import type { DetectedComponent } from "../../../src/core/types/component";
import { ensureMainToUnlinkedSectionApiFlows } from "../../../src/data-flow/ensure-section-api-flows";

function comp(
  partial: Partial<DetectedComponent> & Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return {
    subType: partial.subType,
    confidence: 0.9,
    detectedFrom: [],
    sourceLocations: [],
    properties: partial.properties ?? {},
    ...partial,
  };
}

describe("ensure-section-api-flows", () => {
  it("links main app to orphan API asset in the same section", () => {
    const components: DetectedComponent[] = [
      comp({
        id: "main_1",
        name: "twenty-apps",
        type: "asset",
        subType: "service",
        properties: {
          isMainApplication: true,
          section_id: "packages/twenty-apps",
        },
      }),
      comp({
        id: "api_1",
        name: "twenty-apps API",
        type: "asset",
        subType: "api",
        properties: { section_id: "packages/twenty-apps" },
      }),
    ];

    const flows = ensureMainToUnlinkedSectionApiFlows(components, []);
    expect(flows).toHaveLength(1);
    expect(flows[0].sourceComponentId).toBe("main_1");
    expect(flows[0].targetComponentId).toBe("api_1");
  });
});
