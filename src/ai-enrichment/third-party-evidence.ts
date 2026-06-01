import type { DetectedComponent } from "../core/types/component";
import type { FileInfo } from "../core/types/file";
import type {
  AiInferenceCandidate,
  AiProposal,
  ComponentPatch,
  EvidenceRef,
} from "./types";

interface EndpointHit {
  url: string;
  filePath: string;
  line: number;
}

interface ThirdPartyEvidenceBundle {
  candidate: AiInferenceCandidate;
  component: DetectedComponent;
  files: FileInfo[];
  endpoints: EndpointHit[];
  dependencyNames: string[];
  authHints: Set<string>;
  importHints: Set<string>;
}

const KNOWN_VENDOR_DOCS: Record<string, string> = {
  aws: "https://docs.aws.amazon.com",
  stripe: "https://docs.stripe.com",
  sentry: "https://docs.sentry.io",
  auth0: "https://auth0.com/docs",
  twilio: "https://www.twilio.com/docs",
  slack: "https://api.slack.com",
  github: "https://docs.github.com",
  google: "https://cloud.google.com/docs",
  azure: "https://learn.microsoft.com/azure",
};

function isSparse(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function toBand(score: number): "high" | "medium" | "low" {
  if (score >= 0.85) return "high";
  if (score >= 0.65) return "medium";
  return "low";
}

function firstLineMatch(
  file: FileInfo,
  pattern: RegExp,
): { line: number; snippet: string } | undefined {
  const lines = file.content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (pattern.test(line)) {
      return { line: i + 1, snippet: line.trim().slice(0, 160) };
    }
  }
  return undefined;
}

function componentSeedPaths(component: DetectedComponent): Set<string> {
  const seed = new Set<string>();
  const sectionId = component.properties.section_id;
  if (typeof sectionId === "string" && sectionId.trim()) {
    seed.add(sectionId.trim());
  }
  for (const loc of component.sourceLocations ?? []) {
    if (loc.filePath?.trim()) seed.add(loc.filePath.trim());
  }
  for (const ref of component.detectedFrom ?? []) {
    const fp = ref.sourceLocation?.filePath;
    if (fp?.trim()) seed.add(fp.trim());
  }
  return seed;
}

function selectRelevantFiles(component: DetectedComponent, files: FileInfo[]): FileInfo[] {
  const seeds = [...componentSeedPaths(component)];
  if (seeds.length === 0) return [];
  return files.filter((file) => seeds.some((seed) => file.path.startsWith(seed) || seed.startsWith(file.path)));
}

function extractEndpoints(files: FileInfo[]): EndpointHit[] {
  const hits: EndpointHit[] = [];
  const re = /https?:\/\/[^\s"'`)<>\]]+/g;
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      const matches = [...line.matchAll(re)];
      for (const match of matches) {
        const url = match[0];
        if (!url) continue;
        hits.push({ url, filePath: file.path, line: idx + 1 });
      }
    });
  }
  return hits;
}

function parseDependencies(files: FileInfo[]): string[] {
  const out = new Set<string>();
  for (const file of files) {
    if (!file.path.endsWith("package.json")) continue;
    try {
      const parsed = JSON.parse(file.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const key of Object.keys(parsed.dependencies ?? {})) out.add(key.toLowerCase());
      for (const key of Object.keys(parsed.devDependencies ?? {})) out.add(key.toLowerCase());
    } catch {
      // Ignore malformed package json in scanned repositories.
    }
  }
  return [...out].sort();
}

function inferVendor(component: DetectedComponent, evidence: ThirdPartyEvidenceBundle): {
  vendor?: string;
  score: number;
  refs: EvidenceRef[];
} {
  const refs: EvidenceRef[] = [];
  const candidates = new Set<string>();
  const fromName = component.name?.trim();
  if (fromName) candidates.add(fromName.toLowerCase());
  const fromClient = component.properties.client;
  if (typeof fromClient === "string" && fromClient.trim()) {
    candidates.add(fromClient.trim().toLowerCase());
  }
  for (const dep of evidence.dependencyNames) {
    const normalized = dep.replace(/^@/, "").split("/")[0]?.trim();
    if (normalized) candidates.add(normalized.toLowerCase());
  }
  for (const endpoint of evidence.endpoints) {
    try {
      const host = new URL(endpoint.url).hostname.replace(/^api\./, "");
      const base = host.split(".")[0]?.toLowerCase();
      if (base) candidates.add(base);
      refs.push({
        filePath: endpoint.filePath,
        startLine: endpoint.line,
        endLine: endpoint.line,
        reason: `endpoint host suggests vendor ${base ?? host}`,
      });
    } catch {
      // Ignore invalid urls.
    }
  }

  const ranked = [...candidates]
    .map((raw) => {
      if (KNOWN_VENDOR_DOCS[raw]) return { raw, score: 0.92 };
      if (raw.length >= 3) return { raw, score: 0.78 };
      return { raw, score: 0.62 };
    })
    .sort((a, b) => b.score - a.score || a.raw.localeCompare(b.raw));
  const winner = ranked[0];
  if (!winner) return { score: 0, refs: [] };

  const depEvidence = evidence.files.find((f) => f.path.endsWith("package.json"));
  if (depEvidence) {
    refs.push({
      filePath: depEvidence.path,
      startLine: 1,
      endLine: 1,
      reason: "dependency manifest contributes vendor inference",
    });
  }
  return { vendor: winner.raw[0]!.toUpperCase() + winner.raw.slice(1), score: winner.score, refs };
}

function inferAuthHints(files: FileInfo[]): Set<string> {
  const hints = new Set<string>();
  const patterns: Array<{ id: string; re: RegExp }> = [
    { id: "oauth2", re: /\boauth2?\b/i },
    { id: "jwt", re: /\bjwt\b/i },
    { id: "api_key", re: /\bapi[_-]?key\b/i },
    { id: "bearer_token", re: /\bbearer\b/i },
    { id: "basic_auth", re: /\bbasic auth\b/i },
  ];
  for (const file of files) {
    for (const pattern of patterns) {
      if (pattern.re.test(file.content)) hints.add(pattern.id);
    }
  }
  return hints;
}

function inferImportHints(files: FileInfo[]): Set<string> {
  const hints = new Set<string>();
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (const line of lines) {
      if (/\b(import|require)\b/.test(line)) hints.add("sdk");
      if (/\bfetch\(|\baxios\b|\bhttp[s]?:\/\//i.test(line)) hints.add("api");
      if (/\bgraphql\b|\/graphql\b/i.test(line)) hints.add("graphql");
      if (/\bwebhook\b/i.test(line)) hints.add("webhook");
    }
  }
  return hints;
}

function buildBundle(
  candidate: AiInferenceCandidate,
  component: DetectedComponent,
  files: FileInfo[],
): ThirdPartyEvidenceBundle {
  const relevant = selectRelevantFiles(component, files);
  const endpoints = extractEndpoints(relevant);
  return {
    candidate,
    component,
    files: relevant,
    endpoints,
    dependencyNames: parseDependencies(relevant),
    authHints: inferAuthHints(relevant),
    importHints: inferImportHints(relevant),
  };
}

function buildPropertyEvidence(
  refs: EvidenceRef[],
  property: string,
): Record<string, EvidenceRef[]> {
  return { [property]: refs.slice(0, 4) };
}

export function buildThirdPartyHeuristicProposal(input: {
  candidate: AiInferenceCandidate;
  component: DetectedComponent;
  files: FileInfo[];
}): ComponentPatch | undefined {
  const bundle = buildBundle(input.candidate, input.component, input.files);
  if (bundle.files.length === 0) return undefined;

  const setProperties: Record<string, unknown> = {};
  const propertyEvidence: Record<string, EvidenceRef[]> = {};
  const allEvidence: EvidenceRef[] = [];
  const scores: number[] = [];

  const vendorResult = inferVendor(bundle.component, bundle);
  if (vendorResult.vendor && isSparse(bundle.component.properties.vendor)) {
    setProperties.vendor = vendorResult.vendor;
    propertyEvidence.vendor = vendorResult.refs;
    allEvidence.push(...vendorResult.refs);
    scores.push(vendorResult.score);
  }

  const vendorLower = typeof setProperties.vendor === "string"
    ? String(setProperties.vendor).toLowerCase()
    : undefined;
  if (vendorLower && isSparse(bundle.component.properties.serviceName)) {
    setProperties.serviceName = String(setProperties.vendor);
    propertyEvidence.serviceName = propertyEvidence.vendor ?? [];
    scores.push(0.9);
  }
  if (vendorLower && isSparse(bundle.component.properties.client)) {
    setProperties.client = vendorLower;
    propertyEvidence.client = propertyEvidence.vendor ?? [];
    scores.push(0.86);
  }

  if (isSparse(bundle.component.properties.integration_method)) {
    const methods: string[] = [];
    if (bundle.importHints.has("api")) methods.push("api");
    if (bundle.importHints.has("sdk")) methods.push("sdk");
    if (bundle.importHints.has("webhook")) methods.push("webhook");
    if (methods.length > 0) {
      setProperties.integration_method = [...new Set(methods)];
      const file = bundle.files[0]!;
      const match = firstLineMatch(file, /\b(import|require|fetch\(|axios|webhook)\b/i);
      if (match) {
        propertyEvidence.integration_method = buildPropertyEvidence(
          [
            {
              filePath: file.path,
              startLine: match.line,
              endLine: match.line,
              reason: "integration style inferred from imports/call sites",
            },
          ],
          "integration_method",
        ).integration_method;
        allEvidence.push(...(propertyEvidence.integration_method ?? []));
      }
      scores.push(0.82);
    }
  }

  if (isSparse(bundle.component.properties.api_type)) {
    let apiType: string | undefined;
    if (bundle.importHints.has("graphql")) apiType = "graphql";
    else if (bundle.importHints.has("webhook")) apiType = "webhook";
    else if (bundle.endpoints.length > 0 || bundle.importHints.has("api")) apiType = "rest";
    if (apiType) {
      setProperties.api_type = apiType;
      const hit = bundle.endpoints[0];
      if (hit) {
        propertyEvidence.api_type = [
          {
            filePath: hit.filePath,
            startLine: hit.line,
            endLine: hit.line,
            reason: `endpoint usage suggests ${apiType} API`,
          },
        ];
        allEvidence.push(...propertyEvidence.api_type);
      }
      scores.push(apiType === "graphql" ? 0.86 : 0.8);
    }
  }

  if (isSparse(bundle.component.properties.authentication_method)) {
    let method: string | undefined;
    if (bundle.authHints.has("oauth2")) method = "oauth2";
    else if (bundle.authHints.has("api_key")) method = "api_key";
    else if (bundle.authHints.has("bearer_token")) method = "bearer_token";
    else if (bundle.authHints.has("jwt")) method = "jwt";
    else if (bundle.authHints.has("basic_auth")) method = "basic_auth";
    if (method) {
      setProperties.authentication_method = method;
      const matchFile = bundle.files.find((file) =>
        /\boauth2?\b|\bapi[_-]?key\b|\bbearer\b|\bjwt\b|\bbasic auth\b/i.test(file.content),
      );
      if (matchFile) {
        const match = firstLineMatch(
          matchFile,
          /\boauth2?\b|\bapi[_-]?key\b|\bbearer\b|\bjwt\b|\bbasic auth\b/i,
        );
        if (match) {
          propertyEvidence.authentication_method = [
            {
              filePath: matchFile.path,
              startLine: match.line,
              endLine: match.line,
              reason: "auth token/header pattern detected",
            },
          ];
          allEvidence.push(...propertyEvidence.authentication_method);
        }
      }
      scores.push(0.78);
    }
  }

  if (bundle.endpoints.length > 0 && isSparse(bundle.component.properties.api_endpoint)) {
    const endpoint = bundle.endpoints[0]!;
    setProperties.api_endpoint = endpoint.url;
    propertyEvidence.api_endpoint = [
      {
        filePath: endpoint.filePath,
        startLine: endpoint.line,
        endLine: endpoint.line,
        reason: "external endpoint found in section code",
      },
    ];
    allEvidence.push(...propertyEvidence.api_endpoint);
    scores.push(0.84);
  }

  if (bundle.endpoints.length > 0 && isSparse(bundle.component.properties.https_enforced)) {
    const httpsOnly = bundle.endpoints.every((item) => item.url.startsWith("https://"));
    setProperties.https_enforced = httpsOnly;
    const endpoint = bundle.endpoints[0]!;
    propertyEvidence.https_enforced = [
      {
        filePath: endpoint.filePath,
        startLine: endpoint.line,
        endLine: endpoint.line,
        reason: httpsOnly ? "all discovered endpoints are HTTPS" : "non-HTTPS endpoint found",
      },
    ];
    allEvidence.push(...propertyEvidence.https_enforced);
    scores.push(httpsOnly ? 0.9 : 0.7);
  }

  if (vendorLower && isSparse(bundle.component.properties.documentation_url)) {
    const docs = KNOWN_VENDOR_DOCS[vendorLower];
    if (docs) {
      setProperties.documentation_url = docs;
      propertyEvidence.documentation_url = propertyEvidence.vendor ?? [];
      scores.push(0.86);
    }
  }

  if (bundle.dependencyNames.length > 0 && isSparse(bundle.component.properties.sdk_available)) {
    setProperties.sdk_available = true;
    const depFile = bundle.files.find((file) => file.path.endsWith("package.json"));
    if (depFile) {
      propertyEvidence.sdk_available = [
        {
          filePath: depFile.path,
          startLine: 1,
          endLine: 1,
          reason: "dependency manifest indicates SDK/library usage",
        },
      ];
      allEvidence.push(...propertyEvidence.sdk_available);
    }
    scores.push(0.83);
  }

  if (
    (bundle.importHints.has("api") || bundle.importHints.has("sdk")) &&
    isSparse(bundle.component.properties.integration_status)
  ) {
    setProperties.integration_status = "active";
    const file = bundle.files[0];
    if (file) {
      propertyEvidence.integration_status = [
        {
          filePath: file.path,
          startLine: 1,
          endLine: 1,
          reason: "client calls/imports indicate active integration",
        },
      ];
      allEvidence.push(...propertyEvidence.integration_status);
    }
    scores.push(0.8);
  }

  const normalizedSetProperties = { ...setProperties };
  if (Object.keys(normalizedSetProperties).length === 0) return undefined;
  const confidenceScore =
    scores.length > 0 ? Math.max(0.65, Math.min(0.96, scores.reduce((a, b) => a + b, 0) / scores.length)) : 0.65;

  return {
    kind: "component_patch",
    targetComponentId: bundle.component.id,
    candidateType: "third_party",
    setProperties: normalizedSetProperties,
    propertyEvidence,
    confidence: {
      score: Number(confidenceScore.toFixed(2)),
      band: toBand(confidenceScore),
    },
    evidence: allEvidence.slice(0, 16),
    provider: "mock",
    model: "third_party_evidence_v1",
    agent: "tpAgent",
  };
}

function verifyPropertyEvidence(patch: ComponentPatch): boolean {
  if (!patch.propertyEvidence) return false;
  for (const key of Object.keys(patch.setProperties)) {
    const refs = patch.propertyEvidence[key];
    if (!refs || refs.length === 0) return false;
  }
  return true;
}

export function verifyThirdPartyProposal(
  proposal: AiProposal,
): { ok: true } | { ok: false; reason: string } {
  if (proposal.kind !== "component_patch") return { ok: false, reason: "not_component_patch" };
  if (proposal.candidateType !== "third_party") return { ok: false, reason: "not_third_party_candidate" };
  if (proposal.evidence.length === 0) return { ok: false, reason: "missing_evidence" };
  if (!verifyPropertyEvidence(proposal)) return { ok: false, reason: "missing_property_evidence" };
  return { ok: true };
}

