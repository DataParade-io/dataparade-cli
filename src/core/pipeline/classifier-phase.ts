import type { DetectedComponent, RawFinding } from "../types";
import type { ServiceSection } from "../sectioning/discover-service-sections";
import {
  classifyRawFindings,
  compactAuthServiceComponents,
  dedupeComponents,
  injectApplicationAssetIfMissing,
  injectApplicationAssetsPerSectionIfMissing,
  injectActorIfMissing,
  mergeDatabaseAssetsByType,
  synthesizeSectionApiNodes,
} from "../../classifier/classify";
import { enhanceComponents } from "../../classifier/enhance";
import { FRONTEND_FRAMEWORK_HINTS_SET } from "../../patterns/frontend-frameworks";

export interface ClassifierPhaseOptions {
  projectName: string;
  minimumConfidence: number;
}

function frameworkValues(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) {
    return value.filter(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    );
  }
  return [];
}

function mergeUniqueStringValues(current: unknown, incoming: string[]): unknown {
  const existing = frameworkValues(current);
  const merged = Array.from(new Set([...existing, ...incoming]));
  if (merged.length === 0) return current;
  return merged;
}

function collapseManifestFrontendFrameworkAssets(
  components: DetectedComponent[],
): DetectedComponent[] {
  if (components.length === 0) return components;

  const mainBySection = new Map<string, DetectedComponent>();
  for (const component of components) {
    if (component.type !== "asset") continue;
    if (
      component.properties?.isMainApplication === true ||
      component.properties?.isMainApplication === "true"
    ) {
      const sectionId =
        typeof component.properties?.section_id === "string"
          ? component.properties.section_id
          : "";
      if (sectionId) mainBySection.set(sectionId, component);
    }
  }

  const removeIds = new Set<string>();
  const updatesById = new Map<string, DetectedComponent>();

  for (const component of components) {
    if (component.type !== "asset" || component.subType !== "api") continue;
    if (component.properties?.sourceContext !== "dependency_manifest") continue;

    const sectionId =
      typeof component.properties?.section_id === "string"
        ? component.properties.section_id
        : "";
    if (!sectionId) continue;

    const main = mainBySection.get(sectionId);
    if (!main || main.id === component.id) continue;

    const frameworks = frameworkValues(component.properties?.framework).filter((fw) =>
      FRONTEND_FRAMEWORK_HINTS_SET.has(fw.toLowerCase()),
    );
    if (frameworks.length === 0) continue;

    const currentMain = updatesById.get(main.id) ?? main;
    const nextProps = { ...currentMain.properties };
    nextProps.framework = mergeUniqueStringValues(nextProps.framework, frameworks);
    nextProps.technology_stack = mergeUniqueStringValues(
      nextProps.technology_stack,
      frameworks,
    );

    updatesById.set(main.id, { ...currentMain, properties: nextProps });
    removeIds.add(component.id);
  }

  return components
    .filter((component) => !removeIds.has(component.id))
    .map((component) => updatesById.get(component.id) ?? component);
}

export function runClassifierPhase(
  findings: RawFinding[],
  sections: ServiceSection[],
  options: ClassifierPhaseOptions,
): DetectedComponent[] {
  const classified = classifyRawFindings(findings);
  const dedupedComponents = dedupeComponents(classified);
  const compactedAuthComponents = compactAuthServiceComponents(dedupedComponents);
  const mergedDbComponents = mergeDatabaseAssetsByType(compactedAuthComponents);

  const withPerSectionApplication = injectApplicationAssetsPerSectionIfMissing(
    mergedDbComponents,
    sections,
    { projectName: options.projectName },
  );
  const withApplication = injectApplicationAssetIfMissing(
    withPerSectionApplication,
    { projectName: options.projectName },
  );
  const enhanced = enhanceComponents(withApplication);
  const mergedFrameworkHelpers = collapseManifestFrontendFrameworkAssets(enhanced);
  const withSectionApiNodes = synthesizeSectionApiNodes(mergedFrameworkHelpers);

  return injectActorIfMissing(withSectionApiNodes).filter(
    (component) => component.confidence >= options.minimumConfidence,
  );
}

