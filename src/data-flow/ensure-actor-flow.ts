import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import { INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT } from "../classifier/application-injection";
import { findTerraformPrimaryProviderHub } from "../classifier/terraform-provider-hub";
import { shouldInjectUserActorForMainApp } from "../core/sectioning/section-runtime";
import { findApplicationHubForFlows } from "./application-hub";

/**
 * Ensures at least one flow connects an actor to the main application hub.
 * When we have both a hub and actor(s) but no actor↔hub flow (e.g. because
 * the actor was injected and no pattern matched), adds actor→hub from the
 * first actor.
 */
export function ensureActorToAppFlow(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): DetectedDataFlow[] {
  const actors = components.filter((c) => c.type === "actor");
  if (actors.length === 0) return flows;

  const maxFlowNum = flows.reduce((max, f) => {
    const m = /^flow_(\d+)$/.exec(f.id);
    return m ? Math.max(max, Number.parseInt(m[1], 10)) : max;
  }, 0);

  const actorsBySection = new Map<string, DetectedComponent[]>();
  for (const actor of actors) {
    const sectionId = String(actor.properties?.section_id ?? "");
    const list = actorsBySection.get(sectionId);
    if (list) list.push(actor);
    else actorsBySection.set(sectionId, [actor]);
  }

  const synthetic: DetectedDataFlow[] = [];
  let nextFlowNum = maxFlowNum;

  const stableActorSectionEntries = Array.from(
    actorsBySection.entries(),
  ).sort(([a], [b]) => a.localeCompare(b));

  for (const [sectionId, sectionActors] of stableActorSectionEntries) {
    const app = findApplicationHubForFlows(components, sectionId);
    if (!app) continue;
    if (!shouldInjectUserActorForMainApp(app, components)) continue;

    const appId = app.id;
    const stableActors = [...sectionActors].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const actorIds = new Set(stableActors.map((a) => a.id));
    const hasActorAppFlow = flows.some(
      (f) =>
        (actorIds.has(f.sourceComponentId) && f.targetComponentId === appId) ||
        (actorIds.has(f.targetComponentId) && f.sourceComponentId === appId),
    );
    if (hasActorAppFlow) continue;

    nextFlowNum += 1;
    synthetic.push({
      id: `flow_${nextFlowNum}`,
      sourceComponentId: stableActors[0].id,
      targetComponentId: appId,
      type: "api_call",
      confidence: 0.5,
    });
  }

  return synthetic.length > 0 ? [...flows, ...synthetic] : flows;
}

/**
 * After {@link ensureActorToAppFlow}, the graph can have User → injected project
 * main with no main → cloud provider edge (rewire only adds main→provider when
 * it rewires an earlier actor→infra flow). Adds main → `provider.*` for each
 * injected placeholder main that has a matching Terraform provider in scope.
 */
export function ensureInjectedProjectMainToTerraformProviderHub(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): DetectedDataFlow[] {
  const mains = components.filter(
    (c) =>
      c.type === "asset" &&
      (c.properties?.isMainApplication === true ||
        c.properties?.isMainApplication === "true") &&
      c.properties?.sourceContext === INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
  );
  if (mains.length === 0) return flows;

  const maxFlowNum = flows.reduce((max, f) => {
    const m = /^flow_(\d+)$/.exec(f.id);
    return m ? Math.max(max, Number.parseInt(m[1], 10)) : max;
  }, 0);
  let nextFlowNum = maxFlowNum;

  const pairKeys = new Set(
    flows
      .filter((f) => f.type === "api_call")
      .map((f) => `${f.sourceComponentId}\t${f.targetComponentId}`),
  );

  const synthetic: DetectedDataFlow[] = [];
  const stableMains = [...mains].sort((a, b) => a.id.localeCompare(b.id));

  for (const main of stableMains) {
    const sid = String(main.properties?.section_id ?? "");
    const hub = findTerraformPrimaryProviderHub(components, sid);
    if (!hub) continue;

    const key = `${main.id}\t${hub.id}`;
    if (pairKeys.has(key)) continue;
    pairKeys.add(key);

    nextFlowNum += 1;
    synthetic.push({
      id: `flow_${nextFlowNum}`,
      sourceComponentId: main.id,
      targetComponentId: hub.id,
      type: "api_call",
      confidence: 0.72,
    });
  }

  return synthetic.length > 0 ? [...flows, ...synthetic] : flows;
}
