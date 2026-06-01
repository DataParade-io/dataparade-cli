import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import { ensureActorToAppFlow, ensureInjectedProjectMainToTerraformProviderHub } from "../../../src/data-flow/ensure-actor-flow";

function makeComponent(
  overrides: Partial<DetectedComponent> &
    Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type,
    subType: overrides.subType,
    confidence: overrides.confidence ?? 0.9,
    detectedFrom: overrides.detectedFrom ?? [],
    sourceLocations: overrides.sourceLocations ?? [],
    properties: overrides.properties ?? {},
    description: overrides.description,
    dataFlowIds: overrides.dataFlowIds,
  };
}

function makeFlow(
  flow: Partial<DetectedDataFlow> &
    Pick<
      DetectedDataFlow,
      "id" | "sourceComponentId" | "targetComponentId" | "type"
    >,
): DetectedDataFlow {
  return {
    confidence: 0.8,
    ...flow,
  } as DetectedDataFlow;
}

describe("data-flow/ensure-actor-flow - ensureActorToAppFlow", () => {
  it("adds actor→app flow when app and actor exist but no flow connects them", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "app_1",
        name: "Application",
        type: "asset",
        subType: "api",
        properties: { isMainApplication: true },
      }),
      makeComponent({
        id: "actor_1",
        name: "User",
        type: "actor",
        subType: "customer",
      }),
    ];
    const flows: DetectedDataFlow[] = [
      makeFlow({
        id: "flow_1",
        sourceComponentId: "app_1",
        targetComponentId: "db_1",
        type: "database_query",
      }),
    ];

    const result = ensureActorToAppFlow(components, flows);

    const actorToApp = result.filter(
      (f) => f.sourceComponentId === "actor_1" && f.targetComponentId === "app_1",
    );
    expect(actorToApp).toHaveLength(1);
    expect(actorToApp[0].type).toBe("api_call");
    expect(actorToApp[0].confidence).toBe(0.5);
    expect(result).toHaveLength(2);
  });

  it("does not add flow when actor→app already exists", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "app_1",
        name: "Application",
        type: "asset",
        subType: "api",
        properties: { isMainApplication: true },
      }),
      makeComponent({
        id: "actor_1",
        name: "User",
        type: "actor",
      }),
    ];
    const flows: DetectedDataFlow[] = [
      makeFlow({
        id: "flow_1",
        sourceComponentId: "actor_1",
        targetComponentId: "app_1",
        type: "api_call",
      }),
    ];

    const result = ensureActorToAppFlow(components, flows);

    expect(result).toHaveLength(1);
  });

  it("does not add flow when app→actor already exists", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "app_1",
        name: "Application",
        type: "asset",
        subType: "api",
        properties: { isMainApplication: true },
      }),
      makeComponent({
        id: "actor_1",
        name: "User",
        type: "actor",
      }),
    ];
    const flows: DetectedDataFlow[] = [
      makeFlow({
        id: "flow_1",
        sourceComponentId: "app_1",
        targetComponentId: "actor_1",
        type: "api_call",
      }),
    ];

    const result = ensureActorToAppFlow(components, flows);

    expect(result).toHaveLength(1);
  });

  it("returns flows unchanged when no app exists", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "actor_1",
        name: "User",
        type: "actor",
      }),
    ];
    const flows: DetectedDataFlow[] = [];

    const result = ensureActorToAppFlow(components, flows);

    expect(result).toEqual([]);
  });

  it("returns flows unchanged when no actors exist", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "app_1",
        name: "Application",
        type: "asset",
        subType: "api",
        properties: { isMainApplication: true },
      }),
    ];
    const flows: DetectedDataFlow[] = [];

    const result = ensureActorToAppFlow(components, flows);

    expect(result).toEqual([]);
  });

  it("uses first actor in section when multiple actors exist and none have app flow", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "app_1",
        name: "Application",
        type: "asset",
        subType: "api",
        properties: { isMainApplication: true },
      }),
      makeComponent({
        id: "actor_1",
        name: "Customer",
        type: "actor",
      }),
      makeComponent({
        id: "actor_2",
        name: "Admin",
        type: "actor",
      }),
    ];
    const flows: DetectedDataFlow[] = [];

    const result = ensureActorToAppFlow(components, flows);

    const actorToApp = result.filter(
      (f) => f.targetComponentId === "app_1",
    );
    expect(actorToApp).toHaveLength(1);
    expect(actorToApp[0].sourceComponentId).toBe("actor_1");
  });

  it("adds one actor→app flow per section without an actor-app connection", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "app_a",
        name: "Section A",
        type: "asset",
        subType: "application",
        properties: { isMainApplication: true, section_id: "a" },
      }),
      makeComponent({
        id: "app_b",
        name: "Section B",
        type: "asset",
        subType: "application",
        properties: { isMainApplication: true, section_id: "b" },
      }),
      makeComponent({
        id: "actor_a",
        name: "User A",
        type: "actor",
        properties: { section_id: "a" },
      }),
      makeComponent({
        id: "actor_b",
        name: "User B",
        type: "actor",
        properties: { section_id: "b" },
      }),
    ];

    const result = ensureActorToAppFlow(components, []);
    const links = result.filter((f) => f.type === "api_call");

    expect(links).toHaveLength(2);
    expect(
      links.some(
        (f) => f.sourceComponentId === "actor_a" && f.targetComponentId === "app_a",
      ),
    ).toBe(true);
    expect(
      links.some(
        (f) => f.sourceComponentId === "actor_b" && f.targetComponentId === "app_b",
      ),
    ).toBe(true);
  });

  it("ensureInjectedProjectMainToTerraformProviderHub adds main → provider.aws", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "main_1",
        name: "my-iac-root",
        type: "asset",
        subType: "application",
        properties: {
          isMainApplication: true,
          sourceContext: "injected_project_placeholder",
          section_id: "root",
        },
      }),
      makeComponent({
        id: "tp_aws",
        name: "Amazon Web Services",
        type: "third_party",
        properties: {
          terraform_address: "provider.aws",
          section_id: "root",
        },
      }),
    ];
    const flows: DetectedDataFlow[] = [
      makeFlow({
        id: "flow_1",
        sourceComponentId: "actor_1",
        targetComponentId: "main_1",
        type: "api_call",
      }),
    ];

    const result = ensureInjectedProjectMainToTerraformProviderHub(components, flows);
    const mainToAws = result.find(
      (f) =>
        f.sourceComponentId === "main_1" &&
        f.targetComponentId === "tp_aws" &&
        f.type === "api_call",
    );
    expect(mainToAws).toBeDefined();
    expect(mainToAws?.confidence).toBe(0.72);
  });
});
