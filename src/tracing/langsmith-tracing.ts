import { traceable } from "langsmith/traceable";
import type { InferencePipelineResult } from "../ai-enrichment/types";
import type { OrchestratorScanResult } from "../core/pipeline/orchestrator-result";
import type { AiInferenceSummary, ScanResult } from "../core/types/result";

/**
 * LangSmith / LangChain tracing for CLI scan and AI inference.
 *
 * Trace payloads are summary-only (counts and ids) so uploads stay under API
 * size limits. Trace upload failures are logged and never fail the scan.
 *
 * Set:
 * - LANGSMITH_API_KEY (or LANGCHAIN_API_KEY)
 * - LANGCHAIN_TRACING_V2=true or LANGSMITH_TRACING=true
 * - LANGSMITH_PROJECT (optional; also LANGCHAIN_PROJECT)
 *
 * @see https://docs.smith.langchain.com/
 */
export function isLangSmithTracingEnabled(): boolean {
  const key = process.env.LANGSMITH_API_KEY ?? process.env.LANGCHAIN_API_KEY;
  if (!key || key.trim().length === 0) return false;
  const on =
    process.env.LANGCHAIN_TRACING_V2 === "true" ||
    process.env.LANGSMITH_TRACING === "true";
  return on;
}

function warnLangsmithTraceFailure(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `[dataparade] LangSmith trace upload failed (${context}): ${message}\n`,
  );
}

function countComponentsByType(
  components: ScanResult["components"],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const component of components) {
    counts[component.type] = (counts[component.type] ?? 0) + 1;
  }
  return counts;
}

function uniqueSectionIds(components: ScanResult["components"]): string[] {
  const ids = new Set<string>();
  for (const component of components) {
    const raw = component.properties?.section_id;
    if (typeof raw === "string" && raw.trim()) {
      ids.add(raw.trim());
    }
  }
  return [...ids].sort();
}

/** Summary sent to LangSmith instead of full scan output (keeps traces small). */
export function buildLangSmithScanTraceSummary(
  result: OrchestratorScanResult,
): Record<string, unknown> {
  const scan = result.scanResult;
  const ai = scan.aiInferenceSummary;
  return {
    filesScanned: scan.filesScanned,
    filesSkipped: scan.filesSkipped,
    totalLines: scan.totalLines,
    scanDurationMs: scan.scanDurationMs,
    componentCount: scan.components.length,
    dataFlowCount: scan.dataFlows.length,
    warningCount: scan.warnings.length,
    errorCount: scan.errors.length,
    findingCount: result.findings.length,
    componentTypes: countComponentsByType(scan.components),
    sectionIds: uniqueSectionIds(scan.components),
    languageStats: scan.languageStats?.map((s) => ({
      language: s.language,
      filesParsed: s.filesParsed,
    })),
    aiInference: ai ? buildLangSmithAiInferenceTraceSummary(ai) : undefined,
    terraformScanSummary: scan.terraformScanSummary,
  };
}

export function buildLangSmithInferencePipelineTraceSummary(
  result: InferencePipelineResult,
): Record<string, unknown> {
  return {
    candidateCount: result.candidates.length,
    proposalCount: result.proposals.length,
    appliedProposalCount: result.mergeResult.appliedProposalIds.length,
    rejectedProposalCount: result.mergeResult.rejectedProposalIds.length,
    queueCount: result.plan.queues.length,
    droppedCandidateCount: result.plan.droppedCandidates.length,
    usageSummary: result.usageSummary,
  };
}

export function buildLangSmithAiInferenceTraceSummary(
  summary: AiInferenceSummary,
): Record<string, unknown> {
  return {
    candidatesConsidered: summary.candidatesConsidered,
    proposalsGenerated: summary.proposalsGenerated,
    proposalsApplied: summary.proposalsApplied,
    proposalsRejected: summary.proposalsRejected,
    proposalsGeneratedHeuristic: summary.proposalsGeneratedHeuristic,
    proposalsAppliedHeuristic: summary.proposalsAppliedHeuristic,
    proposalsGeneratedProvider: summary.proposalsGeneratedProvider,
    proposalsAppliedProvider: summary.proposalsAppliedProvider,
    providerCalls: summary.providerCalls,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    totalTokens: summary.totalTokens,
    estimatedCostUsd: summary.estimatedCostUsd,
    aiProvider: summary.aiProvider,
    aiModel: summary.aiModel,
  };
}

async function runWithLangSmithTrace<T>(
  traced: (payload: { run: () => Promise<unknown> }) => Promise<unknown>,
  context: string,
  run: () => Promise<T>,
  summarize: (result: T) => unknown,
): Promise<T> {
  let result: T | undefined;
  try {
    await traced({
      run: async () => {
        result = await run();
        return summarize(result);
      },
    });
  } catch (err) {
    if (result === undefined) {
      throw err;
    }
    warnLangsmithTraceFailure(context, err);
  }
  return result as T;
}

const tracedScanRoot = traceable(
  async (payload: {
    rootPath: string;
    projectName?: string;
    enableAiInference?: boolean;
    run: () => Promise<unknown>;
  }) => payload.run(),
  {
    name: "dataparade_scan",
    run_type: "chain",
    metadata: { app: "dataparade-cli" },
  },
);

const tracedAiInference = traceable(
  async (payload: {
    provider?: string;
    model?: string;
    run: () => Promise<unknown>;
  }) => payload.run(),
  {
    name: "dataparade_ai_inference",
    run_type: "chain",
  },
);

const tracedProviderInfer = traceable(
  async (payload: {
    providerId: string;
    model: string;
    run: () => Promise<unknown>;
  }) => payload.run(),
  {
    name: "dataparade_provider_infer",
    run_type: "llm",
  },
);

export async function traceDataparadeScan<T extends OrchestratorScanResult>(meta: {
  rootPath: string;
  projectName?: string;
  enableAiInference?: boolean;
  run: () => Promise<T>;
}): Promise<T> {
  if (!isLangSmithTracingEnabled()) {
    return meta.run();
  }
  return runWithLangSmithTrace(
    (payload) =>
      tracedScanRoot({
        rootPath: meta.rootPath,
        projectName: meta.projectName,
        enableAiInference: meta.enableAiInference,
        run: payload.run,
      }),
    "dataparade_scan",
    meta.run,
    buildLangSmithScanTraceSummary,
  );
}

export async function traceDataparadeAiInference<T extends InferencePipelineResult>(meta: {
  provider?: string;
  model?: string;
  run: () => Promise<T>;
}): Promise<T> {
  if (!isLangSmithTracingEnabled()) {
    return meta.run();
  }
  return runWithLangSmithTrace(
    (payload) =>
      tracedAiInference({
        provider: meta.provider,
        model: meta.model,
        run: payload.run,
      }),
    "dataparade_ai_inference",
    meta.run,
    buildLangSmithInferencePipelineTraceSummary,
  );
}

export async function traceDataparadeProviderInfer<T>(meta: {
  providerId: string;
  model: string;
  run: () => Promise<T>;
}): Promise<T> {
  if (!isLangSmithTracingEnabled()) {
    return meta.run();
  }
  return runWithLangSmithTrace(
    (payload) =>
      tracedProviderInfer({
        providerId: meta.providerId,
        model: meta.model,
        run: payload.run,
      }),
    "dataparade_provider_infer",
    meta.run,
    () => ({
      providerId: meta.providerId,
      model: meta.model,
    }),
  );
}
