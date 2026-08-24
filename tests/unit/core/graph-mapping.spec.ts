import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";
import { buildDiagramGraphFromScanResult } from "../../../src/core/pipeline/graph-mapping";
import { diagramGraphJsonSchema } from "../../../src/core/schema";
import type { ScanResult } from "../../../src/core/types";
import { testAsset as asset } from "../../helpers/scan-result-builders";

describe("core/pipeline/graph-mapping - DP-P0-CLI-402", () => {
  it("builds a DiagramGraphJson from a real ScanResult for the typescript-basic fixture", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult } = await scan(fixturesRoot, config);

    const graph = buildDiagramGraphFromScanResult(scanResult);

    expect(graph.nodes.length).toBe(scanResult.components.length);
    expect(graph.edges.length).toBeGreaterThan(0);

    const validation = diagramGraphJsonSchema.safeParse(graph);
    expect(validation.success).toBe(true);

    const edgeWithProperties = graph.edges.find(
      (edge) => edge.data && (edge.data as any).properties,
    );

    expect(edgeWithProperties).toBeDefined();
    if (!edgeWithProperties?.data) return;

    const properties = (edgeWithProperties.data as any).properties;
    expect(properties.engineering).toBeDefined();
    expect(properties.privacy).toBeDefined();
    expect(properties.security).toBeDefined();
  });

  it("maps all DetectedComponent and DetectedDataFlow properties into node data and DataFlowProperties", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "component-1",
          name: "Test Application",
          type: "asset",
          subType: "service",
          description: "Main application service",
          confidence: 0.99,
          detectedFrom: [
            {
              pattern: "express_route",
            },
          ],
          sourceLocations: [
            {
              filePath: "src/app.ts",
              startLine: 10,
              endLine: 20,
            },
          ],
          properties: {
            technologyStack: ["node", "express"],
            cloudProvider: "AWS",
          },
        },
      ],
      dataFlows: [
        {
          id: "flow-1",
          sourceComponentId: "component-1",
          targetComponentId: "component-1",
          type: "api_call",
          description: "Health check endpoint",
          confidence: 0.9,
          sourceLocation: {
            filePath: "src/app.ts",
            startLine: 30,
            endLine: 40,
          },
          method: "GET",
          endpoint: "/health",
          dataCategories: ["personal_identifiers"],
          dataSubjectCategories: ["customers"],
          processingPurpose: ["service_provision"],
          actions: ["read"],
          transformation: ["encrypted"],
          enrichmentConfidence: 0.8,
          enrichmentNotes: "Encrypted health-check response",
          targetScope: "local",
          targetScopeConfidence: "high",
          targetScopeReason: "same-section-id",
        },
      ],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 100,
      scanDurationMs: 5,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(1);

    const node = graph.nodes[0];
    const nodeData = node.data as any;

    expect(nodeData.label).toBe("Test Application");
    expect(nodeData.description).toBe("Main application service");
    expect(nodeData.componentType).toBe("asset");
    expect(nodeData.componentSubType).toBe("service");
    expect(nodeData.scanConfidence).toBe(0.99);
    expect(nodeData.sourceLocations).toEqual([
      {
        filePath: "src/app.ts",
        startLine: 10,
        endLine: 20,
      },
    ]);
    expect(nodeData.detectedFrom).toEqual([
      {
        pattern: "express_route",
      },
    ]);
    expect(nodeData.technologyStack).toEqual(["node", "express"]);
    expect(nodeData.cloudProvider).toBe("AWS");

    const edge = graph.edges[0];
    expect(edge.data).toBeDefined();
    if (!edge.data) return;

    const properties = (edge.data as any).properties;

    expect(properties.engineering.transferType).toBe("api_call");
    expect(properties.engineering.protocol).toBe("rest");
    expect(properties.engineering.name).toContain("Test Application");
    expect(properties.engineering.actions).toEqual(["read"]);

    expect(properties.privacy.dataCategories).toEqual([
      "personal_identifiers",
    ]);
    expect(properties.privacy.dataSubjectCategories).toEqual(["customers"]);
    expect(properties.privacy.processingPurpose).toEqual([
      "service_provision",
    ]);

    expect(properties.security.transformation).toBe("encrypted");
    expect(properties.security.enrichmentConfidence).toBe(0.8);
    expect(properties.security.enrichmentNotes).toBe(
      "Encrypted health-check response",
    );
    expect(properties.targetScope).toBe("local");
    expect(properties.targetScopeConfidence).toBe("high");
    expect(properties.targetScopeReason).toBe("same-section-id");
    expect(properties.sourceLocation).toEqual({
      filePath: "src/app.ts",
      startLine: 30,
      endLine: 40,
    });
    expect(properties.confidence).toBe(0.9);
  });

  it("strips SourceLocation.code and copies scanConfidence onto node data", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "component-1",
          name: "DB",
          type: "asset",
          subType: "database",
          confidence: 0.87,
          detectedFrom: [
            {
              pattern: "orm_save",
              sourceLocation: {
                filePath: "src/db/users.ts",
                startLine: 88,
                endLine: 88,
                code: "await db.insert(users)",
              },
            },
          ],
          sourceLocations: [
            {
              filePath: "src/db/users.ts",
              startLine: 88,
              endLine: 88,
              code: "await db.insert(users)",
            },
          ],
          properties: {},
        },
      ],
      dataFlows: [],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 10,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);
    const nodeData = graph.nodes[0].data as Record<string, unknown>;
    expect(nodeData.scanConfidence).toBe(0.87);
    expect(nodeData.sourceLocations).toEqual([
      { filePath: "src/db/users.ts", startLine: 88, endLine: 88 },
    ]);
    expect(nodeData.detectedFrom).toEqual([
      {
        pattern: "orm_save",
        sourceLocation: {
          filePath: "src/db/users.ts",
          startLine: 88,
          endLine: 88,
        },
      },
    ]);
  });

  it("sets engineering.protocol to graphql when flow endpoint is a GraphQL URL", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "component-1",
          name: "API Service",
          type: "asset",
          subType: "api",
          confidence: 0.9,
          detectedFrom: [{ pattern: "express_route" }],
          sourceLocations: [
            { filePath: "src/api.ts", startLine: 1, endLine: 10 },
          ],
          properties: {},
        },
        {
          id: "component-2",
          name: "External API",
          type: "third_party",
          subType: "saas_service",
          confidence: 0.9,
          detectedFrom: [{ pattern: "external_api_call" }],
          sourceLocations: [
            { filePath: "src/api.ts", startLine: 20, endLine: 30 },
          ],
          properties: {},
        },
      ],
      dataFlows: [
        {
          id: "flow-gql",
          sourceComponentId: "component-1",
          targetComponentId: "component-2",
          type: "api_call",
          confidence: 0.9,
          endpoint: "https://api.example.com/graphql",
          method: "POST",
        },
      ],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 50,
      scanDurationMs: 5,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);
    const properties = (graph.edges[0]?.data as { properties?: { engineering?: { protocol?: string } } })
      ?.properties;

    expect(properties?.engineering?.protocol).toBe("graphql");
  });

  it("places managed provider service nodes after provider in layout", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "tp_supabase",
          name: "Supabase",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "root" },
        },
        {
          id: "cmp_managed_supabase_pg_1",
          name: "Supabase Pg",
          type: "asset",
          subType: "database",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            managed_by_provider: "tp_supabase",
            managed_service_key: "postgres",
          },
        },
      ],
      dataFlows: [
        {
          id: "flow-1",
          sourceComponentId: "tp_supabase",
          targetComponentId: "cmp_managed_supabase_pg_1",
          type: "database_query",
          confidence: 0.8,
        },
      ],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 1,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);
    const provider = graph.nodes.find((n) => n.id === "tp_supabase");
    const managed = graph.nodes.find((n) => n.id === "cmp_managed_supabase_pg_1");
    expect(provider).toBeDefined();
    expect(managed).toBeDefined();
    expect((managed?.position.x ?? 0)).toBeGreaterThan(provider?.position.x ?? 0);
    expect((managed?.position.y ?? 0)).toBeGreaterThan(provider?.position.y ?? 0);

    const managedEdge = graph.edges.find((e) => e.id === "flow-1") as
      | (typeof graph.edges)[number]
      | undefined;
    expect(managedEdge).toBeDefined();
    expect((managedEdge as any)?.sourceHandle).toBe("right-source");
    expect((managedEdge as any)?.targetHandle).toBe("left-target");
  });

  it("stacks managed nodes downward from provider with vertical spacing", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "tp_supabase",
          name: "Supabase",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "root" },
        },
        {
          id: "cmp_managed_supabase_auth",
          name: "Supabase Auth",
          type: "asset",
          subType: "service",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            managed_by_provider: "tp_supabase",
            managed_service_key: "auth",
          },
        },
        {
          id: "cmp_managed_supabase_pg",
          name: "Supabase Pg",
          type: "asset",
          subType: "database",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            managed_by_provider: "tp_supabase",
            managed_service_key: "postgres",
          },
        },
        {
          id: "cmp_managed_supabase_storage",
          name: "Supabase Storage",
          type: "asset",
          subType: "storage",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            managed_by_provider: "tp_supabase",
            managed_service_key: "storage",
          },
        },
      ],
      dataFlows: [],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 1,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const provider = byId.get("tp_supabase");
    const auth = byId.get("cmp_managed_supabase_auth");
    const pg = byId.get("cmp_managed_supabase_pg");
    const storage = byId.get("cmp_managed_supabase_storage");

    expect(provider).toBeDefined();
    expect(auth).toBeDefined();
    expect(pg).toBeDefined();
    expect(storage).toBeDefined();

    const managedX = (provider?.position.x ?? 0) + 320;
    expect(auth?.position.x).toBe(managedX);
    expect(pg?.position.x).toBe(managedX);
    expect(storage?.position.x).toBe(managedX);

    expect(auth?.position.y).toBeGreaterThan(provider?.position.y ?? 0);
    expect(pg?.position.y).toBeGreaterThan(auth?.position.y ?? 0);
    expect(storage?.position.y).toBeGreaterThan(pg?.position.y ?? 0);
  });

  it("uses grid rows for monorepo app sections without Terraform (avoids stacking User and app on y=0)", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "actor_apps",
          name: "User",
          type: "actor",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "packages/twenty-apps" },
        },
        {
          id: "app_apps",
          name: "twenty-apps",
          type: "asset",
          subType: "service",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "packages/twenty-apps",
            isMainApplication: true,
          },
        },
        {
          id: "actor_front",
          name: "User",
          type: "actor",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "packages/twenty-front" },
        },
        {
          id: "app_front",
          name: "twenty-front",
          type: "asset",
          subType: "service",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "packages/twenty-front",
            isMainApplication: true,
          },
        },
      ],
      dataFlows: [],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 1,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);
    const appsUser = graph.nodes.find((n) => n.id === "actor_apps")?.position;
    const appsMain = graph.nodes.find((n) => n.id === "app_apps")?.position;
    const frontUser = graph.nodes.find((n) => n.id === "actor_front")?.position;

    expect((appsUser?.x ?? -1)).toBeLessThan(appsMain?.x ?? 0);
    expect((frontUser?.x ?? 0)).toBeGreaterThan((appsMain?.x ?? 0));
  });

  it("monorepo Terraform sections keep provider left of managed resources with vertical spacing", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "app_other",
          name: "other-app",
          type: "asset",
          subType: "service",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "packages/other-app" },
        },
        {
          id: "tp_k8s",
          name: "Kubernetes",
          type: "third_party",
          subType: "cloud_provider",
          confidence: 0.92,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "packages/acme/k8s/terraform",
            terraform_address: "provider.kubernetes",
          },
        },
        {
          id: "k8s_a",
          name: "Kubernetes workload · a",
          type: "asset",
          subType: "service",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "packages/acme/k8s/terraform",
            terraform_address: "kubernetes_deployment.a",
            managed_by_provider: "tp_k8s",
            managed_service_key: "workload",
          },
        },
        {
          id: "k8s_b",
          name: "Kubernetes workload · b",
          type: "asset",
          subType: "service",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "packages/acme/k8s/terraform",
            terraform_address: "kubernetes_deployment.b",
            managed_by_provider: "tp_k8s",
            managed_service_key: "workload",
          },
        },
      ],
      dataFlows: [],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 1,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);
    const provider = graph.nodes.find((n) => n.id === "tp_k8s")?.position;
    const a = graph.nodes.find((n) => n.id === "k8s_a")?.position;
    const b = graph.nodes.find((n) => n.id === "k8s_b")?.position;

    expect(provider).toBeDefined();
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect((provider?.x ?? 0)).toBeLessThan(a?.x ?? 0);
    expect(Math.abs((a?.y ?? 0) - (b?.y ?? 0))).toBeGreaterThanOrEqual(200);
    expect((provider?.x ?? 0)).toBeLessThan(b?.x ?? 0);
  });

  it("orders single-section Terraform scans left-to-right: actor → main → module → provider → resource", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "actor_user",
          name: "User",
          type: "actor",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "root" },
        },
        {
          id: "asset_main",
          name: "Main App",
          type: "asset",
          subType: "service",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            isMainApplication: true,
            terraform_address: "injected_project_placeholder",
          },
        },
        {
          id: "mod_vpc",
          name: "Module · vpc",
          type: "asset",
          subType: "application",
          confidence: 0.88,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            terraform_address: "module.vpc",
          },
        },
        {
          id: "vpc_main",
          name: "main (aws_vpc)",
          type: "asset",
          subType: "network",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            terraform_address: "aws_vpc.main",
            resource_type: "aws_vpc",
          },
        },
        {
          id: "tp_aws",
          name: "Amazon Web Services",
          type: "third_party",
          subType: "cloud_provider",
          confidence: 0.92,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            terraform_address: "provider.aws",
          },
        },
        {
          id: "managed_s3",
          name: "Aws S3",
          type: "asset",
          subType: "file_storage",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            terraform_address: "aws_s3_bucket.x",
            resource_type: "aws_s3_bucket",
            managed_by_provider: "tp_aws",
            managed_service_key: "s3",
          },
        },
      ],
      dataFlows: [],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 1,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);
    const pos = (id: string) => graph.nodes.find((n) => n.id === id)?.position;

    expect((pos("actor_user")?.x ?? -1)).toBeLessThan(pos("asset_main")?.x ?? 0);
    expect((pos("asset_main")?.x ?? -1)).toBeLessThan(pos("mod_vpc")?.x ?? 0);
    expect((pos("mod_vpc")?.x ?? -1)).toBeLessThan(pos("tp_aws")?.x ?? 0);
    expect((pos("tp_aws")?.x ?? -1)).toBeLessThan(pos("vpc_main")?.x ?? 0);
    expect((pos("tp_aws")?.x ?? -1)).toBeLessThan(pos("managed_s3")?.x ?? 0);
  });

  it("aligns minimal Terraform like lane layout: actor, main+ECS column, provider, managed", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "actor_u",
          name: "User",
          type: "actor",
          subType: "customer",
          confidence: 0.5,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "root" },
        },
        {
          id: "main_x",
          name: "Main App",
          type: "asset",
          subType: "application",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            isMainApplication: true,
          },
        },
        {
          id: "cmp_ecs",
          name: "ECS Frontend",
          type: "asset",
          subType: "application",
          confidence: 0.88,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            terraform_address: "module.ecs_frontend",
          },
        },
        {
          id: "tp_aws",
          name: "Amazon Web Services",
          type: "third_party",
          subType: "cloud_provider",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            terraform_address: "provider.aws",
          },
        },
        {
          id: "cmp_s3",
          name: "Aws S3",
          type: "asset",
          subType: "file_storage",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            managed_by_provider: "tp_aws",
            managed_service_key: "s3",
            terraform_address: "aws_s3_bucket.x",
          },
        },
      ],
      dataFlows: [
        {
          id: "flow-1",
          sourceComponentId: "cmp_ecs",
          targetComponentId: "cmp_s3",
          type: "file_transfer",
          confidence: 0.8,
        },
      ],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 1,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);
    const pos = (id: string) => graph.nodes.find((n) => n.id === id)?.position;

    expect((pos("actor_u")?.x ?? -1)).toBeLessThan(pos("main_x")?.x ?? 0);
    expect(pos("main_x")?.x).toBe(pos("cmp_ecs")?.x);
    expect((pos("main_x")?.y ?? 999)).toBeLessThan(pos("cmp_ecs")?.y ?? 0);
    expect((pos("cmp_ecs")?.x ?? -1)).toBeLessThan(pos("tp_aws")?.x ?? 0);
    expect((pos("tp_aws")?.x ?? -1)).toBeLessThan(pos("cmp_s3")?.x ?? 0);
  });

  it("keeps User left of main app in root when root has no TF but another section does", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "cmp_8",
          name: "User",
          type: "actor",
          subType: "customer",
          confidence: 0.5,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "root", section_label: "root" },
        },
        {
          id: "cmp_1",
          name: "Backend",
          type: "asset",
          subType: "api",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            section_label: "root",
            isMainApplication: true,
          },
        },
        {
          id: "cmp_vpc",
          name: "main (aws_vpc)",
          type: "asset",
          subType: "network",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "terraform/stack-a",
            section_label: "stack-a",
            terraform_address: "aws_vpc.main",
            resource_type: "aws_vpc",
          },
        },
      ],
      dataFlows: [],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 1,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);
    const pos = (id: string) => graph.nodes.find((n) => n.id === id)?.position;

    expect((pos("cmp_8")?.x ?? -1)).toBeLessThan(pos("cmp_1")?.x ?? 0);
  });

  it("places app sections before root and provider→module edges left-to-right for mixed app+TF", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "api_reedy",
          name: "API",
          type: "asset",
          subType: "api",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "reedy", isSectionApiNode: true },
        },
        {
          id: "tp_aws",
          name: "Amazon Web Services",
          type: "third_party",
          subType: "cloud_provider",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            section_id: "root",
            terraform_address: "provider.aws",
          },
        },
        asset("mod_aurora", "Module · aurora", {
          section_id: "root",
          terraform_address: "module.aurora",
        }),
        asset("mod_vpc", "Module · vpc", {
          section_id: "root",
          terraform_address: "module.vpc",
        }),
      ],
      dataFlows: [
        {
          id: "tf_link",
          sourceComponentId: "tp_aws",
          targetComponentId: "mod_aurora",
          type: "api_call",
          confidence: 0.72,
          description: "mixed_app_terraform_module_shell",
        },
      ],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 1,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);
    const pos = (id: string) => graph.nodes.find((n) => n.id === id)?.position;

    expect((pos("api_reedy")?.x ?? 9999)).toBeLessThan(pos("tp_aws")?.x ?? 0);
    expect((pos("tp_aws")?.x ?? -1)).toBeLessThan(pos("mod_aurora")?.x ?? 0);
    expect((pos("tp_aws")?.x ?? -1)).toBeLessThan(pos("mod_vpc")?.x ?? 0);

    const edge = graph.edges.find((e) => e.id === "tf_link");
    expect(edge?.sourceHandle).toBe("right-source");
    expect(edge?.targetHandle).toBe("left-target");
  });

  it("places integrations in a fourth column and managed sub-services beside their provider", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "api",
          name: "API",
          type: "asset",
          subType: "api",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "reedy", isSectionApiNode: true },
        },
        {
          id: "tp_sb",
          name: "Supabase",
          type: "third_party",
          subType: "saas_service",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "reedy" },
        },
        asset("pg", "Supabase Pg", {
          section_id: "reedy",
          managed_by_provider: "tp_sb",
          managed_service_key: "postgres",
        }),
        {
          id: "tp_auth",
          name: "Auth0",
          type: "third_party",
          subType: "saas_service",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "reedy" },
        },
      ],
      dataFlows: [
        {
          id: "api_auth",
          sourceComponentId: "api",
          targetComponentId: "tp_auth",
          type: "api_call",
          confidence: 0.8,
        },
        {
          id: "sb_pg",
          sourceComponentId: "tp_sb",
          targetComponentId: "pg",
          type: "database_query",
          confidence: 0.8,
        },
      ],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 1,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);
    const pos = (id: string) => graph.nodes.find((n) => n.id === id)?.position;

    expect((pos("api")?.x ?? -1)).toBeLessThan(pos("tp_auth")?.x ?? 0);
    expect((pos("tp_sb")?.x ?? -1)).toBeLessThan(pos("pg")?.x ?? 0);
    expect(pos("api")?.x).toBe(800);
    expect(pos("tp_auth")?.x).toBe(1200);

    const apiAuth = graph.edges.find((e) => e.id === "api_auth");
    expect(apiAuth?.sourceHandle).toBe("right-source");
    expect(apiAuth?.targetHandle).toBe("left-target");
  });
});
