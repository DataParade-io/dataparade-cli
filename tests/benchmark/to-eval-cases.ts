import type { EvalCase, EvalLayer } from "../eval/types";
import type { AnnotationRecord, ReviewState } from "./schema";

export interface ToEvalCasesOptions {
  /**
   * When true, include `proposed` and `needs_adjudication` annotations.
   * Default false. Mutually exclusive with `reviewStates`.
   */
  includeProposed?: boolean;
  /**
   * Explicit set of review states to include. Default `["accepted"]`.
   * When set, overrides `includeProposed`.
   */
  reviewStates?: ReviewState[];
}

const DEFAULT_REVIEW_STATES: ReviewState[] = ["accepted"];

function resolveReviewStates(options: ToEvalCasesOptions): ReviewState[] {
  if (options.reviewStates) {
    return options.reviewStates;
  }
  if (options.includeProposed) {
    return ["accepted", "proposed", "needs_adjudication"];
  }
  return DEFAULT_REVIEW_STATES;
}

function isIncludedReviewState(
  reviewState: AnnotationRecord["provenance"]["review_state"],
  allowedStates: ReviewState[],
): boolean {
  return allowedStates.includes(reviewState);
}

const LAYER_MAP: Record<AnnotationRecord["layer"], EvalLayer> = {
  components: "components",
  data_flows: "data-flows",
  pii_signals: "pii-signals",
  data_items: "data-items",
};

function toEvalLayer(layer: AnnotationRecord["layer"]): EvalLayer {
  const mapped = LAYER_MAP[layer];
  if (!mapped) {
    throw new Error(`Unsupported annotation layer '${layer}' for eval conversion`);
  }
  return mapped;
}

/**
 * Convert one benchmark annotation to an eval case, or null when filtered out.
 */
export function annotationToEvalCase(
  annotation: AnnotationRecord,
  fixture: string,
  options: ToEvalCasesOptions = {},
): EvalCase | null {
  const allowedStates = resolveReviewStates(options);
  if (!isIncludedReviewState(annotation.provenance.review_state, allowedStates)) {
    return null;
  }

  return {
    id: annotation.id,
    fixture,
    layer: toEvalLayer(annotation.layer),
    subject: {
      key: annotation.subject.key,
      ...(annotation.subject.name !== undefined ? { name: annotation.subject.name } : {}),
    },
    evidence: {
      file_path: annotation.evidence.file_path,
      start_line: annotation.evidence.start_line,
      end_line: annotation.evidence.end_line,
    },
    expected: {
      status: annotation.expected.status,
      labels: [...annotation.expected.labels],
    },
    rationale: annotation.rationale,
    ...(annotation.expected.exhaustive_scope_files !== undefined
      ? { exhaustiveScopeFiles: [...annotation.expected.exhaustive_scope_files] }
      : {}),
  };
}

/** Convert benchmark annotations to eval cases for a fixture. */
export function annotationsToEvalCases(
  annotations: AnnotationRecord[],
  fixture: string,
  options: ToEvalCasesOptions = {},
): EvalCase[] {
  return annotations.flatMap((annotation) => {
    const evalCase = annotationToEvalCase(annotation, fixture, options);
    return evalCase === null ? [] : [evalCase];
  });
}
