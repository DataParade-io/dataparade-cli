import type { BriefSnapshot } from "./types";

function parseEnumValues(row: string): string[] {
  const dashIndex = row.indexOf("—");
  const tail = dashIndex === -1 ? row : row.slice(dashIndex + 1);
  const values: string[] = [];
  const pattern = /`([a-z_]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tail)) !== null) {
    values.push(match[1]);
  }
  return values;
}

export function parseTaxonomyFromSkill(skillMarkdown: string): BriefSnapshot["taxonomy"] {
  const sectionStart = skillMarkdown.indexOf("## Taxonomy discipline");
  if (sectionStart === -1) {
    throw new Error("Missing taxonomy section in SKILL.md");
  }
  const section = skillMarkdown.slice(sectionStart);

  let dataCategories: string[] = [];
  let purposes: string[] = [];
  let actorKinds: string[] = [];

  for (const line of section.split("\n")) {
    if (!line.includes("|")) {
      continue;
    }
    if (line.includes("DataCategory")) {
      dataCategories = parseEnumValues(line);
    } else if (line.includes("Purpose")) {
      purposes = parseEnumValues(line);
    } else if (line.includes("ActorKind")) {
      actorKinds = parseEnumValues(line);
    }
  }

  if (dataCategories.length === 0 || purposes.length === 0 || actorKinds.length === 0) {
    throw new Error("Could not parse ontology enums from SKILL.md");
  }

  return { dataCategories, purposes, actorKinds };
}

export function extractPinnedBriefSha(markdown: string): string {
  const match = markdown.match(/dogfood-brief-a0\.md`?\s*@\s*`?([0-9a-f]{7,40})/i);
  if (!match) {
    throw new Error("Could not find pinned brief SHA in knowledge-base skill/rubric artifact");
  }
  return match[1];
}

export function assertBriefShaMatchesPin(skillOrRubricMarkdown: string, expectedFullSha: string): void {
  const cited = extractPinnedBriefSha(skillOrRubricMarkdown);
  if (!expectedFullSha.startsWith(cited) && cited !== expectedFullSha) {
    throw new Error(
      `Pinned brief SHA drift: artifact cites ${cited} but manifest requires ${expectedFullSha}`,
    );
  }
}
