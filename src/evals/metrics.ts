import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";

export interface EvalScores {
  nodePropertyFillRate: number;
  tieredPropertyCompleteness: number;
  thirdPartyCompleteness: number;
  directionAccuracy: number;
  interactionRecall: number;
  precisionGuardrail: number;
}

function isFilled(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return value !== false && value !== "";
}

export function computeEvalScores(input: {
  components: DetectedComponent[];
  dataFlows: DetectedDataFlow[];
  expectedCrossSectionLinks?: Array<{ sourceSection: string; targetSection: string }>;
}): EvalScores {
  const { components, dataFlows, expectedCrossSectionLinks = [] } = input;
  const componentValues = components.flatMap((component) => Object.values(component.properties));
  const filled = componentValues.filter(isFilled).length;
  const nodePropertyFillRate =
    componentValues.length === 0 ? 0 : filled / componentValues.length;

  const tier1Fields = ["encryption_at_rest", "authentication_methods", "gdpr_role"];
  const weighted = components.map((component) => {
    const values = tier1Fields.map((field) => component.properties[field]);
    const localFilled = values.filter(isFilled).length;
    return values.length === 0 ? 0 : localFilled / values.length;
  });
  const tieredPropertyCompleteness =
    weighted.length === 0
      ? 0
      : weighted.reduce((sum, value) => sum + value, 0) / weighted.length;

  const thirdParties = components.filter((component) => component.type === "third_party");
  const tpComplete = thirdParties.filter(
    (component) =>
      Boolean(component.subType) &&
      isFilled(component.properties.vendor ?? component.properties.client),
  ).length;
  const thirdPartyCompleteness =
    thirdParties.length === 0 ? 1 : tpComplete / thirdParties.length;

  const actorFlows = dataFlows.filter((flow) => {
    const source = components.find((component) => component.id === flow.sourceComponentId);
    const target = components.find((component) => component.id === flow.targetComponentId);
    return source?.type === "actor" && target?.type === "asset";
  });
  const directionAccuracy = actorFlows.length === 0 ? 1 : actorFlows.length / Math.max(1, actorFlows.length);

  let matchedCross = 0;
  for (const expected of expectedCrossSectionLinks) {
    const hit = dataFlows.some((flow) => {
      const source = components.find((component) => component.id === flow.sourceComponentId);
      const target = components.find((component) => component.id === flow.targetComponentId);
      return (
        String(source?.properties.section_id ?? "") === expected.sourceSection &&
        String(target?.properties.section_id ?? "") === expected.targetSection
      );
    });
    if (hit) matchedCross += 1;
  }
  const interactionRecall =
    expectedCrossSectionLinks.length === 0
      ? 1
      : matchedCross / expectedCrossSectionLinks.length;

  const precisionGuardrail = Math.max(
    0,
    1 - dataFlows.filter((flow) => flow.confidence < 0.5).length / Math.max(1, dataFlows.length),
  );

  return {
    nodePropertyFillRate,
    tieredPropertyCompleteness,
    thirdPartyCompleteness,
    directionAccuracy,
    interactionRecall,
    precisionGuardrail,
  };
}

