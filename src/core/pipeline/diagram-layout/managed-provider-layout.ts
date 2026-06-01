import type { DetectedComponent } from "../../types";
import type { DiagramNodeSchema } from "../../schema";
import {
  MANAGED_NODE_X_OFFSET,
  MANAGED_NODE_Y_BASE_OFFSET,
  MANAGED_NODE_Y_STEP,
} from "./constants";
import type { ComponentByIdMap } from "./types";

export function repositionManagedProviderNodes(
  nodes: DiagramNodeSchema[],
  componentsById: ComponentByIdMap,
): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const managedByProvider = new Map<string, DetectedComponent[]>();

  for (const component of componentsById.values()) {
    const providerId = component.properties?.managed_by_provider;
    if (typeof providerId !== "string" || !providerId.trim()) continue;
    const list = managedByProvider.get(providerId) ?? [];
    list.push(component);
    managedByProvider.set(providerId, list);
  }

  for (const [providerId, managedComponents] of managedByProvider.entries()) {
    const providerNode = nodeById.get(providerId);
    if (!providerNode) continue;
    const sortedManaged = [...managedComponents].sort((a, b) => {
      const aKey = String(a.properties?.managed_service_key ?? a.name ?? "");
      const bKey = String(b.properties?.managed_service_key ?? b.name ?? "");
      const keyCmp = aKey.localeCompare(bKey);
      if (keyCmp !== 0) return keyCmp;
      return a.id.localeCompare(b.id);
    });

    sortedManaged.forEach((managedComponent, index) => {
      const managedNode = nodeById.get(managedComponent.id);
      if (!managedNode) return;
      managedNode.position = {
        x: providerNode.position.x + MANAGED_NODE_X_OFFSET,
        y:
          providerNode.position.y +
          MANAGED_NODE_Y_BASE_OFFSET +
          index * MANAGED_NODE_Y_STEP,
      };
    });
  }
}
