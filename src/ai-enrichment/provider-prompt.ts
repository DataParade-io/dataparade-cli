import type { ServiceSection } from "../core/sectioning/discover-service-sections";
import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import type { FileInfo } from "../core/types/file";
import type { AiAgentName, AiInferenceCandidate } from "./types";
import { isSensitiveFileForAiPrompt } from "./sensitive-paths";
import { normScanPath, resolveScannedFileExact } from "./scan-paths";

const MAX_DETECTED_FROM = 14;
const MAX_SOURCE_LOCS = 12;
/** Cap how many files we embed per provider call (token budget). */
const MAX_FILES_IN_PROMPT = 28;
const MAX_CHARS_PER_FILE = 14_000;
const MAX_TOTAL_EXCERPT_CHARS = 100_000;
const NON_ENRICHMENT_PROPERTY_KEYS = new Set(["inference_status"]);

function truncateChars(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n...[truncated]`;
}

function pathsFromComponent(comp: DetectedComponent | undefined): string[] {
  if (!comp) return [];
  const out: string[] = [];
  for (const ref of comp.detectedFrom ?? []) {
    const p = ref.sourceLocation?.filePath;
    if (p) out.push(normScanPath(p));
  }
  for (const loc of comp.sourceLocations ?? []) {
    if (loc.filePath) out.push(normScanPath(loc.filePath));
  }
  return out;
}

/**
 * Collect repo-relative paths tied to queued candidates (components and flow endpoints).
 */
export function collectReferencedPathsForQueue(
  queue: AiInferenceCandidate[],
  components: DetectedComponent[],
  dataFlows: DetectedDataFlow[],
): string[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const ordered = new Set<string>();
  for (const cand of queue) {
    if (cand.componentId) {
      for (const p of pathsFromComponent(byId.get(cand.componentId))) ordered.add(p);
    }
    if (cand.flowId) {
      const flow = dataFlows.find((f) => f.id === cand.flowId);
      if (flow) {
        for (const p of pathsFromComponent(byId.get(flow.sourceComponentId))) ordered.add(p);
        for (const p of pathsFromComponent(byId.get(flow.targetComponentId))) ordered.add(p);
      }
    }
  }
  return [...ordered].sort((a, b) => a.localeCompare(b));
}

/**
 * Map path → file text for paths referenced by the queue, bounded for LLM prompts.
 */
export function buildFileExcerptsForQueue(
  files: FileInfo[],
  queue: AiInferenceCandidate[],
  components: DetectedComponent[],
  dataFlows: DetectedDataFlow[],
): Record<string, string> {
  const paths = collectReferencedPathsForQueue(queue, components, dataFlows);
  const out: Record<string, string> = {};
  let total = 0;
  for (const p of paths) {
    if (Object.keys(out).length >= MAX_FILES_IN_PROMPT) break;
    const fi = resolveScannedFileExact(files, p);
    if (!fi || isSensitiveFileForAiPrompt(fi)) continue;
    const key = normScanPath(fi.path);
    if (out[key]) continue;
    const excerpt = truncateChars(fi.content, MAX_CHARS_PER_FILE);
    if (total + excerpt.length > MAX_TOTAL_EXCERPT_CHARS) break;
    out[key] = excerpt;
    total += excerpt.length;
  }
  return out;
}

export function buildFileExcerptsForPaths(
  files: FileInfo[],
  preferredPaths: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  let total = 0;
  const ordered = [...new Set(preferredPaths.map((p) => normScanPath(p)))].sort((a, b) =>
    a.localeCompare(b),
  );
  for (const p of ordered) {
    if (Object.keys(out).length >= MAX_FILES_IN_PROMPT) break;
    const fi = resolveScannedFileExact(files, p);
    if (!fi || isSensitiveFileForAiPrompt(fi)) continue;
    const key = normScanPath(fi.path);
    if (out[key]) continue;
    const excerpt = truncateChars(fi.content, MAX_CHARS_PER_FILE);
    if (total + excerpt.length > MAX_TOTAL_EXCERPT_CHARS) break;
    out[key] = excerpt;
    total += excerpt.length;
  }
  return out;
}

function isSparseValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Compact component view for LLM prompts: real paths from structural scan,
 * plus which property keys are still empty so the model can target patches.
 */
export function slimComponentForLlm(component: DetectedComponent): Record<string, unknown> {
  const props = component.properties ?? {};
  const sparseKeys: string[] = [];
  const propertiesSet: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (NON_ENRICHMENT_PROPERTY_KEYS.has(key)) continue;
    if (isSparseValue(value)) {
      sparseKeys.push(key);
    } else {
      propertiesSet[key] = value;
    }
  }
  sparseKeys.sort((a, b) => a.localeCompare(b));

  return {
    id: component.id,
    name: component.name,
    type: component.type,
    subType: component.subType,
    description: component.description,
    confidence: component.confidence,
    propertiesSet,
    /** Every property key that is still null/empty/[] — LLM should try to fill these. */
    sparsePropertyKeys: sparseKeys,
    detectedFrom: (component.detectedFrom ?? []).slice(0, MAX_DETECTED_FROM).map((ref) => ({
      pattern: ref.pattern,
      filePath: ref.sourceLocation?.filePath,
      startLine: ref.sourceLocation?.startLine,
      endLine: ref.sourceLocation?.endLine,
    })),
    sourceLocations: (component.sourceLocations ?? []).slice(0, MAX_SOURCE_LOCS).map((loc) => ({
      filePath: loc.filePath,
      startLine: loc.startLine,
      endLine: loc.endLine,
    })),
  };
}

/**
 * JSON user message for {@link AiProvider.infer}: candidates plus enough graph
 * context to produce evidence-backed `proposals`.
 */
export function buildProviderPromptPayload(input: {
  agent: AiAgentName;
  queue: AiInferenceCandidate[];
  components: DetectedComponent[];
  dataFlows: DetectedDataFlow[];
  sections?: ServiceSection[];
  files?: FileInfo[];
  preferredPaths?: string[];
}): Record<string, unknown> {
  const excerpts =
    input.files && input.files.length > 0
      ? input.preferredPaths && input.preferredPaths.length > 0
        ? buildFileExcerptsForPaths(input.files, input.preferredPaths)
        : buildFileExcerptsForQueue(
            input.files,
            input.queue,
            input.components,
            input.dataFlows,
          )
      : {};

  const byId = new Map(input.components.map((c) => [c.id, c]));
  const componentContext: Record<string, Record<string, unknown>> = {};
  for (const cand of input.queue) {
    if (!cand.componentId) continue;
    const comp = byId.get(cand.componentId);
    if (comp && !componentContext[cand.componentId]) {
      componentContext[cand.componentId] = slimComponentForLlm(comp);
    }
  }

  const flowContext: Record<string, Record<string, unknown>> = {};
  for (const cand of input.queue) {
    if (!cand.flowId) continue;
    const flow = input.dataFlows.find((f) => f.id === cand.flowId);
    if (!flow || flowContext[cand.flowId]) continue;
    const src = byId.get(flow.sourceComponentId);
    const tgt = byId.get(flow.targetComponentId);
    flowContext[cand.flowId] = {
      id: flow.id,
      type: flow.type,
      confidence: flow.confidence,
      sourceComponentId: flow.sourceComponentId,
      targetComponentId: flow.targetComponentId,
      sourceName: src?.name,
      targetName: tgt?.name,
    };
  }

  const sectionSummary =
    input.sections?.map((s) => ({
      id: s.id,
      label: s.label,
      role: s.role,
    })) ?? [];

  const hasExcerpts = Object.keys(excerpts).length > 0;
  const canonicalComponentIds = Object.keys(componentContext).sort((a, b) =>
    a.localeCompare(b),
  );

  const propertyShapeHints =
    " **Property shapes (match DataParade scan/schema):** Use snake_case keys from sparsePropertyKeys. " +
    "`integration_method` must always be an array of lowercase tokens (e.g. [\"api\"], [\"sdk\",\"api\"]); never a single string. " +
    "`authentication_method` must be a single string token (e.g. \"api_key\", \"oauth_2_0\", \"openid_connect\", \"jwt\", \"saml\", \"mtls\", \"certificate\", \"basic_auth\", \"none\")—not an array—so it matches product dropdowns. " +
    "`processing_purpose` must be a string array of **taxonomy** tokens the app lists (e.g. authentication, security, analytics, service_provision, payment_processing, marketing, compliance, other)—snake_case only, not sentences. " +
    "Other multi-value fields such as `data_categories_received`, `supported_export_formats`, `cloud_services_used`, `regions_availability_zones` must be string arrays, not one comma-joined string. " +
    "Booleans must be true/false (not strings). Prefer enum-like values in lowercase snake_case (e.g. integration_status: \"active\"). " +
    "For any field that corresponds to an app dropdown or multi-select, use the product's option tokens (snake_case / exact strings) — e.g. legal_basis: \"contractual_necessity\" not \"contract\"; pci_scope: \"saq_d\" not \"full\"; data_transfer_mechanism: \"standard_contractual_clauses\" not raw \"HTTPS\"; risk_rating and encrypt_at_rest must match allowed values.";

  const groundedInstructions =
    "You may output multiple component_patch proposals when they are independently grounded in code/config text. Prefer at most one component_patch per target component, and only for properties you can **ground in code/config text**. Use propertiesSet as truth for fields already set. For every key in setProperties, **propertyEvidence[key]** must be a non-empty array citing filePath + startLine/endLine + reason where that key's value appears in relevantFileContents (when provided) or in the file paths listed on that component in detectedFrom/sourceLocations. If you cannot tie a property to cited text or a cited path, **omit that key**. Indirect guesses are not allowed. It is valid to return **no proposals** or a patch with only one or two setProperties. Never invent URLs, vendor names, analytics products, retention numbers, or compliance labels without a literal basis in the excerpts or cited lines. `targetComponentId` must be exactly one of canonicalComponentIds (componentContext keys). ";

  return {
    instructions: hasExcerpts
      ? `${groundedInstructions} relevantFileContents may be truncated; line ranges must fall within the excerpt for that file. confidence.score should reflect how well the patch is supported (>= 0.72 when merge thresholds apply).`.concat(
          propertyShapeHints,
        )
      : `${groundedInstructions} sourceLocations paths and line ranges you rely on; if you cannot cite support, omit the property. confidence.score should reflect how well the patch is supported (>= 0.72 when merge thresholds apply).`.concat(
          propertyShapeHints,
        ),
    agent: input.agent,
    candidates: input.queue,
    componentContext,
    canonicalComponentIds,
    ...(Object.keys(flowContext).length > 0 ? { flowContext } : {}),
    ...(sectionSummary.length > 0 ? { sectionSummary } : {}),
    ...(hasExcerpts ? { relevantFileContents: excerpts } : {}),
  };
}
