import type { DiagramNodeSchema } from "../../schema";
import {
  NODE_VERTICAL_SPACING,
  SECTION_BLOCK_WIDTH,
  TERRAFORM_LANE_X_STEP,
} from "./constants";
import {
  filterSectionNodes,
  getSectionIdFromComponent,
  isMainApplicationComponent,
  isManagedSubserviceComponent,
  isSectionApiNodeComponent,
  sectionQualifiesForTerraformLaneLayout,
  sortNodesByLabel,
} from "./section-helpers";
import type { ComponentByIdMap } from "./types";

/**
 * Monorepo app sections: actor → main app → section API → integrations;
 * managed sub-services are positioned beside their provider hub afterward.
 */
export function applyAppSectionStackLayout(
  nodes: DiagramNodeSchema[],
  componentsById: ComponentByIdMap,
  sectionIds: string[],
): void {
  const allComponents = [...componentsById.values()];

  for (const sectionId of sectionIds) {
    const sectionIndex = sectionIds.indexOf(sectionId);
    const baseX = Math.max(0, sectionIndex) * SECTION_BLOCK_WIDTH;

    const sectionComponents = allComponents.filter(
      (c) => getSectionIdFromComponent(c) === sectionId,
    );
    if (sectionQualifiesForTerraformLaneLayout(sectionComponents)) continue;

    const sectionNodes = filterSectionNodes(nodes, componentsById, sectionId);
    if (sectionNodes.length === 0) continue;

    const actors: DiagramNodeSchema[] = [];
    const mains: DiagramNodeSchema[] = [];
    const sectionApis: DiagramNodeSchema[] = [];
    const integrations: DiagramNodeSchema[] = [];
    const otherAssets: DiagramNodeSchema[] = [];

    for (const node of sectionNodes) {
      const c = componentsById.get(node.id);
      if (!c) continue;
      if (c.type === "actor") actors.push(node as DiagramNodeSchema);
      else if (c.type === "asset" && isMainApplicationComponent(c)) {
        mains.push(node as DiagramNodeSchema);
      } else if (isSectionApiNodeComponent(c)) {
        sectionApis.push(node as DiagramNodeSchema);
      } else if (isManagedSubserviceComponent(c)) continue;
      else if (c.type === "third_party") integrations.push(node as DiagramNodeSchema);
      else otherAssets.push(node as DiagramNodeSchema);
    }

    actors.sort(sortNodesByLabel);
    mains.sort(sortNodesByLabel);
    sectionApis.sort(sortNodesByLabel);
    integrations.sort(sortNodesByLabel);
    otherAssets.sort(sortNodesByLabel);

    const integrationColumnX = baseX + 3 * TERRAFORM_LANE_X_STEP;

    actors.forEach((node, i) => {
      node.position = { x: baseX, y: i * NODE_VERTICAL_SPACING };
    });
    mains.forEach((node, i) => {
      node.position = {
        x: baseX + TERRAFORM_LANE_X_STEP,
        y: i * NODE_VERTICAL_SPACING,
      };
    });
    sectionApis.forEach((node, i) => {
      node.position = {
        x: baseX + 2 * TERRAFORM_LANE_X_STEP,
        y: i * NODE_VERTICAL_SPACING,
      };
    });
    const integrationStack = [...integrations, ...otherAssets];
    integrationStack.forEach((node, i) => {
      node.position = {
        x: integrationColumnX,
        y: i * NODE_VERTICAL_SPACING,
      };
    });
  }
}
