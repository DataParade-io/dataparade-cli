import { createAgentTooling } from "../../../src/ai-enrichment/tools";
import type { AiScanContext } from "../../../src/ai-enrichment/tools";
import type { ComponentPatch } from "../../../src/ai-enrichment/types";

function ctx(files: AiScanContext["files"]): AiScanContext {
  return {
    components: [],
    dataFlows: [],
    findings: [],
    files,
    sections: [],
  };
}

function openAiPatch(filePath: string): ComponentPatch {
  return {
    kind: "component_patch",
    targetComponentId: "c1",
    candidateType: "third_party",
    setProperties: { vendor: "Acme" },
    confidence: { score: 0.85, band: "high" },
    evidence: [
      {
        filePath,
        startLine: 1,
        endLine: 2,
        reason: "import acme sdk",
      },
    ],
    provider: "openai",
    model: "gpt-4o-mini",
    agent: "tpAgent",
  };
}

describe("createAgentTooling validateProposal", () => {
  const scanned = [
    {
      path: "lib/x.ts",
      name: "x.ts",
      content: "export {}",
      language: "typescript" as const,
      size: 10,
    },
  ];

  it("allows mock proposals with unknown evidence path", () => {
    const tools = createAgentTooling(ctx(scanned), [], []);
    const mockPatch: ComponentPatch = {
      ...openAiPatch("unknown"),
      provider: "mock",
      model: "heuristic",
      agent: "propertyAgent",
    };
    expect(tools.validateProposal(mockPatch)).toEqual({ ok: true });
  });

  it("rejects non-mock proposal when evidence path is not in scan", () => {
    const tools = createAgentTooling(ctx(scanned), [], []);
    const r = tools.validateProposal(openAiPatch("nowhere.ts"));
    expect(r).toEqual({ ok: false, reason: "evidence_path_not_in_scan" });
  });

  it("accepts non-mock proposal when evidence path matches a scanned file", () => {
    const tools = createAgentTooling(ctx(scanned), [], []);
    expect(tools.validateProposal(openAiPatch("lib/x.ts"))).toEqual({ ok: true });
  });

  it("skips path check when scan has no files", () => {
    const tools = createAgentTooling(ctx([]), [], []);
    expect(tools.validateProposal(openAiPatch("any.ts"))).toEqual({ ok: true });
  });
});
