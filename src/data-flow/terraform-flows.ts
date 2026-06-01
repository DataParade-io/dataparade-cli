import type { DetectedComponent } from "../core/types/component";
import type { DataFlowType, DetectedDataFlow } from "../core/types/data-flow";
import type { RawFinding } from "../core/types/detection";
import { buildFlow } from "./flow-builder";

function flowTypeForTerraformTarget(
  target: DetectedComponent | undefined,
): DataFlowType {
  const st = target?.subType?.toLowerCase();
  if (st === "database") return "database_query";
  if (st === "queue") return "message_queue";
  return "api_call";
}

/**
 * Terraform HCL references point from the dependent block to dependencies.
 * For most edges we want **provision / data-supply direction**: referenced
 * resource → block that consumes it (matches apply order and typical
 * "infrastructure feeds this resource" reading).
 *
 * **Exception:** `database_query` keeps **caller → database** (the
 * referencing workload initiates queries toward the DB).
 */
function terraformReferenceFlowEndpoints(
  referrer: DetectedComponent,
  refd: DetectedComponent,
  flowType: DataFlowType,
): { source: DetectedComponent; target: DetectedComponent } {
  if (flowType === "database_query") {
    return { source: referrer, target: refd };
  }
  return { source: refd, target: referrer };
}

function syntheticTerraformFinding(
  source: DetectedComponent,
): RawFinding {
  const loc = source.sourceLocations?.[0] ?? {
    filePath: "terraform",
    startLine: 1,
    endLine: 1,
  };
  return {
    pattern: "terraform_resource",
    name: "terraform_reference",
    confidence: 0.85,
    location: loc,
    properties: {},
  };
}

/**
 * Infer edges between Terraform-managed assets from `terraform_references`
 * merged onto components (see Terraform detector).
 */
export function appendTerraformDataFlows(
  components: DetectedComponent[],
  startIndex: number,
): { flows: DetectedDataFlow[]; nextIndex: number } {
  const flows: DetectedDataFlow[] = [];
  let flowIndex = startIndex;

  const addressToComponent = new Map<string, DetectedComponent>();
  for (const c of components) {
    const addr = c.properties?.terraform_address;
    if (typeof addr === "string" && addr.trim()) {
      addressToComponent.set(addr.trim(), c);
    }
  }

  const seen = new Set<string>();

  for (const component of components) {
    const sourceAddr = component.properties?.terraform_address;
    if (typeof sourceAddr !== "string" || !sourceAddr.trim()) continue;

    const rawRefs = component.properties?.terraform_references;
    if (!Array.isArray(rawRefs) || rawRefs.length === 0) continue;

    const refs = rawRefs.filter((r): r is string => typeof r === "string");

    for (const ref of refs) {
      const target = addressToComponent.get(ref);
      if (!target || target.id === component.id) continue;

      const flowType = flowTypeForTerraformTarget(target);
      const { source, target: dest } = terraformReferenceFlowEndpoints(
        component,
        target,
        flowType,
      );
      const key = `${source.id}::${dest.id}::${flowType}`;
      if (seen.has(key)) continue;
      seen.add(key);

      flowIndex += 1;
      const finding = syntheticTerraformFinding(source);
      flows.push(
        buildFlow(
          source.id,
          dest.id,
          flowType,
          finding,
          flowIndex,
          source,
          dest,
        ),
      );
    }
  }

  return { flows, nextIndex: flowIndex };
}

export function terraformProviderLocalNameFromResourceType(
  resourceType: string,
): string | undefined {
  const rt = resourceType.trim().toLowerCase();
  const idx = rt.indexOf("_");
  if (idx <= 0) return undefined;
  return rt.slice(0, idx);
}

/**
 * Resolves the `provider.<local>` third_party for a Terraform-managed asset
 * (e.g. `aws_s3_bucket.*` → `provider.aws`).
 */
export function findTerraformProviderForResourceAsset(
  components: DetectedComponent[],
  asset: DetectedComponent,
): DetectedComponent | undefined {
  if (asset.type !== "asset") return undefined;
  const rt = asset.properties?.resource_type;
  if (typeof rt !== "string" || !rt.includes("_")) return undefined;
  const localName = terraformProviderLocalNameFromResourceType(rt);
  if (!localName) return undefined;
  const wantAddr = `provider.${localName}`;
  return components.find(
    (c) =>
      c.type === "third_party" &&
      typeof c.properties?.terraform_address === "string" &&
      c.properties.terraform_address.trim() === wantAddr,
  );
}

/**
 * Same role as the former `appendTerraformProviderAttachmentFlows`, but runs
 * from {@link applyDeterministicInferenceFallbacks} **after** provider-topology
 * managed nodes (so flow types / dedupe match the TypeScript path). Skips
 * assets already tagged with `managed_by_provider` and skips pairs already in
 * `pairKeys` (e.g. provider → resource edges emitted as `file_transfer`).
 *
 * Skips resources declared under a `module.*` address so the provider node does
 * not fan out to every nested resource (references / topology already link the
 * graph).
 */
export function appendTerraformBareProviderAttachmentFlows(input: {
  components: DetectedComponent[];
  flows: DetectedDataFlow[];
  pairKeys: Set<string>;
}): void {
  const byAddr = new Map<string, DetectedComponent>();
  for (const c of input.components) {
    const a = c.properties?.terraform_address;
    if (typeof a === "string" && a.trim()) {
      byAddr.set(a.trim(), c);
    }
  }

  for (const c of input.components) {
    if (c.type !== "asset") continue;
    if (typeof c.properties?.managed_by_provider === "string") continue;

    const rt = c.properties?.resource_type;
    if (typeof rt !== "string" || !rt.includes("_")) continue;

    const addrRaw = c.properties?.terraform_address;
    if (
      typeof addrRaw === "string" &&
      addrRaw.startsWith("module.") &&
      addrRaw.split(".").length > 2
    ) {
      continue;
    }

    const localName = terraformProviderLocalNameFromResourceType(rt);
    if (!localName) continue;

    const prov = byAddr.get(`provider.${localName}`);
    if (!prov || prov.type !== "third_party") continue;
    if (prov.id === c.id) continue;

    const pairKey = `${prov.id}::${c.id}`;
    if (input.pairKeys.has(pairKey)) continue;

    input.pairKeys.add(pairKey);
    const loc = c.sourceLocations?.[0] ?? {
      filePath: "terraform",
      startLine: 1,
      endLine: 1,
    };
    input.flows.push({
      id: `flow_fallback_${input.flows.length + 1}`,
      sourceComponentId: prov.id,
      targetComponentId: c.id,
      type: "api_call",
      confidence: 0.72,
      sourceLocation: loc,
      description: `${prov.name} terraform provider attachment (${String(c.properties?.terraform_address ?? "")})`,
    });
  }
}
