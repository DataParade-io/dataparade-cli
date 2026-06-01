import type {
  AiAgentName,
  AiCandidateType,
  AiInferenceCandidate,
  InferencePlannerOptions,
  InferencePlannerResult,
} from "./types";

const AGENT_BY_CANDIDATE_TYPE: Record<AiCandidateType, AiAgentName> = {
  third_party: "tpAgent",
  node_property: "propertyAgent",
  flow_direction: "directionAgent",
  missing_interaction: "interactionAgent",
};

function divideEvenly(total: number, buckets: number): number[] {
  if (buckets <= 0) return [];
  const base = Math.floor(total / buckets);
  const rem = total % buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < rem ? 1 : 0));
}

export function planInferenceQueues(
  candidates: AiInferenceCandidate[],
  options: InferencePlannerOptions,
): InferencePlannerResult {
  const grouped = new Map<AiAgentName, AiInferenceCandidate[]>();
  const droppedCandidates: Array<{ candidateId: string; reason: string }> = [];
  // `0` or omitted → no per-agent cap (queue every candidate). Otherwise cap
  // queue length; pipeline defaults pass `25` from `ScanConfiguration`.
  const rawCap = options.maxCandidatesPerAgent;
  const maxCandidatesPerAgent =
    rawCap === 0 || rawCap === undefined
      ? Number.MAX_SAFE_INTEGER
      : Math.max(1, rawCap);

  for (const candidate of candidates) {
    const agent = AGENT_BY_CANDIDATE_TYPE[candidate.candidateType];
    const queue = grouped.get(agent) ?? [];

    if (queue.length >= maxCandidatesPerAgent) {
      droppedCandidates.push({
        candidateId: candidate.id,
        reason: "agent_queue_capacity_exceeded",
      });
      continue;
    }

    queue.push(candidate);
    grouped.set(agent, queue);
  }

  const queues = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([agent, queue]) => ({
      agent,
      queue: queue.sort((x, y) => {
        if (x.priority !== y.priority) return y.priority - x.priority;
        return x.id.localeCompare(y.id);
      }),
      budgetTokens: 0,
      maxModelCalls: 0,
    }));

  const totalBudgetTokens = options.totalBudgetTokens;
  const totalMaxModelCalls = options.maxModelCalls;
  const tokenSlices = divideEvenly(totalBudgetTokens, queues.length);
  const callSlices = divideEvenly(totalMaxModelCalls, queues.length);

  for (let i = 0; i < queues.length; i += 1) {
    queues[i]!.budgetTokens = tokenSlices[i] ?? 0;
    queues[i]!.maxModelCalls = callSlices[i] ?? 0;
  }

  return { queues, droppedCandidates };
}
