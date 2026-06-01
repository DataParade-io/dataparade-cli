import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import { isConcreteServiceSectionId } from "../core/sectioning/section-runtime";

function sectionIdOf(component: DetectedComponent | undefined): string {
  const sid = component?.properties?.section_id;
  return typeof sid === "string" ? sid.trim() : "";
}

/**
 * Drops edges between two different concrete service sections. Monorepo scans
 * should show per-package subgraphs; synthetic bridges (e.g. app → remote TF hub)
 * are not valid cross-section runtime flows.
 */
export function dropCrossSectionServiceFlows(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): DetectedDataFlow[] {
  const byId = new Map(components.map((c) => [c.id, c]));

  return flows.filter((flow) => {
    const source = byId.get(flow.sourceComponentId);
    const target = byId.get(flow.targetComponentId);
    if (!source || !target) return true;

    const sourceSection = sectionIdOf(source);
    const targetSection = sectionIdOf(target);
    if (!sourceSection || !targetSection || sourceSection === targetSection) {
      return true;
    }
    if (
      !isConcreteServiceSectionId(sourceSection) ||
      !isConcreteServiceSectionId(targetSection)
    ) {
      return true;
    }

    return false;
  });
}
