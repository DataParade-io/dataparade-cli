import type { DetectedComponent } from "../core/types/component";
import type { RawFinding } from "../core/types/detection";

function getSectionIdFromMaybeUnknown(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v ? v : undefined;
}

export function getSectionIdFromFinding(finding: RawFinding): string | undefined {
  return getSectionIdFromMaybeUnknown(finding.properties?.section_id);
}

export function getSectionIdFromComponent(
  component: DetectedComponent,
): string | undefined {
  return getSectionIdFromMaybeUnknown(component.properties?.section_id);
}

export function isConcreteServiceSectionId(
  sectionId: string | undefined,
): boolean {
  if (!sectionId) return false;
  return (
    sectionId !== "root" &&
    sectionId !== "<unsectioned>" &&
    sectionId !== "global"
  );
}

/**
 * Resolves the default "caller" component (Application) for app→DB and app→TP flows.
 * Uses asset with isMainApplication, or first asset with subType api/service.
 * When multiple main applications exist (per section_id), selects the one
 * matching the finding's section_id.
 */
export function findSourceComponent(
  components: DetectedComponent[],
  sectionId?: string,
): DetectedComponent | undefined {
  const scoped =
    sectionId && sectionId.trim().length > 0
      ? components.filter((c) => getSectionIdFromComponent(c) === sectionId)
      : components;

  const main = scoped.find(
    (c) =>
      c.type === "asset" &&
      (c.properties?.isMainApplication === true ||
        c.properties?.isMainApplication === "true"),
  );
  if (main) return main;

  const apiOrService = scoped.find(
    (c) => c.type === "asset" && (c.subType === "api" || c.subType === "service"),
  );
  if (apiOrService) return apiOrService;

  // Fallback to global selection when the section has no candidate.
  const globalMain = components.find(
    (c) =>
      c.type === "asset" &&
      (c.properties?.isMainApplication === true ||
        c.properties?.isMainApplication === "true"),
  );
  if (globalMain) return globalMain;

  return (
    components.find(
      (c) => c.type === "asset" && (c.subType === "api" || c.subType === "service"),
    ) ?? components.find((c) => c.type === "asset")
  );
}

export function findSectionApiNode(
  components: DetectedComponent[],
  sectionId?: string,
): DetectedComponent | undefined {
  if (!sectionId || !sectionId.trim()) return undefined;
  return components.find(
    (c) =>
      c.type === "asset" &&
      c.subType === "api" &&
      getSectionIdFromComponent(c) === sectionId &&
      (c.properties?.isSectionApiNode === true ||
        c.properties?.isSectionApiNode === "true"),
  );
}

