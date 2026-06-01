import { selectInferenceCandidates } from "./candidate-selector";
import { mergeAiProposals } from "./merge-rules";
import { planInferenceQueues } from "./planner";
import type {
  GenerateProposalsContext,
  InferencePipelineResult,
  InferencePlannerOptions,
  RunInferencePipelineInput,
  RunInferencePipelineOptions,
} from "./types";

const DEFAULT_PLANNER_OPTIONS: InferencePlannerOptions = {
  totalBudgetTokens: 12_000,
  maxModelCalls: 12,
  maxCandidatesPerAgent: 25,
};

export async function runInferencePipeline(
  input: RunInferencePipelineInput,
  options: RunInferencePipelineOptions = {},
): Promise<InferencePipelineResult> {
  const components = input.components;
  const candidates = selectInferenceCandidates({
    components,
    dataFlows: input.dataFlows,
    sections: input.sections,
    inferenceScope: input.inferenceScope ?? "default",
  });

  const plannerOptions: InferencePlannerOptions = {
    ...DEFAULT_PLANNER_OPTIONS,
    ...(input.plannerOptions ?? {}),
  };
  const plan = planInferenceQueues(candidates, plannerOptions);

  const proposalContext: GenerateProposalsContext = {
    candidates,
    plan,
    components: input.components,
    dataFlows: input.dataFlows,
    sections: input.sections,
    files: input.files,
    findings: input.findings,
  };
  const generation = options.generateProposals
    ? await options.generateProposals(proposalContext)
    : { proposals: [] };
  const proposals = generation.proposals;

  const mergeResult = mergeAiProposals(components, input.dataFlows, proposals, {}, {
    enforceIntraSectionFlowChangesOnly: true,
  });

  return {
    candidates,
    plan,
    proposals,
    usageSummary: generation.usageSummary,
    mergeResult,
  };
}
