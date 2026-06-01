import {
  ensureThirdPartySubTypes,
  inferThirdPartySubType,
  normalizeThirdPartySubType,
} from "../../../src/ai-enrichment/third-party-subtype";
import type { DetectedComponent } from "../../../src/core/types/component";

function tp(partial: Partial<DetectedComponent> & { name: string }): DetectedComponent {
  const { name, properties, ...rest } = partial;
  return {
    id: "cmp_1",
    type: "third_party",
    confidence: 0.8,
    detectedFrom: [],
    sourceLocations: [],
    properties: properties ?? {},
    name,
    ...rest,
  };
}

describe("normalizeThirdPartySubType", () => {
  it("normalizes aliases and accepts taxonomy values", () => {
    expect(normalizeThirdPartySubType("AI Provider")).toBe("ai_provider");
    expect(normalizeThirdPartySubType("saas_service")).toBe("saas_service");
    expect(normalizeThirdPartySubType("payment")).toBe("payment_processor");
  });
});

describe("inferThirdPartySubType", () => {
  it("infers ai_provider for OpenAI from name", () => {
    expect(
      inferThirdPartySubType(tp({ name: "Openai", properties: { client: "openai" } })),
    ).toBe("ai_provider");
  });

  it("infers payment_processor for Stripe", () => {
    expect(inferThirdPartySubType(tp({ name: "Stripe" }))).toBe("payment_processor");
  });

  it("keeps existing normalized subType", () => {
    expect(
      inferThirdPartySubType(
        tp({ name: "X", subType: "cloud_provider" }),
      ),
    ).toBe("cloud_provider");
  });
});

describe("ensureThirdPartySubTypes", () => {
  it("fills missing subType on third_party components", () => {
    const components = [
      tp({ id: "cmp_a", name: "Auth0", subType: undefined }),
      tp({ id: "cmp_b", name: "Internal API", type: "asset", subType: "api" }),
    ] as DetectedComponent[];
    const filled = ensureThirdPartySubTypes(components);
    expect(filled).toBe(1);
    expect(components[0].subType).toBe("saas_service");
  });
});
