import { isTerraformModuleCallShellAsset } from "../../../classifier/main-application-selection";
import { isTerraformProviderComponent } from "../../terraform/component-predicates";
import type { DetectedComponent } from "../../types";
import type { DiagramEdgeSchema } from "../../schema";
import {
  isMainApplicationComponent,
  isSectionApiNodeComponent,
} from "./section-helpers";

export function applyDirectionalEdgeHandles(
  edge: DiagramEdgeSchema,
  sourceComponent: DetectedComponent | undefined,
  targetComponent: DetectedComponent | undefined,
): void {
  const isProviderToManagedServiceEdge =
    sourceComponent?.type === "third_party" &&
    typeof targetComponent?.properties?.managed_by_provider === "string" &&
    targetComponent.properties.managed_by_provider === sourceComponent?.id;

  const isProviderToModuleShellEdge =
    sourceComponent !== undefined &&
    targetComponent !== undefined &&
    isTerraformProviderComponent(sourceComponent) &&
    isTerraformModuleCallShellAsset(targetComponent);

  const isHubToIntegrationEdge =
    sourceComponent !== undefined &&
    targetComponent?.type === "third_party" &&
    ((sourceComponent.type === "asset" &&
      isMainApplicationComponent(sourceComponent)) ||
      isSectionApiNodeComponent(sourceComponent));

  if (
    isProviderToManagedServiceEdge ||
    isProviderToModuleShellEdge ||
    isHubToIntegrationEdge
  ) {
    (edge as Record<string, unknown>).sourceHandle = "right-source";
    (edge as Record<string, unknown>).targetHandle = "left-target";
  }
}
