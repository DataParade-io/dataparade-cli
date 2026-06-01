import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import { ensureInjectedProjectMainToTerraformProviderHub } from "../../../src/data-flow/ensure-actor-flow";

function makeComponent(
  partial: Partial<DetectedComponent> & Pick<DetectedComponent, "id">,
): DetectedComponent {
  return {
    name: partial.id,
    type: "asset",
    confidence: 1,
    detectedFrom: [],
    sourceLocations: [],
    properties: {},
    ...partial,
  };
}

describe("ensureInjectedProjectMainToTerraformProviderHub — cross-section scope", () => {
  it("does not bridge tooling packages to the global Terraform hub", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "main_cli",
        name: "twenty-cli",
        subType: "application",
        properties: {
          isMainApplication: true,
          sourceContext: "injected_project_placeholder",
          section_id: "packages/twenty-cli",
        },
      }),
      makeComponent({
        id: "k8s",
        name: "Kubernetes",
        type: "third_party",
        properties: {
          terraform_address: "provider.kubernetes",
          section_id: "packages/twenty-docker/k8s/terraform",
        },
      }),
    ];

    const flows: DetectedDataFlow[] = [];
    const result = ensureInjectedProjectMainToTerraformProviderHub(components, flows);

    expect(result).toHaveLength(0);
  });

  it("does not bridge primary monorepo main to Terraform hub in another section", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "main_server",
        name: "api",
        subType: "application",
        properties: {
          isMainApplication: true,
          sourceContext: "injected_project_placeholder",
          section_id: "packages/api",
          is_primary_monorepo_package: true,
        },
      }),
      makeComponent({
        id: "k8s",
        name: "Kubernetes",
        type: "third_party",
        properties: {
          terraform_address: "provider.kubernetes",
          section_id: "packages/twenty-docker/k8s/terraform",
        },
      }),
    ];

    const result = ensureInjectedProjectMainToTerraformProviderHub(components, []);

    expect(result).toHaveLength(0);
  });

  it("bridges injected main to provider hub in the same section only", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "main_iac",
        name: "iac-root",
        subType: "application",
        properties: {
          isMainApplication: true,
          sourceContext: "injected_project_placeholder",
          section_id: "packages/acme/k8s/terraform",
        },
      }),
      makeComponent({
        id: "k8s",
        name: "Kubernetes",
        type: "third_party",
        properties: {
          terraform_address: "provider.kubernetes",
          section_id: "packages/acme/k8s/terraform",
        },
      }),
    ];

    const result = ensureInjectedProjectMainToTerraformProviderHub(components, []);

    expect(result).toHaveLength(1);
    expect(result[0]?.sourceComponentId).toBe("main_iac");
    expect(result[0]?.targetComponentId).toBe("k8s");
  });
});
