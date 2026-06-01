import { planInferenceQueues } from "../../../src/ai-enrichment/planner";
import type { AiInferenceCandidate } from "../../../src/ai-enrichment/types";

describe("ai-enrichment planner", () => {
  it("partitions candidates by agent and allocates budgets", () => {
    const candidates: AiInferenceCandidate[] = [
      {
        id: "c1",
        candidateType: "node_property",
        priority: 90,
        componentId: "asset_1",
        missingFields: ["encryption_at_rest"],
        rationale: "missing",
        hints: [],
      },
      {
        id: "c2",
        candidateType: "third_party",
        priority: 80,
        componentId: "tp_1",
        missingFields: ["subType"],
        rationale: "missing",
        hints: [],
      },
      {
        id: "c3",
        candidateType: "flow_direction",
        priority: 70,
        flowId: "flow_1",
        missingFields: [],
        rationale: "uncertain",
        hints: [],
      },
    ];

    const plan = planInferenceQueues(candidates, {
      totalBudgetTokens: 9000,
      maxModelCalls: 9,
    });

    expect(plan.queues).toHaveLength(3);
    expect(plan.queues.reduce((sum, q) => sum + q.budgetTokens, 0)).toBe(9000);
    expect(plan.queues.reduce((sum, q) => sum + q.maxModelCalls, 0)).toBe(9);
    expect(plan.droppedCandidates).toEqual([]);
  });

  it("drops candidates when agent queue capacity is exceeded", () => {
    const candidates: AiInferenceCandidate[] = [
      {
        id: "c1",
        candidateType: "node_property",
        priority: 90,
        componentId: "asset_1",
        missingFields: [],
        rationale: "x",
        hints: [],
      },
      {
        id: "c2",
        candidateType: "node_property",
        priority: 80,
        componentId: "asset_2",
        missingFields: [],
        rationale: "x",
        hints: [],
      },
    ];

    const plan = planInferenceQueues(candidates, {
      maxCandidatesPerAgent: 1,
      totalBudgetTokens: 1000,
      maxModelCalls: 2,
    });

    expect(plan.queues).toHaveLength(1);
    expect(plan.queues[0]?.queue).toHaveLength(1);
    expect(plan.droppedCandidates).toEqual([
      { candidateId: "c2", reason: "agent_queue_capacity_exceeded" },
    ]);
  });

  it("treats maxCandidatesPerAgent 0 as unlimited", () => {
    const candidates: AiInferenceCandidate[] = [
      {
        id: "c1",
        candidateType: "node_property",
        priority: 90,
        componentId: "asset_1",
        missingFields: [],
        rationale: "x",
        hints: [],
      },
      {
        id: "c2",
        candidateType: "node_property",
        priority: 80,
        componentId: "asset_2",
        missingFields: [],
        rationale: "x",
        hints: [],
      },
    ];

    const plan = planInferenceQueues(candidates, {
      maxCandidatesPerAgent: 0,
      totalBudgetTokens: 1000,
      maxModelCalls: 2,
    });

    expect(plan.queues).toHaveLength(1);
    expect(plan.queues[0]?.queue).toHaveLength(2);
    expect(plan.droppedCandidates).toEqual([]);
  });
});
