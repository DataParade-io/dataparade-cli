import type { BriefSnapshot, InterviewSlot } from "./types";

const COMPONENT_ID_RE = /`(cmp_\d+)`/;
const FLOW_ID_RE = /`(flow_\d+)`/;

function parseTableRows(section: string): string[][] {
  const rows: string[][] = [];
  for (const line of section.split("\n")) {
    if (!line.trim().startsWith("|") || line.includes("---")) {
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  return rows;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSection(markdown: string, heading: string): string {
  const pattern = new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "m");
  const match = pattern.exec(markdown);
  if (!match) {
    throw new Error(`Missing '## ${heading}' section in dogfood brief`);
  }
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const nextHeading = rest.search(/^## /m);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

function extractSubsection(section: string, heading: string): string {
  const pattern = new RegExp(`^### ${escapeRegExp(heading)}\\s*$`, "m");
  const match = pattern.exec(section);
  if (!match) {
    throw new Error(`Missing '### ${heading}' subsection in dogfood brief`);
  }
  const start = match.index + match[0].length;
  const rest = section.slice(start);
  const nextHeading = rest.search(/^### /m);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

function parseDiscoveryIds(section: string, idPattern: RegExp): string[] {
  const ids: string[] = [];
  for (const row of parseTableRows(section)) {
    const match = idPattern.exec(row[0] ?? "");
    if (match) {
      ids.push(match[1]);
    }
  }
  return ids;
}

function parsePartialKnownActors(requiredSlotsSection: string): string[] {
  const match = requiredSlotsSection.match(/`((?:cmp_\d+)(?:`, `cmp_\d+)*)`/);
  if (!match) {
    throw new Error("Could not parse partial-known actor ids from brief");
  }
  return match[1].split("`, `").map((id) => id.replace(/`/g, ""));
}

function parseSiblingRepoCandidates(requiredSlotsSection: string): string[] {
  const match = requiredSlotsSection.match(/Sibling candidates:\s*([^|]+)/);
  if (!match) {
    throw new Error("Could not parse sibling repo candidates from brief");
  }
  const repos: string[] = [];
  const repoPattern = /`([^`]+)`/g;
  let repoMatch: RegExpExecArray | null;
  while ((repoMatch = repoPattern.exec(match[1])) !== null) {
    repos.push(repoMatch[1]);
  }
  return repos;
}

function parseUnknownSlots(requiredSlotsSection: string): InterviewSlot[] {
  const slots: InterviewSlot[] = [];
  for (const row of parseTableRows(requiredSlotsSection)) {
    const slotLabel = row[0] ?? "";
    const status = (row[1] ?? "").toLowerCase();
    if (!status.includes("unknown")) {
      continue;
    }
    if (slotLabel.includes("System identity")) {
      slots.push("system_identity");
    } else if (slotLabel.includes("System boundary") || slotLabel.includes("Repo membership")) {
      slots.push("system_boundary");
    } else if (slotLabel.includes("data_categories")) {
      slots.push("sends_data_to.data_categories");
    } else if (slotLabel.includes("purpose")) {
      slots.push("sends_data_to.purpose");
    }
  }
  return slots;
}

function parseMushMergeGroups(componentsSection: string): Record<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const row of parseTableRows(componentsSection)) {
    const idMatch = COMPONENT_ID_RE.exec(row[0] ?? "");
    const value = row[2] ?? "";
    if (!idMatch || !value) {
      continue;
    }
    const id = idMatch[1];
    const existing = groups.get(value) ?? [];
    existing.push(id);
    groups.set(value, existing);
  }

  const mushOnly: Record<string, string[]> = {};
  for (const [name, ids] of groups.entries()) {
    if (ids.length > 1) {
      mushOnly[name] = ids;
    }
  }
  return mushOnly;
}

export function parseBriefMarkdown(content: string, sha: string): BriefSnapshot {
  const requiredSlotsSection = extractSection(content, "Required slots (A0 data-flow)");
  const discoveriesSection = extractSection(
    content,
    "Known from Discoveries (provenance=`scan`)",
  );
  const componentsSection = extractSubsection(discoveriesSection, "Components");
  const flowsSection = extractSubsection(discoveriesSection, "Data flows");

  return {
    sha,
    scanKnownComponents: parseDiscoveryIds(componentsSection, COMPONENT_ID_RE),
    scanKnownFlows: parseDiscoveryIds(flowsSection, FLOW_ID_RE),
    partialKnownActors: parsePartialKnownActors(requiredSlotsSection),
    unknownSlots: parseUnknownSlots(requiredSlotsSection),
    siblingRepoCandidates: parseSiblingRepoCandidates(requiredSlotsSection),
    taxonomy: {
      dataCategories: [],
      purposes: [],
      actorKinds: [],
    },
    mushMergeGroups: parseMushMergeGroups(componentsSection),
  };
}
