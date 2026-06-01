import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";

function getSectionId(component: DetectedComponent): string {
  const sid = component.properties?.section_id;
  return typeof sid === "string" && sid.trim() ? sid.trim() : "";
}

function isMainApp(component: DetectedComponent): boolean {
  return (
    component.type === "asset" &&
    (component.properties?.isMainApplication === true ||
      component.properties?.isMainApplication === "true")
  );
}

function isSyntheticSectionApiNode(component: DetectedComponent): boolean {
  return (
    component.properties?.isSectionApiNode === true ||
    component.properties?.isSectionApiNode === "true"
  );
}

function componentHasFlow(
  componentId: string,
  flows: DetectedDataFlow[],
): boolean {
  return flows.some(
    (f) =>
      f.sourceComponentId === componentId || f.targetComponentId === componentId,
  );
}

/**
 * Links the section main app to API assets that have no flows yet
 */
export function ensureMainToUnlinkedSectionApiFlows(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): DetectedDataFlow[] {
  const flowKeys = new Set(
    flows.map((f) => `${f.sourceComponentId}\t${f.targetComponentId}\t${f.type}`),
  );

  let maxFlowNum = flows.reduce((max, f) => {
    const m = /^flow_(\d+)$/.exec(f.id);
    return m ? Math.max(max, Number.parseInt(m[1], 10)) : max;
  }, 0);

  const synthetic: DetectedDataFlow[] = [];

  const apiAssets = components
    .filter(
      (c) =>
        c.type === "asset" &&
        c.subType === "api" &&
        !isSyntheticSectionApiNode(c),
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const api of apiAssets) {
    if (componentHasFlow(api.id, flows)) continue;

    const sectionId = getSectionId(api);
    const main = components.find(
      (c) => isMainApp(c) && getSectionId(c) === sectionId,
    );
    if (!main || main.id === api.id) continue;

    const key = `${main.id}\t${api.id}\tapi_call`;
    if (flowKeys.has(key)) continue;
    flowKeys.add(key);

    maxFlowNum += 1;
    synthetic.push({
      id: `flow_${maxFlowNum}`,
      sourceComponentId: main.id,
      targetComponentId: api.id,
      type: "api_call",
      confidence: 0.75,
      description: "Section main to API surface",
    });
  }

  return synthetic.length > 0 ? [...flows, ...synthetic] : flows;
}
