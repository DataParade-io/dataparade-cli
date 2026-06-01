import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import { findTerraformProviderForResourceAsset } from "./terraform-flows";
import { findApplicationHubForFlows } from "./application-hub";
import { INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT } from "../classifier/application-injection";

function resolveSyntheticMainTerraformEdgeTarget(
  componentById: Map<string, DetectedComponent>,
  components: DetectedComponent[],
  appId: string,
  originalTargetId: string,
): string {
  const app = componentById.get(appId);
  const target = componentById.get(originalTargetId);
  if (!app || app.properties?.sourceContext !== INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT) {
    return originalTargetId;
  }
  if (
    !target ||
    target.type !== "asset" ||
    typeof target.properties?.terraform_address !== "string" ||
    !target.properties.terraform_address.trim()
  ) {
    return originalTargetId;
  }
  const prov = findTerraformProviderForResourceAsset(components, target);
  if (!prov || prov.id === originalTargetId) return originalTargetId;
  return prov.id;
}

/**
 * Rewires data flows so that actor → (asset | third_party) edges go through the
 * main Application node: actor → Application and Application → target.
 * Flows that already involve the Application or are not actor→infra are unchanged.
 * Call this after flow detection and dedupe so the emitted dataflow.json reflects
 * the desired topology (actors → Application → databases / third parties).
 */
export function rewireFlowsThroughApplication(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): DetectedDataFlow[] {
  const defaultApp = findApplicationHubForFlows(components);
  if (!defaultApp) return flows;

  const componentById = new Map(components.map((c) => [c.id, c]));

  const result: DetectedDataFlow[] = [];
  const infraTargetsNeedingAppEdgeByAppId = new Map<string, Set<string>>();
  let syntheticIndex = 0;

  for (const flow of flows) {
    const sourceComp = componentById.get(flow.sourceComponentId);
    const targetComp = componentById.get(flow.targetComponentId);

    if (!sourceComp || !targetComp) {
      result.push(flow);
      continue;
    }

    const isActorSource = sourceComp.type === "actor";
    const isInfraTarget =
      targetComp.type === "asset" || targetComp.type === "third_party";

    if (isActorSource && isInfraTarget) {
      // This branch becomes reachable only when actor→infra edges exist.
      // Choose the right app for the actor's section.
      const actorSectionId = String(sourceComp.properties?.section_id ?? "");
      const app =
        findApplicationHubForFlows(components, actorSectionId) ?? defaultApp;

      if (flow.targetComponentId !== app.id) {
        result.push({
          ...flow,
          targetComponentId: app.id,
        });
        const set =
          infraTargetsNeedingAppEdgeByAppId.get(app.id) ?? new Set<string>();
        set.add(flow.targetComponentId);
        infraTargetsNeedingAppEdgeByAppId.set(app.id, set);
      } else {
        result.push(flow);
      }
    } else {
      result.push(flow);
    }
  }

  const existingApiCallOutKeys = new Set(
    result
      .filter((f) => f.type === "api_call")
      .map((f) => `${f.sourceComponentId}\t${f.targetComponentId}\t${f.type}`),
  );

  const stableInfraTargetsEntries = Array.from(
    infraTargetsNeedingAppEdgeByAppId.entries(),
  ).sort(([a], [b]) => a.localeCompare(b));

  for (const [appId, targetIds] of stableInfraTargetsEntries) {
    const stableTargetIds = Array.from(targetIds).sort((a, b) =>
      a.localeCompare(b),
    );
    for (const targetId of stableTargetIds) {
      const resolvedTargetId = resolveSyntheticMainTerraformEdgeTarget(
        componentById,
        components,
        appId,
        targetId,
      );
      const key = `${appId}\t${resolvedTargetId}\tapi_call`;
      if (existingApiCallOutKeys.has(key)) continue;
      existingApiCallOutKeys.add(key);

      syntheticIndex += 1;
      result.push({
        id: `flow_app_${syntheticIndex}`,
        sourceComponentId: appId,
        targetComponentId: resolvedTargetId,
        type: "api_call",
        confidence: 0.8,
      });
    }
  }

  return result;
}
