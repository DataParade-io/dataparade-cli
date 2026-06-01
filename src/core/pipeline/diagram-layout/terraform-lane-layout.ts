import { isTerraformModuleCallShellAsset } from "../../../classifier/main-application-selection";
import { isTerraformProviderComponent } from "../../terraform/component-predicates";
import type { DetectedComponent } from "../../types";
import type { DiagramNodeSchema } from "../../schema";
import {
  NODE_VERTICAL_SPACING,
  SECTION_BLOCK_WIDTH,
  TERRAFORM_LANE_X_STEP,
} from "./constants";
import {
  getSectionIdFromComponent,
  isMainApplicationComponent,
  sectionQualifiesForTerraformLaneLayout,
} from "./section-helpers";
import type { ComponentByIdMap } from "./types";

/**
 * Mixed-app Terraform root: only `provider.*` + `module.*` shells (no actor/main).
 */
function sectionUsesProviderHubBeforeModuleShells(
  sectionComponents: DetectedComponent[],
): boolean {
  let hasProvider = false;
  let hasModuleShell = false;
  for (const c of sectionComponents) {
    if (c.type === "actor") return false;
    if (c.type === "asset" && isMainApplicationComponent(c)) return false;
    if (isTerraformProviderComponent(c)) hasProvider = true;
    else if (isTerraformModuleCallShellAsset(c)) hasModuleShell = true;
  }
  return hasProvider && hasModuleShell;
}

function terraformLaneTier(
  component: DetectedComponent,
  opts?: { providerBeforeModuleShells?: boolean },
): number | undefined {
  if (component.type === "actor") return 0;
  if (component.type === "asset" && isMainApplicationComponent(component)) {
    return 1;
  }
  if (opts?.providerBeforeModuleShells) {
    if (isTerraformProviderComponent(component)) return 2;
    if (isTerraformModuleCallShellAsset(component)) return 3;
    if (component.type === "asset") return 4;
    return undefined;
  }
  if (isTerraformModuleCallShellAsset(component)) return 2;
  if (component.type === "third_party") return 3;
  if (component.type === "asset") return 4;
  return undefined;
}

export function applyTerraformLaneLayout(
  nodes: DiagramNodeSchema[],
  componentsById: ComponentByIdMap,
  sectionIds: string[],
): void {
  const allComponents = [...componentsById.values()];

  const targetSectionIds =
    sectionIds.length <= 1
      ? sectionIds
      : sectionIds.filter((sid) => {
          const inSection = allComponents.filter(
            (c) => getSectionIdFromComponent(c) === sid,
          );
          return sectionQualifiesForTerraformLaneLayout(inSection);
        });

  if (targetSectionIds.length === 0) return;

  for (const sectionId of targetSectionIds) {
    const sectionIndex = sectionIds.indexOf(sectionId);
    const baseX = Math.max(0, sectionIndex) * SECTION_BLOCK_WIDTH;

    const sectionNodes = nodes.filter((n) => {
      const c = componentsById.get(n.id);
      return c && getSectionIdFromComponent(c) === sectionId;
    });
    if (sectionNodes.length === 0) continue;

    const sectionComponents = sectionNodes
      .map((n) => componentsById.get(n.id))
      .filter((c): c is DetectedComponent => Boolean(c));
    if (!sectionQualifiesForTerraformLaneLayout(sectionComponents)) continue;

    const providerBeforeModuleShells =
      sectionUsesProviderHubBeforeModuleShells(sectionComponents);

    const byTier = new Map<number, DiagramNodeSchema[]>();
    for (const node of sectionNodes) {
      const c = componentsById.get(node.id);
      if (!c) continue;
      const tier = terraformLaneTier(c, { providerBeforeModuleShells });
      if (tier === undefined) continue;
      const list = byTier.get(tier) ?? [];
      list.push(node);
      byTier.set(tier, list);
    }

    const tierOrder = [0, 1, 2, 3, 4];
    for (const tier of tierOrder) {
      const list = byTier.get(tier);
      if (!list) continue;
      list.sort((a, b) => {
        const ca = componentsById.get(a.id);
        const cb = componentsById.get(b.id);
        const na = ca?.name ?? a.id;
        const nb = cb?.name ?? b.id;
        const cmp = na.localeCompare(nb);
        if (cmp !== 0) return cmp;
        return a.id.localeCompare(b.id);
      });
      list.forEach((node, idx) => {
        node.position = {
          x: baseX + tier * TERRAFORM_LANE_X_STEP,
          y: idx * NODE_VERTICAL_SPACING,
        };
      });
    }
  }
}
