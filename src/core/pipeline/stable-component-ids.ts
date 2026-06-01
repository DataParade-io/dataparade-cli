import { getSectionIdFromProperties } from "../../classifier/sectioning";
import type { DetectedComponent } from "../types/component";
import type { DetectedDataFlow } from "../types/data-flow";

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function firstSourceFilePath(component: DetectedComponent): string {
  const paths = (component.sourceLocations ?? []).map((loc) =>
    loc.filePath.replace(/\\/g, "/"),
  );
  paths.sort((a, b) => a.localeCompare(b));
  return paths[0] ?? "";
}

/**
 * Deterministic identity for remapping component ids after Terraform reduction.
 * Priority: terraform_address → managed service tuple → app surface tuple.
 */
export function stableComponentKey(component: DetectedComponent): string {
  const addr = component.properties?.terraform_address;
  if (typeof addr === "string" && addr.trim()) {
    return `tf:${addr.trim()}`;
  }

  const managedBy = component.properties?.managed_by_provider;
  const managedKey = component.properties?.managed_service_key;
  if (
    typeof managedBy === "string" &&
    managedBy.trim() &&
    typeof managedKey === "string" &&
    managedKey.trim()
  ) {
    const sid = getSectionIdFromProperties(component.properties);
    return `managed:${managedBy.trim()}|${String(managedKey).trim()}|${sid}`;
  }

  const sid = getSectionIdFromProperties(component.properties);
  const subType = component.subType ?? "";
  const filePath = firstSourceFilePath(component);
  return `app:${sid}|${component.type}|${subType}|${filePath}|${normalizeName(component.name)}`;
}

function compareComponentsForStableIds(
  a: DetectedComponent,
  b: DetectedComponent,
): number {
  const keyCmp = stableComponentKey(a).localeCompare(stableComponentKey(b));
  if (keyCmp !== 0) return keyCmp;
  return a.id.localeCompare(b.id);
}

/**
 * Reassign `cmp_1` … `cmp_n` from {@link stableComponentKey} ordering and rewrite
 * flow endpoints plus `managed_by_provider` references.
 */
export function assignStableComponentIds(
  components: DetectedComponent[],
  dataFlows: DetectedDataFlow[],
): { components: DetectedComponent[]; dataFlows: DetectedDataFlow[] } {
  const sorted = [...components].sort(compareComponentsForStableIds);

  const idRemap = new Map<string, string>();
  sorted.forEach((component, index) => {
    idRemap.set(component.id, `cmp_${index + 1}`);
  });

  const remappedComponents = components.map((component) => {
    const newId = idRemap.get(component.id) ?? component.id;
    const properties = { ...component.properties };
    const managedBy = properties.managed_by_provider;
    if (typeof managedBy === "string" && idRemap.has(managedBy)) {
      properties.managed_by_provider = idRemap.get(managedBy);
    }
    return { ...component, id: newId, properties };
  });

  const remappedFlows = dataFlows.map((flow) => ({
    ...flow,
    sourceComponentId:
      idRemap.get(flow.sourceComponentId) ?? flow.sourceComponentId,
    targetComponentId:
      idRemap.get(flow.targetComponentId) ?? flow.targetComponentId,
  }));

  return { components: remappedComponents, dataFlows: remappedFlows };
}
