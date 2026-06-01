import type { RawFinding } from "../../../src/core/types/detection";
import type { DetectedComponent } from "../../../src/core/types/component";
import {
  classifyRawFindings,
  compactAuthServiceComponents,
  dedupeComponents,
  mergeGlobalIdentityProviderThirdParties,
  synthesizeSectionApiNodes,
  mergeDatabaseAssetsByType,
  injectApplicationAssetIfMissing,
  injectActorIfMissing,
} from "../../../src/classifier/classify";
import {
  clearClassifierConfigCacheForTest,
  loadClassifierConfig,
} from "../../../src/classifier/config";
import { enhanceComponents } from "../../../src/classifier/enhance";

function makeLocation(overrides?: Partial<RawFinding["location"]>) {
  return {
    filePath: overrides?.filePath ?? "src/example.ts",
    startLine: overrides?.startLine ?? 1,
    endLine: overrides?.endLine ?? 1,
    code: overrides?.code,
  };
}

function makeFinding(
  overrides: Partial<RawFinding> & Pick<RawFinding, "pattern" | "name">,
): RawFinding {
  return {
    pattern: overrides.pattern,
    name: overrides.name,
    confidence: overrides.confidence ?? 0.9,
    location: overrides.location ?? makeLocation({}),
    properties: overrides.properties ?? {},
    description: overrides.description,
  };
}

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

function makeDatabaseOnlyFindings(): RawFinding[] {
  return [
    makeFinding({
      pattern: "database_connection",
      name: "Primary Postgres",
      properties: {
        client: "pg",
        databaseType: "postgres",
      },
    }),
    makeFinding({
      pattern: "database_connection",
      name: "Reporting Postgres",
      properties: {
        client: "pg",
        databaseType: "postgres",
      },
    }),
  ];
}

function makeExternalApiHeavyFindings(): RawFinding[] {
  return [
    makeFinding({
      pattern: "external_api_call",
      name: "StripeClient",
      properties: {
        serviceName: "stripe",
        client: "@stripe/stripe-js",
      },
    }),
    makeFinding({
      pattern: "external_api_call",
      name: "StripeClient",
      confidence: 0.85,
      properties: {
        serviceName: "stripe",
        client: "stripe",
      },
    }),
    makeFinding({
      pattern: "external_api_call",
      name: "SendGridClient",
      properties: {
        serviceName: "sendgrid",
      },
    }),
    makeFinding({
      pattern: "external_api_call",
      name: "Auth0ApiClient",
      properties: {
        serviceName: "auth0",
      },
    }),
    makeFinding({
      pattern: "external_api_call",
      name: "AwsSdkClient",
      properties: {
        serviceName: "aws",
        client: "@aws-sdk/s3",
      },
    }),
  ];
}

function makeMixedProjectFindings(): RawFinding[] {
  return [
    // No express_route so that injectApplicationAssetIfMissing adds a synthetic app.
    makeFinding({
      pattern: "database_connection",
      name: "Orders DB",
      properties: {
        client: "pg",
        databaseType: "postgres",
      },
    }),
    makeFinding({
      pattern: "external_api_call",
      name: "StripePayments",
      properties: {
        serviceName: "stripe",
      },
    }),
    // Web customer actor interacting with the app.
    makeFinding({
      pattern: "web_actor",
      name: "Customer",
      properties: {
        actorType: "customer",
        sourceContext: "frontend_session",
      },
    }),
    // Service actor representing an internal admin.
    makeFinding({
      pattern: "service_actor",
      name: "Admin user",
      properties: {
        actorType: "employee",
        roleNames: ["admin"],
        sourceContext: "backend_role_check",
      },
    }),
  ];
}

describe("classifier/classify - DP-P0-CLI-201", () => {
  beforeAll(() => {
    // Ensure the classifier config can be loaded from YAML.
    clearClassifierConfigCacheForTest();
    const config = loadClassifierConfig();

    expect(config.patternDefaults.length).toBeGreaterThan(0);
  });

  it("classifies database_connection findings as asset/database components using database_type_mapping", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "database_connection",
        name: "pg",
        properties: {
          client: "pg",
          databaseType: "postgres",
        },
      }),
      makeFinding({
        pattern: "database_connection",
        name: "sql_query_detected",
        confidence: 0.6,
        properties: {
          hint: "raw_sql_keyword",
        },
      }),
    ];

    const components = classifyRawFindings(findings);

    // Raw SQL helper findings (sql_query_detected) should not become
    // standalone components; they only flag raw SQL usage. We still expect
    // the primary database client component to be present.
    const dbComponent = components.find(
      (c) => c.properties.client === "pg",
    );
    const rawSqlComponent = components.find(
      (c) => c.name === "Sql Query Detected",
    );

    expect(dbComponent).toBeDefined();
    expect(dbComponent?.type).toBe("asset");
    expect(dbComponent?.subType).toBe("database");
    expect(dbComponent?.confidence).toBeGreaterThan(0);
    expect(dbComponent?.detectedFrom.length).toBeGreaterThanOrEqual(1);
    expect(dbComponent?.sourceLocations.length).toBeGreaterThanOrEqual(1);
    expect(rawSqlComponent).toBeUndefined();
  });

  it("maps known external_api_call findings to third_party components using YAML-driven catalog", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "external_api_call",
        name: "StripeClient",
        properties: {
          serviceName: "stripe",
        },
      }),
      makeFinding({
        pattern: "external_api_call",
        name: "SendGridClient",
        properties: {
          serviceName: "sendgrid",
        },
        confidence: 0.8,
      }),
      makeFinding({
        pattern: "external_api_call",
        name: "BraintreeClient",
        properties: {
          serviceName: "braintree",
        },
      }),
      makeFinding({
        pattern: "external_api_call",
        name: "AdyenClient",
        properties: {
          serviceName: "adyen",
        },
      }),
      makeFinding({
        pattern: "external_api_call",
        name: "PayPalClient",
        properties: {
          serviceName: "paypal",
        },
      }),
    ];

    const components = classifyRawFindings(findings);

    // We expect at least several third-party components: Stripe, SendGrid, and multiple payment processors.
    expect(components.length).toBeGreaterThanOrEqual(5);

    const stripe = components.find((c) =>
      c.name.toLowerCase().includes("stripe"),
    );
    const sendgrid = components.find((c) =>
      c.name.toLowerCase().includes("sendgrid"),
    );
    const braintree = components.find((c) =>
      c.name.toLowerCase().includes("braintree"),
    );
    const adyen = components.find((c) =>
      c.name.toLowerCase().includes("adyen"),
    );
    const paypal = components.find((c) =>
      c.name.toLowerCase().includes("paypal"),
    );

    expect(stripe).toBeDefined();
    expect(stripe?.type).toBe("third_party");
    expect(stripe?.subType).toBe("payment_processor");

    expect(sendgrid).toBeDefined();
    expect(sendgrid?.type).toBe("third_party");
    expect(sendgrid?.subType).toBe("saas_service");

    expect(braintree).toBeDefined();
    expect(braintree?.type).toBe("third_party");
    expect(braintree?.subType).toBe("payment_processor");

    expect(adyen).toBeDefined();
    expect(adyen?.type).toBe("third_party");
    expect(adyen?.subType).toBe("payment_processor");

    expect(paypal).toBeDefined();
    expect(paypal?.type).toBe("third_party");
    expect(paypal?.subType).toBe("payment_processor");
  });

  it("classifies multiple AI providers as third_party/ai_provider components", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "external_api_call",
        name: "OpenAI SDK",
        properties: {
          serviceName: "openai",
        },
      }),
      makeFinding({
        pattern: "external_api_call",
        name: "Anthropic SDK",
        properties: {
          serviceName: "anthropic",
        },
      }),
      makeFinding({
        pattern: "external_api_call",
        name: "Google AI SDK",
        properties: {
          serviceName: "google_ai",
        },
      }),
    ];

    const components = classifyRawFindings(findings);

    const openai = components.find((c) =>
      c.name.toLowerCase().includes("openai"),
    );
    const anthropic = components.find((c) =>
      c.name.toLowerCase().includes("anthropic"),
    );
    const googleAi = components.find((c) =>
      c.name.toLowerCase().includes("google ai"),
    );

    expect(openai).toBeDefined();
    expect(openai?.type).toBe("third_party");
    expect(openai?.subType).toBe("ai_provider");

    expect(anthropic).toBeDefined();
    expect(anthropic?.type).toBe("third_party");
    expect(anthropic?.subType).toBe("ai_provider");

    expect(googleAi).toBeDefined();
    expect(googleAi?.type).toBe("third_party");
    expect(googleAi?.subType).toBe("ai_provider");
  });

  it("classifies literal https external_api_call as third_party via hostname when not in catalog", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "external_api_call",
        name: "https://api.weirdvendor.io/v1/foo",
        confidence: 0.85,
        properties: {
          client: "fetch",
          url: "https://api.weirdvendor.io/v1/foo",
        },
      }),
    ];
    const components = classifyRawFindings(findings);
    expect(components).toHaveLength(1);
    expect(components[0].type).toBe("third_party");
    expect(components[0].properties.serviceName).toBe("weirdvendor.io");
    expect(components[0].subType).toBe("saas_service");
  });

  it("merges differing property values into arrays and aggregates confidence deterministically", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "external_api_call",
        name: "OpenAI SDK",
        confidence: 0.9,
        properties: {
          serviceName: "openai",
          url: "https://api.openai.com/v1/chat/completions",
        },
      }),
      makeFinding({
        pattern: "external_api_call",
        name: "OpenAI SDK",
        confidence: 0.7,
        properties: {
          serviceName: "openai",
          url: "https://api.openai.com/v1/embeddings",
        },
      }),
    ];

    const first = classifyRawFindings(findings);
    const second = classifyRawFindings(findings);

    expect(first).toHaveLength(1);
    const [component] = first;

    expect(component.type).toBe("third_party");
    expect(component.subType).toBe("ai_provider");

    const urlProp = component.properties.url;
    expect(Array.isArray(urlProp)).toBe(true);
    expect(urlProp).toContain(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(urlProp).toContain(
      "https://api.openai.com/v1/embeddings",
    );

    // Determinism: running classification twice with the same input
    // should yield the same shape (ignoring generated IDs).
    expect(second).toHaveLength(1);
    const again = second[0];
    expect(again.type).toBe(component.type);
    expect(again.subType).toBe(component.subType);
    expect(again.name).toBe(component.name);
  });

  it("skips third-party components detected only from manifest metadata files", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "external_api_call",
        name: "supabase",
        location: makeLocation({
          filePath: "backend/package.json",
          startLine: 1,
          endLine: 1,
        }),
        properties: {
          serviceName: "supabase",
          section_id: "backend",
          section_label: "backend",
          section_role: "service",
        },
      }),
    ];

    const components = classifyRawFindings(findings);
    expect(components).toHaveLength(0);
  });

  it("normalizes generic Route Handler API names to section-specific API label", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "express_route",
        name: "Route Handler",
        properties: {
          section_id: "backend",
          section_label: "Backend",
          section_role: "service",
        },
      }),
    ];

    const components = classifyRawFindings(findings);
    expect(components).toHaveLength(1);
    expect(components[0].type).toBe("asset");
    expect(components[0].subType).toBe("api");
    expect(components[0].name).toBe("Backend API");
  });

  it("synthesizes one explicit section API node when express_route evidence exists but no API asset exists", () => {
    const routeFinding = makeFinding({
      pattern: "express_route",
      name: "Route Handler",
      properties: {
        section_id: "backend",
        section_label: "Backend",
        section_role: "service",
      },
    });

    const withApiNode = synthesizeSectionApiNodes([
      {
        id: "cmp_existing_service",
        name: "Backend Service",
        type: "asset",
        subType: "service",
        confidence: 0.9,
        detectedFrom: [
          {
            pattern: routeFinding.pattern,
            sourceLocation: routeFinding.location,
          },
        ],
        sourceLocations: [routeFinding.location],
        properties: {
          section_id: "backend",
          section_label: "Backend",
          section_role: "service",
        },
      },
    ]);

    const sectionApiNodes = withApiNode.filter(
      (c) =>
        c.type === "asset" &&
        c.subType === "api" &&
        (c.properties.isSectionApiNode === true ||
          c.properties.isSectionApiNode === "true"),
    );
    expect(sectionApiNodes).toHaveLength(1);
    expect(sectionApiNodes[0]?.name).toBe("API");
    expect(sectionApiNodes[0]?.properties.section_id).toBe("backend");
  });

  it("does not synthesize a duplicate section API node when a non-main concrete API already has route evidence", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "express_route",
        name: "Route Handler",
        properties: {
          section_id: "backend",
          section_label: "Backend",
          section_role: "service",
        },
      }),
    ];

    const classified = classifyRawFindings(findings);
    const deduped = dedupeComponents(classified);
    const enhanced = enhanceComponents(deduped).map((c) =>
      c.subType === "api"
        ? {
            ...c,
            name: "Backend API",
            properties: {
              ...c.properties,
              isMainApplication: false,
            },
          }
        : c,
    );

    const withApiNode = synthesizeSectionApiNodes(enhanced);
    const apiAssets = withApiNode.filter(
      (c) =>
        c.type === "asset" &&
        c.subType === "api" &&
        c.properties.section_id === "backend",
    );

    expect(apiAssets).toHaveLength(1);
    expect(apiAssets[0]?.name).toBe("Backend API");
    expect(apiAssets[0]?.properties.isSectionApiNode).toBeUndefined();
  });

  it("synthesizes a section API node when the only section API is the main application", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "express_route",
        name: "Route Handler",
        properties: {
          section_id: "frontend",
          section_label: "frontend",
          section_role: "service",
        },
      }),
    ];

    const classified = classifyRawFindings(findings).map((c) =>
      c.subType === "api"
        ? {
            ...c,
            name: "frontend",
            properties: {
              ...c.properties,
              isMainApplication: true,
            },
          }
        : c,
    );

    const withApiNode = synthesizeSectionApiNodes(classified);
    const sectionApiNodes = withApiNode.filter(
      (c) =>
        c.type === "asset" &&
        c.subType === "api" &&
        c.properties.section_id === "frontend" &&
        (c.properties.isSectionApiNode === true ||
          c.properties.isSectionApiNode === "true"),
    );

    expect(sectionApiNodes).toHaveLength(1);
    expect(sectionApiNodes[0]?.name).toBe("API");
  });
});

describe("classifier/classify - actors", () => {
  beforeEach(() => {
    clearClassifierConfigCacheForTest();
  });

  it("classifies web_actor findings as actor/customer components", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "web_actor",
        name: "Customer",
        properties: {
          actorType: "customer",
          sourceContext: "frontend_session",
        },
      }),
    ];

    const components = classifyRawFindings(findings);
    expect(components).toHaveLength(1);

    const actor = components[0];
    expect(actor.type).toBe("actor");
    expect(actor.subType).toBe("customer");
    expect(actor.name).toBe("Customer");
  });

  it("classifies service_actor findings as actor/employee components", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "service_actor",
        name: "Admin user",
        properties: {
          actorType: "employee",
          roleNames: ["admin"],
          sourceContext: "backend_role_check",
        },
      }),
    ];

    const components = classifyRawFindings(findings);
    expect(components).toHaveLength(1);

    const actor = components[0];
    expect(actor.type).toBe("actor");
    expect(actor.subType).toBe("employee");
    expect(actor.properties.roleNames).toEqual(["admin"]);
  });

  it("prefers actor type when both asset and actor findings are present with higher-priority actor defaults", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "express_route",
        name: "GET /diagrams",
        properties: {
          framework: "express",
        },
      }),
      makeFinding({
        pattern: "web_actor",
        name: "Customer",
        properties: {
          actorType: "customer",
        },
      }),
    ];
    const components = classifyRawFindings(findings);

    const actor = components.find((c) => c.type === "actor");
    const asset = components.find((c) => c.type === "asset");

    expect(actor).toBeDefined();
    expect(actor?.subType).toBe("customer");
    expect(asset).toBeDefined();
  });

  it("merges multiple express_route findings into a single HTTP API asset", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "express_route",
        name: "GET *",
        location: makeLocation({ filePath: "server.ts", startLine: 10 }),
        properties: { httpMethod: "GET", path: "*" },
      }),
      makeFinding({
        pattern: "express_route",
        name: "GET /auth/:provider",
        location: makeLocation({ filePath: "router.ts", startLine: 19 }),
        properties: { httpMethod: "GET", path: "/auth/:provider" },
      }),
      makeFinding({
        pattern: "express_route",
        name: "POST /api/items",
        location: makeLocation({ filePath: "routes/items.ts", startLine: 3 }),
        properties: { httpMethod: "POST", path: "/api/items" },
      }),
    ];

    const components = classifyRawFindings(findings);
    const apiAssets = components.filter(
      (c) => c.type === "asset" && c.subType === "api",
    );

    expect(apiAssets).toHaveLength(1);
    expect(apiAssets[0].name).toBe("HTTP API");
    expect(apiAssets[0].detectedFrom.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps merged HTTP API assets separated by section_id", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "express_route",
        name: "GET /a",
        location: makeLocation({ filePath: "packages/a/src/server.ts", startLine: 10 }),
        properties: {
          httpMethod: "GET",
          path: "/a",
          section_id: "service-a",
          section_label: "service-a",
          section_role: "service",
        },
      }),
      makeFinding({
        pattern: "express_route",
        name: "POST /a/items",
        location: makeLocation({ filePath: "packages/a/src/routes/items.ts", startLine: 3 }),
        properties: {
          httpMethod: "POST",
          path: "/a/items",
          section_id: "service-a",
          section_label: "service-a",
          section_role: "service",
        },
      }),
      makeFinding({
        pattern: "express_route",
        name: "GET /b",
        location: makeLocation({ filePath: "packages/b/src/server.ts", startLine: 5 }),
        properties: {
          httpMethod: "GET",
          path: "/b",
          section_id: "service-b",
          section_label: "service-b",
          section_role: "service",
        },
      }),
    ];

    const components = classifyRawFindings(findings);
    const apiAssets = components.filter(
      (c) => c.type === "asset" && c.subType === "api",
    );
    const sectionIds = apiAssets.map((c) =>
      typeof c.properties.section_id === "string"
        ? c.properties.section_id
        : String(c.properties.section_id),
    );

    expect(apiAssets).toHaveLength(2);
    expect(sectionIds).toContain("service-a");
    expect(sectionIds).toContain("service-b");
  });
});

describe("classifier/classify - env_variable exclusion", () => {
  beforeEach(() => {
    clearClassifierConfigCacheForTest();
  });

  it("does not emit a component for env_variable findings whose key is in env_variable_exclude_keys (e.g. NODE_ENV)", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "env_variable",
        name: "process.env.NODE_ENV",
        properties: { key: "NODE_ENV" },
      }),
    ];

    const components = classifyRawFindings(findings);

    expect(components).toHaveLength(0);
  });

  it("does not emit components for any env_variable (config assets are excluded from output)", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "env_variable",
        name: "process.env.DATABASE_URL",
        properties: { key: "DATABASE_URL" },
      }),
    ];

    const components = classifyRawFindings(findings);

    expect(components).toHaveLength(0);
  });
});

describe("classifier/classify - DP-P0-CLI-202", () => {
  beforeEach(() => {
    clearClassifierConfigCacheForTest();
  });

  it("classifies cloud providers from the dedicated third-party catalog (AWS, GCP, Azure)", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "external_api_call",
        name: "AwsSdkClient",
        properties: {
          serviceName: "aws",
          client: "@aws-sdk/s3",
        },
      }),
      makeFinding({
        pattern: "external_api_call",
        name: "GcpClient",
        properties: {
          serviceName: "gcp",
          client: "@google-cloud/storage",
        },
      }),
      makeFinding({
        pattern: "external_api_call",
        name: "AzureClient",
        properties: {
          serviceName: "azure",
          client: "@azure/storage-blob",
        },
      }),
    ];

    const components = classifyRawFindings(findings);

    const aws = components.find((c) =>
      c.name.toLowerCase().includes("aws"),
    );
    const gcp = components.find((c) =>
      c.name.toLowerCase().includes("gcp"),
    );
    const azure = components.find((c) =>
      c.name.toLowerCase().includes("azure"),
    );

    expect(aws).toBeDefined();
    expect(aws?.type).toBe("third_party");
    expect(aws?.subType).toBe("cloud_provider");

    expect(gcp).toBeDefined();
    expect(gcp?.type).toBe("third_party");
    expect(gcp?.subType).toBe("cloud_provider");

    expect(azure).toBeDefined();
    expect(azure?.type).toBe("third_party");
    expect(azure?.subType).toBe("cloud_provider");
  });

  it("uses catalog to override generic external_api_call asset mapping for SaaS/API providers", () => {
    const findings: RawFinding[] = [
      makeFinding({
        pattern: "external_api_call",
        name: "TwilioApiClient",
        properties: {
          serviceName: "twilio",
        },
      }),
      makeFinding({
        pattern: "external_api_call",
        name: "FirebaseSdk",
        properties: {
          serviceName: "firebase",
        },
      }),
      makeFinding({
        pattern: "external_api_call",
        name: "Auth0ApiClient",
        properties: {
          serviceName: "auth0",
        },
      }),
    ];

    const components = classifyRawFindings(findings);

    const twilio = components.find((c) =>
      c.name.toLowerCase().includes("twilio"),
    );
    const firebase = components.find((c) =>
      c.name.toLowerCase().includes("firebase"),
    );
    const auth0 = components.find((c) =>
      c.name.toLowerCase().includes("auth0"),
    );

    expect(twilio).toBeDefined();
    expect(twilio?.type).toBe("third_party");
    expect(twilio?.subType).toBe("saas_service");

    expect(firebase).toBeDefined();
    expect(firebase?.type).toBe("third_party");
    expect(firebase?.subType).toBe("saas_service");

    expect(auth0).toBeDefined();
    expect(auth0?.type).toBe("third_party");
    expect(auth0?.subType).toBe("saas_service");
  });
});

describe("classifier/dedupe & application asset - DP-P0-CLI-204", () => {
  it("dedupeComponents merges components by type + normalized name across assets, third parties, and actors", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_1",
        name: "User DB",
        type: "asset",
        subType: "database",
        properties: { region: "us-east-1" },
      }),
      makeComponent({
        id: "cmp_2",
        name: "user   db",
        type: "asset",
        subType: "database",
        properties: { region: "eu-west-1" },
      }),
      makeComponent({
        id: "cmp_3",
        name: "Stripe",
        type: "third_party",
        subType: "payment_processor",
        properties: { url: "https://api.stripe.com" },
      }),
      makeComponent({
        id: "cmp_4",
        name: "stripe ",
        type: "third_party",
        subType: "payment_processor",
        properties: { url: "https://api.stripe.com/v2" },
      }),
      makeComponent({
        id: "cmp_5",
        name: "Customer",
        type: "actor",
        subType: "customer",
        properties: { segment: "retail" },
      }),
      makeComponent({
        id: "cmp_6",
        name: "customer",
        type: "actor",
        subType: "customer",
        properties: { region: "EU" },
      }),
    ];

    const deduped = dedupeComponents(components);

    const assets = deduped.filter((c) => c.type === "asset");
    const thirdParties = deduped.filter((c) => c.type === "third_party");
    const actors = deduped.filter((c) => c.type === "actor");

    expect(assets).toHaveLength(1);
    expect(thirdParties).toHaveLength(1);
    expect(actors).toHaveLength(1);

    const assetRegion = assets[0].properties.region;
    expect(Array.isArray(assetRegion)).toBe(true);
    expect(assetRegion).toContain("us-east-1");
    expect(assetRegion).toContain("eu-west-1");

    const urls = thirdParties[0].properties.url;
    expect(Array.isArray(urls)).toBe(true);
    expect(urls).toContain("https://api.stripe.com");
    expect(urls).toContain("https://api.stripe.com/v2");
  });

  it("merges asset components by normalized name when names differ only by case/spacing", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_1",
        name: "Postgres",
        type: "asset",
        subType: "database",
        properties: { databaseType: "postgres", region: "us-east-1" },
      }),
      makeComponent({
        id: "cmp_2",
        name: "postgres",
        type: "asset",
        subType: "database",
        properties: { databaseType: "postgres", region: "eu-west-1" },
      }),
    ];

    const deduped = dedupeComponents(components);

    expect(deduped).toHaveLength(1);
    const [merged] = deduped;
    expect(merged.type).toBe("asset");
    expect(merged.subType).toBe("database");
    const regionProp = merged.properties.region;
    expect(Array.isArray(regionProp)).toBe(true);
    expect(regionProp).toContain("us-east-1");
    expect(regionProp).toContain("eu-west-1");
  });

  it("does not merge components that share a name but differ in type", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_1",
        name: "Auth0",
        type: "asset",
        subType: "api",
        properties: {},
      }),
      makeComponent({
        id: "cmp_2",
        name: "Auth0",
        type: "third_party",
        subType: "saas_service",
        properties: {},
      }),
    ];

    const deduped = dedupeComponents(components);

    const asset = deduped.find((c) => c.type === "asset");
    const thirdParty = deduped.find((c) => c.type === "third_party");

    expect(asset).toBeDefined();
    expect(thirdParty).toBeDefined();
  });

  it("injects a synthetic application asset when none exists and marks it as main application after enhancement", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_1",
        name: "DB",
        type: "asset",
        subType: "database",
        properties: {},
      }),
      makeComponent({
        id: "cmp_2",
        name: "Stripe",
        type: "third_party",
        subType: "payment_processor",
        properties: {},
      }),
    ];

    const withApp = injectApplicationAssetIfMissing(components, {
      projectName: "my-app",
    });

    expect(withApp.length).toBe(3);
    const synthetic = withApp.find(
      (c) => c.type === "asset" && c.name === "my-app",
    );
    expect(synthetic).toBeDefined();

    const enhanced = enhanceComponents(withApp);
    const mainApps = enhanced.filter(
      (c) => c.properties.isMainApplication === true,
    );
    expect(mainApps).toHaveLength(1);
    expect(mainApps[0].name).toBe("my-app");
  });

  it("does not inject an application asset when an application-like asset already exists", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_1",
        name: "App API",
        type: "asset",
        subType: "api",
        properties: {},
      }),
      makeComponent({
        id: "cmp_2",
        name: "DB",
        type: "asset",
        subType: "database",
        properties: {},
      }),
    ];

    const withApp = injectApplicationAssetIfMissing(components, {
      projectName: "ignored",
    });

    expect(withApp).toHaveLength(2);
  });

  it("does not inject when merged HTTP API (express) is the only application hub", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_api",
        name: "HTTP API",
        type: "asset",
        subType: "api",
        properties: { framework: "express" },
      }),
      makeComponent({
        id: "cmp_db",
        name: "Postgres",
        type: "asset",
        subType: "database",
        properties: { databaseType: "postgres" },
      }),
    ];

    const withApp = injectApplicationAssetIfMissing(components, {
      projectName: "should-not-appear",
    });

    expect(withApp).toHaveLength(2);
    expect(withApp.some((c) => c.name === "should-not-appear")).toBe(false);
  });

  it("treats single-route API assets as non-application and injects a separate main application", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_route",
        name: "POST /api/ai-completion",
        type: "asset",
        subType: "api",
        properties: {
          framework: "express",
        },
      }),
    ];

    const withApp = injectApplicationAssetIfMissing(components, {
      projectName: "my-app",
    });

    expect(withApp).toHaveLength(2);

    const routeAsset = withApp.find(
      (c) => c.id === "cmp_route" && c.type === "asset",
    );
    const appAsset = withApp.find(
      (c) => c.type === "asset" && c.name === "my-app",
    );

    expect(routeAsset).toBeDefined();
    expect(appAsset).toBeDefined();

    const enhanced = enhanceComponents(withApp);
    const mainApps = enhanced.filter(
      (c) => c.properties.isMainApplication === true,
    );

    expect(mainApps).toHaveLength(1);
    expect(mainApps[0].name).toBe("my-app");
  });

  describe("injectActorIfMissing", () => {
    it("injects a User actor for user-entrypoint sections (application main app)", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "cmp_1",
          name: "MyApp",
          type: "asset",
          subType: "application",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "cmp_2",
          name: "Postgres",
          type: "asset",
          subType: "database",
          properties: {},
        }),
      ];

      const result = injectActorIfMissing(components);

      expect(result).toHaveLength(3);
      const actor = result.find((c) => c.type === "actor");
      expect(actor).toBeDefined();
      expect(actor?.name).toBe("User");
      expect(actor?.subType).toBe("customer");
      expect(actor?.properties?.sourceContext).toBe("injected_default");
    });

    it("does not inject a User actor for backend-style main app sections", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "cmp_1",
          name: "Backend API",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true, section_id: "backend" },
        }),
      ];

      const result = injectActorIfMissing(components);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("asset");
    });

    it("injects a User actor for frontend frameworks even when main app subtype is api", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "cmp_1",
          name: "Frontend API Surface",
          type: "asset",
          subType: "api",
          properties: {
            isMainApplication: true,
            section_id: "frontend",
            framework: "next_or_react_route",
          },
        }),
      ];

      const result = injectActorIfMissing(components);
      const actor = result.find((c) => c.type === "actor");
      expect(actor).toBeDefined();
      expect(actor?.name).toBe("User");
      expect(actor?.properties?.section_id).toBe("frontend");
    });

    it("injects User as api_consumer for backend projects", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "cmp_1",
          name: "Backend App",
          type: "asset",
          subType: "application",
          properties: {
            isMainApplication: true,
            section_id: "reedy-backend",
            framework: "fastapi",
          },
        }),
      ];

      const result = injectActorIfMissing(components);
      const actor = result.find((c) => c.type === "actor");
      expect(actor).toBeDefined();
      expect(actor?.name).toBe("User");
      expect(actor?.subType).toBe("api_consumer");
      expect(actor?.properties?.section_id).toBe("reedy-backend");
    });

    it("does not inject when actors already exist", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "cmp_1",
          name: "MyApp",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "cmp_2",
          name: "Customer",
          type: "actor",
          subType: "customer",
          properties: {},
        }),
      ];

      const result = injectActorIfMissing(components);

      expect(result).toHaveLength(2);
      const actors = result.filter((c) => c.type === "actor");
      expect(actors).toHaveLength(1);
      expect(actors[0].name).toBe("Customer");
    });

    it("does not inject when no main application exists", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "cmp_1",
          name: "Postgres",
          type: "asset",
          subType: "database",
          properties: {},
        }),
      ];

      const result = injectActorIfMissing(components);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("asset");
    });

    it("does not inject when components is empty", () => {
      const result = injectActorIfMissing([]);
      expect(result).toEqual([]);
    });
  });

  describe("compactAuthServiceComponents", () => {
    it("merges auth_service properties into same-section Auth0 node and removes standalone auth_service", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "tp_1",
          name: "Auth0",
          type: "third_party",
          subType: "saas_service",
          properties: {
            section_id: "backend",
            section_label: "backend",
            section_role: "service",
            serviceName: "auth0",
          },
        }),
        makeComponent({
          id: "a_1",
          name: "Jwt Auth",
          type: "asset",
          subType: "auth_service",
          properties: {
            section_id: "backend",
            section_label: "backend",
            section_role: "service",
            strategy: "jwt",
            authentication_method: "jwt",
          },
        }),
      ];

      const compacted = compactAuthServiceComponents(components);
      expect(compacted.find((c) => c.id === "a_1")).toBeUndefined();

      const auth0 = compacted.find((c) => c.id === "tp_1");
      expect(auth0).toBeDefined();
      expect(auth0?.properties.strategy).toBe("jwt");
      expect(auth0?.properties.authentication_method).toBe("jwt");
      expect(auth0?.type).toBe("third_party");
    });
  });

  it("merges third_party components by serviceName even when names differ", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_10",
        name: "Auth0",
        type: "third_party",
        subType: "saas_service",
        properties: {
          serviceName: "auth0",
          client: "auth0",
        },
      }),
      makeComponent({
        id: "cmp_11",
        name: "Https://${auth0Domain}/dbconnections/change_password",
        type: "third_party",
        subType: "saas_service",
        properties: {
          serviceName: "auth0",
          client: "fetch",
          url: "https://${auth0Domain}/dbconnections/change_password",
        },
      }),
    ];

    const deduped = dedupeComponents(components);

    expect(deduped).toHaveLength(1);
    const [merged] = deduped;
    expect(merged.type).toBe("third_party");
    expect(merged.subType).toBe("saas_service");
    expect(merged.properties.serviceName).toBe("auth0");
    const clientProp = merged.properties.client;
    expect(Array.isArray(clientProp)).toBe(true);
    expect(clientProp).toContain("auth0");
    expect(clientProp).toContain("fetch");
  });

  it("keeps third_party components separate per section_id (no global bucket)", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_1",
        name: "Auth0",
        type: "third_party",
        subType: "saas_service",
        properties: {
          serviceName: "auth0",
          client: "auth0",
          section_id: "frontend",
          section_label: "Frontend",
          section_role: "service",
        },
      }),
      makeComponent({
        id: "cmp_2",
        name: "Auth0",
        type: "third_party",
        subType: "saas_service",
        properties: {
          serviceName: "auth0",
          client: "fetch",
          section_id: "backend",
          section_label: "Backend",
          section_role: "service",
        },
      }),
    ];

    const deduped = dedupeComponents(components);

    expect(deduped).toHaveLength(2);

    const frontend = deduped.find(
      (c) => c.properties.section_id === "frontend",
    );
    const backend = deduped.find(
      (c) => c.properties.section_id === "backend",
    );

    expect(frontend).toBeDefined();
    expect(backend).toBeDefined();

    expect(frontend?.type).toBe("third_party");
    expect(frontend?.subType).toBe("saas_service");
    expect(frontend?.properties.section_label).toBe("Frontend");
    expect(frontend?.properties.section_role).toBe("service");

    expect(backend?.type).toBe("third_party");
    expect(backend?.subType).toBe("saas_service");
    expect(backend?.properties.section_label).toBe("Backend");
    expect(backend?.properties.section_role).toBe("service");
  });

  describe("mergeGlobalIdentityProviderThirdParties", () => {
    it("merges Auth0 third_party nodes from different sections into one canonical component", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "cmp_fe",
          name: "Auth0",
          type: "third_party",
          subType: "saas_service",
          confidence: 0.85,
          sourceLocations: [
            {
              filePath: "frontend/app/auth/route.ts",
              startLine: 1,
              endLine: 1,
            },
          ],
          properties: {
            serviceName: "auth0",
            client: "spa",
            section_id: "frontend",
            section_label: "Frontend",
            section_role: "service",
          },
        }),
        makeComponent({
          id: "cmp_be",
          name: "Auth0",
          type: "third_party",
          subType: "saas_service",
          confidence: 0.85,
          sourceLocations: [
            {
              filePath: "backend/src/auth/guard.ts",
              startLine: 1,
              endLine: 1,
            },
          ],
          properties: {
            serviceName: "auth0",
            client: "passport",
            section_id: "backend",
            section_label: "Backend",
            section_role: "service",
          },
        }),
      ];

      const merged = mergeGlobalIdentityProviderThirdParties(components);

      expect(merged).toHaveLength(1);
      expect(merged[0]!.id).toBe("cmp_be");
      const client = merged[0]!.properties.client;
      expect(Array.isArray(client)).toBe(true);
      expect(client).toEqual(expect.arrayContaining(["spa", "passport"]));
      expect(merged[0]!.properties.section_id).toBe("backend");
      expect(merged[0]!.sourceLocations.map((l) => l.filePath)).toEqual(
        expect.arrayContaining([
          "frontend/app/auth/route.ts",
          "backend/src/auth/guard.ts",
        ]),
      );
    });

    it("prefers backend-scoped IdP base even when frontend row has higher confidence", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "cmp_fe",
          name: "Auth0",
          type: "third_party",
          subType: "saas_service",
          confidence: 0.99,
          sourceLocations: [
            {
              filePath: "frontend/app/auth/route.ts",
              startLine: 1,
              endLine: 1,
            },
          ],
          properties: {
            serviceName: "auth0",
            section_id: "frontend",
          },
        }),
        makeComponent({
          id: "cmp_be",
          name: "Auth0",
          type: "third_party",
          subType: "saas_service",
          confidence: 0.8,
          sourceLocations: [
            {
              filePath: "backend/src/auth/strategy.ts",
              startLine: 1,
              endLine: 1,
            },
          ],
          properties: {
            serviceName: "auth0",
            section_id: "backend",
          },
        }),
      ];

      const merged = mergeGlobalIdentityProviderThirdParties(components);
      expect(merged).toHaveLength(1);
      expect(merged[0]!.id).toBe("cmp_be");
      expect(merged[0]!.properties.section_id).toBe("backend");
    });

    it("does not merge non-IdP third_party vendors across sections", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "a",
          name: "Aws",
          type: "third_party",
          subType: "saas_service",
          properties: {
            serviceName: "aws",
            section_id: "frontend",
          },
        }),
        makeComponent({
          id: "b",
          name: "Aws",
          type: "third_party",
          subType: "saas_service",
          properties: {
            serviceName: "aws",
            section_id: "backend",
          },
        }),
      ];

      const merged = mergeGlobalIdentityProviderThirdParties(components);
      expect(merged).toHaveLength(2);
    });
  });

  it("mergeDatabaseAssetsByType merges database assets by canonical technology (postgres/supabase/pg → one, redis → one)", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_1",
        name: "Supabase",
        type: "asset",
        subType: "database",
        properties: { client: "supabase" },
      }),
      makeComponent({
        id: "cmp_2",
        name: "Pg",
        type: "asset",
        subType: "database",
        properties: { client: "pg", databaseType: "postgres" },
      }),
      makeComponent({
        id: "cmp_3",
        name: "Redis",
        type: "asset",
        subType: "database",
        properties: { client: "redis" },
      }),
    ];

    const merged = mergeDatabaseAssetsByType(components);

    const dbAssets = merged.filter(
      (c) => c.type === "asset" && c.subType === "database",
    );
    expect(dbAssets).toHaveLength(2);

    const postgresLike = dbAssets.find(
      (c) =>
        c.name.toLowerCase().includes("postgres") ||
        c.name.toLowerCase().includes("supabase") ||
        c.name.toLowerCase().includes("pg"),
    );
    const redisLike = dbAssets.find((c) =>
      c.name.toLowerCase().includes("redis"),
    );
    expect(postgresLike).toBeDefined();
    expect(redisLike).toBeDefined();
    expect(postgresLike?.properties.client || postgresLike?.properties.databaseType).toBeTruthy();
    expect(redisLike?.properties.client).toBe("redis");
  });

  it("mergeDatabaseAssetsByType keeps database components separate per section_id (no global bucket)", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_1",
        name: "Supabase",
        type: "asset",
        subType: "database",
        properties: {
          client: "supabase",
          section_id: "frontend",
          section_label: "Frontend",
          section_role: "service",
        },
      }),
      makeComponent({
        id: "cmp_2",
        name: "Pg",
        type: "asset",
        subType: "database",
        properties: {
          client: "pg",
          databaseType: "postgres",
          section_id: "backend",
          section_label: "Backend",
          section_role: "service",
        },
      }),
    ];

    const merged = mergeDatabaseAssetsByType(components);

    const dbAssets = merged.filter(
      (c) => c.type === "asset" && c.subType === "database",
    );
    expect(dbAssets).toHaveLength(2);

    const frontendDb = dbAssets.find(
      (c) => c.properties.section_id === "frontend",
    );
    const backendDb = dbAssets.find(
      (c) => c.properties.section_id === "backend",
    );

    expect(frontendDb).toBeDefined();
    expect(backendDb).toBeDefined();

    expect(frontendDb?.properties.section_label).toBe("Frontend");
    expect(frontendDb?.properties.section_role).toBe("service");
    expect(backendDb?.properties.section_label).toBe("Backend");
    expect(backendDb?.properties.section_role).toBe("service");
  });
});

describe("classifier/classify - DP-P0-CLI-205", () => {
  beforeEach(() => {
    clearClassifierConfigCacheForTest();
  });

  it("classifies a database-only project into asset/database components", () => {
    const findings = makeDatabaseOnlyFindings();

    const classified = classifyRawFindings(findings);
    const deduped = dedupeComponents(classified);

    expect(classified.length).toBeGreaterThanOrEqual(1);
    expect(deduped.length).toBeGreaterThanOrEqual(1);

    for (const component of deduped) {
      expect(component.type).toBe("asset");
      expect(component.subType).toBe("database");
      expect(component.sourceLocations.length).toBeGreaterThanOrEqual(1);
      expect(component.detectedFrom.length).toBeGreaterThanOrEqual(1);
    }

    // No third-party components should be inferred in a database-only project.
    expect(deduped.find((c) => c.type === "third_party")).toBeUndefined();
  });

  it("classifies an external-API-heavy project into third_party components and merges duplicate services", () => {
    const findings = makeExternalApiHeavyFindings();

    const classified = classifyRawFindings(findings);
    const deduped = dedupeComponents(classified);

    const stripe = deduped.find((c) =>
      c.name.toLowerCase().includes("stripe"),
    );
    const sendgrid = deduped.find((c) =>
      c.name.toLowerCase().includes("sendgrid"),
    );
    const auth0 = deduped.find((c) =>
      c.name.toLowerCase().includes("auth0"),
    );
    const aws = deduped.find((c) =>
      c.name.toLowerCase().includes("aws"),
    );

    expect(stripe).toBeDefined();
    expect(stripe?.type).toBe("third_party");
    expect(stripe?.subType).toBe("payment_processor");
    const stripeClientProp = stripe?.properties.client;
    if (stripeClientProp) {
      expect(Array.isArray(stripeClientProp)).toBe(true);
      expect(stripeClientProp).toEqual(
        expect.arrayContaining(["@stripe/stripe-js", "stripe"]),
      );
    }

    expect(sendgrid).toBeDefined();
    expect(sendgrid?.type).toBe("third_party");
    expect(sendgrid?.subType).toBe("saas_service");

    expect(auth0).toBeDefined();
    expect(auth0?.type).toBe("third_party");
    expect(auth0?.subType).toBe("saas_service");

    expect(aws).toBeDefined();
    expect(aws?.type).toBe("third_party");
    expect(aws?.subType).toBe("cloud_provider");
  });

  it("handles a mixed project with assets, actors, and third parties and injects an application asset when missing", () => {
    const findings = makeMixedProjectFindings();

    const classified = classifyRawFindings(findings);
    const deduped = dedupeComponents(classified);

    const assets = deduped.filter((c) => c.type === "asset");
    const thirdParties = deduped.filter((c) => c.type === "third_party");
    const actors = deduped.filter((c) => c.type === "actor");

    expect(assets.length).toBeGreaterThanOrEqual(1);
    expect(
      assets.some((c) => c.subType === "database"),
    ).toBe(true);

    expect(thirdParties.length).toBeGreaterThanOrEqual(1);
    expect(
      thirdParties.some((c) => c.subType === "payment_processor"),
    ).toBe(true);

    expect(actors.length).toBeGreaterThanOrEqual(2);

    const withApp = injectApplicationAssetIfMissing(deduped, {
      projectName: "mixed-project",
    });
    const enhanced = enhanceComponents(withApp);

    const mainApps = enhanced.filter(
      (c) => c.properties.isMainApplication === true,
    );
    expect(mainApps).toHaveLength(1);
    expect(mainApps[0].name).toBe("mixed-project");
  });
});


