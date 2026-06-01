import { INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT } from "../../classifier/application-injection";
import { isTerraformModuleCallShellAsset } from "../../classifier/main-application-selection";
import {
  hasTerraformAddress,
  isTerraformProviderComponent,
  trimTerraformAddress,
} from "../terraform/component-predicates";
import type { DetectedComponent } from "../types/component";
import type { DataFlowType, DetectedDataFlow } from "../types/data-flow";
import type { ScanResult } from "../types/result";
import {
  applyMixedAppTerraformScanResult,
  isMixedAppTerraformScan,
  shouldKeepComponentInMixedAppTerraformScan,
} from "./mixed-app-terraform-scan";
import {
  findPrimaryTerraformProvider,
  hasDirectedFlow,
  nextSyntheticFlowId,
} from "./terraform-flow-utils";

export {
  applyMixedAppTerraformScanResult,
  isMixedAppTerraformScan,
  shouldKeepComponentInMixedAppTerraformScan,
};

const ECS_MODULE_ADDRESS = /^module\.ecs_[^.]+$/;

/**
 * Minimal service view is only for IaC-primary scans; mixed app+Terraform repos
 * use {@link applyMixedAppTerraformScanResult} instead of the full resource graph.
 */
export function isTerraformPrimaryScan(components: DetectedComponent[]): boolean {
  const hasTf = components.some(hasTerraformAddress);
  if (!hasTf) return false;
  if (isMixedAppTerraformScan(components)) return false;

  return !components.some(
    (c) =>
      c.type === "asset" &&
      !c.properties?.managed_by_provider &&
      !hasTerraformAddress(c) &&
      (c.subType === "api" || c.subType === "service"),
  );
}

function titleCaseWords(s: string): string {
  return s
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** `module.ecs_frontend` → `ECS Frontend` */
export function ecsModuleServiceLabel(terraformAddress: string): string {
  const m = /^module\.ecs_(.+)$/.exec(terraformAddress.trim());
  if (!m) return terraformAddress;
  return `ECS ${titleCaseWords(m[1].replace(/_/g, " "))}`;
}

function isEcsModuleShell(c: DetectedComponent): boolean {
  if (c.type !== "asset") return false;
  const addr = trimTerraformAddress(c);
  return addr.length > 0 && ECS_MODULE_ADDRESS.test(addr);
}

export function isManagedServiceAsset(c: DetectedComponent): boolean {
  return (
    c.type === "asset" &&
    typeof c.properties?.managed_by_provider === "string" &&
    c.properties.managed_by_provider.trim().length > 0
  );
}

function isMainApplicationLike(c: DetectedComponent): boolean {
  if (c.type !== "asset") return false;
  const inj =
    c.properties?.sourceContext === INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT;
  const main =
    c.properties?.isMainApplication === true ||
    c.properties?.isMainApplication === "true";
  return Boolean(main || inj);
}

/**
 * Layout / bucket for minimal Terraform diagram (left-to-right story).
 */
export function terraformMinimalLayoutBucket(
  c: DetectedComponent | undefined,
): "actor" | "main" | "ecs" | "provider" | "managed" | null {
  if (!c) return null;
  if (c.type === "actor") return "actor";
  if (isTerraformProviderComponent(c)) return "provider";
  if (c.type === "asset") {
    if (isManagedServiceAsset(c)) return "managed";
    if (isEcsModuleShell(c)) return "ecs";
    if (isMainApplicationLike(c)) return "main";
  }
  return null;
}

function cloneRelabeledEcsModule(c: DetectedComponent): DetectedComponent {
  const addr = trimTerraformAddress(c);
  const label = ecsModuleServiceLabel(addr);
  if (label === c.name) return c;
  return { ...c, name: label };
}

function countServiceNodes(components: DetectedComponent[]): number {
  let n = 0;
  for (const c of components) {
    if (isManagedServiceAsset(c) || isEcsModuleShell(c)) n += 1;
  }
  return n;
}

/** Diagram layout: same eligibility as {@link applyTerraformMinimalServiceScanResult}. */
export function shouldUseTerraformMinimalServiceDiagramLayout(
  components: DetectedComponent[],
): boolean {
  return isTerraformPrimaryScan(components) && countServiceNodes(components) >= 2;
}

function findPrimaryMainApp(components: DetectedComponent[]): DetectedComponent | undefined {
  const mains = components.filter(isMainApplicationLike);
  mains.sort((a, b) => a.id.localeCompare(b.id));
  return mains[0];
}

function findPrimaryActor(components: DetectedComponent[]): DetectedComponent | undefined {
  const actors = components.filter((c) => c.type === "actor");
  actors.sort((a, b) => a.id.localeCompare(b.id));
  return actors[0];
}

function flowTypeProviderToManaged(m: DetectedComponent): DataFlowType {
  const k = String(m.properties?.managed_service_key ?? "").toLowerCase();
  if (
    k.includes("postgres") ||
    k.includes("pg") ||
    k === "rds" ||
    k.includes("mysql") ||
    k.includes("sql")
  ) {
    return "database_query";
  }
  if (k === "s3" || k.includes("storage") || k.includes("bucket")) {
    return "file_transfer";
  }
  return "api_call";
}

/**
 * Ensures User → main app → (ECS shells when present) → Terraform provider hub,
 * and provider → each managed subservice, when edges were dropped or never created.
 */
export function ensureTerraformMinimalHubAndManagedFlows(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): DetectedDataFlow[] {
  const next = [...flows];
  const actor = findPrimaryActor(components);
  const main = findPrimaryMainApp(components);
  const provider = findPrimaryTerraformProvider(components);
  const managed = components.filter(isManagedServiceAsset);

  const push = (sourceId: string, targetId: string, type: DataFlowType): void => {
    if (hasDirectedFlow(next, sourceId, targetId)) return;
    next.push({
      id: nextSyntheticFlowId(next),
      sourceComponentId: sourceId,
      targetComponentId: targetId,
      type,
      confidence: 0.72,
      description: "terraform_minimal_service_hub",
    });
  };

  if (actor && main) {
    push(actor.id, main.id, "api_call");
  }

  const ecsShells = components.filter(isEcsModuleShell);
  ecsShells.sort((a, b) => a.id.localeCompare(b.id));

  if (main && ecsShells.length > 0) {
    for (const ecs of ecsShells) {
      push(main.id, ecs.id, "api_call");
    }
    if (provider) {
      for (const ecs of ecsShells) {
        push(ecs.id, provider.id, "api_call");
      }
    }
  } else if (main && provider) {
    push(main.id, provider.id, "api_call");
  }

  if (provider) {
    for (const m of managed) {
      const mp = m.properties?.managed_by_provider;
      if (typeof mp !== "string" || mp.trim() !== provider.id) continue;
      push(provider.id, m.id, flowTypeProviderToManaged(m));
    }
  }

  return next;
}

function dropRedundantDirectMainToPrimaryProviderWhenEcsHub(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): DetectedDataFlow[] {
  const ecsShells = components.filter(isEcsModuleShell);
  if (ecsShells.length === 0) return flows;

  const main = findPrimaryMainApp(components);
  const provider = findPrimaryTerraformProvider(components);
  if (!main || !provider) return flows;

  return flows.filter(
    (f) =>
      !(
        f.sourceComponentId === main.id &&
        f.targetComponentId === provider.id
      ),
  );
}

/**
 * For {@link isTerraformPrimaryScan} with at least two ECS/managed service nodes,
 * shrink components and flows to **User**, **main application**, **Terraform
 * `provider.*` hub**, **managed service nodes**, and **`module.ecs_*`** workload
 * shells. Otherwise returns `scanResult` unchanged.
 */
export function applyTerraformMinimalServiceScanResult(
  scanResult: ScanResult,
): ScanResult {
  const mixedReduced = applyMixedAppTerraformScanResult(scanResult);
  if (!isTerraformPrimaryScan(mixedReduced.components)) return mixedReduced;

  if (countServiceNodes(mixedReduced.components) < 2) return mixedReduced;

  const keptIds = new Set<string>();
  for (const c of mixedReduced.components) {
    if (c.type === "actor") keptIds.add(c.id);
    if (isTerraformProviderComponent(c)) keptIds.add(c.id);
    if (isMainApplicationLike(c)) keptIds.add(c.id);
    if (isManagedServiceAsset(c) || isEcsModuleShell(c)) keptIds.add(c.id);
  }

  const components = mixedReduced.components
    .filter((c) => keptIds.has(c.id))
    .map((c) => (isEcsModuleShell(c) ? cloneRelabeledEcsModule(c) : c));

  let flows = mixedReduced.dataFlows.filter(
    (f) => keptIds.has(f.sourceComponentId) && keptIds.has(f.targetComponentId),
  );

  flows = ensureTerraformMinimalHubAndManagedFlows(components, flows);
  flows = dropRedundantDirectMainToPrimaryProviderWhenEcsHub(components, flows);

  return {
    ...mixedReduced,
    components,
    dataFlows: flows,
  };
}
