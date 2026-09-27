import { projectCollectedDiscoveriesDiagram } from "../../../src/discoveries/project-collected-diagram";
import type { A0DiscoveriesDocument } from "../../eval/a0-diagram/a0-discoveries-document.schema";

const document: A0DiscoveriesDocument = {
  components: [
    {
      id: "/repo-a::cmp_1",
      scanPath: "/repo-a",
      name: "api",
      type: "asset",
      subType: "service",
      confidence: 0.9,
      sourceLocations: [],
      dataItemIds: ["/repo-a::data_item:email"],
    },
    {
      id: "/repo-a::cmp_2",
      scanPath: "/repo-a",
      name: "db",
      type: "asset",
      subType: "database",
      confidence: 0.8,
      sourceLocations: [],
      dataItemIds: [],
    },
  ],
  dataFlows: [
    {
      id: "/repo-a::flow_1",
      scanPath: "/repo-a",
      sourceComponentId: "/repo-a::cmp_1",
      targetComponentId: "/repo-a::cmp_2",
      type: "data_transfer",
      confidence: 0.7,
    },
  ],
  dataItems: [
    {
      id: "/repo-a::data_item:email",
      scanPath: "/repo-a",
      mentionIds: ["/repo-a::mention:email:src/a.ts:3"],
    },
    {
      id: "/repo-b::data_item:email",
      scanPath: "/repo-b",
      mentionIds: ["/repo-b::mention:email:src/a.ts:3"],
    },
  ],
  mentions: [
    {
      id: "/repo-a::mention:email:src/a.ts:3",
      scanPath: "/repo-a",
      filePath: "src/a.ts",
      startLine: 3,
      endLine: 3,
      code: "email",
    },
    {
      id: "/repo-b::mention:email:src/a.ts:3",
      scanPath: "/repo-b",
      filePath: "src/a.ts",
      startLine: 3,
      endLine: 3,
    },
  ],
};

describe("projectCollectedDiscoveriesDiagram", () => {
  const diagram = projectCollectedDiscoveriesDiagram(document);

  it("draws the components and the flow that exist, and does not invent a system box", () => {
    expect(diagram.graph.nodes.map((node) => node.id).sort()).toEqual([
      "/repo-a::cmp_1",
      "/repo-a::cmp_2",
      "/repo-b::data_item:email",
    ]);
    expect(diagram.graph.nodes.some((node) => node.type === "system")).toBe(false);
    expect(diagram.graph.edges).toEqual([
      expect.objectContaining({
        id: "/repo-a::flow_1",
        source: "/repo-a::cmp_1",
        target: "/repo-a::cmp_2",
      }),
    ]);
    expect(diagram.graph.edges[0]?.data?.label).toBe("data_transfer");
    expect(JSON.stringify(diagram.graph)).not.toContain("?");
  });

  it("keeps mentions on the data item and does not draw them as nodes", () => {
    const api = diagram.graph.nodes.find((node) => node.id === "/repo-a::cmp_1");
    const collected = api?.data.collected as {
      dataItems: Array<{ mentions: Array<{ filePath: string; startLine: number }> }>;
    };
    expect(collected.dataItems[0]?.mentions).toEqual([
      expect.objectContaining({ filePath: "src/a.ts", startLine: 3 }),
    ]);
    expect(diagram.graph.nodes.some((node) => String(node.id).includes("mention:"))).toBe(false);

    const loose = diagram.graph.nodes.find((node) => node.id === "/repo-b::data_item:email");
    expect(loose?.type).toBe("data_item");
    expect(loose?.data.label).toBe("data_item:email (repo-b)");
  });
});
