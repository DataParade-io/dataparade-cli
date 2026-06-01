import type { DetectedComponent, DetectedFromRef } from "../core/types/component";
import type { SourceLocation } from "../core/types/file";
import type { ServiceSection } from "../core/sectioning/discover-service-sections";
import { loadPropertyDetectionConfig } from "../config/property-detection-config";
import {
  isExcludedFromMainApplicationHub,
  pickMainApplicationAssetIndex,
  PREFERRED_WEB_APP_FRAMEWORKS,
} from "./main-application-selection";
import {
  sectionQualifiesForSyntheticApplication,
  shouldInjectUserActorForMainApp,
} from "../core/sectioning/section-runtime";
import {
  getSectionIdFromProperties,
  pickDefaultSectionId,
  pickSectionRoleForSectionId,
  getSectionLabelFromProperties,
} from "./sectioning";
import {
  dedupeSourceLocations,
  compareSourceLocations,
  compareDetectedFromRefs,
} from "./postprocessing";

/** Synthetic main app created when no code hub exists (e.g. IaC-only scan). */
export const INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT =
  "injected_project_placeholder" as const;

function isLikelyUserEntrypoint(mainApp: DetectedComponent): boolean {
  const subType = mainApp.subType;
  if (subType === "application") return true;

  const framework = mainApp.properties?.framework;
  const frameworks: string[] = [];
  if (typeof framework === "string") frameworks.push(framework);
  if (Array.isArray(framework)) {
    for (const v of framework) {
      if (typeof v === "string") frameworks.push(v);
    }
  }
  return frameworks.some((f) => {
    const lower = f.toLowerCase();
    if (PREFERRED_WEB_APP_FRAMEWORKS.has(lower)) return true;
    return Array.from(PREFERRED_WEB_APP_FRAMEWORKS).some((fw) =>
      lower.includes(fw),
    );
  });
}

function isLikelyBackendEntrypoint(mainApp: DetectedComponent): boolean {
  const framework = mainApp.properties?.framework;
  const frameworks: string[] = [];
  if (typeof framework === "string") frameworks.push(framework);
  if (Array.isArray(framework)) {
    for (const v of framework) {
      if (typeof v === "string") frameworks.push(v);
    }
  }

  const backendHints = new Set([
    "express",
    "nest",
    "fastapi",
    "flask",
    "django",
    "drf",
    "starlette",
    "bottle",
    "serverless",
  ]);

  if (
    frameworks.some((f) => {
      const lower = f.toLowerCase();
      return (
        backendHints.has(lower) ||
        lower.includes("backend") ||
        lower.includes("api")
      );
    })
  ) {
    return true;
  }

  const sectionId = getSectionIdFromProperties(mainApp.properties).toLowerCase();
  return sectionId.includes("backend") || sectionId.endsWith("-api");
}

function getInjectedUserActorSubtype(mainApp: DetectedComponent): string {
  return isLikelyBackendEntrypoint(mainApp) ? "api_consumer" : "customer";
}

function getNextComponentId(components: DetectedComponent[]): string {
  let maxNumericId = 0;

  for (const component of components) {
    const match = /^cmp_(\d+)$/.exec(component.id);
    if (match) {
      const num = Number.parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxNumericId) {
        maxNumericId = num;
      }
    }
  }

  const next = maxNumericId + 1;
  return `cmp_${next}`;
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

function chooseMainAppSubType(mainAppSubtypes: Set<string>): string {
  if (mainAppSubtypes.has("application")) return "application";
  if (mainAppSubtypes.has("service")) return "service";
  if (mainAppSubtypes.has("api")) return "api";
  const first = mainAppSubtypes.values().next();
  return first.done ? "service" : first.value;
}

export function injectApplicationAssetsPerSectionIfMissing(
  components: DetectedComponent[],
  sections: ServiceSection[],
  opts?: { projectName?: string },
): DetectedComponent[] {
  if (!components || components.length === 0) return [];
  if (!sections || sections.length === 0) return components;

  const { mainAppSubtypes } = loadPropertyDetectionConfig().enhance;
  const chosenSubType = chooseMainAppSubType(mainAppSubtypes);

  const hasCandidateInSection = new Map<string, boolean>();

  for (const c of components) {
    if (c.type !== "asset" || c.subType === undefined) continue;
    if (!mainAppSubtypes.has(c.subType)) continue;
    if (isExcludedFromMainApplicationHub(c)) continue;
    const sid = getSectionIdFromProperties(c.properties);
    hasCandidateInSection.set(sid, true);
  }

  const synthetic: DetectedComponent[] = [];
  const hasPrimaryMonorepo = sections.some(
    (s) => s.isPrimaryMonorepoPackage === true,
  );
  const eligibleSections = sections.filter((s) => {
    if (s.role !== "service") return false;
    if (hasPrimaryMonorepo) return s.isPrimaryMonorepoPackage === true;
    return true;
  });

  for (const section of eligibleSections) {
    const sid = section.id;
    if (!sectionQualifiesForSyntheticApplication(section, components)) continue;
    if (hasCandidateInSection.get(sid) === true) continue;

    const name = section.label.trim() || sid;

    synthetic.push({
      id: getNextComponentId([...components, ...synthetic]),
      name,
      type: "asset",
      subType: chosenSubType,
      confidence: 1,
      detectedFrom: [],
      sourceLocations: [],
      properties: {
        section_id: sid,
        section_label: section.label,
        section_role: section.role,
        ...(section.packageName
          ? { package_name: section.packageName }
          : {}),
        ...(section.isPrimaryMonorepoPackage === true
          ? { is_primary_monorepo_package: true }
          : {}),
        sourceContext: INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
      },
      description: undefined,
      dataFlowIds: undefined,
    });
  }

  return synthetic.length > 0 ? [...components, ...synthetic] : components;
}

export function injectApplicationAssetIfMissing(
  components: DetectedComponent[],
  opts?: { projectName?: string },
): DetectedComponent[] {
  if (!components || components.length === 0) {
    return [];
  }

  const appIndex = pickMainApplicationAssetIndex(components);

  if (appIndex !== -1) {
    const cloned = [...components];
    const app = cloned[appIndex];
    if (
      app.name === "Route Handler" ||
      app.name === "route handler"
    ) {
      const projectName =
        (opts?.projectName && opts.projectName.trim()) || "Application";
      cloned[appIndex] = {
        ...app,
        name: projectName,
      };
    }
    return cloned;
  }

  const name =
    (opts?.projectName && opts.projectName.trim()) || "Application";

  const { mainAppSubtypes } = loadPropertyDetectionConfig().enhance;

  let chosenSubType: string | undefined;
  if (mainAppSubtypes.has("application")) {
    chosenSubType = "application";
  } else if (mainAppSubtypes.has("service")) {
    chosenSubType = "service";
  } else if (mainAppSubtypes.has("api")) {
    chosenSubType = "api";
  } else {
    const first = mainAppSubtypes.values().next();
    chosenSubType = first.value;
  }

  const defaultSectionId = pickDefaultSectionId(components);
  const defaultSectionRole = pickSectionRoleForSectionId(
    components,
    defaultSectionId,
  );

  const synthetic: DetectedComponent = {
    id: getNextComponentId(components),
    name,
    type: "asset",
    subType: chosenSubType,
    confidence: 1,
    detectedFrom: [],
    sourceLocations: [],
    properties: {
      section_id: defaultSectionId,
      section_role: defaultSectionRole,
      sourceContext: INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
    },
  };

  return [...components, synthetic];
}

export function injectActorIfMissing(
  components: DetectedComponent[],
): DetectedComponent[] {
  if (!components || components.length === 0) {
    return [];
  }

  const actorsBySection = new Set(
    components
      .filter((c) => c.type === "actor")
      .map((c) => getSectionIdFromProperties(c.properties)),
  );

  const mainApps = components.filter(
    (c) =>
      c.type === "asset" &&
      (c.properties?.isMainApplication === true ||
        c.properties?.isMainApplication === "true"),
  );

  const synthetic: DetectedComponent[] = [];
  for (const mainApp of mainApps) {
    if (!isLikelyUserEntrypoint(mainApp)) continue;
    if (!shouldInjectUserActorForMainApp(mainApp, components)) continue;

    const mainAppSectionId = getSectionIdFromProperties(mainApp.properties);
    const fallbackSectionId = pickDefaultSectionId(components);
    const sectionId =
      mainAppSectionId !== "<unsectioned>"
        ? mainAppSectionId
        : fallbackSectionId;
    if (actorsBySection.has(sectionId)) continue;
    actorsBySection.add(sectionId);

    const sectionRole = pickSectionRoleForSectionId(components, sectionId);
    synthetic.push({
      id: getNextComponentId([...components, ...synthetic]),
      name: "User",
      type: "actor",
      subType: getInjectedUserActorSubtype(mainApp),
      confidence: 0.5,
      detectedFrom: [],
      sourceLocations: [],
      properties: {
        sourceContext: "injected_default",
        section_id: sectionId,
        section_role: sectionRole,
      },
    });
  }

  return synthetic.length > 0 ? [...components, ...synthetic] : components;
}

export function synthesizeSectionApiNodes(
  components: DetectedComponent[],
): DetectedComponent[] {
  if (!components?.length) return [];

  const bySection = new Map<string, DetectedComponent[]>();
  for (const component of components) {
    const sectionId = getSectionIdFromProperties(component.properties);
    const list = bySection.get(sectionId);
    if (list) list.push(component);
    else bySection.set(sectionId, [component]);
  }

  const synthetic: DetectedComponent[] = [];

  for (const [sectionId, sectionComponents] of bySection.entries()) {
    const routeEvidenceRefs: DetectedFromRef[] = [];
    let hasNonManifestRouteEvidence = false;
    for (const c of sectionComponents) {
      for (const ref of c.detectedFrom) {
        if (ref.pattern === "express_route") {
          routeEvidenceRefs.push(ref);
          const fp = ref.sourceLocation?.filePath?.replace(/\\/g, "/");
          if (fp && !fp.endsWith("package.json")) {
            hasNonManifestRouteEvidence = true;
          }
        }
      }
    }
    if (routeEvidenceRefs.length === 0 || !hasNonManifestRouteEvidence) continue;

    routeEvidenceRefs.sort(compareDetectedFromRefs);

    const existingApi = sectionComponents.find((c) => {
      if (c.type !== "asset" || c.subType !== "api") return false;
      const isMainApp =
        c.properties?.isMainApplication === true ||
        c.properties?.isMainApplication === "true";

      const hasRouteEvidence = c.detectedFrom.some(
        (ref) => ref.pattern === "express_route",
      );
      if (hasRouteEvidence && !isMainApp) return true;

      return (
        c.properties?.isSectionApiNode === true ||
        c.properties?.isSectionApiNode === "true"
      );
    });
    if (existingApi) continue;

    const sectionLabel =
      getSectionLabelFromProperties(sectionComponents[0]?.properties) ?? sectionId;
    const sourceLocations = dedupeSourceLocations(
      routeEvidenceRefs
        .map((ref) => ref.sourceLocation)
        .filter((loc): loc is SourceLocation => loc !== undefined),
    ).sort(compareSourceLocations);

    synthetic.push({
      id: getNextComponentId([...components, ...synthetic]),
      name: "API",
      type: "asset",
      subType: "api",
      confidence: 1,
      detectedFrom: routeEvidenceRefs,
      sourceLocations,
      properties: {
        section_id: sectionId,
        section_label: sectionLabel,
        section_role: pickSectionRoleForSectionId(components, sectionId),
        isSectionApiNode: true,
      },
    });
  }

  if (synthetic.length === 0) return components;
  return [...components, ...synthetic];
}

