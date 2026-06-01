import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import { rewireFlowsThroughApplication } from "../../../src/data-flow/rewire";

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

describe("data-flow/rewire - rewireFlowsThroughApplication", () => {
  it("rewires actor → infra to actor → Application and Application → target", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "app_1",
        name: "Application",
        type: "asset",
        subType: "service",
        properties: { isMainApplication: true },
      }),
      makeComponent({
        id: "actor_1",
        name: "User",
        type: "actor",
      }),
      makeComponent({
        id: "tp_1",
        name: "Stripe",
        type: "third_party",
      }),
    ];
    const flows: DetectedDataFlow[] = [
      makeFlow({
        id: "f1",
        sourceComponentId: "actor_1",
        targetComponentId: "tp_1",
        type: "api_call",
      }),
    ];

    const result = rewireFlowsThroughApplication(components, flows);

    const actorToApp = result.filter(
      (f) => f.sourceComponentId === "actor_1" && f.targetComponentId === "app_1",
    );
    const appToTp = result.filter(
      (f) => f.sourceComponentId === "app_1" && f.targetComponentId === "tp_1",
    );
    expect(actorToApp).toHaveLength(1);
    expect(appToTp).toHaveLength(1);
    expect(result).toHaveLength(2);
  });

  it("leaves flows unchanged when no Application component exists", () => {
    const components: DetectedComponent[] = [
      makeComponent({ id: "tp_1", name: "Stripe", type: "third_party" }),
    ];
    const flows: DetectedDataFlow[] = [
      makeFlow({
        id: "f1",
        sourceComponentId: "actor_1",
        targetComponentId: "tp_1",
        type: "api_call",
      }),
    ];

    const result = rewireFlowsThroughApplication(components, flows);
    expect(result).toEqual(flows);
  });

  it("does not duplicate Application → target when such flow already exists", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "app_1",
        name: "Application",
        type: "asset",
        properties: { isMainApplication: true },
      }),
      makeComponent({ id: "actor_1", name: "User", type: "actor" }),
      makeComponent({ id: "tp_1", name: "Stripe", type: "third_party" }),
    ];
    const flows: DetectedDataFlow[] = [
      makeFlow({
        id: "f1",
        sourceComponentId: "actor_1",
        targetComponentId: "tp_1",
        type: "api_call",
      }),
      makeFlow({
        id: "f2",
        sourceComponentId: "app_1",
        targetComponentId: "tp_1",
        type: "api_call",
      }),
    ];

    const result = rewireFlowsThroughApplication(components, flows);

    const appToTp = result.filter(
      (f) => f.sourceComponentId === "app_1" && f.targetComponentId === "tp_1",
    );
    expect(appToTp).toHaveLength(1);
    expect(result).toHaveLength(2);
  });

  it("uses first api/service asset as Application when isMainApplication is not set", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "app_1",
        name: "API",
        type: "asset",
        subType: "api",
      }),
      makeComponent({ id: "actor_1", name: "User", type: "actor" }),
      makeComponent({ id: "tp_1", name: "Stripe", type: "third_party" }),
    ];
    const flows: DetectedDataFlow[] = [
      makeFlow({
        id: "f1",
        sourceComponentId: "actor_1",
        targetComponentId: "tp_1",
        type: "api_call",
      }),
    ];

    const result = rewireFlowsThroughApplication(components, flows);

    expect(result.some((f) => f.targetComponentId === "app_1")).toBe(true);
    expect(result.some((f) => f.sourceComponentId === "app_1" && f.targetComponentId === "tp_1")).toBe(true);
  });

  it("routes synthetic project main → cloud provider (not direct) for Terraform assets", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "main_1",
        name: "learn-terraform-lambda-api-gateway-main",
        type: "asset",
        subType: "application",
        properties: {
          isMainApplication: true,
          sourceContext: "injected_project_placeholder",
          section_id: "root",
        },
      }),
      makeComponent({
        id: "actor_1",
        name: "User",
        type: "actor",
        properties: { section_id: "root" },
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
      makeComponent({
        id: "s3_1",
        name: "lambda_bucket (aws_s3_bucket)",
        type: "asset",
        subType: "storage",
        properties: {
          terraform_address: "aws_s3_bucket.lambda_bucket",
          resource_type: "aws_s3_bucket",
          section_id: "root",
        },
      }),
    ];
    const flows: DetectedDataFlow[] = [
      makeFlow({
        id: "f1",
        sourceComponentId: "actor_1",
        targetComponentId: "s3_1",
        type: "api_call",
      }),
      makeFlow({
        id: "f2",
        sourceComponentId: "tp_aws",
        targetComponentId: "s3_1",
        type: "api_call",
      }),
    ];

    const result = rewireFlowsThroughApplication(components, flows);

    expect(
      result.some(
        (f) =>
          f.sourceComponentId === "actor_1" &&
          f.targetComponentId === "main_1" &&
          f.type === "api_call",
      ),
    ).toBe(true);
    expect(
      result.some(
        (f) =>
          f.sourceComponentId === "main_1" &&
          f.targetComponentId === "tp_aws" &&
          f.type === "api_call",
      ),
    ).toBe(true);
    expect(
      result.some(
        (f) =>
          f.sourceComponentId === "tp_aws" &&
          f.targetComponentId === "s3_1" &&
          f.type === "api_call",
      ),
    ).toBe(true);
    expect(result.some((f) => f.sourceComponentId === "main_1" && f.targetComponentId === "s3_1")).toBe(
      false,
    );
  });
});
