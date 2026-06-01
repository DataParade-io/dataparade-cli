import type { DetectedComponent } from "../../src/core/types/component";

export function testAsset(
  id: string,
  name: string,
  props: Record<string, unknown>,
  subType = "application",
): DetectedComponent {
  return {
    id,
    name,
    type: "asset",
    subType,
    confidence: 0.9,
    detectedFrom: [],
    sourceLocations: [],
    properties: props,
  };
}
