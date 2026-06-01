import {
  buildThirdPartyHeuristicProposal,
  verifyThirdPartyProposal,
} from "../../../src/ai-enrichment/third-party-evidence";
import type { AiInferenceCandidate } from "../../../src/ai-enrichment/types";
import type { DetectedComponent } from "../../../src/core/types/component";
import type { FileInfo } from "../../../src/core/types/file";

function candidate(componentId: string): AiInferenceCandidate {
  return {
    id: `cand_${componentId}`,
    candidateType: "third_party",
    priority: 90,
    componentId,
    missingFields: ["vendor", "api_type", "authentication_method"],
    rationale: "fill sparse third-party properties from evidence",
    hints: [],
  };
}

function component(): DetectedComponent {
  return {
    id: "cmp_tp_1",
    name: "Stripe",
    type: "third_party",
    confidence: 0.9,
    detectedFrom: [
      {
        pattern: "external_api_call",
        sourceLocation: {
          filePath: "backend/services/payments/index.ts",
          startLine: 1,
          endLine: 1,
        },
      },
    ],
    sourceLocations: [
      { filePath: "backend/services/payments/index.ts", startLine: 1, endLine: 1 },
    ],
    properties: {
      section_id: "backend/services/payments",
      vendor: null,
      serviceName: null,
      client: null,
      integration_method: [],
      api_type: null,
      authentication_method: null,
      documentation_url: null,
      sdk_available: false,
      api_endpoint: null,
      https_enforced: null,
      vendor_soc2_iso27001: [],
    },
  };
}

function files(): FileInfo[] {
  return [
    {
      path: "backend/services/payments/index.ts",
      name: "index.ts",
      language: "typescript",
      size: 200,
      content: [
        'import Stripe from "stripe";',
        "const client = new Stripe(process.env.STRIPE_API_KEY || \"\", { apiVersion: \"2023-10-16\" });",
        "await fetch(\"https://api.stripe.com/v1/customers\", {",
        "  headers: { Authorization: `Bearer ${process.env.STRIPE_API_KEY}` }",
        "});",
      ].join("\n"),
    },
    {
      path: "backend/services/payments/package.json",
      name: "package.json",
      language: "json",
      size: 80,
      content: JSON.stringify({
        dependencies: {
          stripe: "^17.0.0",
        },
      }),
    },
  ];
}

describe("third-party evidence enrichment", () => {
  it("builds an evidence-backed proposal for sparse third-party fields", () => {
    const proposal = buildThirdPartyHeuristicProposal({
      candidate: candidate("cmp_tp_1"),
      component: component(),
      files: files(),
    });

    expect(proposal).toBeDefined();
    expect(proposal?.kind).toBe("component_patch");
    expect(proposal?.setProperties.vendor).toBe("Stripe");
    expect(proposal?.setProperties.authentication_method).toBe("bearer_token");
    expect(proposal?.setProperties.api_type).toBe("rest");
    expect(proposal?.setProperties.documentation_url).toBe("https://docs.stripe.com");
    expect(proposal?.evidence.length).toBeGreaterThan(0);
    expect(verifyThirdPartyProposal(proposal!)).toEqual({ ok: true });
  });

  it("accepts proposals for additional fields when evidence is present", () => {
    const proposal = buildThirdPartyHeuristicProposal({
      candidate: candidate("cmp_tp_1"),
      component: {
        ...component(),
        properties: {
          ...component().properties,
          vendor: "Stripe",
          vendor_soc2_iso27001: [],
        },
      },
      files: files(),
    });

    expect(proposal).toBeDefined();
    if (!proposal) return;
    proposal.setProperties.vendor_soc2_iso27001 = ["soc2"];
    proposal.propertyEvidence = {
      ...(proposal.propertyEvidence ?? {}),
      vendor_soc2_iso27001: proposal.evidence.slice(0, 1),
    };
    expect(verifyThirdPartyProposal(proposal)).toEqual({ ok: true });
  });
});

