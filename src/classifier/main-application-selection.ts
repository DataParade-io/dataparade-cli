import type { DetectedComponent } from "../core/types/component";
import { isTerraformUtilityResourceType } from "../analyzers/terraform/terraform-utility-resource";
import { loadPropertyDetectionConfig } from "../config/property-detection-config";
import {
  PREFERRED_WEB_APP_FRAMEWORKS,
  SERVER_FRAMEWORK_HINTS,
} from "../patterns/frontend-frameworks";

export { PREFERRED_WEB_APP_FRAMEWORKS };

/**
 * Thin / single-endpoint API surfaces that should not be treated as the primary
 * application hub (e.g. one handler named "POST /foo").
 */
export function isSingleRouteApiAsset(component: DetectedComponent): boolean {
  if (component.type !== "asset" || component.subType !== "api") {
    return false;
  }

  const name = (component.name || "").trim();
  if (!name) return false;

  const lower = name.toLowerCase();

  if (lower === "route handler") {
    return true;
  }

  if (lower.startsWith("nest_controller")) {
    return true;
  }

  if (/^(get|post|put|delete|patch|options|head)\s+/.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Outbound HTTP client calls to absolute URLs (e.g. fetch("https://api.vendor/..."))
 * classified as api assets — not the project's own HTTP API surface.
 */
export function isOutboundExternalHttpApiAsset(
  component: DetectedComponent,
): boolean {
  if (component.type !== "asset" || component.subType !== "api") {
    return false;
  }

  const url =
    typeof component.properties?.url === "string"
      ? component.properties.url.trim()
      : "";
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }

  const fw = component.properties?.framework;
  if (typeof fw === "string" && fw.trim().length > 0) {
    return false;
  }

  return true;
}

/**
 * Terraform resources from utility providers (names, time sleeps, etc.) are not
 * application entrypoints; they should not win isMainApplication when that is
 * the only "application" subtype asset in a section.
 */
export function isTerraformUtilityInfrastructureAsset(
  component: DetectedComponent,
): boolean {
  const rt = component.properties?.resource_type;
  if (typeof rt !== "string" || !rt.trim()) return false;
  return isTerraformUtilityResourceType(rt);
}

/** Exact Terraform resource types that must never win "main application" in IaC scans. */
const TERRAFORM_STRUCTURAL_RESOURCE_TYPES = new Set<string>([
  "aws_vpc",
  "aws_subnet",
  "aws_default_subnet",
  "aws_default_vpc",
  "aws_default_network_acl",
  "aws_default_route_table",
  "aws_default_security_group",
  "aws_internet_gateway",
  "aws_egress_only_internet_gateway",
  "aws_nat_gateway",
  "aws_route_table",
  "aws_route",
  "aws_network_acl",
  "aws_security_group",
  "aws_network_interface",
  "aws_vpc_endpoint",
  "aws_vpc_peering_connection",
  "aws_flow_log",
  "aws_db_subnet_group",
  "aws_elasticache_subnet_group",
  "aws_cloudwatch_log_group",
  "aws_cloudwatch_log_stream",
  "aws_ecs_cluster",
  "aws_ecs_task_definition",
  "aws_lb_target_group",
  "aws_alb_target_group",
  "aws_lb_listener",
  "aws_alb_listener",
  "aws_lb",
  "aws_alb",
  "aws_appautoscaling_target",
  "aws_appautoscaling_policy",
  "aws_db_instance",
  "aws_rds_cluster",
  "aws_rds_cluster_instance",
]);

const TERRAFORM_STRUCTURAL_RESOURCE_PREFIXES = [
  "aws_iam_",
  "aws_default_",
] as const;

/**
 * Networking / IAM / orchestration / data-plane stores from Terraform should not
 * become the product "main app" when no real service code exists — use the injected
 * placeholder instead.
 */
export function isTerraformStructuralInfrastructureAsset(
  component: DetectedComponent,
): boolean {
  const rt = component.properties?.resource_type;
  if (typeof rt !== "string" || !rt.trim()) return false;
  const t = rt.trim().toLowerCase();
  if (TERRAFORM_STRUCTURAL_RESOURCE_TYPES.has(t)) return true;
  return TERRAFORM_STRUCTURAL_RESOURCE_PREFIXES.some((p) => t.startsWith(p));
}

/**
 * Terraform resource/data blocks in the diagram are infrastructure, not the
 * product application hub (e.g. `kubernetes_deployment.*`, `aws_s3_bucket.*`).
 */
export function isTerraformGraphResourceAsset(
  component: DetectedComponent,
): boolean {
  if (component.type !== "asset") return false;
  const addr = component.properties?.terraform_address;
  if (typeof addr !== "string" || !addr.trim()) return false;
  return !addr.trim().startsWith("provider.");
}

/**
 * `module.vpc` / `module.frontend` call shells: not the product application.
 */
export function isTerraformModuleCallShellAsset(
  component: DetectedComponent,
): boolean {
  if (component.type !== "asset") return false;
  const addr = component.properties?.terraform_address;
  if (typeof addr !== "string" || !addr.trim() || !addr.startsWith("module.")) {
    return false;
  }
  const rt = component.properties?.resource_type;
  if (typeof rt === "string" && rt.trim() && rt.trim() !== "unknown") {
    return false;
  }
  return true;
}

export function isExcludedFromMainApplicationHub(
  component: DetectedComponent,
): boolean {
  return (
    isSingleRouteApiAsset(component) ||
    isOutboundExternalHttpApiAsset(component) ||
    isTerraformGraphResourceAsset(component) ||
    isTerraformUtilityInfrastructureAsset(component) ||
    isTerraformStructuralInfrastructureAsset(component) ||
    isTerraformModuleCallShellAsset(component)
  );
}

function getFrameworkPriorityForMainSelection(
  component: DetectedComponent,
): number {
  const value = component.properties.framework;
  const frameworks: string[] = [];

  if (typeof value === "string") {
    frameworks.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string") {
        frameworks.push(v);
      }
    }
  }

  if (frameworks.length === 0) return 100;

  let best = 100;
  for (const raw of frameworks) {
    const fw = raw.toLowerCase();
    if (PREFERRED_WEB_APP_FRAMEWORKS.has(fw)) {
      best = Math.min(best, 0);
    } else if (SERVER_FRAMEWORK_HINTS.has(fw)) {
      best = Math.min(best, 1);
    } else {
      best = Math.min(best, 2);
    }
  }

  return best;
}

/**
 * Index of the asset that should be the main application hub, or -1 if none.
 * Uses the same rules as enhanceComponents (subtype allowlist, exclusions, then
 * framework priority).
 */
export function pickMainApplicationAssetIndex(
  components: DetectedComponent[],
): number {
  const { mainAppSubtypes } = loadPropertyDetectionConfig().enhance;

  const candidates: { index: number; frameworkPriority: number }[] = [];

  for (let i = 0; i < components.length; i++) {
    const c = components[i];
    if (
      c.type === "asset" &&
      c.subType !== undefined &&
      mainAppSubtypes.has(c.subType) &&
      !isExcludedFromMainApplicationHub(c)
    ) {
      candidates.push({
        index: i,
        frameworkPriority: getFrameworkPriorityForMainSelection(c),
      });
    }
  }

  if (candidates.length === 0) {
    return -1;
  }

  candidates.sort((a, b) => {
    if (a.frameworkPriority !== b.frameworkPriority) {
      return a.frameworkPriority - b.frameworkPriority;
    }
    return a.index - b.index;
  });

  return candidates[0].index;
}
