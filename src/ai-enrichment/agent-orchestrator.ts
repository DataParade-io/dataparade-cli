import { runAgentQueue } from "./agents";
import { buildProviderPromptPayload } from "./provider-prompt";
import { createAiProvider } from "./providers";
import { createAgentTooling, type AiScanContext } from "./tools";
import { traceDataparadeProviderInfer } from "../tracing/langsmith-tracing";
import {
  buildThirdPartyHeuristicProposal,
  verifyThirdPartyProposal,
} from "./third-party-evidence";
import type {
  AiAgentName,
  AiProposal,
  InferencePlannerResult,
  RunInferencePipelineInput,
  AiInferenceCandidate,
  AiProviderId,
  AiInferenceUsageSummary,
  AiCandidateAgentTrace,
  AiToolCallTrace,
} from "./types";
import { aiDebugEnabled } from "./providers/provider-contract";
import { resolveScannedFileExact } from "./scan-paths";

import type { PlatformProxyProviderConfig } from "./providers/platform-proxy-provider";
import { PlatformProxyProvider } from "./providers/platform-proxy-provider";
import { HostedWorkerInferProvider } from "./providers/hosted-worker-infer-provider";

export interface AgentOrchestratorOptions {
  provider: AiProviderId;
  model: string;
  endpoint?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
  /** Max concurrent provider calls for tpAgent per-node inference. */
  providerConcurrency?: number;
  toolLoopMaxRounds?: number;
  toolLoopMaxFiles?: number;
  toolLoopMaxSearches?: number;
  /** When false, only structural heuristics run (no HTTP provider calls). */
  llmEnabled?: boolean;
  /** When true, skip local heuristic proposals (already applied in a prior pass). */
  skipStructuralHeuristics?: boolean;
  /** Platform-billed LLM via DataParade API proxy. */
  platformProxy?: PlatformProxyProviderConfig;
  /** Hosted scan in VPC worker: loopback proxy → scan-cli-ai-helper Lambda. */
  hostedWorkerInferProxyUrl?: string;
}

const PROPERTY_AGENT_SLICE_SIZE = 12;
const TP_AGENT_MAX_ROUNDS = 3;
const TP_AGENT_MAX_FILES = 8;
const TP_AGENT_SEARCH_LIMIT = 6;
const IMPORT_RE = /\bimport\s+(?:[^"']+from\s+)?["']([^"']+)["']|\brequire\(["']([^"']+)["']\)/g;

function chunkCandidates(
  queue: AiInferenceCandidate[],
  size: number,
): AiInferenceCandidate[][] {
  const n = Math.max(1, Math.floor(size));
  const out: AiInferenceCandidate[][] = [];
  for (let i = 0; i < queue.length; i += n) {
    out.push(queue.slice(i, i + n));
  }
  return out;
}

function shouldCallProviderForAgent(agent: AiAgentName): boolean {
  // Flow patches are now merge-gated to intra-section changes only, so provider
  // calls can safely support both property and flow-oriented queues.
  return (
    agent === "tpAgent" ||
    agent === "propertyAgent" ||
    agent === "directionAgent" ||
    agent === "interactionAgent"
  );
}

function estimateTokens(text: string): number {
  // Rough but stable approximation used only for budget gating.
  return Math.max(1, Math.ceil(text.length / 4));
}

async function mapWithConcurrency<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  mapper: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.floor(concurrency));
  const out: TOut[] = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await mapper(items[index] as TIn, index);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return out;
}

function gatherSeedPathsForCandidate(
  candidate: AiInferenceCandidate,
  components: RunInferencePipelineInput["components"],
): string[] {
  const component = components.find((c) => c.id === candidate.componentId);
  if (!component) return [];
  const out = new Set<string>();
  const sectionId = component.properties.section_id;
  if (typeof sectionId === "string" && sectionId.trim()) out.add(sectionId.trim());
  for (const loc of component.sourceLocations ?? []) {
    if (loc.filePath?.trim()) out.add(loc.filePath.trim());
  }
  for (const ref of component.detectedFrom ?? []) {
    const fp = ref.sourceLocation?.filePath;
    if (fp?.trim()) out.add(fp.trim());
  }
  return [...out];
}

function gatherSearchTerms(componentName: string): string[] {
  const base = componentName.trim().toLowerCase();
  const terms = new Set<string>([base, "auth", "token", "api", "storage", "database"]);
  if (base.includes("supabase")) {
    terms.add("supabase");
    terms.add("storage.from");
    terms.add("create_client");
  }
  return [...terms].filter((t) => t.length >= 3);
}

function pickUniqueSearchMatches<T extends { filePath: string }>(
  matches: T[],
  alreadyReviewed: Set<string>,
  limit: number,
): T[] {
  const max = Math.max(1, Math.floor(limit));
  const preferred: T[] = [];
  const fallback: T[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const filePath = match.filePath?.trim();
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    if (!alreadyReviewed.has(filePath)) preferred.push(match);
    else fallback.push(match);
  }

  return [...preferred, ...fallback].slice(0, max);
}

function resolveRelativeImportPath(fromFile: string, rawImport: string): string | undefined {
  if (!rawImport.startsWith(".")) return undefined;
  const normalizedFrom = fromFile.replace(/\\/g, "/");
  const parts = normalizedFrom.split("/");
  parts.pop();
  for (const piece of rawImport.split("/")) {
    if (piece === "." || piece === "") continue;
    if (piece === "..") parts.pop();
    else parts.push(piece);
  }
  const base = parts.join("/");
  const candidates = [base, `${base}.ts`, `${base}.js`, `${base}.py`, `${base}/index.ts`, `${base}/index.js`];
  return candidates[0];
}

function expandImportPaths(
  filePath: string,
  content: string,
): string[] {
  const out: string[] = [];
  for (const match of content.matchAll(IMPORT_RE)) {
    const rawImport = (match[1] ?? match[2] ?? "").trim();
    if (!rawImport) continue;
    const rel = resolveRelativeImportPath(filePath, rawImport);
    if (rel) out.push(rel);
  }
  return out;
}

function appendTraceStep(
  list: AiToolCallTrace[],
  step: AiToolCallTrace,
): void {
  list.push(step);
}

function logToolStep(
  candidateId: string,
  step: AiToolCallTrace,
): void {
  if (!aiDebugEnabled()) return;
  const touched = step.filesTouched?.length ?? 0;
  const stats =
    step.stats && Object.keys(step.stats).length > 0
      ? ` stats=${JSON.stringify(step.stats)}`
      : "";
  console.warn(
    `[dataparade-ai] tpAgent tool call candidate=${candidateId} round=${step.round} action=${step.action} files_touched=${touched} detail="${step.detail}"${stats}`,
  );
}

export async function generateAgenticProposals(
  input: RunInferencePipelineInput,
  plan: InferencePlannerResult,
  candidates: AiInferenceCandidate[],
  options: AgentOrchestratorOptions,
): Promise<{
  proposals: Array<{ id: string; proposal: AiProposal }>;
  usageSummary?: AiInferenceUsageSummary;
}> {
  const scanContext: AiScanContext = {
    components: input.components,
    dataFlows: input.dataFlows,
    findings: input.findings ?? [],
    files: input.files ?? [],
    sections: input.sections ?? [],
  };
  const localProposals: AiProposal[] = [];
  const tools = createAgentTooling(scanContext, candidates, localProposals);
  const llmEnabled = options.llmEnabled !== false;
  const skipStructural = options.skipStructuralHeuristics === true;
  const provider = options.platformProxy
    ? new PlatformProxyProvider(options.platformProxy)
    : options.hostedWorkerInferProxyUrl?.trim()
      ? new HostedWorkerInferProvider(options.hostedWorkerInferProxyUrl.trim())
      : createAiProvider(options.provider, {
        endpoint: options.endpoint,
        model: options.model,
        apiKey: options.apiKey,
      });

  const generated: Array<{ id: string; proposal: AiProposal }> = [];
  const agenticTrace: AiCandidateAgentTrace[] = [];
  const aggregateUsage: AiInferenceUsageSummary = {
    providerCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
  let sequence = 0;

  for (const queue of plan.queues) {
    if (!skipStructural && queue.agent === "tpAgent") {
      for (const candidate of queue.queue) {
        if (!candidate.componentId) continue;
        const component = input.components.find((item) => item.id === candidate.componentId);
        if (!component || component.type !== "third_party") continue;
        const patch = buildThirdPartyHeuristicProposal({
          candidate,
          component,
          files: input.files ?? [],
        });
        if (!patch) continue;
        const verification = verifyThirdPartyProposal(patch);
        if (!verification.ok) continue;
        sequence += 1;
        generated.push({ id: `heuristic_${sequence}`, proposal: patch });
      }
    }

    if (!skipStructural) {
      const heuristic = await runAgentQueue(queue, tools);
      for (const proposal of heuristic) {
        sequence += 1;
        generated.push({ id: `heuristic_${sequence}`, proposal });
      }
    }

    if (!llmEnabled || !shouldCallProviderForAgent(queue.agent)) {
      continue;
    }

    if (queue.agent === "tpAgent") {
      const maxCalls = Math.max(0, Math.floor(queue.maxModelCalls));
      const maxCandidates =
        maxCalls === 0 ? 0 : Math.min(queue.queue.length, maxCalls);
      const tpCandidates = queue.queue.slice(0, maxCandidates);
      const maxRounds = Math.max(1, options.toolLoopMaxRounds ?? TP_AGENT_MAX_ROUNDS);
      const maxFiles = Math.max(1, options.toolLoopMaxFiles ?? TP_AGENT_MAX_FILES);
      const maxSearches = Math.max(1, options.toolLoopMaxSearches ?? TP_AGENT_SEARCH_LIMIT);
      const queueBudget = Math.max(0, Math.floor(queue.budgetTokens));
      let queueBudgetSpent = 0;
      for (const candidate of tpCandidates) {
        const component = input.components.find((c) => c.id === candidate.componentId);
        if (!component) continue;
        const traceSteps: AiToolCallTrace[] = [];
        const reviewed = new Set<string>();
        const seed = gatherSeedPathsForCandidate(candidate, input.components);
        for (const p of seed) reviewed.add(p);
        appendTraceStep(traceSteps, {
          round: 0,
          action: "seed_files",
          detail: "Seed files from detectedFrom/sourceLocations/section_id",
          filesTouched: [...reviewed],
          stats: { seedCount: reviewed.size },
        });
        logToolStep(candidate.id, traceSteps[traceSteps.length - 1]!);

        const searchTerms = gatherSearchTerms(component.name);
        for (const term of searchTerms.slice(0, maxSearches)) {
          const rawMatches = tools.searchInFiles(term, seed.length > 0 ? seed : undefined);
          const matches = pickUniqueSearchMatches(rawMatches, reviewed, 8);
          for (const match of matches) reviewed.add(match.filePath);
          appendTraceStep(traceSteps, {
            round: 0,
            action: "search_text",
            detail: `Search term: ${term}`,
            filesTouched: matches.map((m) => m.filePath),
            stats: { hits: matches.length },
          });
          logToolStep(candidate.id, traceSteps[traceSteps.length - 1]!);
        }

        let finalProposals: AiProposal[] = [];
        let executedRounds = 0;
        for (let round = 1; round <= maxRounds; round += 1) {
          executedRounds = round;
          const preferredPaths = [...reviewed].slice(0, maxFiles);
          const prompt = JSON.stringify(
            buildProviderPromptPayload({
              agent: queue.agent,
              queue: [candidate],
              components: input.components,
              dataFlows: input.dataFlows,
              sections: input.sections,
              files: input.files,
              preferredPaths,
            }),
          );
          const estimatedTokens =
            estimateTokens(prompt) + Math.max(1, options.maxTokens ?? 8192);
          if (queueBudget > 0 && queueBudgetSpent + estimatedTokens > queueBudget) {
            appendTraceStep(traceSteps, {
              round,
              action: "provider_infer",
              detail: "Skipped provider inference due to queue budget limit",
              filesTouched: preferredPaths,
              stats: { estimatedTokens, queueBudget, queueBudgetSpent },
            });
            logToolStep(candidate.id, traceSteps[traceSteps.length - 1]!);
            break;
          }

          const providerResult = await traceDataparadeProviderInfer({
            providerId: options.provider,
            model: options.model,
            run: () =>
              provider.infer({
                prompt,
                model: options.model,
                endpoint: options.endpoint,
                apiKey: options.apiKey,
                maxTokens: options.maxTokens,
                temperature: options.temperature,
              }),
          });
          if (queueBudget > 0) queueBudgetSpent += estimatedTokens;

          if (providerResult.usage) {
            aggregateUsage.providerCalls += 1;
            aggregateUsage.inputTokens += providerResult.usage.inputTokens;
            aggregateUsage.outputTokens += providerResult.usage.outputTokens;
            aggregateUsage.totalTokens += providerResult.usage.totalTokens;
            if (typeof providerResult.usage.estimatedCostUsd === "number") {
              aggregateUsage.estimatedCostUsd =
                (aggregateUsage.estimatedCostUsd ?? 0) + providerResult.usage.estimatedCostUsd;
            } else {
              aggregateUsage.estimatedCostUsd = undefined;
            }
          }

          appendTraceStep(traceSteps, {
            round,
            action: "provider_infer",
            detail: "Provider inference call for current reviewed file set",
            filesTouched: preferredPaths,
            stats: { reviewedCount: preferredPaths.length, proposals: providerResult.proposals.length },
          });
          logToolStep(candidate.id, traceSteps[traceSteps.length - 1]!);

          const acceptedThisRound: AiProposal[] = [];
          for (const proposal of providerResult.proposals) {
            const verification = verifyThirdPartyProposal(proposal);
            if (!verification.ok) {
              if (aiDebugEnabled()) {
                console.warn(
                  `[dataparade-ai] tpAgent proposal rejected by verifyThirdPartyProposal: ${verification.reason}`,
                );
              }
              continue;
            }
            const validation = tools.validateProposal(proposal);
            if (!validation.ok) {
              if (aiDebugEnabled()) {
                console.warn(
                  `[dataparade-ai] provider proposal rejected by tooling validation: ${validation.reason}`,
                );
              }
              continue;
            }
            acceptedThisRound.push(proposal);
          }
          if (acceptedThisRound.length > 0) finalProposals = acceptedThisRound;

          const beforeExpand = reviewed.size;
          const filesForExpand = [...reviewed].slice(0, maxFiles);
          for (const fp of filesForExpand) {
            const fi = input.files ? resolveScannedFileExact(input.files, fp) : undefined;
            if (!fi) continue;
            const imports = expandImportPaths(fi.path, fi.content);
            for (const imp of imports) {
              if (reviewed.size >= maxFiles) break;
              const resolved = input.files
                ? resolveScannedFileExact(input.files, imp)
                : undefined;
              if (resolved) reviewed.add(resolved.path);
            }
            if (reviewed.size >= maxFiles) break;
          }
          const added = reviewed.size - beforeExpand;
          appendTraceStep(traceSteps, {
            round,
            action: "expand_imports",
            detail: "Expand import graph from reviewed files",
            filesTouched: [...reviewed],
            stats: { addedFiles: added, totalReviewed: reviewed.size },
          });
          logToolStep(candidate.id, traceSteps[traceSteps.length - 1]!);
          if (added === 0 && finalProposals.length > 0) break;
        }

        appendTraceStep(traceSteps, {
          round: executedRounds,
          action: "finalize",
          detail: "Finalize accepted proposals for candidate",
          filesTouched: [...reviewed],
          stats: { finalProposalCount: finalProposals.length },
        });
        logToolStep(candidate.id, traceSteps[traceSteps.length - 1]!);

        for (const proposal of finalProposals) {
          sequence += 1;
          generated.push({ id: `provider_${sequence}`, proposal });
          if (aiDebugEnabled()) {
            console.warn(
              `[dataparade-ai] provider proposal accepted: kind=${proposal.kind} candidate=${proposal.candidateType} agent=${queue.agent}`,
            );
          }
        }

        agenticTrace.push({
          candidateId: candidate.id,
          componentId: candidate.componentId,
          filesReviewed: [...reviewed],
          rounds: executedRounds,
          toolCalls: traceSteps,
          finalProposalCount: finalProposals.length,
        });
      }
      continue;
    }

    // Non-tp agents stay in bounded prompt batches.
    const providerSlices = chunkCandidates(queue.queue, PROPERTY_AGENT_SLICE_SIZE);

    const preparedProviderCalls = providerSlices.map((slice) => {
      const prompt = JSON.stringify(
        buildProviderPromptPayload({
          agent: queue.agent,
          queue: slice,
          components: input.components,
          dataFlows: input.dataFlows,
          sections: input.sections,
          files: input.files,
        }),
      );
      const estimatedTokens =
        estimateTokens(prompt) + Math.max(1, options.maxTokens ?? 8192);
      return { prompt, estimatedTokens };
    });

    const maxCalls = Math.max(0, Math.floor(queue.maxModelCalls));
    const callsWithinLimit =
      maxCalls === 0
        ? []
        : preparedProviderCalls.slice(0, Math.min(maxCalls, preparedProviderCalls.length));

    const budget = Math.max(0, Math.floor(queue.budgetTokens));
    const budgetedCalls: Array<{ prompt: string; estimatedTokens: number }> = [];
    if (budget > 0) {
      let spent = 0;
      for (const call of callsWithinLimit) {
        if (spent + call.estimatedTokens > budget) break;
        budgetedCalls.push(call);
        spent += call.estimatedTokens;
      }
      // Avoid starving property enrichment when estimated tokens are conservative.
      if (
        queue.agent === "propertyAgent" &&
        budgetedCalls.length === 0 &&
        callsWithinLimit.length > 0
      ) {
        budgetedCalls.push(callsWithinLimit[0]!);
      }
    } else {
      // Zero/negative budget means no provider calls for this queue.
      budgetedCalls.push(...[]);
    }

    const providerConcurrency = Math.max(
      1,
      Math.floor(options.providerConcurrency ?? 1),
    );
    const providerResults = await mapWithConcurrency(
      budgetedCalls,
      providerConcurrency,
      (call) =>
        traceDataparadeProviderInfer({
          providerId: options.provider,
          model: options.model,
          run: () =>
            provider.infer({
              prompt: call.prompt,
              model: options.model,
              endpoint: options.endpoint,
              apiKey: options.apiKey,
              maxTokens: options.maxTokens,
              temperature: options.temperature,
            }),
        }),
    );

    for (const providerResult of providerResults) {
      if (providerResult.usage) {
        aggregateUsage.providerCalls += 1;
        aggregateUsage.inputTokens += providerResult.usage.inputTokens;
        aggregateUsage.outputTokens += providerResult.usage.outputTokens;
        aggregateUsage.totalTokens += providerResult.usage.totalTokens;
        if (typeof providerResult.usage.estimatedCostUsd === "number") {
          aggregateUsage.estimatedCostUsd =
            (aggregateUsage.estimatedCostUsd ?? 0) + providerResult.usage.estimatedCostUsd;
        } else {
          aggregateUsage.estimatedCostUsd = undefined;
        }
      }
      for (const proposal of providerResult.proposals) {
        const validation = tools.validateProposal(proposal);
        if (!validation.ok) {
          if (aiDebugEnabled()) {
            console.warn(
              `[dataparade-ai] provider proposal rejected by tooling validation: ${validation.reason}`,
            );
          }
          continue;
        }
        sequence += 1;
        generated.push({ id: `provider_${sequence}`, proposal });
        if (aiDebugEnabled()) {
          console.warn(
            `[dataparade-ai] provider proposal accepted: kind=${proposal.kind} candidate=${proposal.candidateType} agent=${queue.agent}`,
          );
        }
      }
    }
  }

  const hasUsage =
    aggregateUsage.providerCalls > 0 ||
    aggregateUsage.inputTokens > 0 ||
    aggregateUsage.outputTokens > 0 ||
    aggregateUsage.totalTokens > 0 ||
    agenticTrace.length > 0;
  return {
    proposals: generated,
    usageSummary: hasUsage ? { ...aggregateUsage, agenticTrace } : undefined,
  };
}

