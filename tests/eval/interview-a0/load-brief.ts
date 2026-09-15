import { fetchGitHubFile, verifyCommitRef } from "./kb-fetch";
import { defaultManifestPath, loadBriefManifest } from "./manifest";
import type { BriefManifest } from "./types";
import { parseBriefMarkdown } from "./parse-brief";
import {
  assertBriefShaMatchesPin,
  parseTaxonomyFromSkill,
} from "./parse-skill";
import type { BriefSnapshot } from "./types";

export async function loadBriefSnapshot(manifest: BriefManifest): Promise<BriefSnapshot> {
  await verifyCommitRef(manifest.repository, manifest.commit);
  await verifyCommitRef(manifest.repository, manifest.skill_commit);

  const [briefFile, skillFile, rubricFile] = await Promise.all([
    fetchGitHubFile(manifest.repository, manifest.brief_path, manifest.commit),
    fetchGitHubFile(
      manifest.repository,
      `${manifest.skill_path}/SKILL.md`,
      manifest.skill_commit,
    ),
    fetchGitHubFile(
      manifest.repository,
      `${manifest.skill_path}/score-rubric.md`,
      manifest.skill_commit,
    ),
  ]);

  assertBriefShaMatchesPin(skillFile.content, manifest.commit);
  assertBriefShaMatchesPin(rubricFile.content, manifest.commit);

  const brief = parseBriefMarkdown(briefFile.content, manifest.commit);
  brief.taxonomy = parseTaxonomyFromSkill(skillFile.content);
  return brief;
}

export async function loadDefaultBriefSnapshot(): Promise<BriefSnapshot> {
  const manifest = loadBriefManifest(defaultManifestPath);
  return loadBriefSnapshot(manifest);
}
