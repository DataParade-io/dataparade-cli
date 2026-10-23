import path from "path";

import type { DataParadeGraph, DataParadeLink } from "@dataparade/scanner";

import type { OrchestratorScanResult } from "../core/pipeline/orchestrator-result";
import { dataItemFilePath, dataItemSlugs } from "./slug";
import {
  SCHEMA_VERSION,
  type CodeRef,
  type ComponentFact,
  type DataFlowFact,
  type DataItemFile,
  type DataItemGroup,
  type DataItemSummary,
  type FactsFile,
  type OccurrenceFact,
  type Relation,
  type SourceLocation,
} from "./schema";

const DP_PREFIX = "dp::";

/** Links that point at code, or that the data item files and groups already carry. */
const NOT_RELATIONS = new Set(["occurrence_of", "part_of", "declared_by", "occurs_in", "defined_in", "observed_in"]);

export interface BuildFactsInput {
  result: OrchestratorScanResult;
  /** The knowledge graph of the scan; without it, Facts have no code refs and no relations. */
  graph?: DataParadeGraph;
  /** Directory that was scanned. Ids and paths in the output are relative to it. */
  scanRoot: string;
  projectName: string;
  cliVersion: string;
  scannerVersion: string;
  scannedAt?: string;
}

export interface BuiltFacts {
  facts: FactsFile;
  /** File content by the file's path relative to the output folder (`data-items/<slug>.json`). */
  dataItemFiles: Map<string, DataItemFile>;
}

function stripDp(id: string): string {
  return id.startsWith(DP_PREFIX) ? id.slice(DP_PREFIX.length) : id;
}

/** Removes the scan root from any string, so absolute paths never reach the output. */
function makeScrubber(scanRoot: string): (value: string) => string {
  const root = path.resolve(scanRoot).split(path.sep).join("/");
  const prefixes = [`${root}/`];
  // A scan of a single file has the file's folder as its root.
  return (value) => {
    let out = value.split(path.sep).join("/");
    for (const prefix of prefixes) {
      while (out.includes(prefix)) out = out.replace(prefix, "");
    }
    return out;
  };
}

function toRef(link: DataParadeLink, scrub: (value: string) => string): CodeRef {
  const kind = link.target_kind;
  const file = link.target_file;
  const line = link.target_line;
  return {
    nodeId: scrub(link.target),
    ...(typeof kind === "string" ? { kind } : {}),
    ...(typeof file === "string" ? { filePath: scrub(file) } : {}),
    ...(typeof line === "number" ? { line } : {}),
  };
}

function mostCommon(values: Array<string | undefined>): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

function byId<T extends { id: string }>(list: T[]): T[] {
  return list.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Turn a scan into Facts. Every Fact appears once: components, flows and data items
 * (with their groups) in facts.json, occurrences in their data item's file.
 */
export function buildFacts(input: BuildFactsInput): BuiltFacts {
  const { result, graph, scanRoot } = input;
  const scrub = makeScrubber(scanRoot);

  // Code refs and handled-by, from the knowledge graph links.
  const refs = new Map<string, CodeRef[]>();
  const handledBy = new Map<string, Set<string>>();
  const declaredBy = new Map<string, { id: string; kind?: string }>();
  const relations: Relation[] = [];
  const relationKeys = new Set<string>();
  for (const link of graph?.links ?? []) {
    const source = scrub(stripDp(link.source));
    if (link.relation === "occurs_in" || link.relation === "defined_in" || link.relation === "observed_in") {
      const list = refs.get(source) ?? [];
      list.push(toRef(link, scrub));
      refs.set(source, list);
      continue;
    }
    if (link.relation === "declared_by") {
      const kind = link.declaration_kind;
      declaredBy.set(source, { id: scrub(stripDp(link.target)), ...(typeof kind === "string" ? { kind } : {}) });
      continue;
    }
    if (NOT_RELATIONS.has(link.relation)) continue;
    const target = scrub(stripDp(link.target));
    if (link.relation === "handled_by") {
      const set = handledBy.get(source) ?? new Set<string>();
      set.add(target);
      handledBy.set(source, set);
    }
    const key = `${link.relation}\u0000${source}\u0000${target}`;
    if (relationKeys.has(key)) continue;
    relationKeys.add(key);
    relations.push({
      type: link.relation,
      source,
      target,
      confidence: link.confidence,
      basis: typeof link.basis === "string" ? link.basis : null,
    });
  }
  const refsFor = (id: string): CodeRef[] => refs.get(id) ?? [];

  const locations = (list: Array<{ filePath: string; startLine: number; endLine: number }> | undefined): SourceLocation[] =>
    (list ?? []).map((l) => ({ filePath: scrub(l.filePath), startLine: l.startLine, endLine: l.endLine }));

  const components: ComponentFact[] = result.scanResult.components.map((c) => ({
    id: scrub(c.id),
    name: c.name,
    type: c.type,
    subType: c.subType ?? "",
    confidence: c.confidence,
    sourceLocations: locations(c.sourceLocations),
    codeRefs: refsFor(scrub(c.id)),
  }));

  const dataFlows: DataFlowFact[] = result.scanResult.dataFlows.map((f) => ({
    id: scrub(f.id),
    sourceComponentId: scrub(f.sourceComponentId),
    targetComponentId: scrub(f.targetComponentId),
    type: f.type,
    ...(f.targetScope !== undefined ? { targetScope: f.targetScope } : {}),
    confidence: f.confidence,
    sourceLocations: locations(f.sourceLocations ?? (f.sourceLocation ? [f.sourceLocation] : [])),
    codeRefs: refsFor(scrub(f.id)),
  }));

  // Data items.
  const occurrenceById = new Map(result.occurrences.map((o) => [o.id, o]));
  const names = result.dataItems.map((item) => item.id.replace(/^data_item:/, ""));
  const slugs = dataItemSlugs(names);
  const dataItems: DataItemSummary[] = [];
  const dataItemFiles = new Map<string, DataItemFile>();

  for (const item of result.dataItems) {
    const name = item.id.replace(/^data_item:/, "");
    const itemId = scrub(item.id);
    const file = dataItemFilePath(slugs.get(name) ?? "item");

    const occurrences = item.occurrenceIds.flatMap((id) => {
      const o = occurrenceById.get(id);
      return o ? [o] : [];
    });
    const groupOf = new Map<string, string>();
    const groups: DataItemGroup[] = (item.groups ?? []).map((g) => {
      const groupId = scrub(`group:${g.id}`);
      for (const id of g.occurrenceIds) groupOf.set(id, groupId);
      const basis = mostCommon(g.occurrenceIds.map((id) => occurrenceById.get(id)?.groupBasis));
      const prefix = `${name}:`;
      return {
        id: groupId,
        label: g.id.startsWith(prefix) ? g.id.slice(prefix.length) || g.id : g.id,
        ...(basis ? { basis } : {}),
        occurrenceCount: g.occurrenceIds.length,
        handledBy: [...(handledBy.get(groupId) ?? [])].sort(),
      };
    });

    const occurrenceFacts: OccurrenceFact[] = occurrences.map((o) => {
      const id = scrub(o.id);
      const declared = declaredBy.get(id);
      return {
        id,
        groupId: groupOf.get(o.id) ?? null,
        filePath: scrub(o.filePath),
        startLine: o.startLine,
        endLine: o.endLine,
        ...(o.code !== undefined ? { code: o.code } : {}),
        labels: [...o.labels],
        ...(o.location ? { location: o.location } : {}),
        codeRefs: refsFor(id),
        ...(declared ? { declaredBy: declared } : {}),
      };
    });
    occurrenceFacts.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine || a.id.localeCompare(b.id));

    dataItems.push({
      id: itemId,
      name,
      labels: [...item.labels],
      occurrenceCount: occurrenceFacts.length,
      file,
      groups: byId(groups),
    });
    dataItemFiles.set(file, {
      schemaVersion: SCHEMA_VERSION,
      id: itemId,
      name,
      labels: [...item.labels],
      groups: byId(groups.map((g) => ({ ...g }))),
      occurrences: occurrenceFacts,
    });
  }

  relations.sort(
    (a, b) => a.type.localeCompare(b.type) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  );

  return {
    facts: {
      schemaVersion: SCHEMA_VERSION,
      scan: {
        projectName: input.projectName,
        scannedAt: input.scannedAt ?? new Date().toISOString(),
        cliVersion: input.cliVersion,
        scannerVersion: input.scannerVersion,
      },
      components: byId(components),
      dataFlows: byId(dataFlows),
      dataItems: byId(dataItems),
      relations,
    },
    dataItemFiles,
  };
}
