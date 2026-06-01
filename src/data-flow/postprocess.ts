import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import { dedupeDataFlows } from "./dedupe";
import { rewireFlowsThroughApplication } from "./rewire";
import { dropCrossSectionServiceFlows } from "./drop-cross-section-flows";
import { ensureActorToAppFlow, ensureInjectedProjectMainToTerraformProviderHub } from "./ensure-actor-flow";
import { ensureManifestDeclaredThirdPartyFlows } from "./ensure-manifest-declared-flows";
import { ensureMainToUnlinkedSectionApiFlows } from "./ensure-section-api-flows";

function getSectionId(component: DetectedComponent | undefined): string {
  const sid = component?.properties?.section_id;
  return typeof sid === "string" ? sid : "";
}

function isMainApp(component: DetectedComponent | undefined): boolean {
  return (
    component?.type === "asset" &&
    (component.properties?.isMainApplication === true ||
      component.properties?.isMainApplication === "true")
  );
}

function isSectionApiNode(component: DetectedComponent | undefined): boolean {
  return (
    component?.type === "asset" &&
    component?.subType === "api" &&
    (component.properties?.isSectionApiNode === true ||
      component.properties?.isSectionApiNode === "true")
  );
}

function collapseSectionApiDuplicateOutboundFlows(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): DetectedDataFlow[] {
  const componentById = new Map(components.map((c) => [c.id, c]));
  const hasMainOutbound = new Set<string>();

  for (const flow of flows) {
    const source = componentById.get(flow.sourceComponentId);
    if (!isMainApp(source)) continue;
    const sid = getSectionId(source);
    if (!sid) continue;
    hasMainOutbound.add(`${sid}::${flow.targetComponentId}::${flow.type}`);
  }

  return flows.filter((flow) => {
    const source = componentById.get(flow.sourceComponentId);
    if (!isSectionApiNode(source)) return true;
    const sid = getSectionId(source);
    if (!sid) return true;
    const key = `${sid}::${flow.targetComponentId}::${flow.type}`;
    return !hasMainOutbound.has(key);
  });
}

/**
 * Applies structural post-processing to raw detected data flows:
 * - structural deduplication
 * - rewiring actor → infra flows through the main application
 * - ensuring at least one actor → app flow per section
 */
export function postprocessDataFlows(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): DetectedDataFlow[] {
  const deduped = dedupeDataFlows(flows);
  const rewired = rewireFlowsThroughApplication(components, deduped);
  const withoutApiDuplicates = collapseSectionApiDuplicateOutboundFlows(
    components,
    rewired,
  );
  const withActor = ensureActorToAppFlow(components, withoutApiDuplicates);
  const withTerraform = ensureInjectedProjectMainToTerraformProviderHub(
    components,
    withActor,
  );
  const withManifest = ensureManifestDeclaredThirdPartyFlows(
    components,
    withTerraform,
  );
  const withSectionApis = ensureMainToUnlinkedSectionApiFlows(
    components,
    withManifest,
  );
  return dropCrossSectionServiceFlows(components, withSectionApis);
}

