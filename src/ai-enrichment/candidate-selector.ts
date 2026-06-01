import type { ServiceSection } from "../core/sectioning/discover-service-sections";
import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import type {
  AiCandidateType,
  AiInferenceCandidate,
  AiInferenceScope,
} from "./types";

/** Keep LangSmith / LLM prompts small; tools still see full `properties`. */
const MAX_MISSING_FIELD_KEYS_IN_CANDIDATE = 36;

function getSectionId(component: DetectedComponent): string | undefined {
  const section = component.properties.section_id;
  return typeof section === "string" && section.length > 0 ? section : undefined;
}

function isSparseValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

function hasSparseProperties(component: DetectedComponent): boolean {
  const values = Object.values(component.properties);
  if (values.length === 0) return true;
  return values.some((value) => isSparseValue(value));
}

function countCrossSectionFlows(
  flows: DetectedDataFlow[],
  componentsById: Map<string, DetectedComponent>,
): number {
  return flows.filter((flow) => {
    const source = componentsById.get(flow.sourceComponentId);
    const target = componentsById.get(flow.targetComponentId);
    if (!source || !target) return false;
    if (source.type === "actor" || target.type === "actor") return false;
    const sourceSection = getSectionId(source);
    const targetSection = getSectionId(target);
    if (!sourceSection || !targetSection) return false;
    return sourceSection !== targetSection;
  }).length;
}

function buildCandidate(
  candidateType: AiCandidateType,
  id: string,
  priority: number,
  rationale: string,
  fields: {
    componentId?: string;
    flowId?: string;
    missingFields?: string[];
    hints?: string[];
  } = {},
): AiInferenceCandidate {
  return {
    id,
    candidateType,
    priority,
    rationale,
    componentId: fields.componentId,
    flowId: fields.flowId,
    missingFields: fields.missingFields ?? [],
    hints: fields.hints ?? [],
  };
}

export function selectInferenceCandidates(
  input: {
    components: DetectedComponent[];
    dataFlows: DetectedDataFlow[];
    sections?: ServiceSection[];
    inferenceScope?: AiInferenceScope;
  },
): AiInferenceCandidate[] {
  const scope = input.inferenceScope ?? "default";

  if (scope === "third_party_only") {
    return selectThirdPartyOnlyCandidates(input.components);
  }

  const candidates: AiInferenceCandidate[] = [];
  const byId = new Map(input.components.map((component) => [component.id, component]));

  for (const component of input.components) {
    if (
      component.type === "third_party" &&
      (!component.subType || component.subType.trim().length === 0)
    ) {
      candidates.push(
        buildCandidate(
          "third_party",
          `cand_third_party_${component.id}`,
          95,
          "Third-party component is missing subtype metadata.",
          {
            componentId: component.id,
            missingFields: ["subType"],
            hints: ["infer vendor/product from import and endpoint evidence"],
          },
        ),
      );
    }

    if (component.type !== "actor" && hasSparseProperties(component)) {
      const sparseFields = Object.entries(component.properties)
        .filter(([, value]) => isSparseValue(value))
        .map(([key]) => key)
        .sort((a, b) => a.localeCompare(b));

      const listed =
        sparseFields.length <= MAX_MISSING_FIELD_KEYS_IN_CANDIDATE
          ? sparseFields
          : sparseFields.slice(0, MAX_MISSING_FIELD_KEYS_IN_CANDIDATE);
      const omitted = sparseFields.length - listed.length;
      const hints =
        omitted > 0
          ? [
              "prioritize Tier 1 fields first",
              `${omitted} more sparse property keys omitted here; use tooling / full component context for the complete list`,
            ]
          : ["prioritize Tier 1 fields first"];

      candidates.push(
        buildCandidate(
          "node_property",
          `cand_node_property_${component.id}`,
          85,
          "Component has sparse properties requiring evidence-backed completion.",
          {
            componentId: component.id,
            missingFields: listed,
            hints,
          },
        ),
      );
    }
  }

  for (const flow of input.dataFlows) {
    const source = byId.get(flow.sourceComponentId);
    const target = byId.get(flow.targetComponentId);
    if (!source || !target) continue;

    const actorInvolved = source.type === "actor" || target.type === "actor";
    const uncertain = flow.confidence < 0.8;
    const suspiciousDirection = source.type !== "actor" && target.type === "actor";

    if (actorInvolved && (uncertain || suspiciousDirection)) {
      candidates.push(
        buildCandidate(
          "flow_direction",
          `cand_flow_direction_${flow.id}`,
          suspiciousDirection ? 90 : 80,
          "Flow involving actor has low confidence or suspicious direction.",
          {
            flowId: flow.id,
            hints: ["verify caller->callee direction from route and handler evidence"],
          },
        ),
      );
    }
  }

  const crossSectionFlows = countCrossSectionFlows(input.dataFlows, byId);
  if ((input.sections?.length ?? 0) >= 2 && crossSectionFlows === 0) {
    candidates.push(
      buildCandidate(
        "missing_interaction",
        "cand_missing_interaction_cross_section",
        88,
        "Multiple sections were detected without any inferred cross-section interactions.",
        {
          hints: ["search for API clients, fetch/axios, and backend route wiring"],
        },
      ),
    );
  }

  return candidates.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });
}

/**
 * One `third_party` candidate per third-party component — no assets, actors, or flow-only work.
 */
function selectThirdPartyOnlyCandidates(
  components: DetectedComponent[],
): AiInferenceCandidate[] {
  const out: AiInferenceCandidate[] = [];

  for (const component of components) {
    if (component.type !== "third_party") continue;

    const needsSubType = !component.subType || component.subType.trim().length === 0;

    const sparseFields = Object.entries(component.properties ?? {})
      .filter(([, value]) => isSparseValue(value))
      .map(([key]) => key)
      .sort((a, b) => a.localeCompare(b));

    const missingFields = needsSubType
      ? ["subType", ...sparseFields.filter((k) => k !== "subType")]
      : sparseFields;

    const listed =
      missingFields.length <= MAX_MISSING_FIELD_KEYS_IN_CANDIDATE
        ? missingFields
        : missingFields.slice(0, MAX_MISSING_FIELD_KEYS_IN_CANDIDATE);
    const omitted = missingFields.length - listed.length;

    out.push(
      buildCandidate(
        "third_party",
        `cand_third_party_${component.id}`,
        needsSubType ? 95 : 90,
        needsSubType
          ? "Third-party AI pass: infer setSubType (required) plus sparse properties with evidence."
          : "Third-party AI pass: fill every sparse property key you can support with evidence from the repo (vendor, auth, methods, data handling, compliance, etc.).",
        {
          componentId: component.id,
          missingFields: listed,
          hints: [
            ...(needsSubType
              ? [
                  "setSubType is required when componentContext.subType is empty — pick one taxonomy value (e.g. ai_provider, saas_service, payment_processor, cloud_provider)",
                ]
              : []),
            "Focus on vendor, integration_method, endpoints, SDKs, and auth patterns from imports and config",
            ...(omitted > 0
              ? [
                  `${omitted} more sparse property keys omitted in this payload; use agent tools for full context`,
                ]
              : []),
          ],
        },
      ),
    );
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}
