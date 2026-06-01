import path from "path";

import type {
  AiInferenceProposalDetail,
  AiInferenceSummary,
  DetectedDataFlow,
  ScanConfiguration,
  ScanPhase,
  ScanProgress,
  ScanResult,
  StructuralEnrichmentSummary,
} from "../types";
import { buildAgentOrchestratorOptions } from "./ai-orchestrator-options";
import { validateScanResult } from "../schema/scan-result.schema";
import { runStructuralScanPhase } from "./structural-scan";
import { runClassifierPhase } from "./classifier-phase";
import { runDataFlowPhase } from "./dataflow-phase";
import {
  sortComponentsDeterministically,
  sortDataFlowsDeterministically,
} from "./sorting";
import { runInferencePipeline } from "../../ai-enrichment/pipeline";
import { applyDeterministicInferenceFallbacks } from "../../ai-enrichment/fallbacks";
import { dropCrossSectionServiceFlows } from "../../data-flow/drop-cross-section-flows";
import { generateAgenticProposals } from "../../ai-enrichment/agent-orchestrator";
import {
  buildProposalTargetComponentIdRemap,
  buildThirdPartyDataFlowSummary,
} from "../../ai-enrichment/third-party-data-flow";
import { ensureThirdPartySubTypes } from "../../ai-enrichment/third-party-subtype";
import { traceDataparadeAiInference } from "../../tracing/langsmith-tracing";
import type { AiProposal, InferencePipelineResult } from "../../ai-enrichment/types";
import type { DetectedComponent } from "../types";
import type { OrchestratorScanResult } from "./orchestrator-result";
import { assignStableComponentIds } from "./stable-component-ids";
import { applyTerraformMinimalServiceScanResult } from "./terraform-minimal-services";

function emitProgress(
  onProgress: ((progress: ScanProgress) => void) | undefined,
  phase: ScanPhase,
  progress: number,
  totalFiles: number,
  message: string,
): void {
  if (!onProgress) return;
  const clamped = Math.max(0, Math.min(progress, 1));
  onProgress({
    phase,
    filesProcessed: totalFiles,
    totalFiles,
    progress: clamped,
    message,
  });
}

function buildAiProposalDetails(input: {
  proposals: Array<{ id: string; proposal: AiProposal }>;
  appliedProposalIds: string[];
  rejectedProposalIds: Array<{ proposalId: string; reason: string }>;
  componentsBeforeAi: DetectedComponent[];
}): AiInferenceProposalDetail[] {
  const appliedSet = new Set(input.appliedProposalIds);
  const rejectedById = new Map(
    input.rejectedProposalIds.map((item) => [item.proposalId, item.reason]),
  );

  const beforeById = new Map(
    input.componentsBeforeAi.map((component) => [component.id, component]),
  );

  return input.proposals.map(({ id, proposal }) => {
    const rejectionReason = rejectedById.get(id);
    const status = appliedSet.has(id) ? "applied" : "rejected";
    const propertyChanges =
      proposal.kind === "component_patch" && status === "applied"
        ? Object.entries(proposal.setProperties).map(([key, to]) => ({
            key,
            from: beforeById.get(proposal.targetComponentId)?.properties?.[key],
            to,
          }))
        : undefined;
    return {
      id,
      source: id.startsWith("heuristic_") ? "heuristic" : "provider",
      status,
      rejectionReason: status === "rejected" ? rejectionReason : undefined,
      kind: proposal.kind,
      candidateType: proposal.candidateType,
      agent: proposal.agent,
      provider: proposal.provider,
      model: proposal.model,
      confidence: proposal.confidence.score,
      confidenceBand: proposal.confidence.band,
      targetComponentId:
        proposal.kind === "component_patch" ? proposal.targetComponentId : undefined,
      targetFlowId: proposal.kind === "flow_patch" ? proposal.targetFlowId : undefined,
      sourceComponentId:
        proposal.kind === "flow_patch" ? proposal.sourceComponentId : undefined,
      targetFlowComponentId:
        proposal.kind === "flow_patch" ? proposal.targetComponentId : undefined,
      evidence: proposal.evidence,
      propertyChanges,
    };
  });
}

function countRejectionsByReason(
  rejected: Array<{ proposalId: string; reason: string }>,
  proposalById: Map<string, { id: string; proposal: AiProposal }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of rejected) {
    const source = proposalById.get(item.proposalId)?.id.startsWith("provider_")
      ? "provider"
      : "heuristic";
    const key = `${source}:${item.reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function isSparse(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function incrementCounter(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function buildThirdPartyCoverage(input: {
  proposals: Array<{ id: string; proposal: AiProposal }>;
  appliedProposalIds: string[];
  rejectedProposalIds: Array<{ proposalId: string; reason: string }>;
  componentsAfterAi: DetectedComponent[];
}): {
  autofilled: Record<string, number>;
  suggested: Record<string, number>;
  unknown: Record<string, number>;
} {
  const autofilled: Record<string, number> = {};
  const suggested: Record<string, number> = {};
  const unknown: Record<string, number> = {};
  const applied = new Set(input.appliedProposalIds);
  const rejectedReasonById = new Map(
    input.rejectedProposalIds.map((entry) => [entry.proposalId, entry.reason]),
  );

  for (const proposalEntry of input.proposals) {
    const proposal = proposalEntry.proposal;
    if (proposal.kind !== "component_patch") continue;
    if (proposal.candidateType !== "third_party") continue;
    const keys = Object.keys(proposal.setProperties ?? {});
    if (keys.length === 0) continue;
    if (applied.has(proposalEntry.id)) {
      for (const key of keys) incrementCounter(autofilled, key);
      continue;
    }
    const reason = rejectedReasonById.get(proposalEntry.id) ?? "";
    if (reason.startsWith("confidence_below_threshold")) {
      for (const key of keys) incrementCounter(suggested, key);
    }
  }

  for (const component of input.componentsAfterAi) {
    if (component.type !== "third_party") continue;
    for (const [key, value] of Object.entries(component.properties ?? {})) {
      if (isSparse(value)) incrementCounter(unknown, key);
    }
  }

  return { autofilled, suggested, unknown };
}

/**
 * Internal scan implementation (ingest → classify → flows → optional AI → validate).
 */
export async function runScanPipeline(
  rootPath: string,
  config: ScanConfiguration,
  onProgress?: (progress: ScanProgress) => void,
): Promise<OrchestratorScanResult> {
  const start = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];

  const projectNameFromPath = path.basename(rootPath.toString());

  emitProgress(onProgress, "ingest", 0.05, 0, `Ingesting files from ${rootPath}...`);
  emitProgress(onProgress, "analyze", 0.25, 0, "Running structural scan...");

  const structural = await runStructuralScanPhase(
    rootPath,
    config,
    (warning) => warnings.push(warning),
  );
  const {
    files,
    findings,
    sections,
    monorepoPackageSectionPathDepth,
    filesScanned,
    totalLines,
    languageStats,
    terraformScanSummary,
  } = structural;

  emitProgress(
    onProgress,
    "classify",
    0.5,
    filesScanned,
    "Classifying detected components...",
  );

  const components = runClassifierPhase(findings, sections, {
    projectName: config.projectName ?? projectNameFromPath,
    minimumConfidence: config.minimumConfidence,
  });

  const subTypesFilledEarly = ensureThirdPartySubTypes(components);
  if (subTypesFilledEarly > 0) {
    warnings.push(
      `third-party-subtype: inferred subType for ${subTypesFilledEarly} third-party component(s) from vendor/name heuristics.`,
    );
  }

  let dataFlows: DetectedDataFlow[] = [];
  if (config.enableDataFlowDetection) {
    emitProgress(
      onProgress,
      "data_flow",
      0.7,
      filesScanned,
      "Detecting data flows...",
    );

    try {
      dataFlows = runDataFlowPhase(files, components, findings, sections, {
        enableDataFlowDetection: config.enableDataFlowDetection,
        minimumConfidence: config.minimumConfidence,
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unknown error during data-flow detection.";
      errors.push(`data-flow: ${message}`);
      dataFlows = [];
    }
  }

  sortComponentsDeterministically(components);
  sortDataFlowsDeterministically(dataFlows);

  let aiInferenceSummary: AiInferenceSummary | undefined;
  let structuralEnrichmentSummary: StructuralEnrichmentSummary | undefined;
  let aiInferenceProposalDetails: AiInferenceProposalDetail[] | undefined;
  let inference: InferencePipelineResult | undefined;
  let postAiComponents: DetectedComponent[] | undefined;

  const plannerInputBase = {
    components,
    dataFlows,
    sections,
    files,
    findings,
    inferenceScope: config.aiInferenceScope ?? "default",
    plannerOptions: {
      maxModelCalls: config.aiMaxModelCalls,
      totalBudgetTokens: config.aiBudgetTokens,
      maxCandidatesPerAgent:
        (config.aiInferenceScope ?? "default") === "third_party_only"
          ? (config.aiMaxCandidatesPerAgent ?? 0)
          : config.aiMaxCandidatesPerAgent,
    },
  } as const;

  emitProgress(
    onProgress,
    "data_flow",
    0.82,
    filesScanned,
    "Running structural enrichment...",
  );

  const structuralInference = await runInferencePipeline(plannerInputBase, {
    generateProposals: async (ctx) =>
      generateAgenticProposals(
        {
          components: ctx.components,
          dataFlows: ctx.dataFlows,
          sections: ctx.sections,
          files: ctx.files,
          findings: ctx.findings,
        },
        ctx.plan,
        ctx.candidates,
        buildAgentOrchestratorOptions(config, {
          llmEnabled: false,
          skipStructuralHeuristics: false,
        }),
      ),
  });

  components.splice(
    0,
    components.length,
    ...structuralInference.mergeResult.components,
  );
  dataFlows.splice(0, dataFlows.length, ...structuralInference.mergeResult.dataFlows);

  structuralEnrichmentSummary = {
    ran: true,
    proposalsGenerated: structuralInference.proposals.length,
    proposalsApplied: structuralInference.mergeResult.appliedProposalIds.length,
    proposalsRejected: structuralInference.mergeResult.rejectedProposalIds.length,
  };

  if (config.enableAiInference) {
    warnings.push(
      "ai-inference: .env files are excluded from scans and provider prompts for security.",
    );

    const componentsBeforeAi = components.map((component) => ({
      ...component,
      properties: { ...component.properties },
    }));
    emitProgress(
      onProgress,
      "data_flow",
      0.85,
      filesScanned,
      "Running LLM inference...",
    );

    const orchOptions = buildAgentOrchestratorOptions(config, {
      llmEnabled: true,
      skipStructuralHeuristics: true,
    });

    inference = await traceDataparadeAiInference({
      provider: orchOptions.provider,
      model: orchOptions.model,
      run: () =>
        runInferencePipeline(plannerInputBase, {
          generateProposals: async (ctx) =>
            generateAgenticProposals(
              {
                components: ctx.components,
                dataFlows: ctx.dataFlows,
                sections: ctx.sections,
                files: ctx.files,
                findings: ctx.findings,
              },
              ctx.plan,
              ctx.candidates,
              orchOptions,
            ),
        }),
    });

    components.splice(0, components.length, ...inference.mergeResult.components);
    dataFlows.splice(0, dataFlows.length, ...inference.mergeResult.dataFlows);
    postAiComponents = inference.mergeResult.components.map((component) => ({
      ...component,
      properties: { ...component.properties },
    }));

    const appliedIds = inference.mergeResult.appliedProposalIds;
    const genP = inference.proposals.filter((p) => p.id.startsWith("provider_"));
    const appliedP = appliedIds.filter((id) => id.startsWith("provider_")).length;

    warnings.push(
      `ai-inference: applied=${appliedIds.length} (provider=${appliedP}), rejected=${inference.mergeResult.rejectedProposalIds.length}`,
    );

    const proposalById = new Map(inference.proposals.map((p) => [p.id, p]));
    const rejectionCounts = countRejectionsByReason(
      inference.mergeResult.rejectedProposalIds,
      proposalById,
    );
    const providerTargetNotFound = rejectionCounts.get("provider:target_not_found") ?? 0;
    if (providerTargetNotFound > 0) {
      warnings.push(
        `ai-provider: ${providerTargetNotFound} provider proposal(s) rejected as target_not_found (likely non-canonical targetComponentId; expected component IDs like cmp_*).`,
      );
    }
    const providerEvidencePathMissing =
      rejectionCounts.get("provider:evidence_path_not_in_scan") ?? 0;
    if (providerEvidencePathMissing > 0) {
      warnings.push(
        `ai-provider: ${providerEvidencePathMissing} provider proposal(s) rejected due to evidence_path_not_in_scan.`,
      );
    }
    const providerConfidenceRejected = [...rejectionCounts.entries()]
      .filter(([k]) => k.startsWith("provider:confidence_below_threshold:"))
      .reduce((acc, [, n]) => acc + n, 0);
    if (providerConfidenceRejected > 0) {
      warnings.push(
        `ai-provider: ${providerConfidenceRejected} provider proposal(s) rejected by confidence thresholds.`,
      );
    }

    if (genP.length === 0) {
      warnings.push(
        [
          "ai-provider: zero LLM proposals were accepted after inference.",
          "Check workspace API key, BYOK credentials, network, and SCAN_AI_MAX_TOKENS for large prompts.",
          "Set SCAN_AI_DEBUG=true to log provider HTTP status and parse/normalization details.",
        ].join(" "),
      );
    } else if (genP.length > 0 && appliedP === 0) {
      warnings.push(
        "ai-provider: proposals were returned but none passed validation/merge (evidence paths, confidence, or thresholds).",
      );
    }

    aiInferenceSummary = {
      ran: true,
      candidatesConsidered: inference.candidates.length,
      proposalsGenerated: inference.proposals.length,
      proposalsApplied: appliedIds.length,
      proposalsRejected: inference.mergeResult.rejectedProposalIds.length,
      proposalsGeneratedHeuristic: 0,
      proposalsAppliedHeuristic: 0,
      proposalsGeneratedProvider: genP.length,
      proposalsAppliedProvider: appliedP,
      aiProvider: orchOptions.platformProxy ? "dataparade" : orchOptions.provider,
      aiModel: orchOptions.model,
      providerCalls: inference.usageSummary?.providerCalls ?? 0,
      inputTokens: inference.usageSummary?.inputTokens ?? 0,
      outputTokens: inference.usageSummary?.outputTokens ?? 0,
      totalTokens: inference.usageSummary?.totalTokens ?? 0,
      estimatedCostUsd: inference.usageSummary?.estimatedCostUsd,
      thirdPartyPropertyCoverage: buildThirdPartyCoverage({
        proposals: inference.proposals,
        appliedProposalIds: inference.mergeResult.appliedProposalIds,
        rejectedProposalIds: inference.mergeResult.rejectedProposalIds,
        componentsAfterAi: inference.mergeResult.components,
      }),
      agenticTrace: inference.usageSummary?.agenticTrace,
    };

    if (config.aiVerbose) {
      aiInferenceProposalDetails = buildAiProposalDetails({
        proposals: inference.proposals,
        appliedProposalIds: inference.mergeResult.appliedProposalIds,
        rejectedProposalIds: inference.mergeResult.rejectedProposalIds,
        componentsBeforeAi,
      });
    }
  }

  const fallbackResult = applyDeterministicInferenceFallbacks(components, dataFlows);
  components.splice(0, components.length, ...fallbackResult.components);
  dataFlows = fallbackResult.dataFlows;

  const subTypesFilledLate = ensureThirdPartySubTypes(components);
  if (subTypesFilledLate > 0) {
    warnings.push(
      `third-party-subtype: filled subType for ${subTypesFilledLate} third-party component(s) after inference.`,
    );
  }

  dataFlows = dropCrossSectionServiceFlows(components, dataFlows);

  const scanDurationMs = Date.now() - start;

  emitProgress(onProgress, "output", 0.95, filesScanned, "Assembling scan result...");

  const reduced = applyTerraformMinimalServiceScanResult({
    components,
    dataFlows,
    filesScanned,
    filesSkipped: 0,
    totalLines,
    scanDurationMs,
    warnings,
    errors,
    languageStats: languageStats.length > 0 ? languageStats : undefined,
    aiInferenceSummary,
    structuralEnrichmentSummary,
    aiInferenceProposalDetails,
    terraformScanSummary,
  });
  const stableIds = assignStableComponentIds(
    reduced.components,
    reduced.dataFlows,
  );

  if (
    aiInferenceSummary &&
    inference &&
    postAiComponents &&
    config.aiThirdPartyDataFlowEnabled !== false
  ) {
    aiInferenceSummary = {
      ...aiInferenceSummary,
      thirdPartyDataFlow: buildThirdPartyDataFlowSummary({
        proposals: inference.proposals,
        appliedProposalIds: inference.mergeResult.appliedProposalIds,
        componentsAfterAi: stableIds.components,
        files,
        agenticTrace: inference.usageSummary?.agenticTrace,
        proposalTargetComponentIdRemap: buildProposalTargetComponentIdRemap(
          postAiComponents,
          stableIds.components,
        ),
      }),
    };
  }

  const scanResult = {
    ...reduced,
    components: stableIds.components,
    dataFlows: stableIds.dataFlows,
    aiInferenceSummary,
    structuralEnrichmentSummary,
  };

  const validation = validateScanResult(scanResult);
  if (!validation.ok) {
    errors.push(...validation.errors);
    scanResult.errors = errors;
  }

  emitProgress(onProgress, "output", 1, filesScanned, "Scan complete.");

  return {
    scanResult,
    files,
    findings,
  };
}
