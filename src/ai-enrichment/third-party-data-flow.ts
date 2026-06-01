import type { AiCandidateAgentTrace, AiProposal, EvidenceRef } from "./types";
import type { DetectedComponent } from "../core/types/component";
import type { FileInfo } from "../core/types/file";
import type {
  ThirdPartyDataCategory,
  ThirdPartyDataDirection,
  ThirdPartyDataFlowElement,
  ThirdPartyDataFlowEvidenceRef,
  ThirdPartyDataFlowSummary,
} from "../core/types/result";
import { stableComponentKey } from "../core/pipeline/stable-component-ids";
import { resolveScannedFileExact } from "./scan-paths";
import { loadPiiSignalRules } from "./pii-signal-rules";
import { loadNonPiiSignalRules } from "./non-pii-signal-rules";

interface BuildThirdPartyDataFlowSummaryInput {
  proposals: Array<{ id: string; proposal: AiProposal }>;
  appliedProposalIds: string[];
  /** Final third-party components (post-fallback, post-stable-id assignment). */
  componentsAfterAi: DetectedComponent[];
  files: FileInfo[];
  agenticTrace?: AiCandidateAgentTrace[];
  /** Maps post-AI-merge component ids to final graph ids (via stableComponentKey). */
  proposalTargetComponentIdRemap?: Map<string, string>;
}

/**
 * Bridge AI proposal/trace target ids (post-merge) to final diagram component ids.
 */
export function buildProposalTargetComponentIdRemap(
  postAiComponents: DetectedComponent[],
  finalComponents: DetectedComponent[],
): Map<string, string> {
  const keyToFinalId = new Map<string, string>();
  for (const component of finalComponents) {
    if (component.type !== "third_party") continue;
    keyToFinalId.set(stableComponentKey(component), component.id);
  }

  const remap = new Map<string, string>();
  for (const component of postAiComponents) {
    if (component.type !== "third_party") continue;
    const finalId = keyToFinalId.get(stableComponentKey(component));
    if (finalId) remap.set(component.id, finalId);
  }
  return remap;
}

function resolveComponentId(
  id: string,
  remap: Map<string, string> | undefined,
): string {
  if (!remap) return id;
  return remap.get(id) ?? id;
}

interface PatternRule {
  re: RegExp;
  category: ThirdPartyDataCategory;
  labels: string[];
  capabilities?: string[];
  directionHint?: ThirdPartyDataDirection;
}

const OPERATION_RE =
  /\b(fetch|axios|request|invoke|send|post|get|put|patch|delete|upload|download|signIn|signOut|auth|token|storage|bucket|client|generateContent|chat|completions|models)\b/i;
const AI_VENDOR_TOKEN_RE =
  /\b(openai|googleai|gemini|anthropic|claude|mistral|cohere|vertex|vertexai|generativeai|generativelanguage|genai)\b/i;

const PATTERN_RULES: PatternRule[] = [
  {
    re: /\b(card|payment|invoice|iban|bank[_-]?account|checkout)\b/i,
    category: "financial",
    labels: ["financial_data"],
    capabilities: ["payments"],
  },
  {
    re: /\b(patient|diagnosis|medical|health|phi)\b/i,
    category: "health",
    labels: ["health_data"],
  },
  {
    re: /\b(user[_-]?id|customer[_-]?id|ip[_-]?address|ip)\b/i,
    category: "identifiers",
    labels: ["user_identifier"],
  },
];

function toBand(score: number): "high" | "medium" | "low" {
  if (score >= 0.85) return "high";
  if (score >= 0.65) return "medium";
  return "low";
}

function toEvidence(ref: EvidenceRef): ThirdPartyDataFlowEvidenceRef {
  return {
    filePath: ref.filePath,
    startLine: ref.startLine,
    endLine: ref.endLine,
    reason: ref.reason,
  };
}

function flattenEvidenceFromProposal(proposal: AiProposal): ThirdPartyDataFlowEvidenceRef[] {
  const fromTop = proposal.evidence.map(toEvidence);
  const fromProperty =
    proposal.kind === "component_patch" && proposal.propertyEvidence
      ? Object.values(proposal.propertyEvidence).flat().map(toEvidence)
      : [];
  return [...fromTop, ...fromProperty];
}

function collectFilesForComponent(input: {
  component: DetectedComponent;
  evidence: ThirdPartyDataFlowEvidenceRef[];
  traceByComponent: Map<string, AiCandidateAgentTrace[]>;
  files: FileInfo[];
}): FileInfo[] {
  const paths = new Set<string>();
  for (const loc of input.component.sourceLocations ?? []) {
    if (loc.filePath?.trim()) paths.add(loc.filePath.trim());
  }
  for (const ref of input.evidence) {
    if (ref.filePath?.trim()) paths.add(ref.filePath.trim());
  }
  const traces = input.traceByComponent.get(input.component.id) ?? [];
  for (const trace of traces) {
    for (const fp of trace.filesReviewed) {
      if (fp.trim()) paths.add(fp.trim());
    }
  }

  const out = new Map<string, FileInfo>();
  for (const key of paths) {
    const resolved = resolveScannedFileExact(input.files, key);
    if (resolved) out.set(resolved.path, resolved);
  }
  return [...out.values()];
}

function buildVendorTokens(component: DetectedComponent): string[] {
  const raw = new Set<string>();
  raw.add(component.name);
  const vendor = component.properties.vendor;
  const serviceName = component.properties.serviceName;
  const client = component.properties.client;
  if (typeof vendor === "string") raw.add(vendor);
  if (typeof serviceName === "string") raw.add(serviceName);
  if (typeof client === "string") raw.add(client);
  const tokens = [...raw].flatMap((value) => {
    const lower = value.toLowerCase();
    const pieces = lower
      .split(/[^a-z0-9]+/)
      .map((piece) => piece.trim())
      .filter((piece) => piece.length >= 3);
    // Preserve compact vendor markers such as "google_ai" => "googleai".
    const compact = lower.replace(/[^a-z0-9]+/g, "").trim();
    if (compact.length >= 5) pieces.push(compact);
    return pieces;
  }).filter((token) => token !== "service" && token !== "third" && token !== "party");
  return [...new Set(tokens)];
}

function hasOperationContext(
  lines: string[],
  lineIndex: number,
): boolean {
  const start = Math.max(0, lineIndex - 2);
  const end = Math.min(lines.length - 1, lineIndex + 2);
  for (let i = start; i <= end; i += 1) {
    if (OPERATION_RE.test(lines[i] ?? "")) return true;
  }
  return false;
}

function hasVendorTokenOnLine(line: string, vendorTokens: string[]): boolean {
  const lower = line.toLowerCase();
  return vendorTokens.some((token) => lower.includes(token));
}

function hasVendorContextNearLine(
  lines: string[],
  lineIndex: number,
  vendorTokens: string[],
): boolean {
  const start = Math.max(0, lineIndex - 3);
  const end = Math.min(lines.length - 1, lineIndex + 3);
  for (let i = start; i <= end; i += 1) {
    if (hasVendorTokenOnLine(lines[i] ?? "", vendorTokens)) return true;
  }
  return false;
}

function isAiVendor(vendorTokens: string[]): boolean {
  return vendorTokens.some((token) => AI_VENDOR_TOKEN_RE.test(token));
}

function isAiProviderComponent(component: DetectedComponent): boolean {
  if (component.subType === "ai_provider") return true;
  return isAiVendor(buildVendorTokens(component));
}

/** Rules where prompt/document assembly in a multi-AI handler is attributed to each AI vendor in that file. */
const SHARED_HANDLER_PROMPT_RULE_IDS = new Set([
  "prompt_content_input",
  "document_content_input",
]);

/**
 * Files referenced by two or more distinct AI third-party providers (shared route/handler).
 */
export function buildSharedHandlerAiFileIndex(
  thirdParties: DetectedComponent[],
  files: FileInfo[],
): Set<string> {
  const fileToProviderIds = new Map<string, Set<string>>();

  for (const component of thirdParties) {
    if (!isAiProviderComponent(component)) continue;
    const tokens = buildVendorTokens(component);
    for (const file of files) {
      if (!isVendorRelevantFile(file, tokens)) continue;
      const ids = fileToProviderIds.get(file.path) ?? new Set<string>();
      ids.add(component.id);
      fileToProviderIds.set(file.path, ids);
    }
  }

  const shared = new Set<string>();
  for (const [path, ids] of fileToProviderIds) {
    if (ids.size >= 2) shared.add(path);
  }
  return shared;
}

function passesContentFilesVendorGate(input: {
  line: string;
  lines: string[];
  lineIndex: number;
  vendorTokens: string[];
  category: ThirdPartyDataCategory;
  capabilities: string[] | undefined;
  filePath: string;
  sharedHandlerAiFiles: Set<string> | undefined;
  nonPiiRuleId?: string;
}): boolean {
  if (hasVendorTokenOnLine(input.line, input.vendorTokens)) return true;

  const aiInferenceCapable = input.capabilities?.includes("ai_inference") ?? false;
  if (
    aiInferenceCapable &&
    isAiVendor(input.vendorTokens) &&
    hasVendorContextNearLine(input.lines, input.lineIndex, input.vendorTokens)
  ) {
    return true;
  }

  if (
    input.category === "content_files" &&
    aiInferenceCapable &&
    isAiVendor(input.vendorTokens) &&
    input.sharedHandlerAiFiles?.has(input.filePath) &&
    input.nonPiiRuleId &&
    SHARED_HANDLER_PROMPT_RULE_IDS.has(input.nonPiiRuleId) &&
    hasOperationContext(input.lines, input.lineIndex)
  ) {
    return true;
  }

  return false;
}

function isVendorRelevantFile(file: FileInfo, vendorTokens: string[]): boolean {
  if (vendorTokens.length === 0) return false;
  const lowerPath = file.path.toLowerCase();
  const lowerContent = file.content.toLowerCase();
  return vendorTokens.some(
    (token) => lowerPath.includes(token) || lowerContent.includes(token),
  );
}

function scanDataSignals(
  files: FileInfo[],
  vendorTokens: string[],
  sharedHandlerAiFiles?: Set<string>,
): {
  dataShared: ThirdPartyDataFlowElement[];
  capabilities: string[];
  direction: ThirdPartyDataDirection;
  evidence: ThirdPartyDataFlowEvidenceRef[];
} {
  const labelByCategory = new Map<ThirdPartyDataCategory, Set<string>>();
  const capabilities = new Set<string>();
  const directionHints = new Set<ThirdPartyDataDirection>();
  const evidence: ThirdPartyDataFlowEvidenceRef[] = [];
  const piiRules = loadPiiSignalRules();
  const nonPiiRules = loadNonPiiSignalRules();

  for (const file of files) {
    if (!isVendorRelevantFile(file, vendorTokens)) continue;
    const lines = file.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      for (const rule of PATTERN_RULES) {
        if (!rule.re.test(line)) continue;
        if (
          rule.capabilities?.includes("ai_inference") &&
          !vendorTokens.some((token) => AI_VENDOR_TOKEN_RE.test(token))
        ) {
          continue;
        }
        if (
          rule.category === "content_files" &&
          !passesContentFilesVendorGate({
            line,
            lines,
            lineIndex: i,
            vendorTokens,
            category: rule.category,
            capabilities: rule.capabilities,
            filePath: file.path,
            sharedHandlerAiFiles,
          })
        ) {
          continue;
        }
        if (!hasOperationContext(lines, i)) continue;
        const labels = labelByCategory.get(rule.category) ?? new Set<string>();
        rule.labels.forEach((label) => labels.add(label));
        labelByCategory.set(rule.category, labels);
        rule.capabilities?.forEach((cap) => capabilities.add(cap));
        if (rule.directionHint) directionHints.add(rule.directionHint);
        evidence.push({
          filePath: file.path,
          startLine: i + 1,
          endLine: i + 1,
          reason: `matched ${rule.category} signal`,
        });
      }
      for (const piiRule of piiRules) {
        if (!piiRule.patterns.some((pattern) => pattern.test(line))) continue;
        if (!hasOperationContext(lines, i)) continue;
        const labels = labelByCategory.get(piiRule.category) ?? new Set<string>();
        piiRule.labels.forEach((label) => labels.add(label));
        labelByCategory.set(piiRule.category, labels);
        if (piiRule.category === "credentials") {
          capabilities.add("auth");
          directionHints.add("outbound_to_third_party");
        }
        evidence.push({
          filePath: file.path,
          startLine: i + 1,
          endLine: i + 1,
          reason: `matched pii:${piiRule.id} signal`,
        });
      }
      for (const rule of nonPiiRules) {
        if (!rule.patterns.some((pattern) => pattern.test(line))) continue;
        if (!hasOperationContext(lines, i)) continue;
        if (
          rule.capabilities.includes("ai_inference") &&
          !vendorTokens.some((token) => AI_VENDOR_TOKEN_RE.test(token))
        ) {
          continue;
        }
        if (
          rule.category === "content_files" &&
          !passesContentFilesVendorGate({
            line,
            lines,
            lineIndex: i,
            vendorTokens,
            category: rule.category,
            capabilities: rule.capabilities,
            filePath: file.path,
            sharedHandlerAiFiles,
            nonPiiRuleId: rule.id,
          })
        ) {
          continue;
        }
        const labels = labelByCategory.get(rule.category) ?? new Set<string>();
        rule.labels.forEach((label) => labels.add(label));
        labelByCategory.set(rule.category, labels);
        rule.capabilities.forEach((cap) => capabilities.add(cap));
        if (rule.directionHint) directionHints.add(rule.directionHint);
        const sharedHandler =
          sharedHandlerAiFiles?.has(file.path) &&
          SHARED_HANDLER_PROMPT_RULE_IDS.has(rule.id) &&
          !hasVendorTokenOnLine(line, vendorTokens) &&
          !hasVendorContextNearLine(lines, i, vendorTokens);
        evidence.push({
          filePath: file.path,
          startLine: i + 1,
          endLine: i + 1,
          reason: sharedHandler
            ? `matched non_pii:${rule.id} signal (shared_ai_handler)`
            : `matched non_pii:${rule.id} signal`,
        });
      }
    }
  }

  const dataShared: ThirdPartyDataFlowElement[] = [...labelByCategory.entries()].map(
    ([category, labels]) => ({
      category,
      labels: [...labels].sort(),
    }),
  );

  const outbound = directionHints.has("outbound_to_third_party");
  const inbound = directionHints.has("inbound_from_third_party");
  const direction = outbound && inbound
    ? "bidirectional"
    : outbound
      ? "outbound_to_third_party"
      : inbound
        ? "inbound_from_third_party"
        : "unknown";

  return {
    dataShared: dataShared.sort((a, b) => a.category.localeCompare(b.category)),
    capabilities: [...capabilities].sort(),
    direction,
    evidence: evidence.slice(0, 20),
  };
}

function inferDataSharedFromEvidenceReasons(
  evidence: ThirdPartyDataFlowEvidenceRef[],
): {
  dataShared: ThirdPartyDataFlowElement[];
  capabilities: string[];
  direction: ThirdPartyDataDirection;
} {
  const labelsByCategory = new Map<ThirdPartyDataCategory, Set<string>>();
  const capabilities = new Set<string>();
  const directionHints = new Set<ThirdPartyDataDirection>();

  for (const item of evidence) {
    const text = item.reason.toLowerCase();

    if (/\b(secret|secrets manager|password|credential|token|api key|auth)\b/.test(text)) {
      const labels = labelsByCategory.get("auth_artifacts") ?? new Set<string>();
      labels.add("auth_token");
      labelsByCategory.set("auth_artifacts", labels);
      capabilities.add("auth");
      directionHints.add("outbound_to_third_party");
    }
    if (/\b(db_password|password)\b/.test(text)) {
      const labels = labelsByCategory.get("credentials") ?? new Set<string>();
      labels.add("user_password");
      labelsByCategory.set("credentials", labels);
      capabilities.add("auth");
      directionHints.add("outbound_to_third_party");
    }
    if (/\b(rds|database|db_|postgres|connection parameters|host|port)\b/.test(text)) {
      const labels = labelsByCategory.get("identifiers") ?? new Set<string>();
      labels.add("technical_identifier");
      labelsByCategory.set("identifiers", labels);
      capabilities.add("sdk");
    }
    if (/\b(lambda|handler)\b/.test(text)) {
      capabilities.add("api");
    }
  }

  const outbound = directionHints.has("outbound_to_third_party");
  const inbound = directionHints.has("inbound_from_third_party");
  const direction = outbound && inbound
    ? "bidirectional"
    : outbound
      ? "outbound_to_third_party"
      : inbound
        ? "inbound_from_third_party"
        : "unknown";

  const dataShared: ThirdPartyDataFlowElement[] = [...labelsByCategory.entries()].map(
    ([category, labels]) => ({
      category,
      labels: [...labels].sort(),
    }),
  );

  return {
    dataShared: dataShared.sort((a, b) => a.category.localeCompare(b.category)),
    capabilities: [...capabilities].sort(),
    direction,
  };
}

function shouldIncludeMetadataCapability(capability: string, scannedCapabilities: Set<string>): boolean {
  const normalized = capability.trim().toLowerCase();
  if (!normalized) return false;
  // AI capability must be evidenced by file-level AI signal detection.
  if (normalized === "ai_inference" && !scannedCapabilities.has("ai_inference")) {
    return false;
  }
  if (normalized === "storage" && !scannedCapabilities.has("storage")) {
    return false;
  }
  return true;
}

export function buildThirdPartyDataFlowSummary(
  input: BuildThirdPartyDataFlowSummaryInput,
): ThirdPartyDataFlowSummary {
  const appliedSet = new Set(input.appliedProposalIds);
  const remap = input.proposalTargetComponentIdRemap;
  const traceByComponent = new Map<string, AiCandidateAgentTrace[]>();
  for (const trace of input.agenticTrace ?? []) {
    if (!trace.componentId) continue;
    const resolvedId = resolveComponentId(trace.componentId, remap);
    const existing = traceByComponent.get(resolvedId) ?? [];
    existing.push(trace);
    traceByComponent.set(resolvedId, existing);
  }

  const thirdParties = input.componentsAfterAi.filter((component) => component.type === "third_party");
  const sharedHandlerAiFiles = buildSharedHandlerAiFileIndex(thirdParties, input.files);
  const entries = thirdParties.map((component) => {
    const related = input.proposals.filter(
      (entry) =>
        entry.proposal.kind === "component_patch" &&
        entry.proposal.candidateType === "third_party" &&
        entry.proposal.targetComponentId != null &&
        resolveComponentId(entry.proposal.targetComponentId, remap) === component.id,
    );
    const providerRelated = related.filter((item) => item.id.startsWith("provider_"));
    const heuristicRelated = related.filter((item) => item.id.startsWith("heuristic_"));
    const appliedRelated = related.filter((item) => appliedSet.has(item.id));

    const proposalEvidence = appliedRelated.flatMap((item) =>
      flattenEvidenceFromProposal(item.proposal),
    );
    const files = collectFilesForComponent({
      component,
      evidence: proposalEvidence,
      traceByComponent,
      files: input.files,
    });
    const vendorTokens = buildVendorTokens(component);
    const scanned = scanDataSignals(files, vendorTokens, sharedHandlerAiFiles);
    const inferredFromEvidence = inferDataSharedFromEvidenceReasons(proposalEvidence);
    const allEvidence = [...proposalEvidence, ...scanned.evidence].slice(0, 24);

    let source: "provider" | "heuristic" | "provider_plus_heuristic" = "heuristic";
    if (providerRelated.length > 0 && heuristicRelated.length > 0) {
      source = "provider_plus_heuristic";
    } else if (providerRelated.length > 0) {
      source = "provider";
    }

    const serviceName = typeof component.properties.serviceName === "string"
      ? component.properties.serviceName
      : undefined;
    const mergedDataShared = scanned.dataShared.length > 0
      ? scanned.dataShared
      : inferredFromEvidence.dataShared;
    const inferredCapabilities = new Set<string>([
      ...scanned.capabilities,
      ...inferredFromEvidence.capabilities,
    ]);
    const integrationMethod = component.properties.integration_method;
    if (Array.isArray(integrationMethod)) {
      for (const item of integrationMethod) {
        if (item == null) continue;
        const normalized = String(item).trim().toLowerCase();
        if (!shouldIncludeMetadataCapability(normalized, inferredCapabilities)) continue;
        inferredCapabilities.add(normalized);
      }
    }
    const apiType = component.properties.api_type;
    if (typeof apiType === "string" && apiType.trim()) {
      const normalized = apiType.trim().toLowerCase();
      if (shouldIncludeMetadataCapability(normalized, inferredCapabilities)) {
        inferredCapabilities.add(normalized);
      }
    }

    let confidence = 0.42;
    if (providerRelated.length > 0) confidence += 0.2;
    if (heuristicRelated.length > 0) confidence += 0.08;
    if (scanned.dataShared.length > 0) confidence += 0.1;
    if (allEvidence.length >= 3) confidence += 0.1;
    confidence = Math.max(0.35, Math.min(0.95, Number(confidence.toFixed(2))));

    const notes: string[] = providerRelated.length > 0
      ? ["ai_provider_inference_present"]
      : ["no_provider_inference_for_component"];
    const usesSharedHandler = files.some((f) => sharedHandlerAiFiles.has(f.path));
    if (
      usesSharedHandler &&
      isAiProviderComponent(component) &&
      mergedDataShared.some((item) => item.category === "content_files")
    ) {
      notes.push("shared_ai_handler_prompt_attribution");
    }

    return {
      componentId: component.id,
      componentName: component.name,
      service: serviceName,
      capabilities: [...inferredCapabilities].sort(),
      direction: scanned.direction !== "unknown" ? scanned.direction : inferredFromEvidence.direction,
      dataShared: mergedDataShared.length > 0
        ? mergedDataShared
        : [{ category: "unknown" as const, labels: ["undetermined"] }],
      confidence,
      confidenceBand: toBand(confidence),
      source,
      notes,
      evidence: allEvidence,
    };
  });

  const withDataShared = entries.filter((entry) =>
    entry.dataShared.some((item) => item.category !== "unknown"),
  ).length;

  return {
    entries,
    totals: {
      thirdPartiesAnalyzed: entries.length,
      withDataShared,
    },
  };
}

