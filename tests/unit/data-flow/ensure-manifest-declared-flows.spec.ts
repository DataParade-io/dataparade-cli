import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import { INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT } from "../../../src/classifier/application-injection";
import {
  ensureManifestDeclaredThirdPartyFlows,
  isManifestOnlyThirdPartyComponent,
} from "../../../src/data-flow/ensure-manifest-declared-flows";

function makeComponent(
  overrides: Partial<DetectedComponent> &
    Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return {
    subType: overrides.subType,
    confidence: overrides.confidence ?? 0.9,
    detectedFrom: overrides.detectedFrom ?? [],
    sourceLocations: overrides.sourceLocations ?? [],
    properties: overrides.properties ?? {},
    ...overrides,
  };
}

describe("ensure-manifest-declared-flows", () => {
  it("isManifestOnlyThirdPartyComponent matches dependency_manifest third parties", () => {
    const tp = makeComponent({
      id: "tp_1",
      name: "Anthropic",
      type: "third_party",
      subType: "ai_provider",
      properties: {
        sourceContext: "dependency_manifest",
        section_id: "packages/twenty-companion",
      },
      detectedFrom: [
        {
          pattern: "external_api_call",
          sourceLocation: {
            filePath: "packages/twenty-companion/package.json",
            startLine: 1,
            endLine: 1,
          },
        },
      ],
    });
    expect(isManifestOnlyThirdPartyComponent(tp)).toBe(true);
  });

  it("adds hub → manifest third_party when package section has a main app", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "hub_1",
        name: "twenty-companion",
        type: "asset",
        subType: "service",
        properties: {
          isMainApplication: true,
          section_id: "packages/twenty-companion",
          sourceContext: INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
        },
      }),
      makeComponent({
        id: "tp_1",
        name: "Anthropic",
        type: "third_party",
        subType: "ai_provider",
        properties: {
          sourceContext: "dependency_manifest",
          section_id: "packages/twenty-companion",
          serviceName: "anthropic",
        },
        detectedFrom: [
          {
            pattern: "external_api_call",
            sourceLocation: {
              filePath: "packages/twenty-companion/package.json",
              startLine: 1,
              endLine: 1,
            },
          },
        ],
      }),
    ];

    const result = ensureManifestDeclaredThirdPartyFlows(components, []);

    expect(result).toHaveLength(1);
    expect(result[0].sourceComponentId).toBe("hub_1");
    expect(result[0].targetComponentId).toBe("tp_1");
    expect(result[0].type).toBe("api_call");
    expect(result[0].enrichmentNotes).toBe("declared_dependency");
  });

  it("does not duplicate an existing hub → third_party flow", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "hub_1",
        name: "twenty-companion",
        type: "asset",
        subType: "service",
        properties: {
          isMainApplication: true,
          section_id: "packages/twenty-companion",
        },
      }),
      makeComponent({
        id: "tp_1",
        name: "Anthropic",
        type: "third_party",
        properties: {
          sourceContext: "dependency_manifest",
          section_id: "packages/twenty-companion",
        },
        detectedFrom: [
          {
            pattern: "external_api_call",
            sourceLocation: {
              filePath: "packages/twenty-companion/package.json",
              startLine: 1,
              endLine: 1,
            },
          },
        ],
      }),
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "hub_1",
        targetComponentId: "tp_1",
        type: "api_call",
        confidence: 0.9,
      },
    ];

    const result = ensureManifestDeclaredThirdPartyFlows(components, flows);
    expect(result).toHaveLength(1);
  });
});
