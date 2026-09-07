import type { DetectedComponent } from "../core/types/component";
import { normalizeThirdPartySubType } from "./third-party-subtype";
import type { DetectedDataFlow } from "../core/types/data-flow";
import {
  componentMayCarryDataActions,
  mergeOneAssignment,
  normalizeDataAction,
  readDataActions,
  selectPrimaryDataAction,
  sortDataFlowsDeterministically,
} from "@dataparade/scanner";
import type { DataAction, DataActionAssignment } from "@dataparade/scanner";
import path from "path";
import { isDeepStrictEqual } from "util";
import type {
  AiMergeResult,
  AiMergeThresholds,
  AiProposal,
  ComponentPatch,
  EvidenceRef,
  FlowPatch,
  MergeProvenance,
} from "./types";
import { UI_DATA_ACTION_PROPERTY_KEY } from "./providers/provider-contract";

/** PRD §4.4 / task 2.2 — AI data-action assignments gated at ≥ 0.72. */
export const DATA_ACTION_MIN_CONFIDENCE = 0.72;

const DEFAULT_THRESHOLDS: AiMergeThresholds = {
  minComponentPatchConfidence: DATA_ACTION_MIN_CONFIDENCE,
  minFlowPatchConfidence: 0.75,
  minInsertFlowConfidence: 0.85,
};

/** When true, flow_patch proposals are not applied — data-flow graph stays exactly as detected before AI. */
export interface MergeAiProposalsOptions {
  preserveDataFlowTopology?: boolean;
  enforceIntraSectionFlowChangesOnly?: boolean;
}

function normalizeAlias(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function stripIndexSuffix(p: string): string {
  const normalized = normalizeAlias(p);
  const base = path.posix.basename(normalized);
  const stem = base.replace(/\.[^.]+$/, "");
  if (stem !== "index") return normalized;
  const dir = path.posix.dirname(normalized);
  return dir === "." ? normalized : normalizeAlias(dir);
}

function addAlias(aliasMap: Map<string, Set<string>>, alias: string, componentId: string): void {
  const key = normalizeAlias(alias);
  if (!key) return;
  const set = aliasMap.get(key) ?? new Set<string>();
  set.add(componentId);
  aliasMap.set(key, set);
}

function buildComponentAliasMap(components: DetectedComponent[]): Map<string, Set<string>> {
  const aliasMap = new Map<string, Set<string>>();
  for (const component of components) {
    addAlias(aliasMap, component.id, component.id);
    addAlias(aliasMap, component.name, component.id);

    for (const loc of component.sourceLocations ?? []) {
      if (!loc.filePath) continue;
      const fp = normalizeAlias(loc.filePath);
      addAlias(aliasMap, fp, component.id);
      addAlias(aliasMap, stripIndexSuffix(fp), component.id);
      addAlias(aliasMap, path.posix.dirname(fp), component.id);
    }
    for (const ref of component.detectedFrom ?? []) {
      const fp = ref.sourceLocation?.filePath;
      if (!fp) continue;
      const normalized = normalizeAlias(fp);
      addAlias(aliasMap, normalized, component.id);
      addAlias(aliasMap, stripIndexSuffix(normalized), component.id);
      addAlias(aliasMap, path.posix.dirname(normalized), component.id);
    }
  }
  return aliasMap;
}

function remapComponentPatchTarget(
  patch: ComponentPatch,
  componentIds: Set<string>,
  aliasMap: Map<string, Set<string>>,
): ComponentPatch {
  if (componentIds.has(patch.targetComponentId)) return patch;
  const key = normalizeAlias(patch.targetComponentId);
  const matches = aliasMap.get(key);
  if (!matches || matches.size !== 1) return patch;
  const [mappedId] = [...matches];
  if (!mappedId || !componentIds.has(mappedId)) return patch;
  return {
    ...patch,
    targetComponentId: mappedId,
  };
}

function proposalTargetKey(proposal: AiProposal): string {
  if (proposal.kind === "component_patch") {
    const propKeys = Object.keys(proposal.setProperties ?? {}).sort().join("|");
    const sub = proposal.setSubType ? `sub:${proposal.setSubType}` : "";
    const desc = proposal.setDescription ? "desc" : "";
    return `component:${proposal.targetComponentId}:${propKeys}:${sub}:${desc}`;
  }

  if (proposal.targetFlowId) {
    return `flow:${proposal.targetFlowId}`;
  }

  return `flow:${proposal.sourceComponentId}->${proposal.targetComponentId}`;
}

function proposalRank(proposal: AiProposal): number {
  const confidenceScore = proposal.confidence.score;
  const evidenceWeight = proposal.evidence.length / 100;
  const insertPenalty =
    proposal.kind === "flow_patch" && proposal.insertIfMissing ? -0.02 : 0;
  const llmBonus = proposal.provider !== "mock" ? 0.25 : 0;
  return confidenceScore + evidenceWeight + insertPenalty + llmBonus;
}

function sortedProposals(proposals: Array<{ id: string; proposal: AiProposal }>) {
  return [...proposals].sort((a, b) => {
    const rankDelta = proposalRank(b.proposal) - proposalRank(a.proposal);
    if (rankDelta !== 0) return rankDelta;

    const aKey = proposalTargetKey(a.proposal);
    const bKey = proposalTargetKey(b.proposal);
    if (aKey !== bKey) return aKey.localeCompare(bKey);

    return a.id.localeCompare(b.id);
  });
}

function toProvenance(
  proposal: ComponentPatch | FlowPatch,
  confidence: number,
): MergeProvenance {
  return {
    source: "ai_agent",
    provider: proposal.provider,
    model: proposal.model,
    agent: proposal.agent,
    candidateType: proposal.candidateType,
    confidence,
    confidenceBand: proposal.confidence.band,
    evidence: proposal.evidence,
  };
}

function evidenceRefsForDataAction(patch: ComponentPatch): EvidenceRef[] {
  const fromProperty = patch.propertyEvidence?.[UI_DATA_ACTION_PROPERTY_KEY];
  if (Array.isArray(fromProperty) && fromProperty.length > 0) return fromProperty;
  return patch.evidence;
}

function toSourceLocations(refs: EvidenceRef[]) {
  return refs.map((ref) => ({
    filePath: ref.filePath,
    startLine: ref.startLine,
    endLine: ref.endLine,
  }));
}

/**
 * Build an AI-sourced assignment for one verb.
 * Relay uses topology corroboration so mergeOneAssignment may assert it (conservative-absence rule).
 */
function buildAiDataActionAssignment(
  action: DataAction,
  patch: ComponentPatch,
): DataActionAssignment {
  const refs = evidenceRefsForDataAction(patch);
  const reason =
    refs
      .map((r) => r.reason.trim())
      .filter(Boolean)
      .join("; ") || "ai enrichment evidence";

  if (action === "relay") {
    return {
      action: "relay",
      source: "ai",
      confidence: patch.confidence.score,
      status: "asserted",
      evidence: {
        kind: "pattern_rule",
        description: reason,
        corroboration: reason,
      },
    };
  }

  return {
    action,
    source: "ai",
    confidence: patch.confidence.score,
    status: "asserted",
    evidence: toSourceLocations(refs),
  };
}

function parseProposedDataActions(raw: unknown): DataAction[] {
  if (raw == null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  const out: DataAction[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const action = normalizeDataAction(String(value));
    if (!action || seen.has(action)) continue;
    seen.add(action);
    out.push(action);
  }
  return out;
}

/**
 * Merge AI-proposed `data_action` verbs into set-valued `properties.dataActions`.
 * Adds / promotes only; never removes deterministic or user assignments.
 */
function mergeDataActionProperties(
  component: DetectedComponent,
  patch: ComponentPatch,
  proposedRaw: unknown,
): boolean {
  if (!componentMayCarryDataActions(component.type)) {
    return false;
  }
  if (patch.confidence.score < DATA_ACTION_MIN_CONFIDENCE) {
    return false;
  }

  const proposed = parseProposedDataActions(proposedRaw);
  if (proposed.length === 0) return false;

  const refs = evidenceRefsForDataAction(patch);
  if (refs.length === 0) return false;

  let merged = [...readDataActions(component)];
  const before = JSON.stringify(merged);

  for (const action of proposed) {
    merged = mergeOneAssignment(merged, buildAiDataActionAssignment(action, patch));
  }

  merged.sort((a, b) => a.action.localeCompare(b.action));
  if (JSON.stringify(merged) === before) {
    return false;
  }

  component.properties = {
    ...component.properties,
    dataActions: merged,
  };
  const primary = selectPrimaryDataAction(merged);
  if (primary) {
    component.properties.primaryDataAction = primary;
  } else {
    delete component.properties.primaryDataAction;
  }
  return true;
}

function mergeComponentPatch(
  components: DetectedComponent[],
  patch: ComponentPatch,
): boolean {
  const component = components.find((item) => item.id === patch.targetComponentId);
  if (!component) return false;

  let changed = false;

  const normalizedSubType = normalizeThirdPartySubType(patch.setSubType);
  if (normalizedSubType && normalizedSubType !== component.subType) {
    component.subType = normalizedSubType;
    changed = true;
  }
  if (patch.setDescription && patch.setDescription !== component.description) {
    component.description = patch.setDescription;
    changed = true;
  }

  const setProperties = patch.setProperties ?? {};
  const dataActionRaw =
    setProperties[UI_DATA_ACTION_PROPERTY_KEY] ?? setProperties.dataActions;
  if (dataActionRaw !== undefined) {
    if (mergeDataActionProperties(component, patch, dataActionRaw)) {
      changed = true;
    }
  }

  const currentProperties = component.properties ?? {};
  const nextProperties = { ...currentProperties };
  for (const [key, value] of Object.entries(setProperties)) {
    if (key === UI_DATA_ACTION_PROPERTY_KEY || key === "dataActions") {
      continue;
    }
    const currentValue = currentProperties[key];
    if (key === "inference_status" && value === "needs_review") {
      continue;
    }
    const normalizedCurrent = normalizeEmptyLikeValue(currentValue);
    const normalizedNext = normalizeEmptyLikeValue(value);
    if (isDeepStrictEqual(normalizedCurrent, normalizedNext)) {
      continue;
    }
    nextProperties[key] = value;
    changed = true;
  }
  component.properties = nextProperties;

  return changed;
}

function normalizeEmptyLikeValue(value: unknown): unknown {
  if (value == null) return "__empty__";
  if (typeof value === "string" && value.trim().toLowerCase() === "none") {
    return "__empty__";
  }
  if (Array.isArray(value) && value.length === 0) return "__empty__";
  return value;
}

function normalizeSectionId(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const section = String(raw).trim();
  return section.length > 0 ? section : undefined;
}

function resolveFlowPatchEndpoints(
  patch: FlowPatch,
  flows: DetectedDataFlow[],
): { sourceComponentId: string; targetComponentId: string } | undefined {
  if (patch.targetFlowId) {
    const targetFlow = flows.find((flow) => flow.id === patch.targetFlowId);
    if (!targetFlow) return undefined;
    return {
      sourceComponentId: targetFlow.sourceComponentId,
      targetComponentId: targetFlow.targetComponentId,
    };
  }

  if (patch.sourceComponentId && patch.targetComponentId) {
    return {
      sourceComponentId: patch.sourceComponentId,
      targetComponentId: patch.targetComponentId,
    };
  }

  return undefined;
}

function isIntraSectionFlowPatch(
  patch: FlowPatch,
  componentsById: Map<string, DetectedComponent>,
  flows: DetectedDataFlow[],
): boolean {
  const endpoints = resolveFlowPatchEndpoints(patch, flows);
  if (!endpoints) return false;
  const source = componentsById.get(endpoints.sourceComponentId);
  const target = componentsById.get(endpoints.targetComponentId);
  if (!source || !target) return false;

  const sourceSectionId = normalizeSectionId(source.properties?.section_id);
  const targetSectionId = normalizeSectionId(target.properties?.section_id);
  return sourceSectionId === targetSectionId;
}

function mergeFlowPatch(flows: DetectedDataFlow[], patch: FlowPatch): boolean {
  const flow = patch.targetFlowId
    ? flows.find((item) => item.id === patch.targetFlowId)
    : flows.find(
        (item) =>
          item.sourceComponentId === patch.sourceComponentId &&
          item.targetComponentId === patch.targetComponentId,
      );

  if (!flow) {
    if (!patch.insertIfMissing) return false;
    if (!patch.sourceComponentId || !patch.targetComponentId) return false;

    const inserted: DetectedDataFlow = {
      id: `flow_ai_${patch.sourceComponentId}_${patch.targetComponentId}_${flows.length + 1}`,
      sourceComponentId: patch.sourceComponentId,
      targetComponentId: patch.targetComponentId,
      type: patch.setType ?? "api_call",
      description: patch.setDescription,
      confidence: patch.confidence.score,
      method: patch.setMethod,
      endpoint: patch.setEndpoint,
      sourceLocations: patch.evidence.map((e) => ({
        filePath: e.filePath,
        startLine: e.startLine,
        endLine: e.endLine,
      })),
    };

    flows.push(inserted);
    return true;
  }

  if (patch.setType) flow.type = patch.setType;
  if (patch.setMethod) flow.method = patch.setMethod;
  if (patch.setEndpoint) flow.endpoint = patch.setEndpoint;
  if (patch.setDescription) flow.description = patch.setDescription;
  flow.confidence = Math.max(flow.confidence, patch.confidence.score);
  return true;
}

export function mergeAiProposals(
  components: DetectedComponent[],
  dataFlows: DetectedDataFlow[],
  proposals: Array<{ id: string; proposal: AiProposal }>,
  thresholds: Partial<AiMergeThresholds> = {},
  options: MergeAiProposalsOptions = {},
): AiMergeResult {
  const mergedThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const nextComponents = components.map((component) => ({
    ...component,
    properties: { ...component.properties },
  }));
  const nextFlows = dataFlows.map((flow) => ({ ...flow }));
  const appliedProposalIds: string[] = [];
  const rejectedProposalIds: Array<{ proposalId: string; reason: string }> = [];
  const provenanceByTarget: Record<string, MergeProvenance> = {};
  const componentIds = new Set(nextComponents.map((c) => c.id));
  const aliasMap = buildComponentAliasMap(nextComponents);
  const componentsById = new Map(nextComponents.map((c) => [c.id, c]));

  for (const { id, proposal } of sortedProposals(proposals)) {
    const resolvedProposal =
      proposal.kind === "component_patch"
        ? remapComponentPatchTarget(proposal, componentIds, aliasMap)
        : proposal;

    if (options.preserveDataFlowTopology && proposal.kind === "flow_patch") {
      rejectedProposalIds.push({
        proposalId: id,
        reason: "data_flow_topology_preserved",
      });
      continue;
    }

    if (
      options.enforceIntraSectionFlowChangesOnly &&
      resolvedProposal.kind === "flow_patch" &&
      !isIntraSectionFlowPatch(resolvedProposal, componentsById, nextFlows)
    ) {
      rejectedProposalIds.push({
        proposalId: id,
        reason: "cross_section_flow_change_blocked",
      });
      continue;
    }

    const minConfidence =
      resolvedProposal.kind === "component_patch"
        ? mergedThresholds.minComponentPatchConfidence
        : resolvedProposal.insertIfMissing
          ? mergedThresholds.minInsertFlowConfidence
          : mergedThresholds.minFlowPatchConfidence;

    if (resolvedProposal.confidence.score < minConfidence) {
      rejectedProposalIds.push({
        proposalId: id,
        reason: `confidence_below_threshold:${minConfidence}`,
      });
      continue;
    }

    if (resolvedProposal.evidence.length === 0) {
      rejectedProposalIds.push({ proposalId: id, reason: "missing_evidence" });
      continue;
    }

    const targetKey = proposalTargetKey(resolvedProposal);
    if (provenanceByTarget[targetKey]) {
      rejectedProposalIds.push({
        proposalId: id,
        reason: "target_already_modified_by_higher_ranked_proposal",
      });
      continue;
    }

    const merged =
      resolvedProposal.kind === "component_patch"
        ? mergeComponentPatch(nextComponents, resolvedProposal)
        : mergeFlowPatch(nextFlows, resolvedProposal);

    if (!merged) {
      rejectedProposalIds.push({
        proposalId: id,
        reason:
          resolvedProposal.kind === "component_patch"
            ? "no_meaningful_changes"
            : "target_not_found",
      });
      continue;
    }

    appliedProposalIds.push(id);
    provenanceByTarget[targetKey] = toProvenance(
      resolvedProposal,
      resolvedProposal.confidence.score,
    );
  }

  sortDataFlowsDeterministically(nextFlows);

  return {
    components: nextComponents,
    dataFlows: nextFlows,
    appliedProposalIds,
    rejectedProposalIds,
    provenanceByTarget,
  };
}
