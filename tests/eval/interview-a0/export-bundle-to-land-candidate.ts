import {
  interviewDiscoveryExportSchema,
  type InterviewDiscoveryExport,
  type InterviewDiscoveryRecord,
} from "./discovery-export-types";
import {
  ELIGIBLE_SHAPES,
  landCandidateSchema,
  type LandCandidate,
  type LandCandidateDiscovery,
} from "./land-candidate-types";
import {
  PINNED_BRIEF_SHA,
  PINNED_ONTOLOGY_SHA,
  PINNED_ONTOLOGY_VERSION,
  PINNED_SKILL_SHA,
} from "./pins";

const AUTO_REVIEWER_RE =
  /^(gpt|claude|composer|model|agent|auto|rubric|the room|coding agent)/i;

const EXAM_PATH_RE =
  /experiments\/datap-\d+|\/datap-(673|674|676|691|693)\//i;

const EXAM_INTERVIEW_ID_RE = /^datap-(673|674|676|691|693)\b/i;

const EXAM_EVIDENCE_RE =
  /experiments\/datap-|\/eval\/|fixtures\/|mapped-transcript|stakeholder-script|discovery-export-bundle|raw-model-transcript/i;

export class LandCandidateConversionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LandCandidateConversionError";
  }
}

export interface ConvertExportBundleOptions {
  /** Explicit human reviewer — never invented. */
  reviewer?: string;
  /** Explicit evidence pointer — never copied from export bundle. */
  rawEvidenceRef?: string;
  landCandidateId?: string;
  ticket?: string;
  reviewedAt?: string;
  /** Source file path when read from disk — used to reject exam folders. */
  sourcePath?: string;
}

function assertHumanReviewer(reviewer: string): string {
  const trimmed = reviewer.trim();
  if (!trimmed) {
    throw new LandCandidateConversionError(
      "INVALID_REVIEWER",
      "Reviewer must be a non-empty human id",
    );
  }
  if (AUTO_REVIEWER_RE.test(trimmed)) {
    throw new LandCandidateConversionError(
      "INVALID_REVIEWER",
      `Reviewer '${trimmed}' is not a human id`,
    );
  }
  return trimmed;
}

function assertNonExamEvidenceRef(rawEvidenceRef: string): string {
  const trimmed = rawEvidenceRef.trim();
  if (!trimmed) {
    throw new LandCandidateConversionError(
      "INVALID_EVIDENCE",
      "raw_evidence_ref must be a non-empty pointer",
    );
  }
  if (EXAM_EVIDENCE_RE.test(trimmed)) {
    throw new LandCandidateConversionError(
      "REJECTED_EVIDENCE",
      `raw_evidence_ref '${trimmed}' points at eval/experiment artifacts`,
    );
  }
  return trimmed;
}

export function assertNonExamSourcePath(sourcePath: string | undefined): void {
  if (!sourcePath) {
    return;
  }
  if (EXAM_PATH_RE.test(sourcePath)) {
    throw new LandCandidateConversionError(
      "REJECTED_EXAM_PATH",
      `Export path '${sourcePath}' is under a scripted exam folder — use non-exam export or stdin`,
    );
  }
}

function assertNonExamBundle(exportBundle: InterviewDiscoveryExport): void {
  if (EXAM_INTERVIEW_ID_RE.test(exportBundle.interview_id)) {
    throw new LandCandidateConversionError(
      "REJECTED_EXAM_BUNDLE",
      `interview_id '${exportBundle.interview_id}' is a scripted exam artifact`,
    );
  }
  if (exportBundle.promotion_blocked) {
    throw new LandCandidateConversionError(
      "PROMOTION_BLOCKED",
      "Export bundle is promotion_blocked — not convertible to land candidate",
    );
  }
  for (const discovery of exportBundle.discoveries) {
    if (EXAM_EVIDENCE_RE.test(discovery.raw_evidence_ref)) {
      throw new LandCandidateConversionError(
        "REJECTED_EXAM_EVIDENCE",
        `Discovery raw_evidence_ref '${discovery.raw_evidence_ref}' points at eval/experiment artifacts`,
      );
    }
  }
}

function toLandDiscovery(record: InterviewDiscoveryRecord): LandCandidateDiscovery {
  if (!ELIGIBLE_SHAPES.has(record.eligible_shape)) {
    throw new LandCandidateConversionError(
      "INELIGIBLE_SHAPE",
      `Discovery ${record.id} has ineligible shape ${record.eligible_shape}`,
    );
  }
  if (record.source !== "interview") {
    throw new LandCandidateConversionError(
      "INVALID_SOURCE",
      `Discovery ${record.id} source must be interview`,
    );
  }

  return {
    id: record.id,
    class: "Discovery",
    source: "interview",
    asserted_at: record.asserted_at,
    asserts: record.asserts,
    asserted_slot: record.asserted_slot,
    asserted_value: record.asserted_value,
    eligible_shape: record.eligible_shape,
  };
}

function defaultLandCandidateId(exportBundle: InterviewDiscoveryExport): string {
  const slug = exportBundle.interview_id
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `from-export-${slug || "bundle"}`;
}

export function convertExportBundleToLandCandidate(
  exportBundle: InterviewDiscoveryExport,
  options: ConvertExportBundleOptions = {},
): LandCandidate {
  assertNonExamSourcePath(options.sourcePath);
  assertNonExamBundle(exportBundle);

  if (exportBundle.export_kind !== "interview_discovery_bundle") {
    throw new LandCandidateConversionError(
      "INVALID_EXPORT",
      "Input must be an interview_discovery_bundle export",
    );
  }
  if (exportBundle.ontology_sha !== PINNED_ONTOLOGY_SHA) {
    throw new LandCandidateConversionError(
      "PIN_MISMATCH",
      `ontology_sha must be ${PINNED_ONTOLOGY_SHA}`,
    );
  }
  if (exportBundle.write_back_kb_sha !== PINNED_SKILL_SHA) {
    throw new LandCandidateConversionError(
      "PIN_MISMATCH",
      `write_back_kb_sha must be ${PINNED_SKILL_SHA}`,
    );
  }
  if (exportBundle.discoveries.length === 0) {
    throw new LandCandidateConversionError(
      "EMPTY_EXPORT",
      "Export bundle has no discoveries to convert",
    );
  }

  const discoveries = exportBundle.discoveries.map(toLandDiscovery);
  const briefSha = exportBundle.discoveries[0]?.brief_sha;
  if (briefSha !== PINNED_BRIEF_SHA) {
    throw new LandCandidateConversionError(
      "PIN_MISMATCH",
      `brief_sha must be ${PINNED_BRIEF_SHA}`,
    );
  }

  const reviewer = options.reviewer ? assertHumanReviewer(options.reviewer) : "";
  const rawEvidenceRef = options.rawEvidenceRef
    ? assertNonExamEvidenceRef(options.rawEvidenceRef)
    : "";

  const candidate: LandCandidate = {
    land_candidate_id:
      options.landCandidateId ?? defaultLandCandidateId(exportBundle),
    ticket: options.ticket,
    ontology_version: PINNED_ONTOLOGY_VERSION,
    ontology_sha: PINNED_ONTOLOGY_SHA,
    skill_sha: PINNED_SKILL_SHA,
    brief_sha: PINNED_BRIEF_SHA,
    reviewer,
    raw_evidence_ref: rawEvidenceRef,
    discoveries,
    source_interview_id: exportBundle.interview_id,
  };

  if (reviewer && options.reviewedAt) {
    candidate.reviewed_at = options.reviewedAt;
  }

  return landCandidateSchema.parse(candidate);
}

export function parseExportBundleJson(json: string): InterviewDiscoveryExport {
  const parsed = JSON.parse(json) as unknown;
  return interviewDiscoveryExportSchema.parse(parsed);
}

export function convertExportBundleJson(
  json: string,
  options: ConvertExportBundleOptions = {},
): LandCandidate {
  const exportBundle = parseExportBundleJson(json);
  return convertExportBundleToLandCandidate(exportBundle, options);
}
