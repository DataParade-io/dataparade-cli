import { buildFileExcerptsForQueue } from "../../../src/ai-enrichment/provider-prompt";
import type { DetectedComponent } from "../../../src/core/types/component";
import type { FileInfo } from "../../../src/core/types/file";
import type { AiInferenceCandidate } from "../../../src/ai-enrichment/types";

describe("buildFileExcerptsForQueue env safety", () => {
  it("does not include .env file content in excerpts", () => {
    const components: DetectedComponent[] = [
      {
        id: "cmp_1",
        name: "api",
        type: "asset",
        confidence: 0.9,
        detectedFrom: [
          {
            pattern: "file",
            sourceLocation: { filePath: "src/api.ts", startLine: 1, endLine: 5 },
          },
        ],
        sourceLocations: [{ filePath: "src/api.ts", startLine: 1, endLine: 5 }],
        properties: {},
      },
    ];
    const files: FileInfo[] = [
      {
        path: "src/api.ts",
        name: "api.ts",
        content: "export const x = 1;",
        language: "typescript",
        size: 20,
      },
      {
        path: ".env",
        name: ".env",
        content: "API_KEY=super-secret",
        language: "env",
        size: 18,
      },
    ];
    const queue: AiInferenceCandidate[] = [
      {
        id: "c1",
        candidateType: "node_property",
        priority: 1,
        componentId: "cmp_1",
        missingFields: [],
        rationale: "test",
        hints: [],
      },
    ];

    const excerpts = buildFileExcerptsForQueue(files, queue, components, []);
    expect(excerpts["src/api.ts"]).toContain("export const");
    expect(excerpts[".env"]).toBeUndefined();
    expect(JSON.stringify(excerpts)).not.toContain("super-secret");
  });
});
