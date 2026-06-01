import type { DetectedComponent, DetectedFromRef } from "../core/types/component";
import type { SourceLocation } from "../core/types/file";
import { loadClassifierConfig, type NameNormalizationConfig } from "./config";
import {
  normalizeComponentName,
  toDisplayName,
} from "./naming";
import {
  getSectionIdFromProperties,
} from "./sectioning";

function aggregateComponentConfidence(
  components: DetectedComponent[],
  strategy: "max" | "average",
): number {
  if (components.length === 0) return 0;

  if (strategy === "average") {
    const sum = components.reduce((acc, c) => acc + c.confidence, 0);
    return Math.min(1, Math.max(0, sum / components.length));
  }

  const max = components.reduce(
    (acc, c) => (c.confidence > acc ? c.confidence : acc),
    0,
  );
  return Math.min(1, Math.max(0, max));
}

export function mergeProperties(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) {
      target[key] = value;
      continue;
    }

    const existing = target[key];
    if (existing === value) {
      continue;
    }

    const existingArray = Array.isArray(existing) ? existing : [existing];
    const incomingArray = Array.isArray(value) ? value : [value];

    const merged: unknown[] = [...existingArray];
    for (const v of incomingArray) {
      if (!merged.includes(v)) {
        merged.push(v);
      }
    }

    target[key] = merged;
  }
}

export function dedupeSourceLocations(
  locations: SourceLocation[],
): SourceLocation[] {
  const seen = new Set<string>();
  const result: SourceLocation[] = [];

  for (const loc of locations) {
    const key = `${loc.filePath}:${loc.startLine}:${loc.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(loc);
  }

  return result;
}

export function compareSourceLocations(a: SourceLocation, b: SourceLocation): number {
  const fileCmp = a.filePath.localeCompare(b.filePath);
  if (fileCmp !== 0) return fileCmp;
  if (a.startLine !== b.startLine) return a.startLine - b.startLine;
  if (a.endLine !== b.endLine) return a.endLine - b.endLine;
  return 0;
}

export function compareDetectedFromRefs(a: DetectedFromRef, b: DetectedFromRef): number {
  const patternCmp = String(a.pattern).localeCompare(String(b.pattern));
  if (patternCmp !== 0) return patternCmp;

  const al = a.sourceLocation;
  const bl = b.sourceLocation;
  if (!al && !bl) return 0;
  if (!al) return 1;
  if (!bl) return -1;
  return compareSourceLocations(al, bl);
}

function compareComponentsForDeterministicBase(
  a: DetectedComponent,
  b: DetectedComponent,
): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  const nameCmp = a.name.localeCompare(b.name);
  if (nameCmp !== 0) return nameCmp;
  const typeCmp = a.type.localeCompare(b.type);
  if (typeCmp !== 0) return typeCmp;
  return a.id.localeCompare(b.id);
}

function buildComponentDedupeKey(
  component: DetectedComponent,
  nameNormalization: NameNormalizationConfig,
): string {
  const sectionId = getSectionIdFromProperties(component.properties);

  if (component.type === "asset") {
    const tfAddr = component.properties?.terraform_address;
    if (
      typeof tfAddr === "string" &&
      tfAddr.trim() &&
      !tfAddr.trim().startsWith("provider.")
    ) {
      return `asset:tf:${sectionId}:${tfAddr.trim().toLowerCase()}`;
    }
  }

  if (component.type === "asset" && component.subType === "auth_service") {
    return `asset:auth_service:${sectionId}`;
  }

  if (component.type === "asset" && component.subType === "database") {
    return `asset:database:${sectionId}:${getDatabaseCanonicalKey(component)}`;
  }

  if (component.type === "third_party") {
    const serviceName = component.properties.serviceName;
    if (typeof serviceName === "string" && serviceName.trim()) {
      const key = serviceName.trim().toLowerCase();
      return `third_party:${sectionId}:${key}`;
    }

    const normalized = normalizeComponentName(component.name, nameNormalization);
    const keyName =
      normalized || component.name.trim().toLowerCase() || "<unknown>";
    return `third_party:${sectionId}:${keyName}`;
  }

  const normalized = normalizeComponentName(component.name, nameNormalization);
  const keyName =
    normalized || component.name.trim().toLowerCase() || "<unknown>";
  return `${component.type}:${sectionId}:${keyName}`;
}

/** Map client/database identifiers to a canonical key for merging same logical DB per project. */
export function getDatabaseCanonicalKey(component: DetectedComponent): string {
  const dbType = component.properties.databaseType;
  if (typeof dbType === "string" && dbType.trim()) {
    return dbType.trim().toLowerCase();
  }
  const client = component.properties.client;
  if (typeof client === "string" && client.trim()) {
    const c = client.trim().toLowerCase();
    if (c === "supabase" || c === "pg" || c === "postgres") return "postgres";
    if (c === "redis") return "redis";
    if (c === "mongo" || c === "mongoose") return "mongo";
    if (c === "mysql" || c === "mysql2") return "mysql";
    return c;
  }
  const fallbackName = (component.name || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
  return fallbackName || component.id;
}

export function dedupeComponents(
  components: DetectedComponent[],
): DetectedComponent[] {
  if (!components || components.length === 0) {
    return [];
  }

  const config = loadClassifierConfig();
  const groups = new Map<string, DetectedComponent[]>();

  for (const component of components) {
    const key = buildComponentDedupeKey(
      component,
      config.nameNormalization,
    );
    const list = groups.get(key);
    if (list) {
      list.push(component);
    } else {
      groups.set(key, [component]);
    }
  }

  const deduped: DetectedComponent[] = [];

  for (const [, group] of groups) {
    const groupSorted = [...group].sort(compareComponentsForDeterministicBase);
    const base = groupSorted[0];

    let subType = base.subType;
    if (!subType) {
      subType = groupSorted.find((c) => c.subType)?.subType;
    }

    const confidence = aggregateComponentConfidence(
      groupSorted,
      config.resolution.confidenceAggregation,
    );

    const allLocations: SourceLocation[] = [];
    for (const c of groupSorted) {
      allLocations.push(...c.sourceLocations);
    }
    const sourceLocations = dedupeSourceLocations(allLocations).sort(
      compareSourceLocations,
    );

    const detectedFromMap = new Map<string, DetectedFromRef>();
    for (const c of groupSorted) {
      for (const ref of c.detectedFrom) {
        const loc = ref.sourceLocation;
        const locKey =
          loc != null
            ? `${ref.pattern}:${loc.filePath}:${loc.startLine}:${loc.endLine}`
            : `${ref.pattern}:<no-location>`;
        if (!detectedFromMap.has(locKey)) {
          detectedFromMap.set(locKey, ref);
        }
      }
    }
    const detectedFrom = Array.from(detectedFromMap.values()).sort(
      compareDetectedFromRefs,
    );

    const mergedProperties: Record<string, unknown> = {};
    for (const c of groupSorted) {
      mergeProperties(mergedProperties, c.properties);
    }

    deduped.push({
      ...base,
      subType,
      confidence,
      detectedFrom,
      sourceLocations,
      properties: mergedProperties,
    });
  }

  deduped.sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;
    return a.type.localeCompare(b.type);
  });

  return deduped;
}

/**
 * Identity providers are external SaaS: the same vendor (e.g. Auth0) detected from
 * backend guards and frontend routes should be one third_party node so data-flow
 * detection targets a single id. Per-section dedupe keys intentionally keep other
 * third_party vendors separate.
 */
function getGlobalIdentityProviderMergeKey(
  component: DetectedComponent,
): string | undefined {
  if (component.type !== "third_party") return undefined;
  const svcRaw = component.properties?.serviceName;
  const svc = typeof svcRaw === "string" ? svcRaw.trim().toLowerCase() : "";
  const nm = (component.name || "").trim().toLowerCase();
  const hay = `${svc} ${nm}`;

  if (hay.includes("auth0")) return "idp:auth0";
  if (hay.includes("okta")) return "idp:okta";
  if (hay.includes("clerk")) return "idp:clerk";
  if (hay.includes("keycloak")) return "idp:keycloak";
  if (hay.includes("cognito")) return "idp:cognito";
  if (hay.includes("stytch")) return "idp:stytch";
  if (hay.includes("azure") && (hay.includes("ad") || hay.includes("b2c"))) {
    return "idp:azure_ad";
  }

  return undefined;
}

/** Prefer merge base with repo paths under `backend/` so one IdP node stays section-scoped to API/auth code, not only the SPA. */
function backendEvidencePathScore(component: DetectedComponent): number {
  const pathMatchesBackend = (filePath: string): boolean =>
    /(^|[\\/])backend([\\/]|$)/.test(filePath);

  let n = 0;
  for (const loc of component.sourceLocations) {
    if (pathMatchesBackend(loc.filePath)) n += 1;
  }
  for (const ref of component.detectedFrom) {
    const fp = ref.sourceLocation?.filePath;
    if (typeof fp === "string" && pathMatchesBackend(fp)) n += 1;
  }
  return n;
}

function compareIdentityProviderMergeBase(
  a: DetectedComponent,
  b: DetectedComponent,
): number {
  const scoreDelta = backendEvidencePathScore(b) - backendEvidencePathScore(a);
  if (scoreDelta !== 0) return scoreDelta;
  return compareComponentsForDeterministicBase(a, b);
}

export function mergeGlobalIdentityProviderThirdParties(
  components: DetectedComponent[],
): DetectedComponent[] {
  if (!components?.length) return [];

  const config = loadClassifierConfig();
  const groups = new Map<string, DetectedComponent[]>();

  for (const c of components) {
    const key = getGlobalIdentityProviderMergeKey(c);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  const removeIds = new Set<string>();
  const mergedByCanonicalId = new Map<string, DetectedComponent>();

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    const groupSorted = [...group].sort(compareIdentityProviderMergeBase);
    const base = groupSorted[0]!;

    let subType = base.subType;
    if (!subType) {
      subType = groupSorted.find((c) => c.subType)?.subType;
    }

    const confidence = aggregateComponentConfidence(
      groupSorted,
      config.resolution.confidenceAggregation,
    );

    const allLocations: SourceLocation[] = [];
    for (const c of groupSorted) {
      allLocations.push(...c.sourceLocations);
    }
    const sourceLocations = dedupeSourceLocations(allLocations).sort(
      compareSourceLocations,
    );

    const detectedFromMap = new Map<string, DetectedFromRef>();
    for (const c of groupSorted) {
      for (const ref of c.detectedFrom) {
        const loc = ref.sourceLocation;
        const locKey =
          loc != null
            ? `${ref.pattern}:${loc.filePath}:${loc.startLine}:${loc.endLine}`
            : `${ref.pattern}:<no-location>`;
        if (!detectedFromMap.has(locKey)) {
          detectedFromMap.set(locKey, ref);
        }
      }
    }
    const detectedFrom = Array.from(detectedFromMap.values()).sort(
      compareDetectedFromRefs,
    );

    const mergedProperties: Record<string, unknown> = {};
    for (const c of groupSorted) {
      mergeProperties(mergedProperties, c.properties);
    }

    // Keep a single section scope for tooling that expects string section_id.
    mergedProperties.section_id = base.properties.section_id;
    mergedProperties.section_label = base.properties.section_label;
    mergedProperties.section_role = base.properties.section_role;

    const merged: DetectedComponent = {
      ...base,
      subType,
      confidence,
      detectedFrom,
      sourceLocations,
      properties: mergedProperties,
    };

    mergedByCanonicalId.set(base.id, merged);
    for (let i = 1; i < groupSorted.length; i++) {
      removeIds.add(groupSorted[i]!.id);
    }
  }

  const out: DetectedComponent[] = [];
  for (const c of components) {
    if (removeIds.has(c.id)) continue;
    out.push(mergedByCanonicalId.get(c.id) ?? c);
  }

  out.sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;
    return a.type.localeCompare(b.type);
  });

  return out;
}

export function mergeDatabaseAssetsByType(
  components: DetectedComponent[],
): DetectedComponent[] {
  if (!components?.length) return [];

  const config = loadClassifierConfig();
  const databaseComponents: DetectedComponent[] = [];
  const other: DetectedComponent[] = [];

  for (const c of components) {
    if (c.type === "asset" && c.subType === "database") {
      databaseComponents.push(c);
    } else {
      other.push(c);
    }
  }

  if (databaseComponents.length <= 1) {
    return components;
  }

  const byKey = new Map<string, DetectedComponent[]>();
  for (const c of databaseComponents) {
    const sectionId = getSectionIdFromProperties(c.properties);
    const key = `${sectionId}::${getDatabaseCanonicalKey(c)}`;
    const list = byKey.get(key);
    if (list) list.push(c);
    else byKey.set(key, [c]);
  }

  const merged: DetectedComponent[] = [];
  const byKeyEntries = Array.from(byKey.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  for (const [, group] of byKeyEntries) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    const groupSorted = [...group].sort(compareComponentsForDeterministicBase);
    const base = groupSorted[0];

    let subType = base.subType;
    if (!subType) {
      subType = groupSorted.find((c) => c.subType)?.subType;
    }
    const confidence = aggregateComponentConfidence(
      groupSorted,
      config.resolution.confidenceAggregation,
    );
    const allLocations: SourceLocation[] = [];
    for (const c of groupSorted) allLocations.push(...c.sourceLocations);
    const sourceLocations = dedupeSourceLocations(allLocations).sort(
      compareSourceLocations,
    );
    const detectedFromMap = new Map<string, DetectedFromRef>();
    for (const c of groupSorted) {
      for (const ref of c.detectedFrom) {
        const loc = ref.sourceLocation;
        const locKey =
          loc != null
            ? `${ref.pattern}:${loc.filePath}:${loc.startLine}:${loc.endLine}`
            : `${ref.pattern}:<no-location>`;
        if (!detectedFromMap.has(locKey)) detectedFromMap.set(locKey, ref);
      }
    }
    const detectedFrom = Array.from(detectedFromMap.values()).sort(
      compareDetectedFromRefs,
    );
    const mergedProperties: Record<string, unknown> = {};
    for (const c of groupSorted)
      mergeProperties(mergedProperties, c.properties);

    const preferredName =
      base.properties.databaseType ?? base.properties.client ?? base.name;
    const displayName =
      typeof preferredName === "string"
        ? preferredName.trim()
        : base.name;
    const name =
      displayName.length > 0
        ? toDisplayName(displayName.toLowerCase(), displayName)
        : base.name;

    merged.push({
      ...base,
      name,
      subType,
      confidence,
      detectedFrom,
      sourceLocations,
      properties: mergedProperties,
    });
  }

  merged.sort((a, b) => a.name.localeCompare(b.name));
  return [...other, ...merged].sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;
    return a.type.localeCompare(b.type);
  });
}

function isAuthProviderThirdParty(component: DetectedComponent): boolean {
  if (component.type !== "third_party") return false;
  const serviceName = component.properties?.serviceName;
  const normalizedService =
    typeof serviceName === "string" ? serviceName.trim().toLowerCase() : "";
  const normalizedName = (component.name || "").trim().toLowerCase();
  return normalizedService.includes("auth0") || normalizedName.includes("auth0");
}

function mergeAuthServiceIntoTarget(
  authService: DetectedComponent,
  target: DetectedComponent,
): DetectedComponent {
  const mergedProperties: Record<string, unknown> = {};
  mergeProperties(mergedProperties, target.properties);
  mergeProperties(mergedProperties, authService.properties);

  const confidence = Math.max(target.confidence, authService.confidence);
  const sourceLocations = dedupeSourceLocations([
    ...target.sourceLocations,
    ...authService.sourceLocations,
  ]).sort(compareSourceLocations);

  const detectedFromMap = new Map<string, DetectedFromRef>();
  for (const ref of [...target.detectedFrom, ...authService.detectedFrom]) {
    const loc = ref.sourceLocation;
    const locKey =
      loc != null
        ? `${ref.pattern}:${loc.filePath}:${loc.startLine}:${loc.endLine}`
        : `${ref.pattern}:<no-location>`;
    if (!detectedFromMap.has(locKey)) detectedFromMap.set(locKey, ref);
  }

  return {
    ...target,
    confidence,
    sourceLocations,
    detectedFrom: Array.from(detectedFromMap.values()).sort(
      compareDetectedFromRefs,
    ),
    properties: mergedProperties,
  };
}

function isTerraformScannedResourceAsset(component: DetectedComponent): boolean {
  const addr = component.properties?.terraform_address;
  return (
    typeof addr === "string" &&
    Boolean(addr.trim()) &&
    !addr.trim().startsWith("provider.")
  );
}

export function compactAuthServiceComponents(
  components: DetectedComponent[],
): DetectedComponent[] {
  if (!components?.length) return [];

  const bySection = new Map<string, DetectedComponent[]>();
  for (const c of components) {
    const sid = getSectionIdFromProperties(c.properties);
    const list = bySection.get(sid);
    if (list) list.push(c);
    else bySection.set(sid, [c]);
  }

  const replacementById = new Map<string, DetectedComponent>();
  const removeIds = new Set<string>();

  for (const [, sectionComponents] of bySection) {
    const authServices = sectionComponents.filter(
      (c) =>
        c.type === "asset" &&
        c.subType === "auth_service" &&
        !isTerraformScannedResourceAsset(c),
    );
    if (authServices.length === 0) continue;

    const authThirdParty = sectionComponents.find(isAuthProviderThirdParty);
    const mainApp = sectionComponents.find(
      (c) =>
        c.type === "asset" &&
        (c.properties?.isMainApplication === true ||
          c.properties?.isMainApplication === "true"),
    );
    const fallbackAsset = sectionComponents.find((c) => c.type === "asset");
    const mergeTarget = authThirdParty ?? mainApp ?? fallbackAsset;
    if (!mergeTarget) continue;

    let nextTarget = replacementById.get(mergeTarget.id) ?? mergeTarget;
    for (const authService of authServices) {
      nextTarget = mergeAuthServiceIntoTarget(authService, nextTarget);
      removeIds.add(authService.id);
    }
    replacementById.set(mergeTarget.id, nextTarget);
  }

  const out: DetectedComponent[] = [];
  for (const c of components) {
    if (removeIds.has(c.id)) continue;
    out.push(replacementById.get(c.id) ?? c);
  }
  return out;
}

