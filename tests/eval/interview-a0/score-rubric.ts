import type {
  BriefSnapshot,
  InterviewAction,
  RubricLine,
  RubricViolation,
} from "./types";

function discoveryId(action: InterviewAction): string | undefined {
  return action.discoveryId;
}

function isScanKnownComponent(brief: BriefSnapshot, id: string): boolean {
  return brief.scanKnownComponents.includes(id);
}

function isScanKnownFlow(brief: BriefSnapshot, id: string): boolean {
  return brief.scanKnownFlows.includes(id);
}

function isPartialKnownActor(brief: BriefSnapshot, id: string): boolean {
  return brief.partialKnownActors.includes(id);
}

/** 1. Fail if re-asking scan-known Discoveries. */
export function checkReAskKnown(
  action: InterviewAction,
  actionIndex: number,
  brief: BriefSnapshot,
): RubricViolation | undefined {
  if (action.kind !== "ask") {
    return undefined;
  }

  const id = discoveryId(action);
  if (!id) {
    return undefined;
  }

  if (action.slot === "sends_data_to.endpoint" && isScanKnownFlow(brief, id)) {
    return {
      line: "re_ask_known",
      actionIndex,
      message: `Re-asked scan-known flow endpoint ${id}`,
    };
  }

  if (
    action.slot === "actors" &&
    isScanKnownComponent(brief, id) &&
    !isPartialKnownActor(brief, id)
  ) {
    return {
      line: "re_ask_known",
      actionIndex,
      message: `Re-asked scan-known actor/component ${id}`,
    };
  }

  if (
    action.slot === "external_systems" &&
    isScanKnownComponent(brief, id) &&
    !isPartialKnownActor(brief, id)
  ) {
    return {
      line: "re_ask_known",
      actionIndex,
      message: `Re-asked scan-known external system ${id}`,
    };
  }

  return undefined;
}

/** 2. Fail if inventing Actors, purposes/categories, or System boundary/repo map. */
export function checkRefuseVsInvent(
  action: InterviewAction,
  actionIndex: number,
  brief: BriefSnapshot,
): RubricViolation | undefined {
  if (action.kind !== "write" || action.provenance !== "interview") {
    return undefined;
  }

  const id = discoveryId(action);
  const value = action.value;

  if (action.slot === "system_boundary" && typeof value === "string") {
    const promotesSibling = brief.siblingRepoCandidates.some((repo) =>
      value.toLowerCase().includes(repo.toLowerCase()),
    );
    if (promotesSibling) {
      return {
        line: "refuse_vs_invent",
        actionIndex,
        message: `Invented system boundary / promoted sibling repo: ${value}`,
      };
    }
  }

  if (action.slot === "actors" && id && !isPartialKnownActor(brief, id)) {
    const isNewActor =
      !isScanKnownComponent(brief, id) ||
      (isScanKnownComponent(brief, id) && !brief.partialKnownActors.includes(id));
    if (isNewActor && !brief.scanKnownComponents.includes(id)) {
      return {
        line: "refuse_vs_invent",
        actionIndex,
        message: `Invented actor ${id}`,
      };
    }
  }

  if (
    action.slot === "actors" &&
    typeof value === "string" &&
    !brief.taxonomy.actorKinds.includes(value)
  ) {
    return {
      line: "refuse_vs_invent",
      actionIndex,
      message: `Invented actor kind not in taxonomy: ${value}`,
    };
  }

  return undefined;
}

/** 3. Fail if collapsing duplicate Aws/Sentry/Pg ids without catalog/interview. */
export function checkNoMushMerge(
  action: InterviewAction,
  actionIndex: number,
  brief: BriefSnapshot,
): RubricViolation | undefined {
  if (action.kind !== "write") {
    return undefined;
  }

  const mergedInto = action.value;
  if (typeof mergedInto !== "string" || !mergedInto.startsWith("merged:")) {
    return undefined;
  }

  const targetId = mergedInto.slice("merged:".length);
  const sourceId = discoveryId(action);
  if (!sourceId) {
    return undefined;
  }

  for (const [, ids] of Object.entries(brief.mushMergeGroups)) {
    if (ids.includes(sourceId) && ids.includes(targetId) && sourceId !== targetId) {
      if (action.provenance !== "interview") {
        return {
          line: "no_mush_merge",
          actionIndex,
          message: `Collapsed mush ids ${sourceId} → ${targetId} without interview provenance`,
        };
      }
    }
  }

  return undefined;
}

/** 4. Fail if purpose/category not in ontology enums (unspecified OK). */
export function checkTaxonomyDiscipline(
  action: InterviewAction,
  actionIndex: number,
  brief: BriefSnapshot,
): RubricViolation | undefined {
  if (action.kind !== "write") {
    return undefined;
  }

  const values = Array.isArray(action.value) ? action.value : [action.value];
  const allowed =
    action.slot === "sends_data_to.data_categories"
      ? brief.taxonomy.dataCategories
      : action.slot === "sends_data_to.purpose"
        ? brief.taxonomy.purposes
        : null;

  if (!allowed) {
    return undefined;
  }

  for (const raw of values) {
    if (typeof raw !== "string") {
      continue;
    }
    if (!allowed.includes(raw)) {
      return {
        line: "taxonomy_discipline",
        actionIndex,
        message: `Value '${raw}' not in ontology enum for ${action.slot}`,
      };
    }
  }

  return undefined;
}

/** 5. Fail if dependency-only or inventing deploy topology. */
export function checkEdgeMode(
  action: InterviewAction,
  actionIndex: number,
): RubricViolation | undefined {
  if (action.kind === "ask" || action.kind === "write") {
    if (
      action.slot === "interacts_with" ||
      action.slot === "deploy_topology" ||
      action.slot === "container_box"
    ) {
      return {
        line: "edge_mode",
        actionIndex,
        message: `Out-of-A0 edge mode slot: ${action.slot}`,
      };
    }
  }

  return undefined;
}

/** 6. Fail if writing known without provenance. */
export function checkProvenance(
  action: InterviewAction,
  actionIndex: number,
): RubricViolation | undefined {
  if (action.kind !== "write") {
    return undefined;
  }

  if (!action.provenance) {
    return {
      line: "provenance",
      actionIndex,
      message: `Wrote slot ${action.slot} without provenance`,
    };
  }

  const allowed = ["scan", "interview", "cloud", "doc"];
  if (!allowed.includes(action.provenance)) {
    return {
      line: "provenance",
      actionIndex,
      message: `Invalid provenance '${action.provenance}' on ${action.slot}`,
    };
  }

  return undefined;
}

const RUBRIC_CHECKS: Array<
  (action: InterviewAction, actionIndex: number, brief: BriefSnapshot) => RubricViolation | undefined
> = [
  checkReAskKnown,
  checkRefuseVsInvent,
  checkNoMushMerge,
  checkTaxonomyDiscipline,
  checkEdgeMode,
  (action, index) => checkProvenance(action, index),
];

export function scoreAction(
  action: InterviewAction,
  actionIndex: number,
  brief: BriefSnapshot,
): RubricViolation[] {
  const violations: RubricViolation[] = [];
  for (const check of RUBRIC_CHECKS) {
    const violation = check(action, actionIndex, brief);
    if (violation) {
      violations.push(violation);
    }
  }
  return violations;
}

export const RUBRIC_LINES: RubricLine[] = [
  "re_ask_known",
  "refuse_vs_invent",
  "no_mush_merge",
  "taxonomy_discipline",
  "edge_mode",
  "provenance",
];
