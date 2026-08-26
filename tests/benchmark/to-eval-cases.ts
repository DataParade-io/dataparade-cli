import type { EvalCase, EvalLayer } from "../eval/types";
import type { AnnotationRecord } from "./schema";

export interface ToEvalCasesOptions {
  /** When true, include `proposed` and `needs_adjudication` annotations. Default false. */
  includeProposed?: boolean;
}

function isIncludedReviewState(
  reviewState: AnnotationRecord["provenance"]["review_state"],
  includeProposed: boolean,
): boolean {
  if (reviewState === "rejected") {
    return false;
  }
  if (reviewState === "accepted") {
    return true;
  }
  return includeProposed;
}

function toEvalLayer(layer: AnnotationRecord["layer"]): EvalLayer {
  if (layer !== "components") {
    throw new Error(`Unsupported annotation layer '${layer}' for eval conversion`);
  }
  return layer;
}

/**
 * Convert one benchmark annotation to an eval case, or null when filtered out.
 */
export function annotationToEvalCase(
  annotation: AnnotationRecord,
  fixture: string,
  options: ToEvalCasesOptions = {},
): EvalCase | null {
  const includeProposed = options.includeProposed ?? false;
  if (!isIncludedReviewState(annotation.provenance.review_state, includeProposed)) {
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
