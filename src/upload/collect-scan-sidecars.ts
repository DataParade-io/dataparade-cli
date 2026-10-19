import fs from 'fs';
import path from 'path';

/**
 * Files a scan writes beside dataflow.json. The upload sends these with the
 * diagram so the stored preview can keep the full scan.
 */
export type ScanUploadSidecars = {
  /** graphify-out/graph.json. Omitted when Graphify did not write it. */
  graphifyGraph?: unknown;
  /** dataparade-graph.json. Joins an occurrence to a Graphify node. */
  dataparadeGraph?: unknown;
  /**
   * Occurrence and data-item Facts from ocsf-discoveries/.
   * Component and flow Facts are left out.
   * Present (possibly empty) when that directory exists.
   */
  facts?: unknown[];
};

const PATH_PREFIX = 'dp:scan/path/';
const ENTITY_MARKER = '/entity/';
const LEGACY_PREFIX = 'dp:scan/entity/';

function readTextIfPresent(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function readJsonIfPresent(filePath: string): unknown | undefined {
  const text = readTextIfPresent(filePath);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): unknown | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value;
}

export function entityIdFromAsserts(asserts: string): string | null {
  if (asserts.startsWith(PATH_PREFIX)) {
    const rest = asserts.slice(PATH_PREFIX.length);
    const markerAt = rest.indexOf(ENTITY_MARKER);
    if (markerAt === -1) return null;
    const entityId = rest.slice(markerAt + ENTITY_MARKER.length);
    return entityId || null;
  }
  if (asserts.startsWith(LEGACY_PREFIX)) {
    const entityId = asserts.slice(LEGACY_PREFIX.length);
    return entityId || null;
  }
  return null;
}

/** True for an occurrence or data-item Fact, including its slot records. */
export function isOccurrenceOrDataItemFact(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  const asserts = (record as { dataparade?: { asserts?: unknown } }).dataparade
    ?.asserts;
  if (typeof asserts !== 'string') return false;
  const entityId = entityIdFromAsserts(asserts);
  if (!entityId) return false;
  return (
    entityId.startsWith('occurrence:') || entityId.startsWith('data_item:')
  );
}

function readOccurrenceAndDataItemFacts(
  discoveriesDir: string
): unknown[] | undefined {
  if (!fs.existsSync(discoveriesDir)) return undefined;
  const facts: unknown[] = [];
  const names = fs
    .readdirSync(discoveriesDir)
    .filter((name) => name.endsWith('.json'));
  names.sort((left, right) => left.localeCompare(right));
  for (const name of names) {
    const parsed = readJsonIfPresent(path.join(discoveriesDir, name));
    if (isOccurrenceOrDataItemFact(parsed)) {
      facts.push(parsed);
    }
  }
  return facts;
}

/**
 * Read the scan files that sit next to dataflow.json.
 * graphify-out/graph.json is included only when that file exists.
 */
export function collectScanSidecars(
  dataflowFilePath: string
): ScanUploadSidecars {
  const outputDir = path.dirname(path.resolve(dataflowFilePath));
  const sidecars: ScanUploadSidecars = {};

  const graphifyGraph = asObject(
    readJsonIfPresent(path.join(outputDir, 'graphify-out', 'graph.json'))
  );
  if (graphifyGraph !== undefined) {
    sidecars.graphifyGraph = graphifyGraph;
  }

  const dataparadeGraph = asObject(
    readJsonIfPresent(path.join(outputDir, 'dataparade-graph.json'))
  );
  if (dataparadeGraph !== undefined) {
    sidecars.dataparadeGraph = dataparadeGraph;
  }

  const facts = readOccurrenceAndDataItemFacts(
    path.join(outputDir, 'ocsf-discoveries')
  );
  if (facts !== undefined) {
    sidecars.facts = facts;
  }

  return sidecars;
}

/** One scan file, as it was written on disk, ready to upload on its own. */
export type ScanUploadFile = {
  relativePath: string;
  content: string;
};

/**
 * Raw scan files to upload beside dataflow.json.
 * graphify-out/graph.json is included only when that file exists.
 * Only occurrence and data-item Facts are included.
 */
export function collectScanUploadFiles(
  dataflowFilePath: string
): ScanUploadFile[] {
  const outputDir = path.dirname(path.resolve(dataflowFilePath));
  const files: ScanUploadFile[] = [];

  const graphify = readTextIfPresent(
    path.join(outputDir, 'graphify-out', 'graph.json')
  );
  if (graphify !== undefined && asObject(parseJson(graphify))) {
    files.push({ relativePath: 'graphify-out/graph.json', content: graphify });
  }

  const dataparadeGraph = readTextIfPresent(
    path.join(outputDir, 'dataparade-graph.json')
  );
  if (dataparadeGraph !== undefined && asObject(parseJson(dataparadeGraph))) {
    files.push({
      relativePath: 'dataparade-graph.json',
      content: dataparadeGraph,
    });
  }

  const discoveriesDir = path.join(outputDir, 'ocsf-discoveries');
  if (fs.existsSync(discoveriesDir)) {
    const names = fs
      .readdirSync(discoveriesDir)
      .filter((name) => name.endsWith('.json'));
    names.sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      const content = readTextIfPresent(path.join(discoveriesDir, name));
      if (content === undefined) continue;
      if (!isOccurrenceOrDataItemFact(parseJson(content))) continue;
      files.push({
        relativePath: `ocsf-discoveries/${name}`,
        content,
      });
    }
  }

  return files;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
