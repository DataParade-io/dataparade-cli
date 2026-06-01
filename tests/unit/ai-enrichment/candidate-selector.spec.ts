import { selectInferenceCandidates } from "../../../src/ai-enrichment/candidate-selector";
import type { DetectedComponent } from "../../../src/core/types/component";
import type { ServiceSection } from "../../../src/core/sectioning/discover-service-sections";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";

describe("ai-enrichment candidate selector", () => {
  it("selects third-party, sparse property, flow direction, and missing interaction candidates", () => {
    const sections: ServiceSection[] = [
      {
        id: "frontend",
        label: "frontend",
        role: "service",
        sectionDir: "frontend",
        manifestPaths: ["frontend/package.json"],
      },
      {
        id: "backend",
        label: "backend",
        role: "service",
        sectionDir: "backend",
        manifestPaths: ["backend/package.json"],
      },
    ];

    const components: DetectedComponent[] = [
      {
        id: "tp_1",
        name: "Stripe",
        type: "third_party",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "backend", dpa_signed: null },
      },
      {
        id: "app_1",
        name: "Backend",
        type: "asset",
        confidence: 0.95,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "backend", encryption_at_rest: null },
      },
      {
        id: "actor_1",
        name: "Customer",
        type: "actor",
        confidence: 0.7,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "frontend" },
      },
    ];

    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "app_1",
        targetComponentId: "actor_1",
        type: "api_call",
        confidence: 0.6,
      },
    ];

    const candidates = selectInferenceCandidates({ components, dataFlows: flows, sections });
    const candidateTypes = candidates.map((candidate) => candidate.candidateType);

    expect(candidateTypes).toContain("third_party");
    expect(candidateTypes).toContain("node_property");
    expect(candidateTypes).toContain("flow_direction");
    expect(candidateTypes).toContain("missing_interaction");
  });

  it("third_party_only returns one third_party candidate per third-party and skips assets", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_a",
        name: "Stripe",
        type: "third_party",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "backend", subType: "payments" },
      },
      {
        id: "tp_b",
        name: "Sentry",
        type: "third_party",
        confidence: 0.85,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "backend" },
      },
      {
        id: "app_1",
        name: "API",
        type: "asset",
        confidence: 0.95,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "backend", encryption_at_rest: null },
      },
    ];

    const candidates = selectInferenceCandidates({
      components,
      dataFlows: [],
      inferenceScope: "third_party_only",
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.candidateType === "third_party")).toBe(
      true,
    );
    expect(new Set(candidates.map((c) => c.componentId))).toEqual(
      new Set(["tp_a", "tp_b"]),
    );
  });
});
