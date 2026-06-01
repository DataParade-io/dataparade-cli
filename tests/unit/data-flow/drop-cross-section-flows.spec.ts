import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import { postprocessDataFlows } from "../../../src/data-flow/postprocess";
import { dropCrossSectionServiceFlows } from "../../../src/data-flow/drop-cross-section-flows";
import { ensureInjectedProjectMainToTerraformProviderHub } from "../../../src/data-flow/ensure-actor-flow";

describe("dropCrossSectionServiceFlows", () => {
  it("removes flows between different concrete service sections", () => {
    const components: DetectedComponent[] = [
      {
        id: "main_a",
        name: "app-a",
        type: "asset",
        subType: "service",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "packages/app-a",
          isMainApplication: true,
          sourceContext: "injected_project_placeholder",
        },
      },
      {
        id: "tp_k8s",
        name: "Kubernetes",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "packages/tf",
          terraform_address: "provider.kubernetes",
        },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "main_a",
        targetComponentId: "tp_k8s",
        type: "api_call",
        confidence: 0.72,
      },
    ];

    const filtered = dropCrossSectionServiceFlows(components, flows);
    expect(filtered).toHaveLength(0);
  });

  it("keeps flows within the same section", () => {
    const components: DetectedComponent[] = [
      {
        id: "main_tf",
        name: "iac",
        type: "asset",
        subType: "application",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "packages/tf",
          isMainApplication: true,
          sourceContext: "injected_project_placeholder",
        },
      },
      {
        id: "tp_k8s",
        name: "Kubernetes",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "packages/tf",
          terraform_address: "provider.kubernetes",
        },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "main_tf",
        targetComponentId: "tp_k8s",
        type: "api_call",
        confidence: 0.72,
      },
    ];

    expect(dropCrossSectionServiceFlows(components, flows)).toHaveLength(1);
  });
});

describe("postprocessDataFlows cross-section guard", () => {
  it("does not emit monorepo package → remote Terraform hub edges", () => {
    const components: DetectedComponent[] = [
      {
        id: "main_ox",
        name: "twenty-oxlint-rules",
        type: "asset",
        subType: "service",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "packages/twenty-oxlint-rules",
          isMainApplication: true,
          sourceContext: "injected_project_placeholder",
          is_primary_monorepo_package: true,
        },
      },
      {
        id: "tp_k8s",
        name: "Kubernetes",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "packages/twenty-docker/k8s/terraform",
          terraform_address: "provider.kubernetes",
        },
      },
    ];

    const bridged = ensureInjectedProjectMainToTerraformProviderHub(components, []);
    expect(bridged).toHaveLength(0);

    const out = postprocessDataFlows(components, bridged);
    const cross = out.filter((f) => {
      const s = components.find((c) => c.id === f.sourceComponentId);
      const t = components.find((c) => c.id === f.targetComponentId);
      return (
        s &&
        t &&
        s.properties?.section_id !== t.properties?.section_id
      );
    });
    expect(cross).toHaveLength(0);
  });
});
