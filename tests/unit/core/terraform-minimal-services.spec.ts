import type { DetectedComponent } from "../../../src/core/types/component";
import type { ScanResult } from "../../../src/core/types/result";
import { INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT } from "../../../src/classifier/application-injection";
import {
  applyMixedAppTerraformScanResult,
  applyTerraformMinimalServiceScanResult,
  ecsModuleServiceLabel,
  isMixedAppTerraformScan,
  isTerraformPrimaryScan,
  shouldKeepComponentInMixedAppTerraformScan,
  terraformMinimalLayoutBucket,
} from "../../../src/core/pipeline/terraform-minimal-services";
import { testAsset as asset } from "../../helpers/scan-result-builders";

describe("terraform-minimal-services", () => {
  it("ecsModuleServiceLabel formats module.ecs_*", () => {
    expect(ecsModuleServiceLabel("module.ecs_frontend")).toBe("ECS Frontend");
    expect(ecsModuleServiceLabel("module.ecs_backend")).toBe("ECS Backend");
  });

  it("terraformMinimalLayoutBucket classifies hub and services", () => {
    expect(
      terraformMinimalLayoutBucket({
        id: "a",
        name: "User",
        type: "actor",
        subType: "customer",
        confidence: 0.5,
        detectedFrom: [],
        sourceLocations: [],
        properties: {},
      }),
    ).toBe("actor");
    expect(
      terraformMinimalLayoutBucket(
        asset("m", "App", {
          sourceContext: INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
        }),
      ),
    ).toBe("main");
    expect(
      terraformMinimalLayoutBucket({
        id: "p",
        name: "AWS",
        type: "third_party",
        subType: "cloud_provider",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { terraform_address: "provider.aws" },
      }),
    ).toBe("provider");
    expect(
      terraformMinimalLayoutBucket(
        asset("e", "ECS", { terraform_address: "module.ecs_frontend" }),
      ),
    ).toBe("ecs");
    expect(
      terraformMinimalLayoutBucket(
        asset("s", "S3", {
          terraform_address: "aws_s3_bucket.x",
          managed_by_provider: "tp_aws",
        }),
      ),
    ).toBe("managed");
  });

  it("isTerraformPrimaryScan is false when a non-Terraform api asset exists", () => {
    const components: DetectedComponent[] = [
      asset("s3", "b", { terraform_address: "aws_s3_bucket.x" }),
      asset("api", "API", {}, "api"),
    ];
    expect(isTerraformPrimaryScan(components)).toBe(false);
  });

  it("isMixedAppTerraformScan is true when app packages and Terraform coexist", () => {
    const components: DetectedComponent[] = [
      asset("api", "API", { section_id: "reedy" }, "api"),
      asset("rds", "RDS", {
        section_id: "terraform/modules/aurora",
        terraform_address: "module.aurora.aws_rds_cluster.this",
        resource_type: "aws_rds_cluster",
      }),
      {
        id: "aws",
        name: "Amazon Web Services",
        type: "third_party",
        subType: "cloud_provider",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { terraform_address: "provider.aws", section_id: "root" },
      },
    ];
    expect(isMixedAppTerraformScan(components)).toBe(true);
    expect(isTerraformPrimaryScan(components)).toBe(false);
    expect(
      shouldKeepComponentInMixedAppTerraformScan(
        asset("rds", "RDS", {
          terraform_address: "module.aurora.aws_rds_cluster.this",
          resource_type: "aws_rds_cluster",
        }),
      ),
    ).toBe(false);
    expect(
      shouldKeepComponentInMixedAppTerraformScan(
        asset("mod", "Module · aurora", {
          terraform_address: "module.aurora",
          section_id: "root",
        }),
      ),
    ).toBe(true);
  });

  it("isMixedAppTerraformScan is true for root-scoped API with app signals and Terraform shells", () => {
    const components: DetectedComponent[] = [
      asset("api", "API", { section_id: "root", isSectionApiNode: true }, "api"),
      asset("rds", "RDS", {
        section_id: "terraform",
        terraform_address: "aws_db_instance.main",
        resource_type: "aws_db_instance",
      }),
      asset("mod", "Module · db", {
        terraform_address: "module.db",
        section_id: "terraform",
      }),
      {
        id: "aws",
        name: "Amazon Web Services",
        type: "third_party",
        subType: "cloud_provider",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { terraform_address: "provider.aws", section_id: "terraform" },
      },
    ];
    expect(isMixedAppTerraformScan(components)).toBe(true);
    expect(isTerraformPrimaryScan(components)).toBe(false);
  });

  it("isMixedAppTerraformScan is false for root-scoped API without app signals", () => {
    const components: DetectedComponent[] = [
      asset("api", "API", { section_id: "root" }, "api"),
      asset("mod", "Module · db", {
        terraform_address: "module.db",
        section_id: "terraform",
      }),
      {
        id: "aws",
        name: "AWS",
        type: "third_party",
        subType: "cloud_provider",
        confidence: 0.9,
        detectedFrom: [],
        sourceLocations: [],
        properties: { terraform_address: "provider.aws", section_id: "terraform" },
      },
    ];
    expect(isMixedAppTerraformScan(components)).toBe(false);
  });

  it("applyMixedAppTerraformScanResult drops inner TF resources for root-scoped app + terraform section", () => {
    const scanResult: ScanResult = {
      components: [
        asset("api", "API", { section_id: "root", isSectionApiNode: true }, "api"),
        asset("rds", "RDS", {
          section_id: "terraform",
          terraform_address: "module.db.aws_db_instance.main",
          resource_type: "aws_db_instance",
        }),
        asset("mod", "Module · db", {
          terraform_address: "module.db",
          section_id: "terraform",
        }),
        {
          id: "aws",
          name: "Amazon Web Services",
          type: "third_party",
          subType: "cloud_provider",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { terraform_address: "provider.aws", section_id: "terraform" },
        },
        asset("subnet", "Subnet", {
          section_id: "terraform",
          terraform_address: "aws_subnet.private",
          resource_type: "aws_subnet",
        }),
      ],
      dataFlows: [
        {
          id: "f1",
          sourceComponentId: "aws",
          targetComponentId: "rds",
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

    const out = applyMixedAppTerraformScanResult(scanResult);
    const ids = out.components.map((c) => c.id).sort();
    expect(ids).toEqual(["api", "aws", "mod"]);
    expect(out.components.some((c) => c.id === "rds")).toBe(false);
    expect(out.components.some((c) => c.id === "subnet")).toBe(false);
    expect(
      out.dataFlows.some(
        (f) => f.sourceComponentId === "aws" && f.targetComponentId === "mod",
      ),
    ).toBe(true);
  });

  it("applyMixedAppTerraformScanResult drops module-internal resources but keeps app nodes", () => {
    const scanResult: ScanResult = {
      components: [
        asset("api", "API", { section_id: "reedy" }, "api"),
        asset("rds", "RDS", {
          section_id: "terraform/modules/aurora",
          terraform_address: "module.aurora.aws_rds_cluster.this",
          resource_type: "aws_rds_cluster",
        }),
        asset("mod", "Module · aurora", {
          terraform_address: "module.aurora",
          section_id: "root",
        }),
        {
          id: "aws",
          name: "Amazon Web Services",
          type: "third_party",
          subType: "cloud_provider",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { terraform_address: "provider.aws", section_id: "root" },
        },
        asset("az", "AZ", {
          section_id: "root",
          terraform_address: "data.aws_availability_zones.available",
          resource_type: "aws_availability_zones",
        }),
      ],
      dataFlows: [
        {
          id: "f1",
          sourceComponentId: "aws",
          targetComponentId: "rds",
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

    const out = applyMixedAppTerraformScanResult(scanResult);
    const ids = out.components.map((c) => c.id).sort();
    expect(ids).toEqual(["api", "aws", "mod"]);
    expect(
      out.dataFlows.some(
        (f) => f.sourceComponentId === "aws" && f.targetComponentId === "mod",
      ),
    ).toBe(true);
    expect(
      out.dataFlows.some(
        (f) => f.sourceComponentId === "aws" && f.targetComponentId === "rds",
      ),
    ).toBe(false);
  });

  it("applyTerraformMinimalServiceScanResult keeps hub, ECS modules, and managed services", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "actor1",
          name: "User",
          type: "actor",
          subType: "customer",
          confidence: 0.5,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "root" },
        },
        asset("main1", "aws_fullstack_terraform", {
          section_id: "root",
          isMainApplication: true,
          sourceContext: INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
        }),
        {
          id: "aws",
          name: "Amazon Web Services",
          type: "third_party",
          subType: "cloud_provider",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { terraform_address: "provider.aws", section_id: "root" },
        },
        asset("ecs_f", "Module · ecs_frontend", {
          terraform_address: "module.ecs_frontend",
          section_id: "root",
        }),
        asset("s3", "Aws S3", {
          terraform_address: "aws_s3_bucket.x",
          managed_by_provider: "aws",
          managed_service_key: "s3",
          section_id: "root",
        }),
        asset("vpc", "Module · vpc", { terraform_address: "module.vpc", section_id: "root" }),
      ],
      dataFlows: [
        {
          id: "f1",
          sourceComponentId: "ecs_f",
          targetComponentId: "s3",
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

    const out = applyTerraformMinimalServiceScanResult(scanResult);
    const ids = out.components.map((c) => c.id).sort();
    expect(ids).toEqual(["actor1", "aws", "ecs_f", "main1", "s3"]);

    const has = (a: string, b: string) =>
      out.dataFlows.some((f) => f.sourceComponentId === a && f.targetComponentId === b);
    expect(has("actor1", "main1")).toBe(true);
    expect(has("main1", "ecs_f")).toBe(true);
    expect(has("ecs_f", "aws")).toBe(true);
    expect(has("main1", "aws")).toBe(false);
    expect(has("aws", "s3")).toBe(true);
  });

  it("removes forced main→provider when ECS-mediated hub edges exist", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "actor1",
          name: "User",
          type: "actor",
          subType: "customer",
          confidence: 0.5,
          detectedFrom: [],
          sourceLocations: [],
          properties: { section_id: "root" },
        },
        asset("main1", "app", {
          section_id: "root",
          isMainApplication: true,
          sourceContext: INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
        }),
        {
          id: "aws",
          name: "Amazon Web Services",
          type: "third_party",
          subType: "cloud_provider",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [],
          properties: { terraform_address: "provider.aws", section_id: "root" },
        },
        asset("ecs_f", "ECS Frontend", {
          terraform_address: "module.ecs_frontend",
          section_id: "root",
        }),
        asset("s3", "Aws S3", {
          terraform_address: "aws_s3_bucket.x",
          managed_by_provider: "aws",
          managed_service_key: "s3",
          section_id: "root",
        }),
      ],
      dataFlows: [
        {
          id: "flow_forced",
          sourceComponentId: "main1",
          targetComponentId: "aws",
          type: "api_call",
          confidence: 0.72,
        },
        {
          id: "f1",
          sourceComponentId: "ecs_f",
          targetComponentId: "s3",
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

    const out = applyTerraformMinimalServiceScanResult(scanResult);
    const direct = out.dataFlows.filter(
      (f) => f.sourceComponentId === "main1" && f.targetComponentId === "aws",
    );
    expect(direct).toHaveLength(0);
    const has = (a: string, b: string) =>
      out.dataFlows.some((f) => f.sourceComponentId === a && f.targetComponentId === b);
    expect(has("main1", "ecs_f")).toBe(true);
    expect(has("ecs_f", "aws")).toBe(true);
  });

  it("leaves scan unchanged when fewer than two ECS/managed service nodes", () => {
    const scanResult: ScanResult = {
      components: [
        asset("ecs_f", "m", { terraform_address: "module.ecs_frontend" }),
      ],
      dataFlows: [],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 1,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const out = applyTerraformMinimalServiceScanResult(scanResult);
    expect(out.components).toHaveLength(1);
  });
});
