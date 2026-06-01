import type { DetectedComponent } from "../core/types/component";
import { getDefaultsForType } from "./enhance-defaults";
import { loadPropertyDetectionConfig } from "../config/property-detection-config";
import {
  isTerraformGraphResourceAsset,
  isTerraformModuleCallShellAsset,
  isTerraformStructuralInfrastructureAsset,
  isTerraformUtilityInfrastructureAsset,
} from "./main-application-selection";
import { INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT } from "./application-injection";
import {
  FRONTEND_FRAMEWORK_HINTS_SET,
  SERVER_FRAMEWORK_HINTS,
} from "../patterns/frontend-frameworks";

function setIfMissing<T>(
  props: Record<string, unknown>,
  key: string,
  value: T,
): void {
  const current = props[key];
  if (current === undefined || current === "" || current === null) {
    props[key] = value;
  }
}

function toTitleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function normalizeApiDisplayName(
  rawName: string,
  properties: Record<string, unknown> | undefined,
): string {
  const name = (rawName || "").trim();
  if (!name) return name;

  const lower = name.toLowerCase();
  const isGenericApiName =
    lower === "route handler" ||
    lower.startsWith("nest_controller") ||
    /^(get|post|put|delete|patch|options|head)\s+/.test(lower);

  if (!isGenericApiName) return name;

  const sectionLabel = properties?.section_label;
  if (typeof sectionLabel === "string" && sectionLabel.trim()) {
    return `${sectionLabel.trim()} API`;
  }

  const sectionId = properties?.section_id;
  if (
    typeof sectionId === "string" &&
    sectionId.trim() &&
    sectionId !== "root" &&
    sectionId !== "global" &&
    sectionId !== "<unsectioned>"
  ) {
    return `${sectionId.trim()} API`;
  }

  return "API";
}

/**
 * Enhances a single component with defaults for all inferrable properties
 * per node type (asset, actor, third_party). Does not set isMainApplication
 * (that is applied in enhanceComponents).
 */
export function enhanceComponent(
  component: DetectedComponent,
): DetectedComponent {
  const properties = { ...component.properties };

  // Apply all Engineering, Privacy, and Security property defaults for this type (only when missing)
  const defaults = getDefaultsForType(component.type);
  for (const key of Object.keys(defaults)) {
    if (properties[key] === undefined) {
      properties[key] = defaults[key];
    }
  }

  switch (component.type) {
    case "asset":
      enhanceAsset(component, properties);
      break;
    case "third_party":
      enhanceThirdParty(component, properties);
      break;
    case "actor":
      enhanceActor(component, properties);
      break;
  }

  return {
    ...component,
    properties,
  };
}

function enhanceAsset(
  component: DetectedComponent,
  properties: Record<string, unknown>,
): void {
  const { subType } = component;
  const { cloudAssetSubtypes, onPremAssetSubtypes, supportedOperationsBySubType } =
    loadPropertyDetectionConfig().enhance;

  // technology_stack: infer from databaseType or known name (only when we have a value)
  const techStack = inferTechnologyStack(component);
  if (techStack) {
    setIfMissing(properties, "technology_stack", techStack);
  }

  // hosting_type: cloud for api/database/cache/etc., on_premise for config
  if (subType && cloudAssetSubtypes.has(subType)) {
    setIfMissing(properties, "hosting_type", "cloud");
  } else if (subType && onPremAssetSubtypes.has(subType)) {
    setIfMissing(properties, "hosting_type", "on_premise");
  } else {
    setIfMissing(properties, "hosting_type", "cloud");
  }

  // database_engine: for database/cache, from databaseType
  if (subType === "database" || subType === "cache") {
    const dbType = component.properties.databaseType;
    if (typeof dbType === "string" && dbType.trim()) {
      setIfMissing(
        properties,
        "database_engine",
        `${dbType.trim().charAt(0).toUpperCase()}${dbType.trim().slice(1).toLowerCase()}`,
      );
    }
  }

  // supported_operations: by subType from config
  if (subType && supportedOperationsBySubType[subType]?.length) {
    setIfMissing(properties, "supported_operations", supportedOperationsBySubType[subType]);
  }
}

function inferTechnologyStack(component: DetectedComponent): string {
  const existing = component.properties.technology_stack;
  if (existing !== undefined && existing !== "") {
    return String(existing);
  }
  const dbType = component.properties.databaseType;
  if (typeof dbType === "string" && dbType.trim()) {
    return dbType.trim().toLowerCase();
  }
  const name = component.name?.trim().toLowerCase();
  const { knownDatabaseNames } = loadPropertyDetectionConfig();
  if (
    name &&
    (component.subType === "database" || component.subType === "cache") &&
    knownDatabaseNames.has(name)
  ) {
    return name;
  }
  // Do not fall back to generic "database" / "cache" — leave technology_stack unset (default null)
  return "";
}

function enhanceThirdParty(
  component: DetectedComponent,
  properties: Record<string, unknown>,
): void {
  const { defaultThirdPartyHosting } = loadPropertyDetectionConfig().enhance;
  setIfMissing(properties, "hosting_type", defaultThirdPartyHosting);
  setIfMissing(properties, "integration_method", "api");
  if (component.name && !properties.vendor) {
    properties.vendor = toTitleCase(component.name.trim());
  }
}

function enhanceActor(
  component: DetectedComponent,
  properties: Record<string, unknown>,
): void {
  if (component.subType === "customer") {
    properties.isDataSubject = true; // override default false for customer
  }
}

function isSingleRouteApiAsset(component: DetectedComponent): boolean {
  if (component.type !== "asset" || component.subType !== "api") {
    return false;
  }

  const name = (component.name || "").trim();
  if (!name) return false;

  const lower = name.toLowerCase();

  if (lower === "route handler") {
    return true;
  }

  if (lower.startsWith("nest_controller")) {
    return true;
  }

  if (/^(get|post|put|delete|patch|options|head)\s+/.test(lower)) {
    return true;
  }

  return false;
}

function getFrameworkPriority(component: DetectedComponent): number {
  const value = component.properties.framework;
  const frameworks: string[] = [];

  if (typeof value === "string") {
    frameworks.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string") {
        frameworks.push(v);
      }
    }
  }

  if (frameworks.length === 0) return 100;

  let best = 100;
  for (const raw of frameworks) {
    const fw = raw.toLowerCase();
    if (FRONTEND_FRAMEWORK_HINTS_SET.has(fw)) {
      best = Math.min(best, 0);
    } else if (SERVER_FRAMEWORK_HINTS.has(fw)) {
      best = Math.min(best, 1);
    } else {
      best = Math.min(best, 2);
    }
  }

  return best;
}

/**
 * Enhances all components with defaults for all node types, then sets
 * isMainApplication on a "primary" app asset per section_id (framework-aware),
 * and normalizes generic API display names.
 */
export function enhanceComponents(
  components: DetectedComponent[],
): DetectedComponent[] {
  const enhanced = components.map(enhanceComponent);
  const { mainAppSubtypes } = loadPropertyDetectionConfig().enhance;

  // Clear any existing isMainApplication markers so the selection is deterministic.
  for (const c of enhanced) {
    if (
      c.type === "asset" &&
      c.subType !== undefined &&
      mainAppSubtypes.has(c.subType)
    ) {
      if ("isMainApplication" in c.properties) {
        delete c.properties.isMainApplication;
      }
    }
  }

  const sectionIdFor = (c: DetectedComponent): string =>
    typeof c.properties?.section_id === "string" && c.properties.section_id.trim()
      ? c.properties.section_id.trim()
      : "<unsectioned>";

  const bySectionRegular = new Map<
    string,
    Array<{ index: number; frameworkPriority: number }>
  >();
  const bySectionSingleRoute = new Map<
    string,
    Array<{ index: number; frameworkPriority: number }>
  >();

  for (let i = 0; i < enhanced.length; i++) {
    const c = enhanced[i];
    if (
      c.type === "asset" &&
      c.subType !== undefined &&
      mainAppSubtypes.has(c.subType)
    ) {
      if (isTerraformGraphResourceAsset(c)) {
        continue;
      }
      if (isTerraformUtilityInfrastructureAsset(c)) {
        continue;
      }
      if (isTerraformStructuralInfrastructureAsset(c)) {
        continue;
      }
      if (isTerraformModuleCallShellAsset(c)) {
        continue;
      }
      const sid = sectionIdFor(c);
      const priority = getFrameworkPriority(c);
      if (isSingleRouteApiAsset(c)) {
        const list = bySectionSingleRoute.get(sid);
        if (list) list.push({ index: i, frameworkPriority: priority });
        else bySectionSingleRoute.set(sid, [{ index: i, frameworkPriority: priority }]);
      } else {
        const list = bySectionRegular.get(sid);
        if (list) list.push({ index: i, frameworkPriority: priority });
        else bySectionRegular.set(sid, [{ index: i, frameworkPriority: priority }]);
      }
    }
  }

  if (bySectionRegular.size + bySectionSingleRoute.size === 0) return enhanced;

  const sectionKeys = new Set([
    ...Array.from(bySectionRegular.keys()),
    ...Array.from(bySectionSingleRoute.keys()),
  ]);
  const hasNonGlobal = Array.from(sectionKeys).some((sid) => sid !== "global");
  const updated = [...enhanced];

  for (const sid of sectionKeys) {
    if (hasNonGlobal && sid === "global") continue;

    const candidates =
      bySectionRegular.get(sid) ?? bySectionSingleRoute.get(sid);
    if (!candidates || candidates.length === 0) continue;

    candidates.sort((a, b) => {
      const aCtx = updated[a.index]?.properties?.sourceContext;
      const bCtx = updated[b.index]?.properties?.sourceContext;
      const aInj =
        aCtx === INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT ? 0 : 1;
      const bInj =
        bCtx === INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT ? 0 : 1;
      if (aInj !== bInj) return aInj - bInj;
      if (a.frameworkPriority !== b.frameworkPriority) {
        return a.frameworkPriority - b.frameworkPriority;
      }
      return a.index - b.index;
    });

    const pick = candidates[0];
    const main = updated[pick.index]!;
    const sectionLabelRaw = main.properties?.section_label;
    const sectionLabel =
      typeof sectionLabelRaw === "string" && sectionLabelRaw.trim()
        ? sectionLabelRaw.trim()
        : undefined;
    const preferredMainName =
      sid !== "<unsectioned>" && sid !== "root"
        ? sectionLabel ?? sid
        : main.name;
    updated[pick.index] = {
      ...main,
      name: preferredMainName,
      properties: { ...main.properties, isMainApplication: true },
    };
  }

  return updated.map((component) => {
    if (component.type === "asset" && component.subType === "api") {
      return {
        ...component,
        name: normalizeApiDisplayName(component.name, component.properties),
      };
    }
    return component;
  });
}
