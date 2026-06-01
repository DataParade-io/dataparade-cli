import { diagramGraphJsonSchema } from "../../src/core/schema/diagram-graph.schema";
describe("diagramGraphJsonSchema", () => {
  it("accepts a minimal valid graph", () => {
    const input = {
      nodes: [
        {
          id: "n1",
          type: "asset",
          position: { x: 0, y: 0 },
          data: {
            label: "Node 1",
            privacy: {},
          },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "n1",
          target: "n1",
          type: "data_flow",
          data: {
            label: "self",
          },
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const result = diagramGraphJsonSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects graphs with invalid nodes/edges", () => {
    const input = {
      nodes: [],
      edges: [
        {
          id: "e1",
          source: "",
          target: "n1",
        },
      ],
    };

    const result = diagramGraphJsonSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

