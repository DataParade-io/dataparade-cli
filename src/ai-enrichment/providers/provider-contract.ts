import type { DataFlowType } from "../../core/types/data-flow";
import type {
  AiAgentName,
  AiCandidateType,
  AiProposal,
  AiProviderId,
  ComponentPatch,
  EvidenceRef,
} from "../types";
import { openAiProposalsResponseSchema } from "../openai-proposals-response.schema";
import { normScanPath } from "../scan-paths";
import { isScanAiDebugEnabled } from "../../config/scan-env";

const AGENTS = new Set<AiAgentName>([
  "tpAgent",
  "propertyAgent",
  "directionAgent",
  "interactionAgent",
]);

const CANDIDATE_TYPES = new Set<AiCandidateType>([
  "third_party",
  "node_property",
  "flow_direction",
  "missing_interaction",
]);

const FLOW_TYPES = new Set<string>([
  "api_call",
  "database_query",
  "message_queue",
  "file_transfer",
  "webhook",
  "rpc",
]);

/** Built from the JSON user payload ({@link buildProviderPromptPayload}) to validate evidence. */
export interface ProposalsValidationContext {
  excerptPaths: Set<string>;
  excerptsByNormPath: Map<string, string>;
  allowedPathsByComponentId: Map<string, Set<string>>;
}

function pathsFromSlimComponentEntry(entry: Record<string, unknown>): string[] {
  const out: string[] = [];
  const df = entry.detectedFrom;
  if (Array.isArray(df)) {
    for (const x of df) {
      if (x && typeof x === "object") {
        const fp = (x as Record<string, unknown>).filePath;
        if (typeof fp === "string" && fp.trim()) out.push(normScanPath(fp.trim()));
      }
    }
  }
  const sl = entry.sourceLocations;
  if (Array.isArray(sl)) {
    for (const x of sl) {
      if (x && typeof x === "object") {
        const fp = (x as Record<string, unknown>).filePath;
        if (typeof fp === "string" && fp.trim()) out.push(normScanPath(fp.trim()));
      }
    }
  }
  return out;
}

export function buildProposalsValidationContext(userPrompt: string): ProposalsValidationContext | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(userPrompt);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;

  const excerptPaths = new Set<string>();
  const excerptsByNormPath = new Map<string, string>();
  const rc = o.relevantFileContents;
  if (rc && typeof rc === "object" && !Array.isArray(rc)) {
    for (const key of Object.keys(rc as Record<string, unknown>)) {
      const n = normScanPath(key);
      excerptPaths.add(n);
      const val = (rc as Record<string, unknown>)[key];
      if (typeof val === "string") excerptsByNormPath.set(n, val);
    }
  }

  const allowedPathsByComponentId = new Map<string, Set<string>>();
  const cc = o.componentContext;
  if (cc && typeof cc === "object" && !Array.isArray(cc)) {
    for (const [compId, entry] of Object.entries(cc as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const set = new Set(pathsFromSlimComponentEntry(entry as Record<string, unknown>));
      allowedPathsByComponentId.set(compId, set);
    }
  }

  return { excerptPaths, excerptsByNormPath, allowedPathsByComponentId };
}

function posixBasename(p: string): string {
  const n = normScanPath(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

function findExcerptContent(normFp: string, excerptsByNormPath: Map<string, string>): string | undefined {
  if (excerptsByNormPath.has(normFp)) return excerptsByNormPath.get(normFp);
  for (const [k, v] of excerptsByNormPath) {
    if (normFp === k || normFp.endsWith(`/${k}`) || k.endsWith(`/${normFp}`)) {
      return v;
    }
  }
  const bn = posixBasename(normFp);
  if (bn.length > 0) {
    for (const [k, v] of excerptsByNormPath) {
      if (posixBasename(k) === bn) return v;
    }
  }
  return undefined;
}

function pathsMatchAllowed(normFp: string, allowed: Set<string>): boolean {
  if (allowed.size === 0) return true;
  if (allowed.has(normFp)) return true;
  for (const a of allowed) {
    if (normFp === a) return true;
    if (normFp.endsWith(`/${a}`) || a.endsWith(`/${normFp}`)) return true;
  }
  const bn = posixBasename(normFp);
  if (bn.length > 0) {
    for (const a of allowed) {
      if (posixBasename(a) === bn) return true;
    }
  }
  return false;
}

/**
 * Ensure evidence points at payload files; when an excerpt exists, clamp line ranges to
 * file length instead of dropping (models often overshoot endLine).
 */
function normalizeEvidenceRefForContext(
  ref: EvidenceRef,
  targetComponentId: string,
  ctx: ProposalsValidationContext | null,
): EvidenceRef | null {
  if (!ctx) return ref;

  const normFp = normScanPath(ref.filePath);
  const componentPaths = ctx.allowedPathsByComponentId.get(targetComponentId) ?? new Set<string>();
  const allowed = new Set<string>([...ctx.excerptPaths, ...componentPaths]);

  if (allowed.size > 0 && !pathsMatchAllowed(normFp, allowed)) {
    return null;
  }

  const content = findExcerptContent(normFp, ctx.excerptsByNormPath);
  if (content != null) {
    const lineCount = Math.max(1, content.split(/\r?\n/).length);
    let start = Math.max(1, Math.floor(ref.startLine));
    let end = Math.max(start, Math.floor(ref.endLine));
    start = Math.min(start, lineCount);
    end = Math.min(end, lineCount);
    if (end < start) end = start;
    return { ...ref, filePath: ref.filePath.trim(), startLine: start, endLine: end };
  }

  return { ...ref, filePath: ref.filePath.trim() };
}

function evidenceRefKey(ref: EvidenceRef): string {
  return `${normScanPath(ref.filePath)}|${ref.startLine}|${ref.endLine}|${ref.reason}`;
}

function flattenPropertyEvidence(map: Record<string, EvidenceRef[]>): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const refs of Object.values(map)) {
    for (const ref of refs) {
      const k = evidenceRefKey(ref);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(ref);
    }
  }
  return out;
}

function isPlaceholderPropertyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "" || normalized === "none";
  }
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function sanitizeSetProperties(raw: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "inference_status") continue;
    if (isPlaceholderPropertyValue(value)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

const UI_DATA_CATEGORY_ALLOWED = new Set<string>([
  "personal_identifiers",
  "contact_information",
  "financial_information",
  "health_data",
  "biometric_data",
  "location_data",
  "behavioral_data",
  "employment_data",
  "education_data",
  "special_category_data",
  "criminal_records",
  "demographic_data",
  "online_identifiers",
  "device_identifiers",
  "usage_data",
  "aggregated_analytics",
  "financial_data",
  "geolocation_gps",
  "geolocation_ip",
  "photos_selfies",
  "professional_data",
  "sensitive_personal_data",
  "special_categories",
  "user_identity_direct",
  "user_identity_indirect",
  "other",
]);

const UI_DATA_CATEGORY_ALIASES: Record<string, string> = {
  personal_data: "user_identity_direct",
  pii: "user_identity_direct",
  personally_identifiable_information: "user_identity_direct",
  document_files: "other",
  document_metadata: "other",
  file_content: "other",
  file_metadata: "other",
  email_address: "contact_information",
  credit_card_data: "financial_data",
  payment_data: "financial_data",
  phi: "health_data",
  ip_address: "geolocation_ip",
  device_id: "device_identifiers",
};

const UI_PROCESSING_PURPOSE_ALLOWED = new Set<string>([
  "authentication",
  "service_provision",
  "customer_support",
  "payment_processing",
  "fraud_prevention",
  "analytics",
  "marketing",
  "advertising",
  "development_testing",
  "debugging",
  "security_monitoring",
  "compliance",
  "audit",
  "data_migration",
  "backup_recovery",
  "research",
  "infrastructure_management",
  "hosting_services",
  "data_storage",
  "email_delivery",
  "security",
  "user_insights",
  "performance_monitoring",
  "customer_management",
  "sales_automation",
  "legal_compliance",
  "transactional_emails",
  "marketing_communications",
  "backup_services",
  "disaster_recovery",
  "other",
]);

const UI_PROCESSING_PURPOSE_ALIASES: Record<string, string> = {
  legal: "legal_compliance",
  legal_basis: "legal_compliance",
  provisioning: "service_provision",
  document_processing: "service_provision",
  storage: "data_storage",
  backup: "backup_services",
};

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function toStringArray(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v)).map((v) => v.trim()).filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [String(raw).trim()].filter(Boolean);
}

function mapToAllowed(
  values: string[],
  allowed: Set<string>,
  aliases: Record<string, string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const token = normalizeToken(value);
    if (!token) continue;
    const mapped = allowed.has(token) ? token : aliases[token] ?? "other";
    if (!allowed.has(mapped)) continue;
    if (!seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out;
}

function normalizeThirdPartySetPropertiesForUi(
  input: Record<string, unknown>,
): { normalized: Record<string, unknown>; evidenceSourceByKey: Record<string, string> } {
  const normalized: Record<string, unknown> = { ...input };
  const evidenceSourceByKey: Record<string, string> = {};

  if (Object.prototype.hasOwnProperty.call(normalized, "data_categories_received")) {
    const values = toStringArray(normalized.data_categories_received);
    const mapped = mapToAllowed(values, UI_DATA_CATEGORY_ALLOWED, UI_DATA_CATEGORY_ALIASES);
    if (mapped.length > 0) normalized.data_categories_received = mapped;
    else delete normalized.data_categories_received;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, "processing_purpose")) {
    const values = toStringArray(normalized.processing_purpose);
    const mapped = mapToAllowed(
      values,
      UI_PROCESSING_PURPOSE_ALLOWED,
      UI_PROCESSING_PURPOSE_ALIASES,
    );
    if (mapped.length > 0) normalized.processing_purpose = mapped;
    else delete normalized.processing_purpose;
  }

  if (
    !Object.prototype.hasOwnProperty.call(normalized, "cloud_provider") &&
    Object.prototype.hasOwnProperty.call(normalized, "cloud_services_used")
  ) {
    const services = toStringArray(normalized.cloud_services_used).map(normalizeToken);
    const provider =
      services.find((s) => s === "aws" || s === "amazon" || s === "amazon_web_services")
        ? "AWS"
        : services.find((s) => s === "gcp" || s === "google" || s === "google_cloud")
          ? "GCP"
          : services.find((s) => s === "azure" || s === "microsoft_azure")
            ? "Azure"
            : undefined;
    if (provider) {
      normalized.cloud_provider = provider;
      evidenceSourceByKey.cloud_provider = "cloud_services_used";
    }
  }

  return { normalized, evidenceSourceByKey };
}

export function parseAgentFromPrompt(prompt: string): AiAgentName {
  try {
    const o = JSON.parse(prompt) as { agent?: string };
    if (o.agent && AGENTS.has(o.agent as AiAgentName)) {
      return o.agent as AiAgentName;
    }
  } catch {
    /* user message may not be JSON */
  }
  return "propertyAgent";
}

export function aiDebugEnabled(): boolean {
  return isScanAiDebugEnabled();
}

function normalizeEvidence(raw: unknown): EvidenceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: EvidenceRef[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const filePath = typeof o.filePath === "string" ? o.filePath.trim() : "";
    const startLine =
      typeof o.startLine === "number" && Number.isFinite(o.startLine)
        ? Math.max(1, Math.floor(o.startLine))
        : 1;
    const endLine =
      typeof o.endLine === "number" && Number.isFinite(o.endLine)
        ? Math.max(startLine, Math.floor(o.endLine))
        : startLine;
    const reason = typeof o.reason === "string" ? o.reason.trim() : "";
    if (!filePath || !reason) continue;
    out.push({ filePath, startLine, endLine, reason });
  }
  return out;
}

function normalizeConfidence(raw: unknown): { score: number; band: "high" | "medium" | "low" } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const score = typeof o.score === "number" && Number.isFinite(o.score) ? o.score : NaN;
  if (score < 0 || score > 1) return null;
  const band =
    o.band === "high" || o.band === "medium" || o.band === "low" ? o.band : "medium";
  return { score, band };
}

function normalizeComponentPatch(
  p: Record<string, unknown>,
  ct: AiCandidateType,
  conf: { score: number; band: "high" | "medium" | "low" },
  defaults: { provider: AiProviderId; model: string; agent: AiAgentName },
  validationCtx: ProposalsValidationContext | null,
  reportDrop?: DropReporter,
): ComponentPatch | null {
  const targetComponentId =
    typeof p.targetComponentId === "string" ? p.targetComponentId.trim() : "";
  if (!targetComponentId) {
    reportDrop?.("component_patch_missing_targetComponentId", p);
    return null;
  }

  const setProperties = p.setProperties;
  if (
    typeof setProperties !== "object" ||
    setProperties === null ||
    Array.isArray(setProperties)
  ) {
    reportDrop?.("component_patch_invalid_setProperties_object", p);
    return null;
  }

  const peRaw = p.propertyEvidence;
  if (
    typeof peRaw !== "object" ||
    peRaw === null ||
    Array.isArray(peRaw)
  ) {
    reportDrop?.("component_patch_invalid_propertyEvidence_object", p);
    return null;
  }

  const sanitizedSetProperties = sanitizeSetProperties(setProperties as Record<string, unknown>);
  const thirdPartyNormalized =
    ct === "third_party"
      ? normalizeThirdPartySetPropertiesForUi(sanitizedSetProperties)
      : { normalized: sanitizedSetProperties, evidenceSourceByKey: {} as Record<string, string> };
  const normalizedSetProperties = thirdPartyNormalized.normalized;
  const evidenceSourceByKey = thirdPartyNormalized.evidenceSourceByKey;
  const propKeys = Object.keys(normalizedSetProperties);
  if (propKeys.length === 0) {
    reportDrop?.("component_patch_setProperties_empty_after_sanitize", p);
    return null;
  }

  const propertyEvidenceRecord = peRaw as Record<string, unknown>;
  const keptProps: Record<string, unknown> = {};
  const keptEvidence: Record<string, EvidenceRef[]> = {};

  for (const key of propKeys) {
    const sourceKey = evidenceSourceByKey[key] ?? key;
    const refs = normalizeEvidence(propertyEvidenceRecord[sourceKey]);
    if (refs.length === 0) {
      reportDrop?.(`component_patch_property_${key}_missing_or_invalid_evidence`, {
        targetComponentId,
        key,
      });
      continue;
    }
    const adjustedRefs: EvidenceRef[] = [];
    let allRefsValid = true;
    for (const ref of refs) {
      const adj = normalizeEvidenceRefForContext(ref, targetComponentId, validationCtx);
      if (!adj) {
        allRefsValid = false;
        reportDrop?.(`component_patch_property_${key}_evidence_path_not_allowed`, {
          targetComponentId,
          key,
          evidenceFilePath: ref.filePath,
        });
        break;
      }
      adjustedRefs.push(adj);
    }
    if (!allRefsValid) continue;
    keptProps[key] = normalizedSetProperties[key] as unknown;
    keptEvidence[key] = adjustedRefs;
  }

  if (Object.keys(keptProps).length === 0) {
    reportDrop?.("component_patch_all_properties_dropped_by_evidence_validation", {
      targetComponentId,
      attemptedPropertyKeys: propKeys,
    });
    return null;
  }

  const evidence = flattenPropertyEvidence(keptEvidence);
  if (evidence.length === 0) {
    reportDrop?.("component_patch_flattened_evidence_empty", {
      targetComponentId,
      keptPropertyKeys: Object.keys(keptProps),
    });
    return null;
  }

  return {
    kind: "component_patch",
    targetComponentId,
    candidateType: ct,
    setSubType:
      typeof p.setSubType === "string" && p.setSubType.trim()
        ? p.setSubType.trim()
        : undefined,
    setDescription:
      typeof p.setDescription === "string" && p.setDescription.trim()
        ? p.setDescription.trim()
        : undefined,
    setProperties: keptProps,
    propertyEvidence: keptEvidence,
    confidence: conf,
    evidence,
    provider: defaults.provider,
    model: defaults.model,
    agent: defaults.agent,
  };
}

function normalizeProposal(
  raw: unknown,
  defaults: { provider: AiProviderId; model: string; agent: AiAgentName },
  validationCtx: ProposalsValidationContext | null,
  reportDrop?: DropReporter,
): AiProposal | null {
  if (!raw || typeof raw !== "object") {
    reportDrop?.("proposal_not_object", raw);
    return null;
  }
  const p = raw as Record<string, unknown>;
  const kind = p.kind;
  const candidateType = p.candidateType;
  if (
    typeof candidateType !== "string" ||
    !CANDIDATE_TYPES.has(candidateType as AiCandidateType)
  ) {
    reportDrop?.("proposal_invalid_candidateType", p);
    return null;
  }
  const ct = candidateType as AiCandidateType;
  const conf = normalizeConfidence(p.confidence);
  if (!conf) {
    reportDrop?.("proposal_invalid_confidence", p);
    return null;
  }

  if (kind === "component_patch") {
    return normalizeComponentPatch(p, ct, conf, defaults, validationCtx, reportDrop);
  }

  const evidence = normalizeEvidence(p.evidence);
  if (evidence.length === 0) {
    reportDrop?.("flow_patch_missing_or_invalid_evidence", p);
    return null;
  }

  if (kind === "flow_patch") {
    const targetFlowId =
      typeof p.targetFlowId === "string" && p.targetFlowId.trim()
        ? p.targetFlowId.trim()
        : undefined;
    const sourceComponentId =
      typeof p.sourceComponentId === "string" ? p.sourceComponentId.trim() : "";
    const targetComponentId =
      typeof p.targetComponentId === "string" ? p.targetComponentId.trim() : "";
    if (!targetFlowId && (!sourceComponentId || !targetComponentId)) {
      reportDrop?.("flow_patch_missing_target_and_endpoints", p);
      return null;
    }

    let setType: DataFlowType | undefined;
    if (typeof p.setType === "string" && FLOW_TYPES.has(p.setType)) {
      setType = p.setType as DataFlowType;
    }

    return {
      kind: "flow_patch",
      candidateType: ct,
      targetFlowId,
      insertIfMissing: p.insertIfMissing === true,
      sourceComponentId: sourceComponentId || undefined,
      targetComponentId: targetComponentId || undefined,
      setType,
      setDirection:
        p.setDirection === "forward" || p.setDirection === "reverse"
          ? p.setDirection
          : undefined,
      setMethod:
        typeof p.setMethod === "string" && p.setMethod.trim()
          ? p.setMethod.trim()
          : undefined,
      setEndpoint:
        typeof p.setEndpoint === "string" && p.setEndpoint.trim()
          ? p.setEndpoint.trim()
          : undefined,
      setDescription:
        typeof p.setDescription === "string" && p.setDescription.trim()
          ? p.setDescription.trim()
          : undefined,
      confidence: conf,
      evidence,
      provider: defaults.provider,
      model: defaults.model,
      agent: defaults.agent,
    };
  }

  reportDrop?.("proposal_unknown_kind", p);
  return null;
}

export interface StrictParseProposalsOptions {
  debugLabel: string;
  /** JSON user message from {@link buildProviderPromptPayload}; validates evidence paths and line ranges. */
  userPrompt?: string;
}

function previewJson(value: unknown, maxChars?: number): string {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return "<empty>";
    if (typeof maxChars !== "number" || !Number.isFinite(maxChars) || maxChars <= 0) {
      return serialized;
    }
    return serialized.length > maxChars
      ? `${serialized.slice(0, maxChars)}...<truncated>`
      : serialized;
  } catch {
    return "<unserializable>";
  }
}

type DropReporter = (reason: string, raw?: unknown) => void;

function coercePropertyEvidenceShape(
  proposal: unknown,
): unknown {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    return proposal;
  }
  const p = proposal as Record<string, unknown>;
  const propertyEvidence = p.propertyEvidence;
  if (!propertyEvidence || typeof propertyEvidence !== "object" || Array.isArray(propertyEvidence)) {
    return proposal;
  }
  const pe = propertyEvidence as Record<string, unknown>;
  let changed = false;
  const coerced: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(pe)) {
    if (Array.isArray(value)) {
      coerced[key] = value;
      continue;
    }
    if (value && typeof value === "object") {
      coerced[key] = [value];
      changed = true;
      continue;
    }
    coerced[key] = value;
  }
  if (!changed) return proposal;
  return { ...p, propertyEvidence: coerced };
}

export function strictParseAndNormalizeProposals(
  raw: unknown,
  defaults: { provider: AiProviderId; model: string; agent: AiAgentName },
  options: StrictParseProposalsOptions,
): AiProposal[] {
  const dropReasonCounts = new Map<string, number>();
  const dropReasonSamples = new Map<string, string>();
  const reportDrop: DropReporter = (reason, rawValue) => {
    dropReasonCounts.set(reason, (dropReasonCounts.get(reason) ?? 0) + 1);
    if (!dropReasonSamples.has(reason) && rawValue !== undefined) {
      dropReasonSamples.set(reason, previewJson(rawValue, 400));
    }
  };

  const coerceRaw = (() => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const o = raw as Record<string, unknown>;
    const proposals = o.proposals;
    if (Array.isArray(proposals)) {
      return {
        ...o,
        proposals: proposals.map((item) => coercePropertyEvidenceShape(item)),
      };
    }
    if (!proposals || typeof proposals !== "object") {
      return raw;
    }
    // Anthropic occasionally returns `proposals` as an object keyed by index.
    // Coerce this shape into the expected array before strict schema validation.
    const base = {
      ...o,
      proposals: Object.values(proposals as Record<string, unknown>),
    };
    const arr = base.proposals;
    return Array.isArray(arr)
      ? { ...base, proposals: arr.map((item) => coercePropertyEvidenceShape(item)) }
      : base;
  })();

  const validated = openAiProposalsResponseSchema.safeParse(coerceRaw);
  if (!validated.success) {
    if (aiDebugEnabled()) {
      const rawObj =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : null;
      const coercedObj =
        coerceRaw && typeof coerceRaw === "object" && !Array.isArray(coerceRaw)
          ? (coerceRaw as Record<string, unknown>)
          : null;
      const rawProposals = rawObj?.proposals;
      const coercedProposals = coercedObj?.proposals;
      console.warn(
        `[dataparade-ai] ${options.debugLabel}: schema validation failed for provider response.`,
        validated.error.flatten(),
      );
      console.warn(
        `[dataparade-ai] ${options.debugLabel}: response shape debug`,
        {
          rawType: Array.isArray(raw) ? "array" : typeof raw,
          rawKeys: rawObj ? Object.keys(rawObj).slice(0, 20) : [],
          rawProposalsType: Array.isArray(rawProposals) ? "array" : typeof rawProposals,
          coercedProposalsType: Array.isArray(coercedProposals)
            ? "array"
            : typeof coercedProposals,
          coercedProposalsLength: Array.isArray(coercedProposals)
            ? coercedProposals.length
            : undefined,
        },
      );
      console.warn(
        `[dataparade-ai] ${options.debugLabel}: raw response preview ${previewJson(raw)}`,
      );
      console.warn(
        `[dataparade-ai] ${options.debugLabel}: coerced response preview ${previewJson(coerceRaw)}`,
      );
    }
    return [];
  }

  const validationCtx = options.userPrompt
    ? buildProposalsValidationContext(options.userPrompt)
    : null;

  const out: AiProposal[] = [];
  const totalValidated = validated.data.proposals.length;
  for (const item of validated.data.proposals) {
    const proposal = normalizeProposal(
      item as unknown,
      defaults,
      validationCtx,
      reportDrop,
    );
    if (proposal) out.push(proposal);
  }

  if (aiDebugEnabled()) {
    const dropped = totalValidated - out.length;
    console.warn(
      `[dataparade-ai] ${options.debugLabel}: normalization summary validated=${totalValidated} kept=${out.length} dropped=${dropped}`,
    );
    if (dropped > 0) {
      const sortedReasons = [...dropReasonCounts.entries()].sort((a, b) => b[1] - a[1]);
      console.warn(
        `[dataparade-ai] ${options.debugLabel}: normalization drop reasons`,
        Object.fromEntries(sortedReasons),
      );
      for (const [reason] of sortedReasons.slice(0, 8)) {
        const sample = dropReasonSamples.get(reason);
        if (sample) {
          console.warn(
            `[dataparade-ai] ${options.debugLabel}: sample for ${reason}: ${sample}`,
          );
        }
      }
    }
    if (out.length > 0) {
      console.warn(
        `[dataparade-ai] ${options.debugLabel}: first normalized proposal preview ${previewJson(out[0])}`,
      );
    }
  }

  return out;
}
