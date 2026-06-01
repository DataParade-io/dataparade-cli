import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import { dedupeDataFlows } from "../../../src/data-flow/dedupe";

function makeFlow(
  overrides: Partial<DetectedDataFlow> &
    Pick<DetectedDataFlow, "id" | "sourceComponentId" | "targetComponentId" | "type">,
): DetectedDataFlow {
  return {
    id: overrides.id,
    sourceComponentId: overrides.sourceComponentId,
    targetComponentId: overrides.targetComponentId,
    type: overrides.type,
    confidence: overrides.confidence ?? 0.5,
    sourceLocation: overrides.sourceLocation,
    sourceLocations: overrides.sourceLocations,
    description: overrides.description,
    method: overrides.method,
    endpoint: overrides.endpoint,
    dataCategories: overrides.dataCategories,
    dataSubjectCategories: overrides.dataSubjectCategories,
    processingPurpose: overrides.processingPurpose,
    actions: overrides.actions,
    transformation: overrides.transformation,
    enrichmentConfidence: overrides.enrichmentConfidence,
    enrichmentNotes: overrides.enrichmentNotes,
  };
}

describe("data-flow/dedupe - DP-P0-CLI-302", () => {
  it("merges duplicate flows by sourceComponentId, targetComponentId, and type", () => {
    const flows: DetectedDataFlow[] = [
      makeFlow({
        id: "flow_1",
        sourceComponentId: "app",
        targetComponentId: "db",
        type: "database_query",
        confidence: 0.7,
        sourceLocation: {
          filePath: "src/db.ts",
          startLine: 10,
          endLine: 12,
        },
        method: "GET",
        endpoint: "/db-1",
      }),
      makeFlow({
        id: "flow_2",
        sourceComponentId: "app",
        targetComponentId: "db",
        type: "database_query",
        confidence: 0.9,
        sourceLocation: {
          filePath: "src/db.ts",
          startLine: 20,
          endLine: 22,
        },
        method: "GET",
        endpoint: "/db-1",
      }),
    ];

    const deduped = dedupeDataFlows(flows);
    expect(deduped).toHaveLength(1);

    const [merged] = deduped;
    // Base flow selection is deterministic: highest confidence wins (tie-broken by id).
    expect(merged.id).toBe("flow_2");
    expect(merged.sourceComponentId).toBe("app");
    expect(merged.targetComponentId).toBe("db");
    expect(merged.type).toBe("database_query");
    expect(merged.confidence).toBe(0.9);

    expect(merged.sourceLocations).toBeDefined();
    expect(merged.sourceLocations!.length).toBe(2);
    const paths = merged.sourceLocations!.map((l) => l.startLine).sort((a, b) => a - b);
    expect(paths).toEqual([10, 20]);

    // Primary sourceLocation should be one of the contributing locations.
    expect(merged.sourceLocation).toBeDefined();
    expect(
      merged.sourceLocations!.some(
        (loc) =>
          loc.filePath === merged.sourceLocation!.filePath &&
          loc.startLine === merged.sourceLocation!.startLine &&
          loc.endLine === merged.sourceLocation!.endLine,
      ),
    ).toBe(true);

    // Non-location metadata should come from the base flow.
    expect(merged.method).toBe("GET");
    expect(merged.endpoint).toBe("/db-1");
  });

  it("does not merge flows with different structural keys", () => {
    const flows: DetectedDataFlow[] = [
      makeFlow({
        id: "flow_1",
        sourceComponentId: "app",
        targetComponentId: "db",
        type: "database_query",
        confidence: 0.8,
      }),
      makeFlow({
        id: "flow_2",
        sourceComponentId: "app",
        targetComponentId: "db",
        type: "api_call",
        confidence: 0.9,
      }),
      makeFlow({
        id: "flow_3",
        sourceComponentId: "app",
        targetComponentId: "cache",
        type: "database_query",
        confidence: 0.7,
      }),
    ];

    const deduped = dedupeDataFlows(flows);
    expect(deduped).toHaveLength(3);
  });

  it("preserves existing sourceLocations when present on a single flow", () => {
    const flows: DetectedDataFlow[] = [
      makeFlow({
        id: "flow_1",
        sourceComponentId: "app",
        targetComponentId: "db",
        type: "database_query",
        confidence: 0.8,
        sourceLocations: [
          {
            filePath: "src/db.ts",
            startLine: 5,
            endLine: 7,
          },
        ],
      }),
    ];

    const deduped = dedupeDataFlows(flows);
    expect(deduped).toHaveLength(1);
    const [merged] = deduped;
    expect(merged.sourceLocations).toBeDefined();
    expect(merged.sourceLocations!.length).toBe(1);
    expect(merged.sourceLocations![0]).toEqual({
      filePath: "src/db.ts",
      startLine: 5,
      endLine: 7,
    });
  });
});

