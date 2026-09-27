const PATH_PREFIX = "dp:scan/path/";
const ENTITY_MARKER = "/entity/";
const LEGACY_PREFIX = "dp:scan/entity/";

export interface ParsedScanEntityAsserts {
  scanPath: string;
  entityId: string;
}

export function scanEntityAsserts(scanPath: string | undefined, entityId: string): string {
  if (!scanPath) {
    return `${LEGACY_PREFIX}${entityId}`;
  }
  return `${PATH_PREFIX}${encodeURIComponent(scanPath)}${ENTITY_MARKER}${entityId}`;
}

export function parseScanEntityAsserts(asserts: string): ParsedScanEntityAsserts | null {
  if (asserts.startsWith(PATH_PREFIX)) {
    const rest = asserts.slice(PATH_PREFIX.length);
    const markerAt = rest.indexOf(ENTITY_MARKER);
    if (markerAt === -1) {
      return null;
    }
    const encodedPath = rest.slice(0, markerAt);
    const entityId = rest.slice(markerAt + ENTITY_MARKER.length);
    if (!encodedPath || !entityId) {
      return null;
    }
    return { scanPath: decodeURIComponent(encodedPath), entityId };
  }
  if (asserts.startsWith(LEGACY_PREFIX)) {
    const entityId = asserts.slice(LEGACY_PREFIX.length);
    if (!entityId) {
      return null;
    }
    return { scanPath: "", entityId };
  }
  return null;
}

export function projectedEntityId(scanPath: string, entityId: string): string {
  if (!scanPath) {
    return entityId;
  }
  return `${scanPath}::${entityId}`;
}
