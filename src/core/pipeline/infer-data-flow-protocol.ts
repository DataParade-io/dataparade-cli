import type { DetectedDataFlow } from "../types/data-flow";

export type InferredDataFlowProtocol = "rest" | "graphql";

const GRAPHQL_SIGNAL = /\bgraphql\b|\/graphql\b/i;

function textSuggestsGraphql(text: string): boolean {
  return GRAPHQL_SIGNAL.test(text);
}

function flowCodeSuggestsGraphql(flow: DetectedDataFlow): boolean {
  const locations = [
    flow.sourceLocation,
    ...(flow.sourceLocations ?? []),
  ].filter((loc): loc is NonNullable<typeof loc> => loc != null);

  for (const loc of locations) {
    if (typeof loc.code === "string" && textSuggestsGraphql(loc.code)) {
      return true;
    }
  }
  return false;
}

/**
 * Infer engineering.protocol for a scanned data flow (rest | graphql).
 * Returns undefined when the flow type is not HTTP/API-shaped or there is no signal.
 */
export function inferDataFlowProtocol(
  flow: DetectedDataFlow,
): InferredDataFlowProtocol | undefined {
  const endpoint = flow.endpoint?.trim() ?? "";
  if (endpoint && textSuggestsGraphql(endpoint)) {
    return "graphql";
  }
  if (flowCodeSuggestsGraphql(flow)) {
    return "graphql";
  }

  if (flow.type !== "api_call") {
    return undefined;
  }

  if (endpoint || flow.method?.trim()) {
    return "rest";
  }

  return undefined;
}
