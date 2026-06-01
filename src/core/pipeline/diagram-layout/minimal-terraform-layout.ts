import { terraformMinimalLayoutBucket } from "../terraform-minimal-services";
import type { DiagramNodeSchema } from "../../schema";
import { NODE_VERTICAL_SPACING, TERRAFORM_LANE_X_STEP } from "./constants";
import { sortNodesByLabel } from "./section-helpers";
import type { ComponentByIdMap } from "./types";

/**
 * Minimal Terraform view: User (0) → main app + ECS shells (1) → provider (2).
 */
export function applyTerraformMinimalServiceDiagramLayout(
  nodes: DiagramNodeSchema[],
  componentsById: ComponentByIdMap,
): void {
  const actorNodes: DiagramNodeSchema[] = [];
  const mainNodes: DiagramNodeSchema[] = [];
  const ecsNodes: DiagramNodeSchema[] = [];
  const providerNodes: DiagramNodeSchema[] = [];

  for (const node of nodes) {
    const c = componentsById.get(node.id);
    const bucket = terraformMinimalLayoutBucket(c);
    if (bucket === "actor") actorNodes.push(node);
    else if (bucket === "main") mainNodes.push(node);
    else if (bucket === "ecs") ecsNodes.push(node);
    else if (bucket === "provider") providerNodes.push(node);
  }

  actorNodes.sort(sortNodesByLabel);
  mainNodes.sort(sortNodesByLabel);
  ecsNodes.sort(sortNodesByLabel);
  providerNodes.sort(sortNodesByLabel);

  actorNodes.forEach((node, i) => {
    node.position = { x: 0 * TERRAFORM_LANE_X_STEP, y: i * NODE_VERTICAL_SPACING };
  });
  mainNodes.forEach((node, i) => {
    node.position = {
      x: 1 * TERRAFORM_LANE_X_STEP,
      y: i * NODE_VERTICAL_SPACING,
    };
  });
  const mainCount = mainNodes.length;
  ecsNodes.forEach((node, i) => {
    node.position = {
      x: 1 * TERRAFORM_LANE_X_STEP,
      y: (mainCount + i) * NODE_VERTICAL_SPACING,
    };
  });
  providerNodes.forEach((node, i) => {
    node.position = {
      x: 2 * TERRAFORM_LANE_X_STEP,
      y: i * NODE_VERTICAL_SPACING,
    };
  });
}
