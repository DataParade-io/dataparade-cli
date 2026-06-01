import { runInferencePipeline } from "../../../src/ai-enrichment/pipeline";
import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";

function baseComponents(): DetectedComponent[] {
  return [
    {
      id: "actor_1",
      name: "Customer",
      type: "actor",
      confidence: 0.8,
      detectedFrom: [],
      sourceLocations: [],
      properties: { section_id: "frontend" },
    },
    {
      id: "asset_1",
      name: "Backend",
      type: "asset",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [],
      properties: { section_id: "backend", encryption_at_rest: null },
    },
  ];
}

function baseFlows(): DetectedDataFlow[] {
  return [
    {
      id: "flow_1",
      sourceComponentId: "asset_1",
      targetComponentId: "actor_1",
      type: "api_call",
      confidence: 0.7,
    },
  ];
}

describe("ai-enrichment pipeline", () => {
  it("returns dry-run merge output when no proposal generator is supplied", async () => {
    const result = await runInferencePipeline({
      components: baseComponents(),
      dataFlows: baseFlows(),
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.mergeResult.appliedProposalIds).toEqual([]);
    expect(result.mergeResult.components[1]?.properties.encryption_at_rest).toBeNull();
  });

  it("applies generated proposals through merge rules", async () => {
    const result = await runInferencePipeline(
      {
        components: baseComponents(),
        dataFlows: baseFlows(),
      },
      {
        generateProposals: async () => ({
          proposals: [
            {
              id: "p1",
              proposal: {
                kind: "component_patch",
                targetComponentId: "asset_1",
                candidateType: "node_property",
                setProperties: { encryption_at_rest: true },
                confidence: { score: 0.92, band: "high" },
                evidence: [
                  {
                    filePath: "backend/src/db.ts",
                    startLine: 1,
                    endLine: 8,
                    reason: "database encryption enabled",
                  },
                ],
                provider: "openai",
                model: "x",
                agent: "propertyAgent",
              },
            },
          ],
        }),
      },
    );

    const backend = result.mergeResult.components.find((c) => c.id === "asset_1");
    expect(backend?.properties.encryption_at_rest).toBe(true);
    expect(result.mergeResult.appliedProposalIds).toEqual(["p1"]);
  });

  it("does not apply cross-section flow_patch proposals (intra-section gate)", async () => {
    const flows = baseFlows();
    const result = await runInferencePipeline(
      {
        components: baseComponents(),
        dataFlows: flows,
      },
      {
        generateProposals: async () => ({
          proposals: [
            {
              id: "fp1",
              proposal: {
                kind: "flow_patch",
                candidateType: "missing_interaction",
                insertIfMissing: true,
                sourceComponentId: "actor_1",
                targetComponentId: "asset_1",
                setType: "api_call",
                confidence: { score: 0.95, band: "high" },
                evidence: [
                  {
                    filePath: "x.ts",
                    startLine: 1,
                    endLine: 2,
                    reason: "test",
                  },
                ],
                provider: "openai",
                model: "x",
                agent: "interactionAgent",
              },
            },
          ],
        }),
      },
    );

    expect(result.mergeResult.appliedProposalIds).toEqual([]);
    expect(
      result.mergeResult.rejectedProposalIds.some(
        (r) => r.reason === "cross_section_flow_change_blocked",
      ),
    ).toBe(true);
    expect(result.mergeResult.dataFlows).toEqual(flows);
  });
});
