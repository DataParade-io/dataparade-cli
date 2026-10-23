import fs from "fs";

import type { A0DiscoveriesDocument } from "../discoveries/contract/discoveries-document.schema";
import { applyAnswers, SYSTEM_FACT_ID, type AppliedState } from "../facts/apply-answers";
import { FactsError, readAnswers, readDataItemFiles, readFacts } from "../facts/io";
import { layoutForDir, type OutputLayout } from "../facts/layout";
import type { Answer, DataItemFile, FactsFile } from "../facts/schema";

/**
 * A project knowledge base on disk: the folder a scan wrote dataflow.json into
 * (`dataparade scan <repo> -o <kb>/dataflow.json`, default `.dataparade/`).
 *
 *   <kb>/facts.json        Facts from the latest scan
 *   <kb>/data-items/       one file per data item, with its occurrences
 *   <kb>/answers.json      people's decisions; a scan never changes it
 *   <kb>/briefs/<sha>.json KB snapshots that interview questions were asked from
 *   <kb>/evidence/         unedited interview transcripts
 *   <kb>/diagram.json      latest projection for the viewer
 */
export type KbPaths = OutputLayout;

export function resolveKbPaths(kbDir: string): KbPaths {
  return layoutForDir(kbDir);
}

export class KbError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KbError";
  }
}

export interface KbState {
  facts: FactsFile;
  /** Data item files as the scan wrote them. */
  dataItemFiles: DataItemFile[];
  /** Everything in answers.json. */
  answers: Answer[];
  /** The scan with the answers applied. */
  applied: AppliedState;
  /** The applied state in the shape the brief and the diagram projection read. */
  document: A0DiscoveriesDocument;
  /** Answers about Facts the latest scan no longer has. Kept on disk, not projected. */
  orphans: Answer[];
}

/** An override may arrive as a list, or as the JSON text of one. */
function asStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      return asStringList(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function appliedStateToDocument(applied: AppliedState): A0DiscoveriesDocument {
  const itemsByComponent = new Map<string, Set<string>>();
  for (const item of applied.facts.dataItems) {
    for (const group of item.groups) {
      for (const componentId of group.handledBy) {
        const set = itemsByComponent.get(componentId) ?? new Set<string>();
        set.add(item.id);
        itemsByComponent.set(componentId, set);
      }
    }
  }
  const inScope = asString(applied.system.in_scope);
  return {
    components: applied.facts.components.map((c) => {
      const extra = c as unknown as Record<string, unknown>;
      const actorKind = asString(extra.actor_kind);
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        subType: c.subType,
        confidence: c.confidence,
        sourceLocations: c.sourceLocations,
        dataItemIds: [...(itemsByComponent.get(c.id) ?? [])].sort(),
        ...(actorKind ? { actor_kind: actorKind } : {}),
      };
    }),
    dataFlows: applied.facts.dataFlows.map((f) => {
      const extra = f as unknown as Record<string, unknown>;
      const categories = asStringList(extra.data_categories);
      const purpose = asString(extra.purpose);
      return {
        id: f.id,
        sourceComponentId: f.sourceComponentId,
        targetComponentId: f.targetComponentId,
        type: f.type,
        confidence: f.confidence,
        ...(f.targetScope !== undefined ? { targetScope: f.targetScope } : {}),
        ...(categories ? { data_categories: categories } : {}),
        ...(purpose ? { purpose } : {}),
      };
    }),
    dataItems: applied.dataItemFiles.map((file) => ({
      id: file.id,
      occurrenceIds: file.occurrences.map((o) => o.id),
    })),
    occurrences: applied.dataItemFiles.flatMap((file) =>
      file.occurrences.map((o) => ({
        id: o.id,
        filePath: o.filePath,
        startLine: o.startLine,
        endLine: o.endLine,
        ...(o.code !== undefined ? { code: o.code } : {}),
      })),
    ),
    ...(inScope ? { system: { in_scope: inScope } } : {}),
  };
}

export function loadKbState(paths: KbPaths): KbState {
  let facts: FactsFile;
  try {
    facts = readFacts(paths);
  } catch (error) {
    if (error instanceof FactsError && error.code === "NO_KB") {
      throw new KbError("NO_KB", error.message);
    }
    throw error;
  }
  const dataItemFiles = readDataItemFiles(paths, facts);
  const answers = readAnswers(paths).answers;
  const applied = applyAnswers(facts, dataItemFiles, answers);
  return { facts, dataItemFiles, answers, applied, document: appliedStateToDocument(applied), orphans: applied.orphans };
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export { SYSTEM_FACT_ID };
