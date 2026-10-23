import type { Answer, DataItemFile, DataItemGroup, DataItemSummary, FactsFile } from "./schema";

/** The Fact id for facts about the whole system, such as its confirmed scope. */
export const SYSTEM_FACT_ID = "dp:a0/system";

/** Properties an answer may not change: they identify the Fact or link it to the code. */
const PROTECTED_PROPERTIES = new Set(["id", "file", "codeRefs", "groups", "occurrences", "schemaVersion"]);

type Extra = Record<string, unknown>;

export interface AppliedState {
  /** facts.json with the answers applied. Overridden properties may be added to any Fact. */
  facts: FactsFile;
  /** The data item files with the answers applied, in the order of `facts.dataItems`. */
  dataItemFiles: DataItemFile[];
  /** Answers about the system itself (`dp:a0/system`), by property. */
  system: Record<string, unknown>;
  /** Answers that were used. */
  applied: Answer[];
  /** Answers about a Fact the latest scan does not have. They stay in answers.json. */
  orphans: Answer[];
  /** Answers not used: a `set` on a removed Fact, a `set` without a property, or on a protected property. */
  ignored: Answer[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type Kind = "component" | "dataFlow" | "dataItem" | "group" | "occurrence" | "system";

function sortByTime(answers: readonly Answer[]): Answer[] {
  return answers
    .map((answer, index) => ({ answer, index, time: Date.parse(answer.at) }))
    .sort((a, b) => (Number.isNaN(a.time) || Number.isNaN(b.time) ? 0 : a.time - b.time) || a.index - b.index)
    .map((entry) => entry.answer);
}

/**
 * The current state of the knowledge base: the latest scan's Facts with people's answers
 * applied on top. Pure: nothing is read or written, and the inputs are not changed.
 *
 * - `set` overrides one property of a Fact. The latest answer for a property wins.
 * - `remove` drops the Fact. A removed data item also drops its occurrences and its
 *   entry in facts.json; a removed component drops its data flows and every handledBy
 *   reference to it; a removed group drops its occurrences. A removal is final: later
 *   `set` answers about a removed Fact are ignored.
 * - An answer about a Fact the scan no longer has is returned in `orphans`.
 */
export function applyAnswers(
  factsInput: FactsFile,
  dataItemFilesInput: readonly DataItemFile[],
  answers: readonly Answer[],
): AppliedState {
  const facts = clone(factsInput);
  const files = clone([...dataItemFilesInput]);
  const system: Record<string, unknown> = {};
  const applied: Answer[] = [];
  const orphans: Answer[] = [];
  const ignored: Answer[] = [];

  const components = new Map<string, Extra>(facts.components.map((c) => [c.id, c as Extra]));
  const flows = new Map<string, Extra>(facts.dataFlows.map((f) => [f.id, f as Extra]));
  const items = new Map<string, DataItemSummary>(facts.dataItems.map((i) => [i.id, i]));
  const fileOfItem = new Map<string, DataItemFile>(files.map((f) => [f.id, f]));
  const kindById = new Map<string, Kind>();
  const groupOwner = new Map<string, string>();
  const occurrenceOwner = new Map<string, string>();
  for (const id of components.keys()) kindById.set(id, "component");
  for (const id of flows.keys()) kindById.set(id, "dataFlow");
  for (const item of facts.dataItems) {
    kindById.set(item.id, "dataItem");
    for (const group of item.groups) {
      kindById.set(group.id, "group");
      groupOwner.set(group.id, item.id);
    }
  }
  for (const file of files) {
    for (const group of file.groups) {
      kindById.set(group.id, "group");
      groupOwner.set(group.id, file.id);
    }
    for (const occurrence of file.occurrences) {
      kindById.set(occurrence.id, "occurrence");
      occurrenceOwner.set(occurrence.id, file.id);
    }
  }
  kindById.set(SYSTEM_FACT_ID, "system");

  const removed = new Set<string>();

  const groupsIn = (itemId: string, id: string): DataItemGroup[] =>
    [items.get(itemId)?.groups, fileOfItem.get(itemId)?.groups]
      .flatMap((list) => list ?? [])
      .filter((group) => group.id === id);

  const dropRelations = (ids: Set<string>) => {
    facts.relations = facts.relations.filter((r) => !ids.has(r.source) && !ids.has(r.target));
  };

  const removeFact = (id: string, kind: Kind) => {
    const gone = new Set<string>([id]);
    if (kind === "component") {
      facts.components = facts.components.filter((c) => c.id !== id);
      for (const flow of facts.dataFlows) {
        if (flow.sourceComponentId === id || flow.targetComponentId === id) gone.add(flow.id);
      }
      facts.dataFlows = facts.dataFlows.filter((f) => !gone.has(f.id));
      const strip = (groups: DataItemGroup[]) => {
        for (const group of groups) group.handledBy = group.handledBy.filter((c) => c !== id);
      };
      for (const item of facts.dataItems) strip(item.groups);
      for (const file of files) strip(file.groups);
    } else if (kind === "dataFlow") {
      facts.dataFlows = facts.dataFlows.filter((f) => f.id !== id);
    } else if (kind === "dataItem") {
      facts.dataItems = facts.dataItems.filter((i) => i.id !== id);
      const index = files.findIndex((f) => f.id === id);
      if (index !== -1) {
        for (const group of files[index].groups) gone.add(group.id);
        for (const occurrence of files[index].occurrences) gone.add(occurrence.id);
        files.splice(index, 1);
      }
      for (const group of items.get(id)?.groups ?? []) gone.add(group.id);
    } else if (kind === "group") {
      const owner = groupOwner.get(id);
      const file = owner ? fileOfItem.get(owner) : undefined;
      const item = owner ? items.get(owner) : undefined;
      if (file) {
        for (const occurrence of file.occurrences) if (occurrence.groupId === id) gone.add(occurrence.id);
        file.occurrences = file.occurrences.filter((o) => o.groupId !== id);
        file.groups = file.groups.filter((g) => g.id !== id);
      }
      if (item) item.groups = item.groups.filter((g) => g.id !== id);
    } else if (kind === "occurrence") {
      const file = fileOfItem.get(occurrenceOwner.get(id) ?? "");
      if (file) file.occurrences = file.occurrences.filter((o) => o.id !== id);
    }
    for (const goneId of gone) removed.add(goneId);
    dropRelations(gone);
  };

  const setProperty = (id: string, kind: Kind, property: string, value: unknown) => {
    if (kind === "system") {
      system[property] = value;
    } else if (kind === "component") {
      (components.get(id) as Extra)[property] = value;
    } else if (kind === "dataFlow") {
      (flows.get(id) as Extra)[property] = value;
    } else if (kind === "dataItem") {
      (items.get(id) as Extra)[property] = value;
      const file = fileOfItem.get(id);
      if (file) (file as Extra)[property] = value;
    } else if (kind === "group") {
      const owner = groupOwner.get(id) ?? "";
      for (const group of groupsIn(owner, id)) (group as Extra)[property] = value;
    } else {
      const file = fileOfItem.get(occurrenceOwner.get(id) ?? "");
      const occurrence = file?.occurrences.find((o) => o.id === id);
      if (occurrence) (occurrence as Extra)[property] = value;
    }
  };

  for (const answer of sortByTime(answers)) {
    const kind = kindById.get(answer.factId);
    if (!kind) {
      orphans.push(answer);
      continue;
    }
    if (removed.has(answer.factId)) {
      ignored.push(answer);
      continue;
    }
    if (answer.action === "remove") {
      if (kind === "system") {
        ignored.push(answer);
        continue;
      }
      removeFact(answer.factId, kind);
      applied.push(answer);
      continue;
    }
    if (!answer.property || PROTECTED_PROPERTIES.has(answer.property)) {
      ignored.push(answer);
      continue;
    }
    setProperty(answer.factId, kind, answer.property, answer.value);
    applied.push(answer);
  }

  // Counts follow what is left.
  for (const file of files) {
    const counts = new Map<string, number>();
    for (const occurrence of file.occurrences) {
      if (occurrence.groupId) counts.set(occurrence.groupId, (counts.get(occurrence.groupId) ?? 0) + 1);
    }
    for (const group of file.groups) group.occurrenceCount = counts.get(group.id) ?? 0;
    const item = items.get(file.id);
    if (item) {
      item.occurrenceCount = file.occurrences.length;
      for (const group of item.groups) group.occurrenceCount = counts.get(group.id) ?? 0;
    }
  }

  const order = new Map(facts.dataItems.map((item, index) => [item.id, index]));
  files.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return { facts, dataItemFiles: files, system, applied, orphans, ignored };
}
