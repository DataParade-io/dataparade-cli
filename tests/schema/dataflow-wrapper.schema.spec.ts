import { dataflowWrapperSchema, validateDataflowJson } from "../../src/core/schema/dataflow-wrapper.schema";
describe("dataflowWrapperSchema", () => {
  it("accepts a valid dataflow.json wrapper", () => {
    const input = {
      schemaVersion: "1.0",
      graph: {
        nodes: [
          {
            id: "n1",
            type: "asset",
            position: { x: 0, y: 0 },
            data: { label: "Node 1", privacy: {} },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      metadata: {
        componentsCount: 1,
        dataFlowsCount: 0,
        filesScanned: 10,
        scanDurationMs: 100,
      },
    };

    const result = validateDataflowJson(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graph.nodes[0].id).toBe("n1");
    }
  });

  it("accepts metadata.terraform when shape matches CLI output", () => {
    const input = {
      schemaVersion: "1.0",
      graph: {
        nodes: [
          {
            id: "n1",
            type: "asset",
            position: { x: 0, y: 0 },
            data: { label: "Node 1", privacy: {} },
          },
        ],
        edges: [],
      },
      metadata: {
        componentsCount: 1,
        terraform: {
          mode: "json_overlay",
          staticTfFiles: 2,
          jsonInputPath: "/tmp/plan.json",
          jsonFindingsMerged: 1,
        },
      },
    };

    const result = validateDataflowJson(input);
    expect(result.ok).toBe(true);
  });

  it("rejects wrappers missing schemaVersion or graph", () => {
    const input = {
      graph: {},
    } as unknown;

    const result = validateDataflowJson(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const message = result.errors.join(" | ");
      expect(message).toMatch(/schemaVersion/);
    }
  });

  it("rejects invalid graph structures", () => {
    const input = {
      schemaVersion: "1.0",
      graph: {
        nodes: [
          {
            id: "",
            type: "asset",
            position: { x: 0, y: 0 },
            data: { label: "Invalid Node", privacy: {} },
          },
        ],
        edges: [],
      },
    };

    const result = dataflowWrapperSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

