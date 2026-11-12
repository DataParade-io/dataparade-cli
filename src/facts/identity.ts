import {
  NAME_FROM_PROJECT_PROPERTY,
  PROJECT_NAME_KEY_TOKEN,
  buildComponentKeyById,
  normalizeFlowEndpoint,
  stableFlowKey,
  type DetectedComponent,
  type DetectedDataFlow,
} from "@dataparade/scanner";

import type { Identity } from "./schema";

/**
 * Identity of every Fact (DATAP-843, DATAP-844): the canonical key the scanner hashes
 * into a component or flow id, or the name-based key of a data item or group, plus the
 * parts the key is made of.
 *
 * Keys never contain the scan root or a line number, so two scans of the same commit in
 * two folders give the same keys. Duplicate keys get `#2`, `#3`, … and `duplicateIndex`, in
 * the order the scanner suffixes ids (`_2`, `_3`, …); see `identitySchema` for the rule.
 * The number comes from the id suffix, never from the key text, because a name can itself
 * end in `#<digits>`.
 */

const SECTION_FALLBACK = "<unsectioned>";

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function sectionOf(properties: Record<string, unknown> | undefined): string {
  const raw = properties?.section_id;
  return typeof raw === "string" && raw.trim() ? raw.trim() : SECTION_FALLBACK;
}

function firstPath(paths: string[]): string {
  return [...paths].sort(compareStrings)[0] ?? "";
}

const STABLE_ID = /^(?:cmp|flow)_[0-9a-f]{12}(?:_(\d+))?$/;

/**
 * The scanner's duplicate number for a stable id: `n` for `<prefix>_<hash>_n`, `undefined`
 * for a plain stable id, and `null` for an id that is not a stable hash (older or test data).
 */
function idSuffix(id: string): number | undefined | null {
  const match = STABLE_ID.exec(id);
  if (!match) return null;
  const n = match[1] === undefined ? undefined : Number(match[1]);
  return n !== undefined && n >= 2 ? n : undefined;
}

function withDuplicate(identity: Identity, duplicateIndex: number | undefined): Identity {
  return duplicateIndex ? { ...identity, key: `${identity.key}#${duplicateIndex}`, duplicateIndex } : identity;
}

/** Copies of the scan's components and flows with file paths relative to the scan root. */
function scrubLocations<T extends DetectedComponent | DetectedDataFlow>(item: T, scrub: (value: string) => string): T {
  const next = { ...item } as T & { sourceLocation?: { filePath: string } };
  if (item.sourceLocations) {
    next.sourceLocations = item.sourceLocations.map((loc) => ({ ...loc, filePath: scrub(loc.filePath) }));
  }
  const single = (item as { sourceLocation?: { filePath: string } }).sourceLocation;
  if (single) next.sourceLocation = { ...single, filePath: scrub(single.filePath) };
  return next;
}

function componentParts(
  component: DetectedComponent,
  baseKey: string,
  /** Base keys (without `#n`), as the scanner embeds a provider's key in a managed key. */
  baseKeyById: ReadonlyMap<string, string>,
): Record<string, string> {
  const props = component.properties ?? {};
  if (baseKey.startsWith("tf:")) {
    return { scheme: "tf", terraformAddress: String(props.terraform_address ?? "").trim() };
  }
  if (baseKey.startsWith("managed:")) {
    const providerId = String(props.managed_by_provider ?? "").trim();
    const providerKey = baseKeyById.get(providerId);
    return {
      scheme: "managed",
      provider: providerKey ?? providerId,
      serviceKey: String(props.managed_service_key ?? "").trim(),
      section: sectionOf(props),
    };
  }
  return {
    scheme: "app",
    section: sectionOf(props),
    type: component.type,
    subType: component.subType ?? "",
    file: firstPath((component.sourceLocations ?? []).map((loc) => loc.filePath.replace(/\\/g, "/"))),
    // The root Application named after the project or scan folder: the scanner keys it by a fixed token (DATAP-858).
    name: props[NAME_FROM_PROJECT_PROPERTY] === true ? PROJECT_NAME_KEY_TOKEN : normalizeName(component.name),
  };
}

export interface ScanIdentities {
  /** By the component's id in facts.json. */
  components: Map<string, Identity>;
  /** By the flow's id in facts.json. */
  dataFlows: Map<string, Identity>;
}

export function buildScanIdentities(
  components: DetectedComponent[],
  dataFlows: DetectedDataFlow[],
  scrub: (value: string) => string,
): ScanIdentities {
  const scrubbedComponents = components.map((c) => scrubLocations(c, scrub));
  // Unique keys (with `#n`), in the order the scanner suffixes ids.
  const uniqueKeyById = buildComponentKeyById(scrubbedComponents);
  // Base key and duplicate number by id. The scanner gives the n-th duplicate `_n` on the id
  // and `#n` on the unique key; read n from the id so a name ending in `#2` is not a duplicate.
  const baseKeyById = new Map<string, string>();
  const duplicateById = new Map<string, number | undefined>();
  for (const component of scrubbedComponents) {
    const uniqueKey = uniqueKeyById.get(component.id);
    if (uniqueKey === undefined) continue;
    const n = idSuffix(component.id);
    const duplicate = n && uniqueKey.endsWith(`#${n}`) ? n : undefined;
    baseKeyById.set(component.id, duplicate ? uniqueKey.slice(0, -`#${duplicate}`.length) : uniqueKey);
    duplicateById.set(component.id, duplicate);
  }

  const componentIdentities = new Map<string, Identity>();
  for (const component of scrubbedComponents) {
    const key = baseKeyById.get(component.id);
    if (key === undefined || componentIdentities.has(scrub(component.id))) continue;
    componentIdentities.set(
      scrub(component.id),
      withDuplicate({ kind: "component", key, parts: componentParts(component, key, baseKeyById) }, duplicateById.get(component.id)),
    );
  }

  const flowEntries = dataFlows.map((flow) => {
    const scrubbed = scrubLocations(flow, scrub);
    const paths = [
      ...(scrubbed.sourceLocation ? [scrubbed.sourceLocation.filePath] : []),
      ...(scrubbed.sourceLocations ?? []).map((loc) => loc.filePath),
    ].map((p) => p.replace(/\\/g, "/"));
    const identity: Identity = {
      kind: "dataFlow",
      key: stableFlowKey(scrubbed, uniqueKeyById),
      parts: {
        source: uniqueKeyById.get(flow.sourceComponentId) ?? `id:${flow.sourceComponentId}`,
        target: uniqueKeyById.get(flow.targetComponentId) ?? `id:${flow.targetComponentId}`,
        type: flow.type,
        method: (flow.method ?? "").trim().toUpperCase(),
        endpoint: normalizeFlowEndpoint(flow.endpoint),
        file: firstPath(paths),
      },
    };
    return { id: scrub(flow.id), identity };
  });

  // Flows that share a key: number them in id order, which is the scanner's suffix order.
  const suffix = (id: string) => idSuffix(id) ?? 1;
  const byKey = new Map<string, typeof flowEntries>();
  for (const entry of flowEntries) {
    const list = byKey.get(entry.identity.key) ?? [];
    list.push(entry);
    byKey.set(entry.identity.key, list);
  }
  const flowIdentities = new Map<string, Identity>();
  for (const list of byKey.values()) {
    list.sort((a, b) => suffix(a.id) - suffix(b.id) || compareStrings(a.id, b.id));
    list.forEach((entry, index) => {
      if (!flowIdentities.has(entry.id)) {
        flowIdentities.set(entry.id, withDuplicate(entry.identity, index === 0 ? undefined : index + 1));
      }
    });
  }

  return { components: componentIdentities, dataFlows: flowIdentities };
}

/** `data_item:<name>` → key `<name>`. Data item names carry no path or line. */
export function dataItemIdentity(name: string): Identity {
  return { kind: "dataItem", key: name, parts: { name } };
}

/** `<file>:<line>` or `<file>:<line>#<name>` after the `@` of a declaration-named group. */
const DECLARATION = /^(.+):(\d+)(?:#(.*))?$/;

/**
 * Group ids (relative to the scan root) are `<data item>:<qualifier>`, `<data item>@<column>`,
 * or, for a group named after the declaration its occurrences share,
 * `<data item>@<file>:<line>` or `<data item>@<file>:<line>#<name>` (scanner
 * `declarationNodeId`). The key drops the declaration's line, so it does not change when code
 * above it moves: `email@src/a.js#email`. Location-named groups (`<item>~file:line`) are never
 * listed as groups. Two unnamed declarations in one file share a key; `numberGroupDuplicates`
 * numbers them.
 */
export function groupIdentity(dataItemName: string, groupId: string): Identity {
  const rest = groupId.startsWith(dataItemName) ? groupId.slice(dataItemName.length) : "";
  if (rest.startsWith("@")) {
    const declaration = DECLARATION.exec(rest.slice(1));
    if (declaration) {
      const [, file, , name] = declaration;
      return {
        kind: "group",
        key: `${dataItemName}@${file}${name !== undefined ? `#${name}` : ""}`,
        parts: { dataItem: dataItemName, declarationFile: file, ...(name !== undefined ? { declarationName: name } : {}) },
      };
    }
    return { kind: "group", key: groupId, parts: { dataItem: dataItemName, column: rest.slice(1) } };
  }
  const parts: Record<string, string> = rest.startsWith(":")
    ? { dataItem: dataItemName, qualifier: rest.slice(1) }
    : { dataItem: dataItemName, group: groupId };
  return { kind: "group", key: groupId, parts };
}

/**
 * Numbers groups of one data item that share a key (`#2`, `#3`, …, with `duplicateIndex`), by
 * the declaration line in their ids, then by id. Takes `[groupId, identity]` pairs and returns
 * the identities in the same order.
 */
export function numberGroupDuplicates(groups: Array<[string, Identity]>): Identity[] {
  const line = (id: string) => Number(/:(\d+)(?:#.*)?$/.exec(id)?.[1] ?? 0);
  const byKey = new Map<string, number[]>();
  groups.forEach(([, identity], index) => byKey.set(identity.key, [...(byKey.get(identity.key) ?? []), index]));
  const result = groups.map(([, identity]) => identity);
  for (const indexes of byKey.values()) {
    if (indexes.length < 2) continue;
    indexes.sort((a, b) => line(groups[a][0]) - line(groups[b][0]) || compareStrings(groups[a][0], groups[b][0]));
    indexes.forEach((index, n) => {
      if (n > 0) result[index] = withDuplicate(result[index], n + 1);
    });
  }
  return result;
}
