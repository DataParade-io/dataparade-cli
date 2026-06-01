import {
  terraformAssetBelongsToProviderRule,
  terraformAssetMatchesManagedServiceTopologyRule,
  terraformResourceTypeMatchesTopologyRule,
} from "../../../src/ai-enrichment/provider-topology-shared";
import type { DetectedComponent } from "../../../src/core/types/component";

describe("provider topology — Kubernetes Terraform resource_type rules", () => {
  const workloadNode = {
    key: "workload",
    usageSignals: [] as string[],
    terraformResourceTypes: [] as string[],
    terraformResourceTypePrefixes: ["kubernetes_deployment"],
  };

  const serviceNode = {
    key: "service",
    usageSignals: [] as string[],
    terraformResourceTypes: [] as string[],
    terraformResourceTypePrefixes: ["kubernetes_service"],
  };

  it("matches kubernetes_deployment by prefix", () => {
    expect(
      terraformResourceTypeMatchesTopologyRule(
        "kubernetes_deployment",
        [],
        ["kubernetes_deployment"],
      ),
    ).toBe(true);
    expect(
      terraformResourceTypeMatchesTopologyRule(
        "kubernetes_service",
        [],
        ["kubernetes_deployment"],
      ),
    ).toBe(false);
  });

  it("assigns kubernetes assets to the kubernetes provider rule", () => {
    const deployment: DetectedComponent = {
      id: "d1",
      name: "app",
      type: "asset",
      confidence: 1,
      detectedFrom: [],
      sourceLocations: [],
      properties: {
        resource_type: "kubernetes_deployment",
        cloud_provider: "kubernetes",
        terraform_address: "kubernetes_deployment.app",
      },
    };
    expect(terraformAssetBelongsToProviderRule(deployment, "kubernetes")).toBe(true);
    expect(terraformAssetBelongsToProviderRule(deployment, "aws")).toBe(false);
    expect(terraformAssetMatchesManagedServiceTopologyRule(deployment, workloadNode)).toBe(
      true,
    );
    expect(terraformAssetMatchesManagedServiceTopologyRule(deployment, serviceNode)).toBe(
      false,
    );
  });
});
