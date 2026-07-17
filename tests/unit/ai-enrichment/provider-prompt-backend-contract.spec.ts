import { buildProviderPromptPayload } from "../../../src/ai-enrichment/provider-prompt";
import type {
  AiAgentName,
  AiInferenceCandidate,
} from "../../../src/ai-enrichment/types";
import type { DetectedComponent } from "../../../src/core/types/component";

/**
 * Backend contract guard (DP-P0-CLI-3810).
 *
 * The backend validates every platform infer prompt against
 * backend/src/scans/scan-cli-infer-prompt.schema.ts:
 * - instructions: non-empty string
 * - agent: tpAgent | propertyAgent | directionAgent | interactionAgent
 * - candidates: non-empty array, each with id (string) + candidateType (enum)
 * - componentContext: object
 * - canonicalComponentIds: string[]
 *
 * If buildProviderPromptPayload stops satisfying this shape, platform AI scans
 * will be rejected with 400 invalid_infer_prompt. Keep both sides in sync.
 */

const AGENTS: AiAgentName[] = [
  "tpAgent",
  "propertyAgent",
  "directionAgent",
  "interactionAgent",
];

const CANDIDATE_TYPES = new Set([
  "third_party",
  "node_property",
  "flow_direction",
  "missing_interaction",
]);

function makeComponent(): DetectedComponent {
  return {
    id: "tp_1",
    name: "Acme API",
    type: "third_party",
    confidence: 0.9,
    detectedFrom: [],
    sourceLocations: [{ filePath: "src/lib/acme.ts", startLine: 1, endLine: 5 }],
    properties: { vendor: null },
  };
}

function makeCandidate(): AiInferenceCandidate {
  return {
    id: "cand-1",
    candidateType: "node_property",
    priority: 1,
    componentId: "tp_1",
    missingFields: ["vendor"],
    rationale: "sparse properties",
    hints: [],
  };
}

function assertMatchesBackendContract(payload: Record<string, unknown>): void {
  expect(typeof payload.instructions).toBe("string");
  expect((payload.instructions as string).length).toBeGreaterThan(0);

  expect(AGENTS).toContain(payload.agent);

  expect(Array.isArray(payload.candidates)).toBe(true);
  const candidates = payload.candidates as Array<Record<string, unknown>>;
  expect(candidates.length).toBeGreaterThan(0);
  for (const cand of candidates) {
    expect(typeof cand.id).toBe("string");
    expect((cand.id as string).length).toBeGreaterThan(0);
    expect(CANDIDATE_TYPES.has(cand.candidateType as string)).toBe(true);
  }

  expect(payload.componentContext).toBeDefined();
  expect(typeof payload.componentContext).toBe("object");
  expect(Array.isArray(payload.componentContext)).toBe(false);

  expect(Array.isArray(payload.canonicalComponentIds)).toBe(true);
  for (const id of payload.canonicalComponentIds as unknown[]) {
    expect(typeof id).toBe("string");
  }

  if (payload.relevantFileContents !== undefined) {
    for (const value of Object.values(
      payload.relevantFileContents as Record<string, unknown>,
    )) {
      expect(typeof value).toBe("string");
    }
  }

  // The wire format is JSON.stringify(payload); it must round-trip.
  expect(() => JSON.parse(JSON.stringify(payload))).not.toThrow();
}

describe("buildProviderPromptPayload backend contract (DP-P0-CLI-3810)", () => {
  it.each(AGENTS)("output for %s satisfies the backend infer schema", (agent) => {
    const payload = buildProviderPromptPayload({
      agent,
      queue: [makeCandidate()],
      components: [makeComponent()],
      dataFlows: [],
    });
    assertMatchesBackendContract(payload);
  });

  it("output with file excerpts still satisfies the contract", () => {
    const payload = buildProviderPromptPayload({
      agent: "propertyAgent",
      queue: [makeCandidate()],
      components: [makeComponent()],
      dataFlows: [],
      files: [
        {
          path: "src/lib/acme.ts",
          name: "acme.ts",
          content: 'import { acme } from "acme";',
          language: "typescript",
          size: 30,
        },
      ],
    });
    assertMatchesBackendContract(payload);
  });

  it("flow-only candidates (empty componentContext) still satisfy the contract", () => {
    const payload = buildProviderPromptPayload({
      agent: "directionAgent",
      queue: [
        {
          id: "cand-flow",
          candidateType: "flow_direction",
          priority: 1,
          flowId: "flow_1",
          missingFields: [],
          rationale: "ambiguous direction",
          hints: [],
        },
      ],
      components: [makeComponent()],
      dataFlows: [
        {
          id: "flow_1",
          type: "api_call",
          confidence: 0.8,
          sourceComponentId: "tp_1",
          targetComponentId: "tp_1",
        },
      ],
    });
    assertMatchesBackendContract(payload);
  });
});
