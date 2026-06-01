import { isTerraformModuleCallShellAsset } from "../../classifier/main-application-selection";
import { isTerraformProviderComponent, trimTerraformAddress } from "../terraform/component-predicates";
import type { DetectedComponent } from "../types/component";
import type { DetectedDataFlow } from "../types/data-flow";

export function findPrimaryTerraformProvider(
  components: DetectedComponent[],
): DetectedComponent | undefined {
  const aws = components.find(
    (c) => c.type === "third_party" && trimTerraformAddress(c) === "provider.aws",
  );
  if (aws) return aws;
  return components.find((c) => isTerraformProviderComponent(c));
}

export function hasDirectedFlow(
  flows: DetectedDataFlow[],
  sourceId: string,
  targetId: string,
): boolean {
  return flows.some(
    (f) => f.sourceComponentId === sourceId && f.targetComponentId === targetId,
  );
}

export function nextSyntheticFlowId(flows: DetectedDataFlow[]): string {
  let max = 0;
  for (const f of flows) {
    const m = /^flow_(\d+)$/.exec(f.id);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
    const m2 = /^flow_minimal_(\d+)$/.exec(f.id);
    if (m2) max = Math.max(max, Number.parseInt(m2[1], 10));
  }
  return `flow_minimal_${max + 1}`;
}

export function listTerraformModuleShells(
  components: DetectedComponent[],
): DetectedComponent[] {
  return components.filter(isTerraformModuleCallShellAsset);
}
