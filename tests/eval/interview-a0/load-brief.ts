import crypto from "crypto";
import fs from "fs";
import path from "path";

import { defaultManifestPath, fixturesRoot, loadBriefManifest } from "./manifest";
import { parseBriefMarkdown } from "./parse-brief";
import {
  assertBriefShaMatchesPin,
  parseTaxonomyFromSkill,
} from "./parse-skill";
import type { BriefManifest, BriefSnapshot } from "./types";

function readPinnedFixture(
  fixtureRelativePath: string,
  expectedSha256: string,
): string {
  const filePath = path.join(fixturesRoot, fixtureRelativePath);
  const content = fs.readFileSync(filePath, "utf8");
  const digest = crypto.createHash("sha256").update(content).digest("hex");
  if (digest !== expectedSha256) {
    throw new Error(
      `Fixture ${fixtureRelativePath} drifted (sha256 ${digest} != manifest ${expectedSha256}). ` +
        "Bump source SHAs in brief.manifest.yaml and regenerate dpkb fixtures.",
    );
  }
  return content;
}

export function loadBriefSnapshot(manifest: BriefManifest): BriefSnapshot {
  const briefMarkdown = readPinnedFixture(manifest.brief_fixture, manifest.brief_fixture_sha256);
  const skillMarkdown = readPinnedFixture(manifest.skill_fixture, manifest.skill_fixture_sha256);
  const rubricMarkdown = readPinnedFixture(
    manifest.rubric_fixture,
    manifest.rubric_fixture_sha256,
  );

  assertBriefShaMatchesPin(skillMarkdown, manifest.commit);
  assertBriefShaMatchesPin(rubricMarkdown, manifest.commit);

  const brief = parseBriefMarkdown(briefMarkdown, manifest.commit);
  brief.taxonomy = parseTaxonomyFromSkill(skillMarkdown);
  return brief;
}

export function loadDefaultBriefSnapshot(): BriefSnapshot {
  const manifest = loadBriefManifest(defaultManifestPath);
  return loadBriefSnapshot(manifest);
}
