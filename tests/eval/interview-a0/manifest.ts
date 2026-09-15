import fs from "fs";
import path from "path";
import YAML from "yaml";

import { PINNED_BRIEF_SHA } from "./brief-snapshot";
import type { BriefManifest } from "./types";

function isNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected non-empty string for ${field}`);
  }
  return value.trim();
}

function validateManifest(raw: Record<string, unknown>, manifestPath: string): BriefManifest {
  const commit = isNonEmptyString(raw.commit, `${manifestPath}:commit`);
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error(`Expected full commit SHA in ${manifestPath}:commit`);
  }

  return {
    repository: isNonEmptyString(raw.repository, `${manifestPath}:repository`),
    brief_path: isNonEmptyString(raw.brief_path, `${manifestPath}:brief_path`),
    commit,
    skill_path: isNonEmptyString(raw.skill_path, `${manifestPath}:skill_path`),
  };
}

export function loadBriefManifest(manifestPath: string): BriefManifest {
  const raw = YAML.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  return validateManifest(raw, manifestPath);
}

export function assertBriefShaPinned(manifest: BriefManifest): void {
  if (manifest.commit !== PINNED_BRIEF_SHA) {
    throw new Error(
      `Brief manifest commit ${manifest.commit} does not match skill pin ${PINNED_BRIEF_SHA}`,
    );
  }
}

export const defaultManifestPath = path.join(__dirname, "fixtures", "brief.manifest.yaml");
