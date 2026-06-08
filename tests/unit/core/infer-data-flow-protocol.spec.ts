import { inferDataFlowProtocol } from "../../../src/core/pipeline/infer-data-flow-protocol";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";

function baseFlow(
  overrides: Partial<DetectedDataFlow> = {},
): DetectedDataFlow {
  return {
    id: "flow-1",
    sourceComponentId: "a",
    targetComponentId: "b",
    type: "api_call",
    confidence: 0.9,
    ...overrides,
  };
}

describe("inferDataFlowProtocol", () => {
  it("returns graphql for /graphql endpoint", () => {
    expect(
      inferDataFlowProtocol(
        baseFlow({ endpoint: "https://api.example.com/graphql" }),
      ),
    ).toBe("graphql");
  });

  it("returns graphql when source code mentions graphql", () => {
    expect(
      inferDataFlowProtocol(
        baseFlow({
          sourceLocation: {
            filePath: "src/client.ts",
            startLine: 1,
            endLine: 2,
            code: "client.query({ query: GET_USERS }) // graphql",
          },
        }),
      ),
    ).toBe("graphql");
  });

  it("returns rest for api_call with HTTP endpoint", () => {
    expect(
      inferDataFlowProtocol(
        baseFlow({ endpoint: "/api/users", method: "GET" }),
      ),
    ).toBe("rest");
  });

  it("returns undefined for database_query", () => {
    expect(
      inferDataFlowProtocol(
        baseFlow({ type: "database_query", endpoint: "postgres://..." }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined for api_call without endpoint or method", () => {
    expect(inferDataFlowProtocol(baseFlow())).toBeUndefined();
  });
});
