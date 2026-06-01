import { computeEvalScores } from "../../../src/evals/metrics";
import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";

describe("eval metrics", () => {
  it("computes property and interaction KPIs", () => {
    const components: DetectedComponent[] = [
      {
        id: "front",
        name: "Frontend",
        type: "asset",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "frontend",
          encryption_at_rest: null,
          authentication_methods: [],
          gdpr_role: null,
        },
      },
      {
        id: "back",
        name: "Backend",
        type: "asset",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "backend",
          encryption_at_rest: true,
          authentication_methods: ["jwt"],
          gdpr_role: "processor",
        },
      },
    ];

    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "front",
        targetComponentId: "back",
        type: "api_call",
        confidence: 0.9,
      },
    ];

    const scores = computeEvalScores({
      components,
      dataFlows: flows,
      expectedCrossSectionLinks: [{ sourceSection: "frontend", targetSection: "backend" }],
    });

    expect(scores.nodePropertyFillRate).toBeGreaterThan(0);
    expect(scores.tieredPropertyCompleteness).toBeGreaterThan(0);
    expect(scores.interactionRecall).toBe(1);
  });
});

