import fs from "fs";
import path from "path";
import YAML from "yaml";

import {
  PINNED_BRIEF_SHA,
  PINNED_ONTOLOGY_SHA,
  PINNED_ONTOLOGY_VERSION,
  PINNED_SKILL_SHA,
} from "./pins";
import type { BriefManifest } from "./types";

function isNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected non-empty string for ${field}`);
  }
  return value.trim();
}

function validateSha(value: string, field: string): string {
  if (!/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`Expected full commit SHA in ${field}`);
  }
  return value;
}

function validateSha256(value: string, field: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Expected sha256 hex digest in ${field}`);
  }
  return value;
}

function validateManifest(raw: Record<string, unknown>, manifestPath: string): BriefManifest {
  return {
    repository: isNonEmptyString(raw.repository, `${manifestPath}:repository`),
    brief_path: isNonEmptyString(raw.brief_path, `${manifestPath}:brief_path`),
    commit: validateSha(isNonEmptyString(raw.commit, `${manifestPath}:commit`), `${manifestPath}:commit`),
    brief_fixture: isNonEmptyString(raw.brief_fixture, `${manifestPath}:brief_fixture`),
    brief_fixture_sha256: validateSha256(
      isNonEmptyString(raw.brief_fixture_sha256, `${manifestPath}:brief_fixture_sha256`),
      `${manifestPath}:brief_fixture_sha256`,
    ),
    skill_path: isNonEmptyString(raw.skill_path, `${manifestPath}:skill_path`),
    skill_commit: validateSha(
      isNonEmptyString(raw.skill_commit, `${manifestPath}:skill_commit`),
      `${manifestPath}:skill_commit`,
    ),
    skill_fixture: isNonEmptyString(raw.skill_fixture, `${manifestPath}:skill_fixture`),
    skill_fixture_sha256: validateSha256(
      isNonEmptyString(raw.skill_fixture_sha256, `${manifestPath}:skill_fixture_sha256`),
      `${manifestPath}:skill_fixture_sha256`,
    ),
    rubric_fixture: isNonEmptyString(raw.rubric_fixture, `${manifestPath}:rubric_fixture`),
    rubric_fixture_sha256: validateSha256(
      isNonEmptyString(raw.rubric_fixture_sha256, `${manifestPath}:rubric_fixture_sha256`),
      `${manifestPath}:rubric_fixture_sha256`,
    ),
    write_back_fixture: isNonEmptyString(
      raw.write_back_fixture,
      `${manifestPath}:write_back_fixture`,
    ),
    write_back_fixture_sha256: validateSha256(
      isNonEmptyString(raw.write_back_fixture_sha256, `${manifestPath}:write_back_fixture_sha256`),
      `${manifestPath}:write_back_fixture_sha256`,
    ),
    ontology_version: isNonEmptyString(raw.ontology_version, `${manifestPath}:ontology_version`),
    ontology_sha: validateSha(
      isNonEmptyString(raw.ontology_sha, `${manifestPath}:ontology_sha`),
      `${manifestPath}:ontology_sha`,
    ),
  };
}

export function loadBriefManifest(manifestPath: string): BriefManifest {
  const raw = YAML.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  return validateManifest(raw, manifestPath);
}

export function assertManifestPins(manifest: BriefManifest): void {
  if (manifest.commit !== PINNED_BRIEF_SHA) {
    throw new Error(
      `Brief manifest commit ${manifest.commit} does not match required pin ${PINNED_BRIEF_SHA}`,
    );
  }
  if (manifest.skill_commit !== PINNED_SKILL_SHA) {
    throw new Error(
      `Skill manifest commit ${manifest.skill_commit} does not match required pin ${PINNED_SKILL_SHA}`,
    );
  }
  if (manifest.ontology_version !== PINNED_ONTOLOGY_VERSION) {
    throw new Error(
      `Ontology version ${manifest.ontology_version} does not match required pin ${PINNED_ONTOLOGY_VERSION}`,
    );
  }
  if (manifest.ontology_sha !== PINNED_ONTOLOGY_SHA) {
    throw new Error(
      `Ontology SHA ${manifest.ontology_sha} does not match required pin ${PINNED_ONTOLOGY_SHA}`,
    );
  }
}

export const defaultManifestPath = path.join(__dirname, "fixtures", "brief.manifest.yaml");
export const fixturesRoot = path.join(__dirname, "fixtures");
