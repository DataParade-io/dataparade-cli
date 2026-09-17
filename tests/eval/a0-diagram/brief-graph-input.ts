import type { BriefSnapshot } from "../interview-a0/types";

const COMPONENT_ID_RE = /`(cmp_\d+)`/;
const FLOW_ID_RE = /`(flow_\d+)`/;
const FLOW_ROW_RE =
  /`(flow_\d+)`\s*\|\s*[^|]+\|\s*`(cmp_\d+)`\s*\(([^)]+)\)\s*→\s*`(cmp_\d+)`\s*\(([^)]+)\)/;

export interface BriefFlowRow {
  flowId: string;
  sourceCmpId: string;
  sourceLabel: string;
  targetCmpId: string;
  targetLabel: string;
}

export interface BriefComponentRow {
  cmpId: string;
  kindHint: string;
  label: string;
}

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

export function parseBriefFlows(markdown: string): BriefFlowRow[] {
  const discoveriesSection = extractSection(
    markdown,
    "Known from Discoveries (provenance=`scan`)",
  );
  const flowsSection = extractSubsection(discoveriesSection, "Data flows");
  const flows: BriefFlowRow[] = [];

  for (const line of flowsSection.split("\n")) {
    const match = FLOW_ROW_RE.exec(line);
    if (!match) {
      continue;
    }
    flows.push({
      flowId: match[1],
      sourceCmpId: match[2],
      sourceLabel: match[3],
      targetCmpId: match[4],
      targetLabel: match[5],
    });
  }

  if (flows.length === 0) {
    throw new Error("Could not parse data flows from dogfood brief");
  }

  return flows;
}

export function parseBriefComponents(markdown: string): BriefComponentRow[] {
  const discoveriesSection = extractSection(
    markdown,
    "Known from Discoveries (provenance=`scan`)",
  );
  const componentsSection = extractSubsection(discoveriesSection, "Components");
  const components: BriefComponentRow[] = [];

  for (const row of parseTableRows(componentsSection)) {
    const idMatch = COMPONENT_ID_RE.exec(row[0] ?? "");
    if (!idMatch) {
      continue;
    }
    components.push({
      cmpId: idMatch[1],
      kindHint: row[1] ?? "",
      label: row[2] ?? idMatch[1],
    });
  }

  return components;
}

export function componentNodeType(kindHint: string): "actor" | "asset" {
  return kindHint.includes("actor/") ? "actor" : "asset";
}

export function assertBriefSnapshotPins(brief: BriefSnapshot, expectedSha: string): void {
  if (brief.sha !== expectedSha) {
    throw new Error(`Brief SHA ${brief.sha} does not match required pin ${expectedSha}`);
  }
}
