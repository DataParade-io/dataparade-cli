import crypto from "crypto";
import fs from "fs";
import path from "path";

import { parseScanEntityAsserts } from "../../../src/discoveries/scan-entity-uri";
import { indexDiscoverySlots, discoveryValue } from "../../../src/discoveries/load-ocsf-discoveries";
import type { OcsfDiscoveryRecord } from "./ocsf-discovery-types";
import { DOGFOOD_BRIEF_GATE } from "./dogfood-brief-gate";
import type { BriefSnapshot, InterviewSlot } from "./types";

const SYSTEM_ASSERTS_URI = "dp:a0/system";

export interface GapEntry {
  asserts: string;
  entityId: string;
  scanPath: string;
  slot: InterviewSlot;
}

export interface GapReport {
  snapshot: BriefSnapshot;
  gaps: GapEntry[];
}

interface LooseOcsfRecord {
  metadata: { uid: string };
  dataparade: {
    asserts: string;
    asserted_slot?: string;
    asserted_value?: string;
    source: string;
  };
}

function loadJsonRecords(dir: string): OcsfDiscoveryRecord[] {
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`OCSF directory not found: ${resolved}`);
  }

  const files = fs
    .readdirSync(resolved)
    .filter((name) => name.endsWith(".json"))
    .sort();

  const records: OcsfDiscoveryRecord[] = [];
  for (const file of files) {
    const parsed = JSON.parse(fs.readFileSync(path.join(resolved, file), "utf8")) as LooseOcsfRecord;
    if (!parsed.metadata?.uid || !parsed.dataparade?.asserts || !parsed.dataparade?.source) {
      throw new Error(`${file}: missing required OCSF discovery fields`);
    }
    records.push(parsed as OcsfDiscoveryRecord);
  }
  return records;
}

function parseJsonArray(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter((value) => value.length > 0);
    }
  } catch {
    return [];
  }
  return [];
}

function slotIsKnown(
  slotIndex: ReturnType<typeof indexDiscoverySlots>,
  asserts: string,
  slot: string,
): boolean {
  const raw = discoveryValue(slotIndex, asserts, slot);
  if (raw === undefined) {
    return false;
  }
  if (slot === "data_categories") {
    return parseJsonArray(raw).length > 0;
  }
  return raw.trim().length > 0;
}

function scanEntityUrisFromRecords(records: OcsfDiscoveryRecord[]): Set<string> {
  const uris = new Set<string>();
  for (const record of records) {
    if (record.dataparade.source !== "scan") {
      continue;
    }
    if (parseScanEntityAsserts(record.dataparade.asserts)) {
      uris.add(record.dataparade.asserts);
    }
  }
  return uris;
}

function entityKind(entityId: string): "component" | "flow" | null {
  if (entityId.startsWith("cmp_")) {
    return "component";
  }
  if (entityId.startsWith("flow_")) {
    return "flow";
  }
  return null;
}

function indicatesActor(typeValue: string | undefined, subTypeValue: string | undefined): boolean {
  const type = (typeValue ?? "").toLowerCase();
  const subType = (subTypeValue ?? "").toLowerCase();
  return type === "actor" || subType.includes("actor");
}

function componentScanPath(
  slotIndex: ReturnType<typeof indexDiscoverySlots>,
  asserts: string,
  fallbackScanPath: string,
): string {
  const fromSlot = discoveryValue(slotIndex, asserts, "scan_path");
  if (fromSlot && fromSlot.trim().length > 0) {
    return fromSlot;
  }
  return fallbackScanPath;
}

function resolveComponentPath(
  slotIndex: ReturnType<typeof indexDiscoverySlots>,
  bareComponentId: string,
  flowScanPath: string,
  scanUris: Set<string>,
): string {
  for (const uri of scanUris) {
    const parsed = parseScanEntityAsserts(uri);
    if (!parsed || parsed.entityId !== bareComponentId) {
      continue;
    }
    return componentScanPath(slotIndex, uri, parsed.scanPath);
  }
  return flowScanPath;
}

function hasScanCrossPathFlow(
  records: OcsfDiscoveryRecord[],
  slotIndex: ReturnType<typeof indexDiscoverySlots>,
  scanUris: Set<string>,
): boolean {
  for (const uri of scanUris) {
    const parsed = parseScanEntityAsserts(uri);
    if (!parsed || !parsed.entityId.startsWith("flow_")) {
      continue;
    }
    if (!slotIsKnown(slotIndex, uri, "source_component")) {
      continue;
    }
    if (!slotIsKnown(slotIndex, uri, "target_component")) {
      continue;
    }
    const sourceId = discoveryValue(slotIndex, uri, "source_component");
    const targetId = discoveryValue(slotIndex, uri, "target_component");
    if (!sourceId || !targetId) {
      continue;
    }
    const sourcePath = resolveComponentPath(slotIndex, sourceId, parsed.scanPath, scanUris);
    const targetPath = resolveComponentPath(slotIndex, targetId, parsed.scanPath, scanUris);
    if (sourcePath && targetPath && sourcePath !== targetPath) {
      return true;
    }
  }
  return false;
}

function parseBoundaryLinkPaths(
  raw: string | undefined,
  slotIndex: ReturnType<typeof indexDiscoverySlots>,
): Set<string> | null {
  if (!raw?.trim()) {
    return null;
  }
  let tokens: string[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      tokens = parsed.map(String);
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      tokens = ["from", "to", "source", "target", "source_asserts", "target_asserts"]
        .map((key) => obj[key])
        .filter((value): value is string => typeof value === "string");
    }
  } catch {
    tokens = raw.split(/[\s,]+/).filter(Boolean);
  }

  const paths = new Set<string>();
  for (const token of tokens) {
    if (token === SYSTEM_ASSERTS_URI) {
      continue;
    }
    const parsed = parseScanEntityAsserts(token);
    if (parsed) {
      paths.add(componentScanPath(slotIndex, token, parsed.scanPath));
      continue;
    }
    if (token.startsWith("cmp_")) {
      for (const uri of scanUrisFromSlotIndex(slotIndex, token)) {
        const pathValue = componentScanPath(slotIndex, uri, parseScanEntityAsserts(uri)?.scanPath ?? "");
        if (pathValue) {
          paths.add(pathValue);
        }
      }
    }
  }
  return paths.size >= 2 ? paths : null;
}

function scanUrisFromSlotIndex(
  slotIndex: ReturnType<typeof indexDiscoverySlots>,
  bareEntityId: string,
): string[] {
  const uris: string[] = [];
  for (const asserts of slotIndex.keys()) {
    const parsed = parseScanEntityAsserts(asserts);
    if (parsed?.entityId === bareEntityId) {
      uris.push(asserts);
    }
  }
  return uris;
}

function hasInterviewCrossPathLink(
  records: OcsfDiscoveryRecord[],
  slotIndex: ReturnType<typeof indexDiscoverySlots>,
): boolean {
  for (const record of records) {
    if (record.dataparade.source !== "interview") {
      continue;
    }
    if (record.dataparade.asserted_slot !== "boundary_link") {
      continue;
    }
    const paths = parseBoundaryLinkPaths(record.dataparade.asserted_value, slotIndex);
    if (paths) {
      return true;
    }
  }
  return false;
}

function distinctNonEmptyScanPaths(
  slotIndex: ReturnType<typeof indexDiscoverySlots>,
  scanUris: Set<string>,
): Set<string> {
  const paths = new Set<string>();
  for (const uri of scanUris) {
    const parsed = parseScanEntityAsserts(uri);
    if (!parsed) {
      continue;
    }
    const pathValue = componentScanPath(slotIndex, uri, parsed.scanPath);
    if (pathValue) {
      paths.add(pathValue);
    }
  }
  return paths;
}

function buildMushMergeGroups(
  slotIndex: ReturnType<typeof indexDiscoverySlots>,
  scanUris: Set<string>,
): Record<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const uri of scanUris) {
    const parsed = parseScanEntityAsserts(uri);
    if (!parsed || !parsed.entityId.startsWith("cmp_")) {
      continue;
    }
    const name = discoveryValue(slotIndex, uri, "name");
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    const ids = byName.get(key) ?? [];
    if (!ids.includes(parsed.entityId)) {
      ids.push(parsed.entityId);
    }
    byName.set(key, ids);
  }

  const mushOnly: Record<string, string[]> = {};
  for (const [name, ids] of byName.entries()) {
    if (ids.length > 1) {
      mushOnly[name] = ids.sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true }),
      );
    }
  }
  return mushOnly;
}

function directorySha(records: OcsfDiscoveryRecord[]): string {
  const uids = records.map((record) => record.metadata.uid).sort();
  return crypto.createHash("sha256").update(uids.join("\n")).digest("hex");
}

export function gapsFromOcsfDir(dir: string): GapReport {
  const records = loadJsonRecords(dir);
  const slotIndex = indexDiscoverySlots(records);
  const scanUris = scanEntityUrisFromRecords(records);

  const scanKnownComponents: string[] = [];
  const scanKnownFlows: string[] = [];
  const actorComponentIds = new Set<string>();
  const gaps: GapEntry[] = [];

  for (const uri of scanUris) {
    const parsed = parseScanEntityAsserts(uri);
    if (!parsed) {
      continue;
    }
    const kind = entityKind(parsed.entityId);
    if (kind === "component") {
      scanKnownComponents.push(parsed.entityId);
      const typeValue = discoveryValue(slotIndex, uri, "type");
      const subTypeValue = discoveryValue(slotIndex, uri, "sub_type");
      if (indicatesActor(typeValue, subTypeValue)) {
        actorComponentIds.add(parsed.entityId);
      }
    }
    if (
      kind === "flow" &&
      slotIsKnown(slotIndex, uri, "source_component") &&
      slotIsKnown(slotIndex, uri, "target_component")
    ) {
      scanKnownFlows.push(parsed.entityId);
    }
  }

  const uniqueComponents = [...new Set(scanKnownComponents)].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
  const uniqueFlows = [...new Set(scanKnownFlows)].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );

  for (const uri of scanUris) {
    const parsed = parseScanEntityAsserts(uri);
    if (!parsed || !parsed.entityId.startsWith("flow_")) {
      continue;
    }
    if (!uniqueFlows.includes(parsed.entityId)) {
      continue;
    }
    if (!slotIsKnown(slotIndex, uri, "data_categories")) {
      gaps.push({
        asserts: uri,
        entityId: parsed.entityId,
        scanPath: parsed.scanPath,
        slot: "sends_data_to.data_categories",
      });
    }
    if (!slotIsKnown(slotIndex, uri, "purpose")) {
      gaps.push({
        asserts: uri,
        entityId: parsed.entityId,
        scanPath: parsed.scanPath,
        slot: "sends_data_to.purpose",
      });
    }
  }

  const partialKnownActors: string[] = [];
  for (const componentId of [...actorComponentIds].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  )) {
    const asserts = scanUrisFromSlotIndex(slotIndex, componentId)[0];
    if (!asserts) {
      continue;
    }
    const parsed = parseScanEntityAsserts(asserts);
    if (!slotIsKnown(slotIndex, asserts, "actor_kind")) {
      partialKnownActors.push(componentId);
      gaps.push({
        asserts,
        entityId: componentId,
        scanPath: parsed?.scanPath ?? "",
        slot: "actors",
      });
    }
  }

  if (!slotIsKnown(slotIndex, SYSTEM_ASSERTS_URI, "in_scope")) {
    gaps.push({
      asserts: SYSTEM_ASSERTS_URI,
      entityId: "system",
      scanPath: "",
      slot: "system_identity",
    });
  }

  const nonEmptyScanPaths = distinctNonEmptyScanPaths(slotIndex, scanUris);
  if (
    nonEmptyScanPaths.size >= 2 &&
    !hasScanCrossPathFlow(records, slotIndex, scanUris) &&
    !hasInterviewCrossPathLink(records, slotIndex)
  ) {
    gaps.push({
      asserts: SYSTEM_ASSERTS_URI,
      entityId: "system",
      scanPath: "",
      slot: "system_boundary",
    });
  }

  gaps.sort((left, right) => {
    const slotCompare = left.slot.localeCompare(right.slot);
    if (slotCompare !== 0) {
      return slotCompare;
    }
    const entityCompare = left.entityId.localeCompare(right.entityId, undefined, { numeric: true });
    if (entityCompare !== 0) {
      return entityCompare;
    }
    return left.asserts.localeCompare(right.asserts);
  });

  const unknownSlots = [...new Set(gaps.map((gap) => gap.slot))].sort();

  const snapshot: BriefSnapshot = {
    sha: directorySha(records),
    scanKnownComponents: uniqueComponents,
    scanKnownFlows: uniqueFlows,
    partialKnownActors,
    unknownSlots,
    siblingRepoCandidates: [],
    taxonomy: { ...DOGFOOD_BRIEF_GATE.taxonomy },
    mushMergeGroups: buildMushMergeGroups(slotIndex, scanUris),
  };

  return { snapshot, gaps };
}
