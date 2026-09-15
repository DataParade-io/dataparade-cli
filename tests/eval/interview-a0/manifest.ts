import fs from "fs";
import path from "path";
import YAML from "yaml";

import { PINNED_BRIEF_SHA, PINNED_SKILL_SHA } from "./pins";
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

function validateManifest(raw: Record<string, unknown>, manifestPath: string): BriefManifest {
  return {
    repository: isNonEmptyString(raw.repository, `${manifestPath}:repository`),
    brief_path: isNonEmptyString(raw.brief_path, `${manifestPath}:brief_path`),
    commit: validateSha(isNonEmptyString(raw.commit, `${manifestPath}:commit`), `${manifestPath}:commit`),
    skill_path: isNonEmptyString(raw.skill_path, `${manifestPath}:skill_path`),
    skill_commit: validateSha(
      isNonEmptyString(raw.skill_commit, `${manifestPath}:skill_commit`),
      `${manifestPath}:skill_commit`,
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
}

export const defaultManifestPath = path.join(__dirname, "fixtures", "brief.manifest.yaml");
