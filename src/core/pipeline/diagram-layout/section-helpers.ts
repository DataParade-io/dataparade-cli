import { scanHasTerraformAddress } from "../../terraform/component-predicates";
import type { DetectedComponent } from "../../types";
import type { ComponentByIdMap } from "./types";

export function getSectionIdFromComponent(component: DetectedComponent): string {
  const sid = component.properties?.section_id;
  return typeof sid === "string" && sid.trim() ? sid.trim() : "<unsectioned>";
}

export function getSectionLabelFromComponent(component: DetectedComponent): string {
  const label = component.properties?.section_label;
  if (typeof label === "string" && label.trim()) return label.trim();
  return getSectionIdFromComponent(component);
}

export function componentSortKey(component: DetectedComponent): string {
  const managedBy = String(component.properties?.managed_by_provider ?? "");
  const managedKey = String(component.properties?.managed_service_key ?? "");
  if (managedBy) {
    return `2|${managedBy}|${managedKey}|${component.name}`;
  }
  if (component.type === "third_party") {
    return `1|${component.id}|${component.name}`;
  }
  return `0|${component.id}|${component.name}`;
}

/** Lane layout applies only to sections with Terraform resources (not every User actor). */
export function sectionQualifiesForTerraformLaneLayout(
  sectionComponents: DetectedComponent[],
): boolean {
  return scanHasTerraformAddress(sectionComponents);
}

export function isMainApplicationComponent(component: DetectedComponent): boolean {
  const v = component.properties?.isMainApplication;
  return v === true || v === "true";
}

export function isSectionApiNodeComponent(component: DetectedComponent): boolean {
  return (
    component.type === "asset" &&
    component.subType === "api" &&
    (component.properties?.isSectionApiNode === true ||
      component.properties?.isSectionApiNode === "true")
  );
}

export function isManagedSubserviceComponent(component: DetectedComponent): boolean {
  const providerId = component.properties?.managed_by_provider;
  return typeof providerId === "string" && providerId.trim().length > 0;
}

export function sortNodesByLabel(
  a: { id: string; data?: { label?: string } },
  b: { id: string; data?: { label?: string } },
): number {
  const la = String(a.data?.label ?? a.id);
  const lb = String(b.data?.label ?? b.id);
  return la.localeCompare(lb);
}

export function filterSectionNodes(
  nodes: Array<{ id: string }>,
  componentsById: ComponentByIdMap,
  sectionId: string,
): Array<{ id: string; position?: { x: number; y: number } }> {
  return nodes.filter((n) => {
    const c = componentsById.get(n.id);
    return c && getSectionIdFromComponent(c) === sectionId;
  });
}
