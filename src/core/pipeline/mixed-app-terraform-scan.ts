import { isTerraformModuleCallShellAsset } from "../../classifier/main-application-selection";
import { getSectionIdFromProperties } from "../../classifier/sectioning";
import {
  hasNonTerraformAppSignals,
  hasTerraformAddress,
  isRootLikeSectionId,
  isTerraformProviderComponent,
} from "../terraform/component-predicates";
import { isTerraformStackSection } from "../sectioning/section-runtime";
import type { DetectedComponent } from "../types/component";
import type { DetectedDataFlow } from "../types/data-flow";
import type { ScanResult } from "../types/result";
import {
  findPrimaryTerraformProvider,
  hasDirectedFlow,
  listTerraformModuleShells,
  nextSyntheticFlowId,
} from "./terraform-flow-utils";

function isDeployableAppAssetOutsideTerraformStack(
  component: DetectedComponent,
): boolean {
  if (component.type !== "asset" || hasTerraformAddress(component)) return false;
  const sub = component.subType;
  if (sub !== "api" && sub !== "service" && sub !== "application") {
    return false;
  }
  const sid = getSectionIdFromProperties(component.properties);
  if (isTerraformStackSection({ id: sid, sectionDir: sid })) {
    return false;
  }
  if (isRootLikeSectionId(sid)) {
    return hasNonTerraformAppSignals(component);
  }
  return true;
}

/**
 * Repo has deployable application code outside the Terraform stack (monorepo apps).
 */
export function isMixedAppTerraformScan(components: DetectedComponent[]): boolean {
  if (!components.some(hasTerraformAddress)) return false;
  return components.some(isDeployableAppAssetOutsideTerraformStack);
}

/** In mixed scans, keep app nodes plus Terraform provider hub and module call shells only. */
export function shouldKeepComponentInMixedAppTerraformScan(
  component: DetectedComponent,
): boolean {
  if (!hasTerraformAddress(component)) return true;
  if (isTerraformProviderComponent(component)) return true;
  if (isTerraformModuleCallShellAsset(component)) return true;
  return false;
}

function ensureMixedAppTerraformProviderToModuleShellFlows(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): DetectedDataFlow[] {
  const provider = findPrimaryTerraformProvider(components);
  const shells = listTerraformModuleShells(components);
  if (!provider || shells.length === 0) return flows;

  const next = [...flows];
  shells.sort((a, b) => a.id.localeCompare(b.id));

  const push = (sourceId: string, targetId: string): void => {
    if (hasDirectedFlow(next, sourceId, targetId)) return;
    next.push({
      id: nextSyntheticFlowId(next),
      sourceComponentId: sourceId,
      targetComponentId: targetId,
      type: "api_call",
      confidence: 0.72,
      description: "mixed_app_terraform_module_shell",
    });
  };

  for (const shell of shells) {
    push(provider.id, shell.id);
  }

  return next;
}

/**
 * When application packages and a Terraform stack coexist, drop per-resource
 * Terraform nodes (VPC subnets, RDS instances, etc.) and keep provider + module shells.
 */
export function applyMixedAppTerraformScanResult(
  scanResult: ScanResult,
): ScanResult {
  if (!isMixedAppTerraformScan(scanResult.components)) return scanResult;

  const components = scanResult.components.filter(
    shouldKeepComponentInMixedAppTerraformScan,
  );
  const keptIds = new Set(components.map((c) => c.id));

  let flows = scanResult.dataFlows.filter(
    (f) => keptIds.has(f.sourceComponentId) && keptIds.has(f.targetComponentId),
  );
  flows = ensureMixedAppTerraformProviderToModuleShellFlows(components, flows);

  return { ...scanResult, components, dataFlows: flows };
}
