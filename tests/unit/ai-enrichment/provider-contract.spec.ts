import {
  strictParseAndNormalizeProposals,
  buildProposalsValidationContext,
} from "../../../src/ai-enrichment/providers/provider-contract";

describe("strictParseAndNormalizeProposals / propertyEvidence", () => {
  const defaults = {
    provider: "openai" as const,
    model: "gpt-4o-mini",
    agent: "propertyAgent" as const,
  };

  const basePatch = {
    kind: "component_patch" as const,
    targetComponentId: "c1",
    candidateType: "third_party" as const,
    setProperties: { flag: true },
    confidence: { score: 0.9, band: "high" as const },
    propertyEvidence: {
      flag: [
        {
          filePath: "a.ts",
          startLine: 1,
          endLine: 1,
          reason: "literal true in source",
        },
      ],
    },
  };

  it("clamps line range to excerpt length instead of dropping the property", () => {
    const raw = {
      proposals: [
        {
          ...basePatch,
          propertyEvidence: {
            flag: [
              {
                filePath: "a.ts",
                startLine: 1,
                endLine: 99,
                reason: "model overshot endLine",
              },
            ],
          },
        },
      ],
    };
    const userPrompt = JSON.stringify({
      relevantFileContents: { "a.ts": "only one line" },
      componentContext: {
        c1: {
          detectedFrom: [{ filePath: "a.ts", pattern: "p" }],
          sourceLocations: [],
        },
      },
    });
    const out = strictParseAndNormalizeProposals(raw, defaults, {
      debugLabel: "test",
      userPrompt,
    });
    expect(out).toHaveLength(1);
    if (out[0]?.kind === "component_patch") {
      expect(out[0].propertyEvidence?.flag?.[0]?.endLine).toBe(1);
    }
  });

  it("keeps a property when line range fits the excerpt", () => {
    const raw = { proposals: [basePatch] };
    const userPrompt = JSON.stringify({
      relevantFileContents: { "a.ts": "only one line" },
      componentContext: {
        c1: {
          detectedFrom: [{ filePath: "a.ts", pattern: "p" }],
          sourceLocations: [],
        },
      },
    });
    const out = strictParseAndNormalizeProposals(raw, defaults, {
      debugLabel: "test",
      userPrompt,
    });
    expect(out).toHaveLength(1);
    if (out[0]?.kind === "component_patch") {
      expect(out[0].setProperties.flag).toBe(true);
      expect(out[0].propertyEvidence?.flag).toHaveLength(1);
    }
  });

  it("accepts evidence file basename when it matches an excerpt/component path basename", () => {
    const raw = { proposals: [basePatch] };
    const userPrompt = JSON.stringify({
      relevantFileContents: { "backend/lambdas/create-db/index.js": "line1\nline2\n" },
      componentContext: {
        c1: {
          detectedFrom: [
            { filePath: "backend/lambdas/create-db/index.js", pattern: "p" },
          ],
          sourceLocations: [],
        },
      },
    });
    const patch = {
      ...basePatch,
      propertyEvidence: {
        flag: [
          {
            filePath: "index.js",
            startLine: 1,
            endLine: 2,
            reason: "basename only",
          },
        ],
      },
    };
    const out = strictParseAndNormalizeProposals({ proposals: [patch] }, defaults, {
      debugLabel: "test",
      userPrompt,
    });
    expect(out).toHaveLength(1);
  });

  it("drops a property when filePath is not in excerpt or component paths", () => {
    const raw = { proposals: [basePatch] };
    const userPrompt = JSON.stringify({
      relevantFileContents: { "allowed.ts": "x" },
      componentContext: {
        c1: {
          detectedFrom: [{ filePath: "allowed.ts", pattern: "p" }],
          sourceLocations: [],
        },
      },
    });
    const out = strictParseAndNormalizeProposals(raw, defaults, {
      debugLabel: "test",
      userPrompt,
    });
    expect(out).toHaveLength(0);
  });

  it("buildProposalsValidationContext returns null on non-JSON", () => {
    expect(buildProposalsValidationContext("not json")).toBeNull();
  });

  it("coerces object-shaped proposals into an array before validation", () => {
    const raw = {
      proposals: {
        "0": basePatch,
      },
    };
    const userPrompt = JSON.stringify({
      relevantFileContents: { "a.ts": "only one line" },
      componentContext: {
        c1: {
          detectedFrom: [{ filePath: "a.ts", pattern: "p" }],
          sourceLocations: [],
        },
      },
    });

    const out = strictParseAndNormalizeProposals(raw, defaults, {
      debugLabel: "test",
      userPrompt,
    });

    expect(out).toHaveLength(1);
    if (out[0]?.kind === "component_patch") {
      expect(out[0].targetComponentId).toBe("c1");
      expect(out[0].setProperties.flag).toBe(true);
    }
  });

  it("coerces propertyEvidence object entries into evidence arrays", () => {
    const raw = {
      proposals: [
        {
          ...basePatch,
          propertyEvidence: {
            flag: {
              filePath: "a.ts",
              startLine: 1,
              endLine: 1,
              reason: "single object instead of array",
            },
          },
        },
      ],
    };
    const userPrompt = JSON.stringify({
      relevantFileContents: { "a.ts": "only one line" },
      componentContext: {
        c1: {
          detectedFrom: [{ filePath: "a.ts", pattern: "p" }],
          sourceLocations: [],
        },
      },
    });

    const out = strictParseAndNormalizeProposals(raw, defaults, {
      debugLabel: "test",
      userPrompt,
    });

    expect(out).toHaveLength(1);
    if (out[0]?.kind === "component_patch") {
      expect(out[0].propertyEvidence?.flag).toHaveLength(1);
      expect(out[0].propertyEvidence?.flag?.[0]?.reason).toContain("single object");
    }
  });

  it("normalizes third-party data categories and derives cloud_provider for UI compatibility", () => {
    const raw = {
      proposals: [
        {
          kind: "component_patch",
          targetComponentId: "c1",
          candidateType: "third_party",
          setProperties: {
            data_categories_received: ["document_files", "document_metadata"],
            processing_purpose: ["document_processing"],
            cloud_services_used: ["aws", "storage"],
          },
          confidence: { score: 0.9, band: "high" },
          propertyEvidence: {
            data_categories_received: [
              { filePath: "a.ts", startLine: 1, endLine: 1, reason: "docs mention files" },
            ],
            processing_purpose: [
              { filePath: "a.ts", startLine: 1, endLine: 1, reason: "service purpose" },
            ],
            cloud_services_used: [
              { filePath: "a.ts", startLine: 1, endLine: 1, reason: "aws sdk usage" },
            ],
          },
        },
      ],
    };
    const userPrompt = JSON.stringify({
      relevantFileContents: { "a.ts": "line" },
      componentContext: {
        c1: {
          detectedFrom: [{ filePath: "a.ts", pattern: "p" }],
          sourceLocations: [],
        },
      },
    });

    const out = strictParseAndNormalizeProposals(raw, defaults, {
      debugLabel: "test",
      userPrompt,
    });
    expect(out).toHaveLength(1);
    if (out[0]?.kind === "component_patch") {
      expect(out[0].setProperties.data_categories_received).toEqual(["other"]);
      expect(out[0].setProperties.processing_purpose).toEqual(["service_provision"]);
      expect(out[0].setProperties.cloud_provider).toBe("AWS");
      expect(out[0].propertyEvidence?.cloud_provider).toHaveLength(1);
    }
  });
});
