import type { AiProposal } from "../types";
import type { AgentTooling } from "../tools";
import type { AiQueuePlan } from "../types";

function defaultEvidence(reason: string) {
  return [{ filePath: "unknown", startLine: 1, endLine: 1, reason }];
}

export async function runAgentQueue(
  queuePlan: AiQueuePlan,
  tools: AgentTooling,
): Promise<AiProposal[]> {
  const proposals: AiProposal[] = [];
  for (const candidate of queuePlan.queue) {
    if (queuePlan.agent === "tpAgent") {
      continue;
    }

    if (queuePlan.agent === "directionAgent" && candidate.flowId) {
      proposals.push({
        kind: "flow_patch",
        candidateType: candidate.candidateType,
        targetFlowId: candidate.flowId,
        setDirection: "reverse",
        confidence: { score: 0.8, band: "medium" },
        evidence: defaultEvidence(candidate.rationale),
        provider: "mock",
        model: "heuristic",
        agent: "directionAgent",
      });
      continue;
    }

    if (queuePlan.agent === "interactionAgent" && candidate.hints.length >= 2) {
      const context = tools.getScanContext();
      const sourceComponent = context.components.find(
        (component) => String(component.properties.section_id ?? "") === candidate.hints[0],
      );
      const targetComponent = context.components.find(
        (component) => String(component.properties.section_id ?? "") === candidate.hints[1],
      );
      if (sourceComponent && targetComponent) {
        proposals.push({
          kind: "flow_patch",
          candidateType: candidate.candidateType,
          insertIfMissing: true,
          sourceComponentId: sourceComponent.id,
          targetComponentId: targetComponent.id,
          setType: "api_call",
          confidence: { score: 0.86, band: "high" },
          evidence: defaultEvidence(candidate.rationale),
          provider: "mock",
          model: "heuristic",
          agent: "interactionAgent",
        });
      }
      continue;
    }

  }

  return proposals;
}

