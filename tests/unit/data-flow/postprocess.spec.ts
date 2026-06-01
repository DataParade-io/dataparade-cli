import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import { postprocessDataFlows } from "../../../src/data-flow/postprocess";

function makeComponent(
  overrides: Partial<DetectedComponent> &
    Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type,
    subType: overrides.subType,
    confidence: overrides.confidence ?? 1,
    detectedFrom: overrides.detectedFrom ?? [],
    sourceLocations: overrides.sourceLocations ?? [],
    properties: overrides.properties ?? {},
  };
}

function makeFlow(
  overrides: Partial<DetectedDataFlow> &
    Pick<
      DetectedDataFlow,
      "id" | "sourceComponentId" | "targetComponentId" | "type"
    >,
): DetectedDataFlow {
  return {
    id: overrides.id,
    sourceComponentId: overrides.sourceComponentId,
    targetComponentId: overrides.targetComponentId,
    type: overrides.type,
    confidence: overrides.confidence ?? 1,
  };
}

describe("data-flow/postprocess", () => {
  it("removes duplicate section-api outbound flows when main app has same target", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "frontend-main",
        name: "frontend",
        type: "asset",
        subType: "api",
        properties: {
          section_id: "frontend",
          isMainApplication: true,
        },
      }),
      makeComponent({
        id: "frontend-api",
        name: "API",
        type: "asset",
        subType: "api",
        properties: {
          section_id: "frontend",
          isSectionApiNode: true,
        },
      }),
      makeComponent({
        id: "auth0",
        name: "Auth0",
        type: "third_party",
        subType: "identity_provider",
        properties: {
          section_id: "frontend",
          serviceName: "auth0",
        },
      }),
    ];

    const flows: DetectedDataFlow[] = [
      makeFlow({
        id: "flow_1",
        sourceComponentId: "frontend-main",
        targetComponentId: "auth0",
        type: "api_call",
      }),
      makeFlow({
        id: "flow_2",
        sourceComponentId: "frontend-api",
        targetComponentId: "auth0",
        type: "api_call",
      }),
    ];

    const out = postprocessDataFlows(components, flows);
    const auth0Calls = out.filter(
      (f) => f.targetComponentId === "auth0" && f.type === "api_call",
    );

    expect(auth0Calls).toHaveLength(1);
    expect(auth0Calls[0].sourceComponentId).toBe("frontend-main");
  });
});
