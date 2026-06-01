import { classifyRawFindings } from "../../../src/classifier/classify";
import type { RawFinding } from "../../../src/core/types/detection";

describe("classifier frontend framework grouping", () => {
  it("keeps dependency-manifest frontend framework separate from route API group", () => {
    const findings: RawFinding[] = [
      {
        pattern: "express_route",
        name: "POST /api/ai-completion",
        confidence: 0.9,
        location: {
          filePath: "dev-server.js",
          startLine: 10,
          endLine: 10,
        },
        properties: {
          framework: "express",
          section_id: "root",
        },
      },
      {
        pattern: "express_route",
        name: "Frontend Application",
        confidence: 0.75,
        location: {
          filePath: "package.json",
          startLine: 1,
          endLine: 1,
        },
        properties: {
          framework: "react",
          section_id: "root",
          sourceContext: "dependency_manifest",
        },
      },
    ];

    const components = classifyRawFindings(findings);

    const routeApi = components.find((c) => c.name === "HTTP API");
    const frontend = components.find((c) => c.name === "React");

    expect(routeApi).toBeDefined();
    expect(frontend).toBeDefined();
    expect(components.length).toBe(2);
  });
});
