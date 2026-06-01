import type { DetectedComponent, DetectedDataFlow } from "../types";

function getSectionId(component: DetectedComponent): string {
  return typeof component.properties?.section_id === "string" &&
    component.properties.section_id.trim()
    ? component.properties.section_id.trim()
    : "<unsectioned>";
}

export function sortComponentsDeterministically(
  components: DetectedComponent[],
): void {
  components.sort((a, b) => {
    const sa = getSectionId(a);
    const sb = getSectionId(b);
    const sectionCmp = sa.localeCompare(sb);
    if (sectionCmp !== 0) return sectionCmp;
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    const typeCmp = a.type.localeCompare(b.type);
    if (typeCmp !== 0) return typeCmp;
    const subTypeA = a.subType ?? "";
    const subTypeB = b.subType ?? "";
    const subCmp = subTypeA.localeCompare(subTypeB);
    if (subCmp !== 0) return subCmp;
    return a.id.localeCompare(b.id);
  });
}

export function sortDataFlowsDeterministically(flows: DetectedDataFlow[]): void {
  flows.sort((a, b) => {
    const typeCmp = a.type.localeCompare(b.type);
    if (typeCmp !== 0) return typeCmp;
    const scCmp = a.sourceComponentId.localeCompare(b.sourceComponentId);
    if (scCmp !== 0) return scCmp;
    const tcCmp = a.targetComponentId.localeCompare(b.targetComponentId);
    if (tcCmp !== 0) return tcCmp;
    const idCmp = a.id.localeCompare(b.id);
    if (idCmp !== 0) return idCmp;
    return a.confidence - b.confidence;
  });
}

