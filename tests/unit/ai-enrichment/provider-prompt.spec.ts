import {
  buildFileExcerptsForQueue,
  buildProviderPromptPayload,
  collectReferencedPathsForQueue,
  slimComponentForLlm,
} from "../../../src/ai-enrichment/provider-prompt";
import type { DetectedComponent } from "../../../src/core/types/component";

describe("provider-prompt", () => {
  it("slimComponentForLlm keeps detectedFrom paths and splits sparse keys", () => {
    const c: DetectedComponent = {
      id: "tp_1",
      name: "Acme API",
      type: "third_party",
      confidence: 0.9,
      detectedFrom: [
        {
          pattern: "import",
          sourceLocation: {
            filePath: "src/lib/acme.ts",
            startLine: 3,
            endLine: 3,
          },
        },
      ],
      sourceLocations: [
        { filePath: "src/lib/acme.ts", startLine: 1, endLine: 20 },
      ],
      properties: {
        section_id: "backend",
        vendor: null,
        integration_method: [],
        inference_status: undefined,
      },
    };
    const slim = slimComponentForLlm(c);
    expect(slim.detectedFrom).toHaveLength(1);
    expect((slim.detectedFrom as { filePath?: string }[])[0]?.filePath).toBe(
      "src/lib/acme.ts",
    );
    expect(slim.propertiesSet).toEqual({ section_id: "backend" });
    expect(slim.sparsePropertyKeys).toContain("vendor");
    expect(slim.sparsePropertyKeys).not.toContain("inference_status");
  });

  it("buildProviderPromptPayload includes componentContext for queued componentIds", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_1",
        name: "X",
        type: "third_party",
        confidence: 0.8,
        detectedFrom: [],
        sourceLocations: [],
        properties: {},
      },
    ];
    const payload = buildProviderPromptPayload({
      agent: "tpAgent",
      queue: [
        {
          id: "c1",
          candidateType: "third_party",
          priority: 90,
          componentId: "tp_1",
          missingFields: [],
          rationale: "test",
          hints: [],
        },
      ],
      components,
      dataFlows: [],
    });
    expect(payload.agent).toBe("tpAgent");
    expect((payload.componentContext as Record<string, unknown>).tp_1).toBeDefined();
    expect((payload.componentContext as { tp_1: { name: string } }).tp_1.name).toBe(
      "X",
    );
    expect(String(payload.instructions)).toContain(
      "targetComponentId` must be exactly one of canonicalComponentIds",
    );
    expect(
      (payload as { canonicalComponentIds?: string[] }).canonicalComponentIds,
    ).toEqual(["tp_1"]);
  });

  it("collectReferencedPathsForQueue includes flow endpoint component paths", () => {
    const components = [
      {
        id: "a",
        name: "A",
        type: "asset" as const,
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [{ filePath: "src/a.ts", startLine: 1, endLine: 2 }],
        properties: {},
      },
      {
        id: "b",
        name: "B",
        type: "asset" as const,
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [{ filePath: "src/b.ts", startLine: 1, endLine: 2 }],
        properties: {},
      },
    ];
    const dataFlows = [
      {
        id: "f1",
        sourceComponentId: "a",
        targetComponentId: "b",
        type: "api_call" as const,
        confidence: 0.8,
      },
    ];
    const paths = collectReferencedPathsForQueue(
      [
        {
          id: "c1",
          candidateType: "flow_direction",
          priority: 1,
          flowId: "f1",
          missingFields: [],
          rationale: "",
          hints: [],
        },
      ],
      components,
      dataFlows,
    );
    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("buildFileExcerptsForQueue maps scan files to referenced paths", () => {
    const components = [
      {
        id: "tp_1",
        name: "X",
        type: "third_party" as const,
        confidence: 0.8,
        detectedFrom: [
          {
            pattern: "external_api_call" as const,
            sourceLocation: {
              filePath: "pkg/handler.ts",
              startLine: 10,
              endLine: 12,
            },
          },
        ],
        sourceLocations: [],
        properties: {},
      },
    ];
    const files = [
      {
        path: "pkg/handler.ts",
        name: "handler.ts",
        content: "export const x = 1;\n",
        language: "typescript" as const,
        size: 20,
      },
    ];
    const excerpts = buildFileExcerptsForQueue(
      files,
      [
        {
          id: "c1",
          candidateType: "third_party",
          priority: 1,
          componentId: "tp_1",
          missingFields: [],
          rationale: "",
          hints: [],
        },
      ],
      components,
      [],
    );
    expect(excerpts["pkg/handler.ts"]).toContain("export const x");
  });

  it("buildProviderPromptPayload adds relevantFileContents when files match queue", () => {
    const components = [
      {
        id: "tp_1",
        name: "X",
        type: "third_party" as const,
        confidence: 0.8,
        detectedFrom: [
          {
            pattern: "external_api_call" as const,
            sourceLocation: {
              filePath: "lib/x.ts",
              startLine: 1,
              endLine: 1,
            },
          },
        ],
        sourceLocations: [],
        properties: {},
      },
    ];
    const payload = buildProviderPromptPayload({
      agent: "tpAgent",
      queue: [
        {
          id: "c1",
          candidateType: "third_party",
          priority: 1,
          componentId: "tp_1",
          missingFields: [],
          rationale: "",
          hints: [],
        },
      ],
      components,
      dataFlows: [],
      files: [
        {
          path: "lib/x.ts",
          name: "x.ts",
          content: "void 0;",
          language: "typescript",
          size: 6,
        },
      ],
    });
    expect(
      (payload as { relevantFileContents?: Record<string, string> }).relevantFileContents?.[
        "lib/x.ts"
      ],
    ).toBe("void 0;");
  });
});
