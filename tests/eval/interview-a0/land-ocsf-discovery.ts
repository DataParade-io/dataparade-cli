import fs from "fs";
import path from "path";

import {
  DOGFOOD_BRIEF_GATE,
  SHAPE_TO_SLOT,
  type DogfoodBriefGate,
} from "./dogfood-brief-gate";
import { landCandidateToOcsfRecords } from "./land-candidate-to-ocsf";
import {
  ELIGIBLE_SHAPES,
  landCandidateSchema,
  type LandCandidate,
  type LandCandidateDiscovery,
} from "./land-candidate-types";
import { ocsfDiscoveryRecordSchema } from "./ocsf-discovery-types";
import {
  PINNED_BRIEF_SHA,
  PINNED_ONTOLOGY_SHA,
  PINNED_ONTOLOGY_VERSION,
  PINNED_SKILL_SHA,
} from "./pins";

const AUTO_REVIEWER_RE =
  /^(gpt|claude|composer|model|agent|auto|rubric|the room|coding agent)/i;

const REJECTED_EVIDENCE_RE =
  /experiments\/datap-|\/eval\/|fixtures\/|mapped-transcript|stakeholder-script|discovery-export-bundle|raw-model-transcript/i;

const EXAM_CANDIDATE_PATH_RE =
  /experiments\/datap-\d+|\/datap-(673|674|676|691|693)\//i;

const SYSTEM_ASSERTS_URI = "dp:a0/system";

export const DEFAULT_OCSF_DISCOVERIES_DIR = path.join(
  "project",
  "wiki",
  "graph",
  "dogfood",
  "ocsf-discoveries",
);

export class LandRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LandRejection";
  }
}

function assertHumanReviewer(reviewer: string | undefined): string {
  if (!reviewer || !reviewer.trim()) {
    throw new LandRejection("MISSING_REVIEWER", "Human reviewer is required to land");
  }
  const trimmed = reviewer.trim();
  if (AUTO_REVIEWER_RE.test(trimmed)) {
    throw new LandRejection("INVALID_REVIEWER", `Reviewer '${trimmed}' is not a human id`);
  }
  return trimmed;
}

function assertRawEvidenceRef(rawEvidenceRef: string | undefined): string {
  if (!rawEvidenceRef || !rawEvidenceRef.trim()) {
    throw new LandRejection(
      "MISSING_EVIDENCE",
      "raw_evidence_ref is required (unedited transcript / notes — not mapper JSON)",
    );
  }
  const trimmed = rawEvidenceRef.trim();
  if (REJECTED_EVIDENCE_RE.test(trimmed)) {
    throw new LandRejection(
      "REJECTED_EVIDENCE",
      `raw_evidence_ref '${trimmed}' points at eval/experiment artifacts — not landable`,
    );
  }
  return trimmed;
}

export function assertNonExamCandidatePath(candidatePath: string | undefined): void {
  if (!candidatePath) {
    return;
  }
  if (EXAM_CANDIDATE_PATH_RE.test(candidatePath)) {
    throw new LandRejection(
      "REJECTED_EXAM_PATH",
      `Land candidate path '${candidatePath}' is under a scripted exam folder`,
    );
  }
}

function parseAssertedEntityId(asserts: string): string | null {
  const match = asserts.match(/^dp:scan\/entity\/(.+)$/);
  return match?.[1] ?? null;
}

function parseDataCategories(assertedValue: string): string[] {
  try {
    const parsed = JSON.parse(assertedValue) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(String);
    }
  } catch {
    // fall through
  }
  throw new LandRejection(
    "INVALID_SHAPE",
    "data_categories asserted_value must be a JSON array string",
  );
}

function validateDiscoveryShape(
  discovery: LandCandidateDiscovery,
  gate: DogfoodBriefGate,
): void {
  const { source, eligible_shape, asserted_slot, asserted_value, asserts } = discovery;

  if (source !== "interview") {
    throw new LandRejection(
      "INVALID_SOURCE",
      `Discovery source must be interview; got '${String(source)}'`,
    );
  }

  if (!ELIGIBLE_SHAPES.has(eligible_shape)) {
    throw new LandRejection(
      "INELIGIBLE_SHAPE",
      `eligible_shape must be D2/D4/D7/D8; got '${String(eligible_shape)}'`,
    );
  }

  if (asserted_slot !== SHAPE_TO_SLOT[eligible_shape]) {
    throw new LandRejection(
      "SHAPE_SLOT_MISMATCH",
      `${eligible_shape} requires asserted_slot '${SHAPE_TO_SLOT[eligible_shape]}'; got '${String(asserted_slot)}'`,
    );
  }

  if (eligible_shape === "D2") {
    if (asserts !== SYSTEM_ASSERTS_URI) {
      throw new LandRejection("INVALID_ASSERTS", `D2 in_scope must assert ${SYSTEM_ASSERTS_URI}`);
    }
    if (!gate.unknown_slots.has("system_identity")) {
      throw new LandRejection("SCAN_WINS", "System identity is not brief-unknown");
    }
    if (!asserted_value?.trim()) {
      throw new LandRejection("INVALID_SHAPE", "D2 in_scope requires approved text");
    }
    return;
  }

  if (eligible_shape === "D4") {
    const entityId = parseAssertedEntityId(asserts);
    if (!entityId) {
      throw new LandRejection(
        "INVALID_ASSERTS",
        "D4 actor_kind must assert dp:scan/entity/cmp_*",
      );
    }
    if (!gate.partial_known_actors.has(entityId)) {
      throw new LandRejection(
        "SCAN_WINS",
        `Actor ${entityId} is not partial-known — interview cannot rewrite scan identity`,
      );
    }
    if (!gate.taxonomy.actorKinds.includes(asserted_value)) {
      throw new LandRejection(
        "INVALID_SHAPE",
        `ActorKind must be one ontology enum token (D4); got '${String(asserted_value)}'`,
      );
    }
    return;
  }

  const flowId = parseAssertedEntityId(asserts);
  if (!flowId || !flowId.startsWith("flow_")) {
    throw new LandRejection("INVALID_ASSERTS", "D7/D8 must assert dp:scan/entity/flow_*");
  }
  if (!gate.scan_known_flows.has(flowId)) {
    throw new LandRejection(
      "D6_ENDPOINT_REASK",
      `Flow ${flowId} endpoint is not scan-known — cannot land interview overwrite`,
    );
  }

  if (eligible_shape === "D7") {
    const categories = parseDataCategories(asserted_value);
    if (categories.length === 0) {
      throw new LandRejection("INVALID_SHAPE", "data_categories list must not be empty");
    }
    if (categories.includes("unspecified")) {
      throw new LandRejection(
        "INVALID_SHAPE",
        "unspecified is not a DataCategory token — use other",
      );
    }
    for (const token of categories) {
      if (!gate.taxonomy.dataCategories.includes(token)) {
        throw new LandRejection(
          "INVALID_SHAPE",
          `Invalid DataCategory token '${token}'`,
        );
      }
    }
    return;
  }

  if (!gate.taxonomy.purposes.includes(asserted_value)) {
    throw new LandRejection(
      "INVALID_SHAPE",
      `Purpose must be ontology enum (D8); got '${String(asserted_value)}'`,
    );
  }
}

export function validateLandCandidate(
  candidate: LandCandidate,
  gate: DogfoodBriefGate = DOGFOOD_BRIEF_GATE,
): { reviewer: string; rawEvidenceRef: string } {
  if (candidate.ontology_version !== PINNED_ONTOLOGY_VERSION) {
    throw new LandRejection(
      "PIN_MISMATCH",
      `ontology_version must be ${PINNED_ONTOLOGY_VERSION}`,
    );
  }
  if (candidate.ontology_sha !== PINNED_ONTOLOGY_SHA) {
    throw new LandRejection("PIN_MISMATCH", `ontology_sha must be ${PINNED_ONTOLOGY_SHA}`);
  }
  if (candidate.skill_sha !== PINNED_SKILL_SHA) {
    throw new LandRejection("PIN_MISMATCH", `skill_sha must be ${PINNED_SKILL_SHA}`);
  }
  if (candidate.brief_sha !== PINNED_BRIEF_SHA) {
    throw new LandRejection("PIN_MISMATCH", `brief_sha must be ${PINNED_BRIEF_SHA}`);
  }
  if (candidate.brief_sha !== gate.brief_sha) {
    throw new LandRejection("PIN_MISMATCH", "brief_sha does not match dogfood brief gate");
  }

  const reviewer = assertHumanReviewer(candidate.reviewer);
  const rawEvidenceRef = assertRawEvidenceRef(candidate.raw_evidence_ref);

  if (candidate.discoveries.length === 0) {
    throw new LandRejection("EMPTY_CANDIDATE", "Land candidate must include discoveries[]");
  }

  for (const discovery of candidate.discoveries) {
    validateDiscoveryShape(discovery, gate);
  }

  return { reviewer, rawEvidenceRef };
}

export function slugifyDiscoveryId(id: string): string {
  return id.replace(/[:/]/g, "_");
}

function ocsfDiscoveryPath(outputDir: string, discoveryId: string): string {
  return path.join(outputDir, `${slugifyDiscoveryId(discoveryId)}.json`);
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export interface LandOcsfDiscoveryOptions {
  outputDir?: string;
  gate?: DogfoodBriefGate;
  dryRun?: boolean;
  landedAt?: string;
  candidatePath?: string;
}

export interface LandedOcsfDiscovery {
  id: string;
  ocsf_path: string;
  eligible_shape: LandCandidateDiscovery["eligible_shape"];
}

export interface LandOcsfDiscoveryResult {
  land_candidate_id: string;
  output_dir: string;
  reviewer: string;
  raw_evidence_ref: string;
  landed_count: number;
  landed: LandedOcsfDiscovery[];
  dry_run: boolean;
  landed_at: string;
}

export function landOcsfDiscoveries(
  candidate: LandCandidate,
  options: LandOcsfDiscoveryOptions = {},
): LandOcsfDiscoveryResult {
  assertNonExamCandidatePath(options.candidatePath);

  const outputDir = options.outputDir ?? DEFAULT_OCSF_DISCOVERIES_DIR;
  const gate = options.gate ?? DOGFOOD_BRIEF_GATE;
  const dryRun = Boolean(options.dryRun);
  const landedAt = options.landedAt ?? new Date().toISOString();

  const parsed = landCandidateSchema.parse(candidate);
  const { reviewer, rawEvidenceRef } = validateLandCandidate(parsed, gate);
  const records = landCandidateToOcsfRecords(parsed, reviewer, rawEvidenceRef);

  if (!dryRun) {
    ensureDir(outputDir);
  }

  const landed: LandedOcsfDiscovery[] = [];

  for (const record of records) {
    const validated = ocsfDiscoveryRecordSchema.parse(record);
    const discoveryId = validated.metadata.uid;
    const filePath = ocsfDiscoveryPath(outputDir, discoveryId);

    if (!dryRun && fs.existsSync(filePath)) {
      throw new LandRejection(
        "DUPLICATE_LAND",
        `OCSF Discovery record already exists: ${filePath}`,
      );
    }

    const payload = {
      ...validated,
      unmapped: {
        dataparade: {
          land_candidate_id: parsed.land_candidate_id,
          landed_at: landedAt,
        },
      },
    };

    if (!dryRun) {
      fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    }

    const discovery = parsed.discoveries.find((d) => d.id === discoveryId);
    landed.push({
      id: discoveryId,
      ocsf_path: path.relative(outputDir, filePath),
      eligible_shape: discovery?.eligible_shape ?? "D2",
    });
  }

  return {
    land_candidate_id: parsed.land_candidate_id,
    output_dir: outputDir,
    reviewer,
    raw_evidence_ref: rawEvidenceRef,
    landed_count: landed.length,
    landed,
    dry_run: dryRun,
    landed_at: landedAt,
  };
}

export function loadLandCandidate(candidatePath: string): LandCandidate {
  const resolved = path.resolve(candidatePath);
  const content = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(content) as unknown;
  return landCandidateSchema.parse(parsed);
}

export function landOcsfDiscoveriesFromPath(
  candidatePath: string,
  options: Omit<LandOcsfDiscoveryOptions, "candidatePath"> = {},
): LandOcsfDiscoveryResult {
  const candidate = loadLandCandidate(candidatePath);
  return landOcsfDiscoveries(candidate, {
    ...options,
    candidatePath: path.resolve(candidatePath),
  });
}
