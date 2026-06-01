import { urlHostMatchKeys } from "../classifier/external-url-third-party";
import type { DetectedComponent } from "../core/types/component";
import type { RawFinding } from "../core/types/detection";
import {
  getSectionIdFromComponent,
  getSectionIdFromFinding,
  isConcreteServiceSectionId,
} from "./source-resolution";

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Matches a database_connection finding to an asset component by databaseType or name.
 */
export function findTargetDatabaseComponent(
  finding: RawFinding,
  components: DetectedComponent[],
): DetectedComponent | undefined {
  const dbType =
    typeof finding.properties?.databaseType === "string"
      ? normalizeKey(finding.properties.databaseType as string)
      : "";
  const findingName = normalizeKey(finding.name);
  const client =
    typeof finding.properties?.client === "string"
      ? normalizeKey(finding.properties.client as string)
      : "";
  const findingSectionId = getSectionIdFromFinding(finding);

  // Prefer same-section matches when multiple logical DB nodes exist.
  if (findingSectionId) {
    for (const c of components) {
      if (c.type !== "asset") continue;
      if (getSectionIdFromComponent(c) !== findingSectionId) continue;

      const compDbType =
        typeof c.properties?.databaseType === "string"
          ? normalizeKey(c.properties.databaseType as string)
          : "";
      const compName = normalizeKey(c.name);

      if (dbType && compDbType && dbType === compDbType) return c;
      if (
        findingName &&
        compName &&
        (findingName === compName ||
          compName.includes(findingName) ||
          findingName.includes(compName))
      ) {
        return c;
      }
      if (
        client &&
        compName &&
        (client === compName || compName.includes(client) || client.includes(compName))
      ) {
        return c;
      }
    }
  }

  // For concrete service sections, do not fall back across sections.
  if (isConcreteServiceSectionId(findingSectionId)) {
    return undefined;
  }

  for (const c of components) {
    if (c.type !== "asset") continue;
    const compDbType =
      typeof c.properties?.databaseType === "string"
        ? normalizeKey(c.properties.databaseType as string)
        : "";
    const compName = normalizeKey(c.name);
    if (dbType && compDbType && dbType === compDbType) return c;
    if (
      findingName &&
      compName &&
      (findingName === compName ||
        compName.includes(findingName) ||
        findingName.includes(compName))
    ) {
      return c;
    }
    if (
      client &&
      compName &&
      (client === compName || compName.includes(client) || client.includes(compName))
    ) {
      return c;
    }
  }
  return undefined;
}

function externalFindingUrlMatchKeys(finding: RawFinding): Set<string> {
  const keys = new Set<string>();
  const urlProp = finding.properties?.url;
  if (typeof urlProp === "string") {
    for (const k of urlHostMatchKeys(urlProp)) {
      keys.add(normalizeKey(k));
    }
  }
  if (
    typeof finding.name === "string" &&
    /^https?:\/\//i.test(finding.name.trim())
  ) {
    for (const k of urlHostMatchKeys(finding.name.trim())) {
      keys.add(normalizeKey(k));
    }
  }
  return keys;
}

function thirdPartyComponentUrlMatchKeys(c: DetectedComponent): Set<string> {
  const keys = new Set<string>();
  const p = c.properties ?? {};
  for (const field of ["url", "service_url_api_endpoint"] as const) {
    const v = p[field];
    if (typeof v !== "string") continue;
    for (const k of urlHostMatchKeys(v)) {
      keys.add(normalizeKey(k));
    }
  }
  return keys;
}

/**
 * Matches an external_api_call finding to a third_party component by serviceName,
 * URL hostname / registrable domain, client, or display name.
 */
export function findTargetThirdPartyComponent(
  finding: RawFinding,
  components: DetectedComponent[],
): DetectedComponent | undefined {
  const serviceName =
    typeof finding.properties?.serviceName === "string"
      ? normalizeKey(finding.properties.serviceName as string)
      : "";
  const client =
    typeof finding.properties?.client === "string"
      ? normalizeKey(finding.properties.client as string)
      : "";
  const findingName = normalizeKey(finding.name);
  const findingUrlKeys = externalFindingUrlMatchKeys(finding);
  const findingSectionId = getSectionIdFromFinding(finding);

  if (findingSectionId) {
    for (const c of components) {
      if (c.type !== "third_party") continue;
      if (getSectionIdFromComponent(c) !== findingSectionId) continue;

      const compServiceName =
        typeof c.properties?.serviceName === "string"
          ? normalizeKey(c.properties.serviceName as string)
          : "";
      const compName = normalizeKey(c.name);

      if (serviceName && (compServiceName === serviceName || compName === serviceName)) {
        return c;
      }
      if (client && (compServiceName === client || compName === client)) return c;
      if (findingName && (compName === findingName || compServiceName === findingName)) {
        return c;
      }

      if (findingUrlKeys.size > 0) {
        const compUrlKeys = thirdPartyComponentUrlMatchKeys(c);
        for (const fk of findingUrlKeys) {
          if (compUrlKeys.has(fk)) return c;
        }
        if (compServiceName.length >= 4) {
          for (const fk of findingUrlKeys) {
            if (fk.includes(compServiceName) || compServiceName.includes(fk)) {
              return c;
            }
          }
        }
      }
    }
  }

  if (isConcreteServiceSectionId(findingSectionId)) {
    return undefined;
  }

  for (const c of components) {
    if (c.type !== "third_party") continue;
    const compServiceName =
      typeof c.properties?.serviceName === "string"
        ? normalizeKey(c.properties.serviceName as string)
        : "";
    const compName = normalizeKey(c.name);
    if (serviceName && (compServiceName === serviceName || compName === serviceName)) {
      return c;
    }
    if (client && (compServiceName === client || compName === client)) return c;
    if (findingName && (compName === findingName || compServiceName === findingName)) {
      return c;
    }

    if (findingUrlKeys.size > 0) {
      const compUrlKeys = thirdPartyComponentUrlMatchKeys(c);
      for (const fk of findingUrlKeys) {
        if (compUrlKeys.has(fk)) return c;
      }
      if (compServiceName.length >= 4) {
        for (const fk of findingUrlKeys) {
          if (fk.includes(compServiceName) || compServiceName.includes(fk)) {
            return c;
          }
        }
      }
    }
  }
  return undefined;
}

/**
 * Matches an express_route finding to an asset component by route name (service-to-service).
 * Excludes the main application so we don't create app→app flows.
 */
export function findTargetAssetForRoute(
  finding: RawFinding,
  components: DetectedComponent[],
  sourceComponent: DetectedComponent,
): DetectedComponent | undefined {
  const routeName = normalizeKey(finding.name);
  if (!routeName || routeName === "route" || routeName === "api") return undefined;
  const findingSectionId = getSectionIdFromFinding(finding);

  for (const c of components) {
    if (c.type !== "asset" || c.id === sourceComponent.id) continue;
    if (
      c.properties?.isMainApplication === true ||
      c.properties?.isMainApplication === "true"
    ) {
      continue;
    }
    if (findingSectionId && getSectionIdFromComponent(c) !== findingSectionId) continue;
    const compName = normalizeKey(c.name);
    if (
      compName &&
      (compName === routeName ||
        compName.includes(routeName) ||
        routeName.includes(compName))
    ) {
      return c;
    }
  }
  return undefined;
}

/** Classifier merges express_route findings into one asset named "HTTP API". */
const MERGED_HTTP_API_SURFACE_NAME = "http api";

export function findMergedHttpApiSurfaceComponent(
  components: DetectedComponent[],
  sourceComponent: DetectedComponent,
): DetectedComponent | undefined {
  for (const c of components) {
    if (c.type !== "asset" || c.id === sourceComponent.id) continue;
    if (c.subType !== "api") continue;
    if (normalizeKey(c.name) === MERGED_HTTP_API_SURFACE_NAME) return c;
  }
  return undefined;
}

/**
 * Matches web_actor / service_actor finding to an actor component by name.
 */
export function findTargetActorComponent(
  finding: RawFinding,
  components: DetectedComponent[],
): DetectedComponent | undefined {
  const findingName = normalizeKey(finding.name);
  const findingSectionId = getSectionIdFromFinding(finding);

  for (const c of components) {
    if (c.type !== "actor") continue;
    if (findingSectionId && getSectionIdFromComponent(c) !== findingSectionId) continue;
    const compName = normalizeKey(c.name);
    if (
      compName &&
      (compName === findingName ||
        compName.includes(findingName) ||
        findingName.includes(compName))
    ) {
      return c;
    }
  }
  return undefined;
}

