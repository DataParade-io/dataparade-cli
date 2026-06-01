import { applyDeterministicInferenceFallbacks } from "../../../src/ai-enrichment/fallbacks";
import { clearProviderTopologyRulesCacheForTest } from "../../../src/ai-enrichment/provider-topology-rules";
import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";

describe("ai-enrichment deterministic fallbacks", () => {
  beforeEach(() => {
    clearProviderTopologyRulesCacheForTest();
  });

  it("reverses suspicious asset->actor direction", () => {
    const components: DetectedComponent[] = [
      {
        id: "asset_1",
        name: "Backend",
        type: "asset",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "backend" },
      },
      {
        id: "actor_1",
        name: "Customer",
        type: "actor",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "frontend" },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "asset_1",
        targetComponentId: "actor_1",
        type: "api_call",
        confidence: 0.6,
      },
    ];

    const fallbackResult = applyDeterministicInferenceFallbacks(components, flows);
    const patched = fallbackResult.dataFlows;
    const patchedComponents = fallbackResult.components;
    expect(patched[0]?.sourceComponentId).toBe("actor_1");
    expect(patched[0]?.targetComponentId).toBe("asset_1");
  });

  it("rewrites app -> pg as app -> supabase -> pg for supabase-backed client evidence", () => {
    const components: DetectedComponent[] = [
      {
        id: "app_1",
        name: "Root API",
        type: "asset",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "backend" },
      },
      {
        id: "tp_1",
        name: "Supabase",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { serviceName: "supabase", section_id: "backend" },
      },
      {
        id: "db_1",
        name: "Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { client: "supabase", databaseType: "postgres", section_id: "backend" },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "app_1",
        targetComponentId: "db_1",
        type: "database_query",
        confidence: 0.7,
      },
    ];

    const fallbackResult = applyDeterministicInferenceFallbacks(components, flows);
    const patched = fallbackResult.dataFlows;
    const patchedComponents = fallbackResult.components;
    expect(
      patched.some(
        (f) =>
          f.sourceComponentId === "app_1" &&
          f.targetComponentId === "tp_1" &&
          f.type === "api_call",
      ),
    ).toBe(true);
    expect(
      patched.some(
        (f) =>
          f.sourceComponentId === "tp_1" &&
          f.targetComponentId === "db_1" &&
          f.type === "database_query",
      ),
    ).toBe(true);
    expect(
      patched.some(
        (f) =>
          f.sourceComponentId === "app_1" &&
          f.targetComponentId === "db_1" &&
          f.type === "database_query",
      ),
    ).toBe(false);
  });

  it("keeps direct app -> pg flow when direct pg client evidence exists", () => {
    const components: DetectedComponent[] = [
      {
        id: "app_1",
        name: "Root API",
        type: "asset",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "backend" },
      },
      {
        id: "tp_1",
        name: "Supabase",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { serviceName: "supabase", section_id: "backend" },
      },
      {
        id: "db_1",
        name: "Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { client: ["supabase", "pg"], databaseType: "postgres", section_id: "backend" },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "app_1",
        targetComponentId: "db_1",
        type: "database_query",
        confidence: 0.7,
      },
    ];

    const fallbackResult = applyDeterministicInferenceFallbacks(components, flows);
    const patched = fallbackResult.dataFlows;
    const patchedComponents = fallbackResult.components;
    expect(
      patched.some(
        (f) =>
          f.sourceComponentId === "app_1" &&
          f.targetComponentId === "db_1" &&
          f.type === "database_query",
      ),
    ).toBe(true);
    expect(
      patched.some(
        (f) =>
          f.sourceComponentId === "tp_1" &&
          f.targetComponentId === "db_1" &&
          f.type === "database_query",
      ),
    ).toBe(true);
  });

  it.each([
    { providerName: "Aws", serviceName: "aws", client: "@aws-sdk/client-rds" },
    { providerName: "Azure", serviceName: "azure", client: "@azure/cosmos" },
    { providerName: "Vercel", serviceName: "vercel", client: "@vercel/postgres" },
    { providerName: "Firebase", serviceName: "firebase", client: "firebase-admin/firestore" },
  ])(
    "rewrites app -> db as app -> $providerName -> db for provider-mediated clients",
    ({ providerName, serviceName, client }) => {
      const components: DetectedComponent[] = [
        {
          id: "app_1",
          name: "Root API",
          type: "asset",
          confidence: 1,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "backend" },
        },
        {
          id: "tp_1",
          name: providerName,
          type: "third_party",
          confidence: 1,
          detectedFrom: [],
          sourceLocations: [],
          properties: { serviceName, section_id: "backend" },
        },
        {
          id: "db_1",
          name: "Managed DB",
          type: "asset",
          subType: "database",
          confidence: 1,
          detectedFrom: [],
          sourceLocations: [],
          properties: { client, databaseType: "postgres", section_id: "backend" },
        },
      ];
      const flows: DetectedDataFlow[] = [
        {
          id: "flow_1",
          sourceComponentId: "app_1",
          targetComponentId: "db_1",
          type: "database_query",
          confidence: 0.7,
        },
      ];

      const patched = applyDeterministicInferenceFallbacks(components, flows).dataFlows;
      expect(
        patched.some(
          (f) =>
            f.sourceComponentId === "app_1" &&
            f.targetComponentId === "tp_1" &&
            f.type === "api_call",
        ),
      ).toBe(true);
      expect(
        patched.some(
          (f) =>
            f.sourceComponentId === "tp_1" &&
            f.targetComponentId === "db_1" &&
            f.type === "database_query",
        ),
      ).toBe(true);
      expect(
        patched.some(
          (f) =>
            f.sourceComponentId === "app_1" &&
            f.targetComponentId === "db_1" &&
            f.type === "database_query",
        ),
      ).toBe(false);
    },
  );

  it("does not rewrite provider topology when provider node is missing", () => {
    const components: DetectedComponent[] = [
      {
        id: "app_1",
        name: "Root API",
        type: "asset",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "backend" },
      },
      {
        id: "db_1",
        name: "Managed DB",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { client: "@aws-sdk/client-rds", databaseType: "postgres", section_id: "backend" },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "app_1",
        targetComponentId: "db_1",
        type: "database_query",
        confidence: 0.7,
      },
    ];

    const fallbackResult = applyDeterministicInferenceFallbacks(components, flows);
    const patched = fallbackResult.dataFlows;
    const patchedComponents = fallbackResult.components;
    expect(
      patched.some(
        (f) =>
          f.sourceComponentId === "app_1" &&
          f.targetComponentId === "db_1" &&
          f.type === "database_query",
      ),
    ).toBe(true);
    expect(
      patched.some((f) => f.targetComponentId === "tp_1"),
    ).toBe(false);
  });

  it("keeps section-local direction in multi-section projects", () => {
    const components: DetectedComponent[] = [
      {
        id: "app_a",
        name: "Service A API",
        type: "asset",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "service-a" },
      },
      {
        id: "tp_b",
        name: "Supabase",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { serviceName: "supabase", section_id: "service-b" },
      },
      {
        id: "db_b",
        name: "Service B DB",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { client: "supabase", databaseType: "postgres", section_id: "service-b" },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "app_a",
        targetComponentId: "db_b",
        type: "database_query",
        confidence: 0.7,
      },
    ];

    const fallbackResult = applyDeterministicInferenceFallbacks(components, flows);
    const patched = fallbackResult.dataFlows;
    const patchedComponents = fallbackResult.components;
    expect(
      patched.some(
        (f) =>
          f.sourceComponentId === "app_a" &&
          f.targetComponentId === "db_b" &&
          f.type === "database_query",
      ),
    ).toBe(true);
    expect(
      patched.some(
        (f) =>
          f.sourceComponentId === "app_a" &&
          f.targetComponentId === "tp_b" &&
          f.type === "api_call",
      ),
    ).toBe(false);
  });

  it("does not connect provider-managed database across different sections", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_supabase_frontend",
        name: "Supabase",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { serviceName: "supabase", section_id: "reedy" },
      },
      {
        id: "tp_supabase_backend",
        name: "Supabase",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { serviceName: "supabase", section_id: "reedy-backend" },
      },
      {
        id: "db_reedy_pg",
        name: "Supabase Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "reedy",
          client: "supabase",
          databaseType: "postgres",
          cloud_provider: "supabase",
        },
      },
      {
        id: "db_backend_pg",
        name: "Supabase Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "reedy-backend",
          client: "supabase",
          databaseType: "postgres",
          cloud_provider: "supabase",
        },
      },
    ];
    const flows: DetectedDataFlow[] = [];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    expect(
      result.dataFlows.some(
        (f) =>
          f.sourceComponentId === "tp_supabase_backend" &&
          f.targetComponentId === "db_reedy_pg",
      ),
    ).toBe(false);
    expect(
      result.dataFlows.some(
        (f) =>
          f.sourceComponentId === "tp_supabase_backend" &&
          f.targetComponentId === "db_backend_pg",
      ),
    ).toBe(true);
  });

  it("creates supabase managed service nodes for pg/auth/storage", () => {
    const components: DetectedComponent[] = [
      {
        id: "app_1",
        name: "Root API",
        type: "asset",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "src/store/authStore.ts", startLine: 1, endLine: 1 }],
        properties: { section_id: "root" },
      },
      {
        id: "tp_supabase",
        name: "Supabase",
        type: "third_party",
        confidence: 1,
        detectedFrom: [
          {
            pattern: "database_connection",
            sourceLocation: { filePath: "src/lib/supabase.ts", startLine: 1, endLine: 1 },
          },
        ],
        sourceLocations: [
          { filePath: "src/lib/supabase.ts", startLine: 1, endLine: 1 },
          { filePath: "src/features/storage/upload.ts", startLine: 1, endLine: 1 },
        ],
        properties: { serviceName: "supabase", section_id: "root" },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "app_1",
        targetComponentId: "tp_supabase",
        type: "api_call",
        confidence: 0.8,
        sourceLocations: [{ filePath: "src/store/authStore.ts", startLine: 10, endLine: 10 }],
      },
    ];

    const fallbackResult = applyDeterministicInferenceFallbacks(components, flows);
    const patched = fallbackResult.dataFlows;
    const patchedComponents = fallbackResult.components;
    expect(
      patched.some(
        (f) =>
          f.sourceComponentId === "tp_supabase" &&
          f.type === "database_query" &&
          (f.description ?? "").toLowerCase().includes("pg"),
      ),
    ).toBe(true);
    expect(
      patched.some(
        (f) =>
          f.sourceComponentId === "tp_supabase" &&
          f.type === "api_call" &&
          (f.description ?? "").toLowerCase().includes("auth"),
      ),
    ).toBe(true);
    expect(
      patched.some(
        (f) =>
          f.sourceComponentId === "tp_supabase" &&
          f.type === "file_transfer" &&
          (f.description ?? "").toLowerCase().includes("storage"),
      ),
    ).toBe(true);
    expect(patchedComponents.some((c) => c.name === "Supabase Pg")).toBe(true);
    expect(patchedComponents.some((c) => c.name === "Supabase Auth")).toBe(true);
    expect(patchedComponents.some((c) => c.name === "Supabase Storage")).toBe(true);
  });

  it("limits managed postgres node evidence to database patterns", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_supabase",
        name: "Supabase",
        type: "third_party",
        confidence: 1,
        detectedFrom: [
          {
            pattern: "database_connection",
            sourceLocation: { filePath: "src/lib/supabase-db.ts", startLine: 12, endLine: 12 },
          },
          {
            pattern: "external_api_call",
            sourceLocation: {
              filePath: "src/features/storage/upload.ts",
              startLine: 5,
              endLine: 5,
            },
          },
        ],
        sourceLocations: [
          { filePath: "src/lib/supabase-db.ts", startLine: 12, endLine: 12 },
          { filePath: "src/features/storage/upload.ts", startLine: 5, endLine: 5 },
        ],
        properties: { serviceName: "supabase", section_id: "root" },
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, []);
    const managedPg = result.components.find((c) => c.name === "Supabase Pg");

    expect(managedPg).toBeDefined();
    expect(managedPg?.detectedFrom).toEqual([
      {
        pattern: "database_connection",
        sourceLocation: { filePath: "src/lib/supabase-db.ts", startLine: 12, endLine: 12 },
      },
    ]);
    expect(managedPg?.sourceLocations).toEqual([
      { filePath: "src/lib/supabase-db.ts", startLine: 12, endLine: 12 },
    ]);
  });

  it("creates aws managed service nodes for pg/s3/lambda", () => {
    const components: DetectedComponent[] = [
      {
        id: "app_1",
        name: "Backend API",
        type: "asset",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "backend/src/upload.ts", startLine: 1, endLine: 1 }],
        properties: { section_id: "backend" },
      },
      {
        id: "tp_aws",
        name: "Aws",
        type: "third_party",
        confidence: 1,
        detectedFrom: [
          {
            pattern: "external_api_call",
            sourceLocation: { filePath: "backend/src/upload.ts", startLine: 1, endLine: 1 },
          },
        ],
        sourceLocations: [
          { filePath: "backend/src/upload.ts", startLine: 1, endLine: 1 },
          { filePath: "backend/src/lambda-client.ts", startLine: 1, endLine: 1 },
        ],
        properties: { serviceName: "aws", section_id: "backend" },
      },
      {
        id: "db_aws_pg",
        name: "Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "backend/src/db.ts", startLine: 1, endLine: 1 }],
        properties: {
          section_id: "backend",
          client: "pg",
          databaseType: "postgres",
          cloud_provider: "aws",
        },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "app_1",
        targetComponentId: "tp_aws",
        type: "api_call",
        confidence: 0.8,
        description: "uses s3 bucket and lambda function",
        sourceLocations: [{ filePath: "backend/src/upload.ts", startLine: 10, endLine: 10 }],
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    expect(result.components.some((c) => c.name === "Aws Pg")).toBe(true);
    expect(result.components.some((c) => c.name === "Aws S3")).toBe(true);
    expect(result.components.some((c) => c.name === "Aws Lambda")).toBe(true);
    expect(
      result.dataFlows.some(
        (f) =>
          f.sourceComponentId === "tp_aws" &&
          (f.description ?? "").toLowerCase().includes("aws s3"),
      ),
    ).toBe(true);
    expect(
      result.dataFlows.some(
        (f) =>
          f.sourceComponentId === "tp_aws" &&
          (f.description ?? "").toLowerCase().includes("aws lambda"),
      ),
    ).toBe(true);
  });

  it("does not create Aws S3 without S3 usage signals", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_aws_no_s3",
        name: "Aws",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "backend/lambdas/auth-helper/index.ts", startLine: 1, endLine: 1 }],
        properties: { serviceName: "aws", section_id: "backend/lambdas/auth-helper" },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_no_s3",
        sourceComponentId: "app_1",
        targetComponentId: "tp_aws_no_s3",
        type: "api_call",
        confidence: 0.8,
        description: "uses auth helper",
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    expect(result.components.some((c) => c.name === "Aws Lambda")).toBe(true);
    expect(result.components.some((c) => c.name === "Aws Pg")).toBe(false);
    expect(result.components.some((c) => c.name === "Aws S3")).toBe(false);
  });

  it("creates Aws S3 for archive-oriented AWS sections", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_aws_archive",
        name: "Aws",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "backend/lambdas/git-archive-finalize/index.ts", startLine: 1, endLine: 1 }],
        properties: { serviceName: "aws", section_id: "backend/lambdas/git-archive-finalize" },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_archive",
        sourceComponentId: "app_1",
        targetComponentId: "tp_aws_archive",
        type: "api_call",
        confidence: 0.8,
        description: "finalize archive pipeline",
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    expect(result.components.some((c) => c.name === "Aws S3")).toBe(true);
  });

  it("prefers API node as third-party flow source over main app", () => {
    const components: DetectedComponent[] = [
      {
        id: "app_ui",
        name: "React",
        type: "asset",
        subType: "web_application",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "root", isMainApplication: true },
      },
      {
        id: "app_api",
        name: "root API",
        type: "asset",
        subType: "api",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "root" },
      },
      {
        id: "tp_sendgrid",
        name: "Sendgrid",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { serviceName: "sendgrid", section_id: "root" },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "app_ui",
        targetComponentId: "tp_sendgrid",
        type: "api_call",
        confidence: 0.8,
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    expect(
      result.dataFlows.some(
        (f) =>
          f.sourceComponentId === "app_api" &&
          f.targetComponentId === "tp_sendgrid" &&
          f.type === "api_call",
      ),
    ).toBe(true);
    expect(
      result.dataFlows.some(
        (f) =>
          f.sourceComponentId === "app_ui" &&
          f.targetComponentId === "tp_sendgrid" &&
          f.type === "api_call",
      ),
    ).toBe(false);
  });

  it("treats pg client as supabase-managed when cloud_provider indicates supabase", () => {
    const components: DetectedComponent[] = [
      {
        id: "app_1",
        name: "React",
        type: "asset",
        subType: "web_application",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "root", isMainApplication: true },
      },
      {
        id: "api_1",
        name: "root API",
        type: "asset",
        subType: "api",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "root" },
      },
      {
        id: "tp_supabase",
        name: "Supabase",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { serviceName: "supabase", section_id: "root" },
      },
      {
        id: "db_pg",
        name: "Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "root",
          client: "pg",
          databaseType: "postgres",
          cloud_provider: "supabase",
        },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "app_1",
        targetComponentId: "db_pg",
        type: "database_query",
        confidence: 0.8,
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    expect(
      result.components.some(
        (c) => c.id === "db_pg" && c.name === "Supabase Pg",
      ),
    ).toBe(true);
    expect(
      result.dataFlows.some(
        (f) =>
          f.sourceComponentId === "tp_supabase" &&
          f.targetComponentId === "db_pg" &&
          f.type === "database_query",
      ),
    ).toBe(true);
    expect(
      result.dataFlows.some(
        (f) =>
          (f.sourceComponentId === "api_1" || f.sourceComponentId === "app_1") &&
          f.targetComponentId === "tp_supabase" &&
          f.type === "api_call",
      ),
    ).toBe(true);
  });

  it("treats pg client as supabase-managed when pg and supabase are detected in same file", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_supabase",
        name: "Supabase",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "scripts/migrate-user-status.js", startLine: 79, endLine: 79 }],
        properties: { serviceName: "supabase", section_id: "root" },
      },
      {
        id: "db_pg",
        name: "Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "scripts/migrate-user-status.js", startLine: 35, endLine: 35 }],
        properties: {
          section_id: "root",
          client: "pg",
          databaseType: "postgres",
        },
      },
    ];
    const flows: DetectedDataFlow[] = [];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    expect(
      result.components.some((c) => c.id === "db_pg" && c.name === "Supabase Pg"),
    ).toBe(true);
    expect(
      result.dataFlows.some(
        (f) =>
          f.sourceComponentId === "tp_supabase" &&
          f.targetComponentId === "db_pg" &&
          f.type === "database_query",
      ),
    ).toBe(true);
    expect(
      result.dataFlows.filter(
        (f) =>
          f.sourceComponentId === "tp_supabase" &&
          f.targetComponentId === "db_pg",
      ),
    ).toHaveLength(1);
  });

  it("does not treat sqlalchemy as supabase-managed from shared section files alone", () => {
    const components: DetectedComponent[] = [
      {
        id: "app_backend",
        name: "Backend API",
        type: "asset",
        subType: "api",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "reedy-backend" },
      },
      {
        id: "tp_supabase",
        name: "Supabase",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [
          { filePath: "reedy-backend/utils/database_utils.py", startLine: 1, endLine: 1 },
        ],
        properties: { serviceName: "supabase", section_id: "reedy-backend" },
      },
      {
        id: "db_sqlalchemy",
        name: "Sqlalchemy",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [
          { filePath: "reedy-backend/database.py", startLine: 1, endLine: 1 },
          { filePath: "reedy-backend/utils/database_utils.py", startLine: 1, endLine: 1 },
        ],
        properties: {
          section_id: "reedy-backend",
          client: "sqlalchemy",
          databaseType: "postgres",
        },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "app_backend",
        targetComponentId: "db_sqlalchemy",
        type: "database_query",
        confidence: 0.9,
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    expect(
      result.dataFlows.some(
        (f) =>
          f.sourceComponentId === "tp_supabase" &&
          f.targetComponentId === "db_sqlalchemy",
      ),
    ).toBe(false);
    expect(
      result.dataFlows.some(
        (f) =>
          f.sourceComponentId === "app_backend" &&
          f.targetComponentId === "db_sqlalchemy",
      ),
    ).toBe(true);
  });

  it("keeps only one direction when reverse flows exist for the same pair", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_supabase",
        name: "Supabase",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { serviceName: "supabase", section_id: "root" },
      },
      {
        id: "tp_auth",
        name: "Supabase Auth",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "root" },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_a",
        sourceComponentId: "tp_supabase",
        targetComponentId: "tp_auth",
        type: "api_call",
        confidence: 0.8,
      },
      {
        id: "flow_b",
        sourceComponentId: "tp_auth",
        targetComponentId: "tp_supabase",
        type: "api_call",
        confidence: 0.6,
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    const pairFlows = result.dataFlows.filter((f) => {
      const a = f.sourceComponentId;
      const b = f.targetComponentId;
      return (
        (a === "tp_supabase" && b === "tp_auth") ||
        (a === "tp_auth" && b === "tp_supabase")
      );
    });
    expect(pairFlows).toHaveLength(1);
    expect(pairFlows[0]?.sourceComponentId).toBe("tp_supabase");
    expect(pairFlows[0]?.targetComponentId).toBe("tp_auth");
  });

  it("does not create supabase managed subnodes without explicit usage signals", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_supabase",
        name: "Supabase",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "src/lib/supabase.ts", startLine: 1, endLine: 1 }],
        properties: { serviceName: "supabase", section_id: "root" },
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, []);
    expect(result.components.some((c) => c.name === "Supabase Pg")).toBe(false);
    expect(result.components.some((c) => c.name === "Supabase Auth")).toBe(false);
    expect(result.components.some((c) => c.name === "Supabase Storage")).toBe(false);
  });

  it("does not create gcp managed service nodes without explicit service signals", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_gcp",
        name: "Google Ai",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "backend/src/google.ts", startLine: 1, endLine: 1 }],
        properties: { serviceName: "google_ai", section_id: "backend" },
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, []);
    const parent = result.components.find((c) => c.id === "tp_gcp");
    expect(parent?.name).toBe("Google");
    expect(parent?.properties.serviceName).toBe("google");
    expect(result.components.some((c) => c.name === "Google Auth")).toBe(false);
    expect(result.components.some((c) => c.name === "Google Cloud Storage")).toBe(false);
    expect(result.components.some((c) => c.name === "Google Pub Sub")).toBe(false);
    expect(result.components.some((c) => c.name === "Google Cloud SQL")).toBe(false);
    expect(result.components.some((c) => c.name === "Google Vertex AI")).toBe(false);
  });

  it("creates only signaled gcp managed service nodes", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_gcp",
        name: "Google",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "backend/src/google.ts", startLine: 1, endLine: 1 }],
        properties: { serviceName: "google", section_id: "backend" },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "app_1",
        targetComponentId: "tp_gcp",
        type: "api_call",
        confidence: 0.9,
        description:
          "uses oauth2.googleapis.com and @google-cloud/storage and vertexai",
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    expect(result.components.some((c) => c.name === "Google Auth")).toBe(true);
    expect(result.components.some((c) => c.name === "Google Cloud Storage")).toBe(true);
    expect(result.components.some((c) => c.name === "Google Vertex AI")).toBe(true);
    expect(result.components.some((c) => c.name === "Google AI")).toBe(false);
    expect(result.components.some((c) => c.name === "Google Cloud SQL")).toBe(false);
    expect(result.components.some((c) => c.name === "Google Pub Sub")).toBe(false);
  });

  it("creates Google AI managed subnode from provider client signal", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_google",
        name: "Google",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "reedy/app/api/assistant/route.ts", startLine: 1, endLine: 1 }],
        properties: {
          serviceName: "google",
          client: "google_ai",
          section_id: "reedy",
        },
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, []);
    expect(result.components.some((c) => c.name === "Google AI")).toBe(true);
    expect(
      result.dataFlows.some(
        (f) =>
          f.sourceComponentId === "tp_google" &&
          (f.description ?? "").toLowerCase().includes("google ai"),
      ),
    ).toBe(true);
  });

  it("does not let google provider claim supabase managed postgres", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_google",
        name: "Google",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "reedy/package.json", startLine: 1, endLine: 1 }],
        properties: { serviceName: "google", section_id: "reedy" },
      },
      {
        id: "tp_supabase",
        name: "supabase",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "reedy/package.json", startLine: 1, endLine: 1 }],
        properties: { serviceName: "supabase", section_id: "reedy" },
      },
      {
        id: "db_supabase_pg",
        name: "Supabase Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "reedy/package.json", startLine: 1, endLine: 1 }],
        properties: {
          section_id: "reedy",
          databaseType: "postgres",
          cloud_provider: "supabase",
        },
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, []);
    expect(
      result.dataFlows.some(
        (f) => f.sourceComponentId === "tp_google" && f.targetComponentId === "db_supabase_pg",
      ),
    ).toBe(false);
    expect(
      result.dataFlows.some(
        (f) => f.sourceComponentId === "tp_supabase" && f.targetComponentId === "db_supabase_pg",
      ),
    ).toBe(true);
  });

  it("rolls up nested AWS section signals to parent backend AWS provider", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_aws_backend",
        name: "Aws",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "backend/rds-data-client.ts", startLine: 1, endLine: 1 }],
        properties: { serviceName: "aws", section_id: "backend" },
      },
      {
        id: "tp_aws_archive",
        name: "Aws",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [
          {
            filePath: "backend/lambdas/git-archive-finalize/index.ts",
            startLine: 1,
            endLine: 1,
          },
        ],
        properties: { serviceName: "aws", section_id: "backend/lambdas/git-archive-finalize" },
      },
      {
        id: "tp_aws_createdb",
        name: "Aws",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [
          { filePath: "backend/lambdas/create-db/index.ts", startLine: 1, endLine: 1 },
        ],
        properties: { serviceName: "aws", section_id: "backend/lambdas/create-db" },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_archive",
        sourceComponentId: "app_1",
        targetComponentId: "tp_aws_archive",
        type: "api_call",
        confidence: 0.8,
        description: "finalize archive pipeline",
      },
      {
        id: "flow_createdb",
        sourceComponentId: "app_1",
        targetComponentId: "tp_aws_createdb",
        type: "api_call",
        confidence: 0.8,
        description: "create-db migration postgres",
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    const backendProvider = result.components.find((c) => c.id === "tp_aws_backend");
    expect(backendProvider).toBeDefined();
    const backendChildren = result.components
      .filter((c) => c.properties?.managed_by_provider === "tp_aws_backend")
      .map((c) => c.name);
    expect(backendChildren).toContain("Aws S3");
    expect(backendChildren).toContain("Aws Pg");
  });

  it("adopts local postgres as provider-managed for any provider with postgres signals", () => {
    const components: DetectedComponent[] = [
      {
        id: "tp_aws_backend",
        name: "Aws",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "backend/package.json", startLine: 1, endLine: 1 }],
        properties: { serviceName: "aws", section_id: "backend" },
      },
      {
        id: "db_local_pg",
        name: "Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "backend/scripts/migrate.ts", startLine: 1, endLine: 1 }],
        properties: { section_id: "backend", client: "pg", databaseType: "postgres" },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_createdb",
        sourceComponentId: "app_1",
        targetComponentId: "tp_aws_backend",
        type: "api_call",
        confidence: 0.8,
        description: "create-db migration postgres",
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    const adopted = result.components.find((c) => c.id === "db_local_pg");
    expect(adopted?.name).toBe("Aws Pg");
    expect(adopted?.properties.managed_by_provider).toBe("tp_aws_backend");
    expect(adopted?.properties.managed_service_key).toBe("postgres");
    expect(
      result.components.filter((c) => c.name === "Aws Pg" && c.properties?.managed_by_provider === "tp_aws_backend")
        .length,
    ).toBe(1);
  });

  it("collapses generic Pg node into managed Aws Pg in same section", () => {
    const components: DetectedComponent[] = [
      {
        id: "backend_asset",
        name: "backend",
        type: "asset",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "backend" },
      },
      {
        id: "tp_aws_backend",
        name: "Aws",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "backend/package.json", startLine: 1, endLine: 1 }],
        properties: { serviceName: "aws", section_id: "backend" },
      },
      {
        id: "db_pg_generic",
        name: "Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "backend/package.json", startLine: 1, endLine: 1 }],
        properties: { section_id: "backend", client: "pg", databaseType: "postgres" },
      },
      {
        id: "db_aws_pg",
        name: "Aws Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "backend/rds-data-client.ts", startLine: 1, endLine: 1 }],
        properties: {
          section_id: "backend",
          managed_by_provider: "tp_aws_backend",
          managed_service_key: "postgres",
        },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_backend_pg",
        sourceComponentId: "backend_asset",
        targetComponentId: "db_pg_generic",
        type: "database_query",
        confidence: 0.8,
      },
      {
        id: "flow_backend_aws",
        sourceComponentId: "backend_asset",
        targetComponentId: "tp_aws_backend",
        type: "api_call",
        confidence: 0.8,
        description: "create-db migration postgres",
      },
      {
        id: "flow_aws_pg",
        sourceComponentId: "tp_aws_backend",
        targetComponentId: "db_aws_pg",
        type: "database_query",
        confidence: 0.8,
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    expect(result.components.some((c) => c.id === "db_pg_generic")).toBe(false);
    const awsPg = result.components.find((c) => c.id === "db_aws_pg");
    expect(awsPg).toBeDefined();
    expect(
      result.dataFlows.some(
        (f) => f.sourceComponentId === "backend_asset" && f.targetComponentId === awsPg?.id,
      ),
    ).toBe(false);
  });

  it("promotes generic Pg to managed Aws Pg when no managed postgres exists yet", () => {
    const components: DetectedComponent[] = [
      {
        id: "svc_archive",
        name: "git-archive-finalize",
        type: "asset",
        subType: "application",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "backend/lambdas/git-archive-finalize" },
      },
      {
        id: "tp_aws_archive",
        name: "aws",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { serviceName: "aws", section_id: "backend/lambdas/git-archive-finalize" },
      },
      {
        id: "aws_s3_managed",
        name: "Aws S3",
        type: "asset",
        subType: "file_storage",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "backend/lambdas/git-archive-finalize",
          managed_by_provider: "tp_aws_archive",
          managed_service_key: "s3",
        },
      },
      {
        id: "db_pg_generic",
        name: "Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "backend/lambdas/git-archive-finalize",
          client: "pg",
          databaseType: "postgres",
        },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_archive_pg",
        sourceComponentId: "svc_archive",
        targetComponentId: "db_pg_generic",
        type: "database_query",
        confidence: 0.8,
      },
      {
        id: "flow_archive_aws",
        sourceComponentId: "svc_archive",
        targetComponentId: "tp_aws_archive",
        type: "api_call",
        confidence: 0.8,
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    const promoted = result.components.find((c) => c.id === "db_pg_generic");
    expect(promoted?.name).toBe("Aws Pg");
    expect(promoted?.properties?.managed_by_provider).toBe("tp_aws_archive");
    expect(promoted?.properties?.managed_service_key).toBe("postgres");
    expect(
      result.dataFlows.some(
        (f) => f.sourceComponentId === "svc_archive" && f.targetComponentId === "db_pg_generic",
      ),
    ).toBe(false);
    expect(
      result.dataFlows.some(
        (f) => f.sourceComponentId === "tp_aws_archive" && f.targetComponentId === "db_pg_generic",
      ),
    ).toBe(true);
  });

  it("removes direct service flows to managed postgres nodes", () => {
    const components: DetectedComponent[] = [
      {
        id: "backend_asset",
        name: "backend",
        type: "asset",
        subType: "application",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "backend" },
      },
      {
        id: "tp_aws_backend",
        name: "Aws",
        type: "third_party",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { serviceName: "aws", section_id: "backend" },
      },
      {
        id: "db_aws_pg",
        name: "Aws Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "backend",
          managed_by_provider: "tp_aws_backend",
          managed_service_key: "postgres",
        },
      },
    ];
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_backend_to_pg",
        sourceComponentId: "backend_asset",
        targetComponentId: "db_aws_pg",
        type: "database_query",
        confidence: 0.8,
      },
      {
        id: "flow_aws_to_pg",
        sourceComponentId: "tp_aws_backend",
        targetComponentId: "db_aws_pg",
        type: "database_query",
        confidence: 0.8,
      },
    ];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    expect(
      result.dataFlows.some(
        (f) => f.sourceComponentId === "backend_asset" && f.targetComponentId === "db_aws_pg",
      ),
    ).toBe(false);
    expect(
      result.dataFlows.some(
        (f) => f.sourceComponentId === "tp_aws_backend" && f.targetComponentId === "db_aws_pg",
      ),
    ).toBe(true);
  });

  it("does not add cross-section actor→leaf fallback when the target section has a main app", () => {
    const components: DetectedComponent[] = [
      {
        id: "actor_user",
        name: "User",
        type: "actor",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "root" },
      },
      {
        id: "main_app",
        name: "App",
        type: "asset",
        subType: "api",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "app", isMainApplication: true },
      },
      {
        id: "section_api",
        name: "API",
        type: "asset",
        subType: "api",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "app", isSectionApiNode: true },
      },
      {
        id: "db_pg",
        name: "Pg",
        type: "asset",
        subType: "database",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: { section_id: "app" },
      },
    ];
    const flows: DetectedDataFlow[] = [];

    const result = applyDeterministicInferenceFallbacks(components, flows);
    const badFallbacks = result.dataFlows.filter(
      (f) =>
        f.id.startsWith("flow_fallback_") &&
        f.sourceComponentId === "actor_user" &&
        (f.targetComponentId === "section_api" || f.targetComponentId === "db_pg"),
    );
    expect(badFallbacks).toHaveLength(0);
  });
});

