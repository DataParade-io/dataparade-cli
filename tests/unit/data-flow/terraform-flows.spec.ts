import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import {
  appendTerraformDataFlows,
  appendTerraformBareProviderAttachmentFlows,
  findTerraformProviderForResourceAsset,
} from "../../../src/data-flow/terraform-flows";
import { applyDeterministicInferenceFallbacks } from "../../../src/ai-enrichment/fallbacks";

describe("data-flow/terraform-flows", () => {
  it("findTerraformProviderForResourceAsset maps aws_* resource types to provider.aws", () => {
    const awsProv: DetectedComponent = {
      id: "tp_aws",
      name: "AWS",
      type: "third_party",
      subType: "saas_service",
      confidence: 1,
      detectedFrom: [],
      sourceLocations: [],
      properties: { terraform_address: "provider.aws" },
    };
    const bucket: DetectedComponent = {
      id: "s3",
      name: "b",
      type: "asset",
      subType: "storage",
      confidence: 1,
      detectedFrom: [],
      sourceLocations: [],
      properties: {
        terraform_address: "aws_s3_bucket.x",
        resource_type: "aws_s3_bucket",
      },
    };
    const hit = findTerraformProviderForResourceAsset([awsProv, bucket], bucket);
    expect(hit?.id).toBe("tp_aws");
  });

  it("appendTerraformBareProviderAttachmentFlows skips module-qualified resource addresses", () => {
    const aws: DetectedComponent = {
      id: "cmp_aws",
      name: "Amazon Web Services",
      type: "third_party",
      subType: "cloud_provider",
      confidence: 0.92,
      detectedFrom: [],
      sourceLocations: [],
      properties: { terraform_address: "provider.aws" },
    };
    const role: DetectedComponent = {
      id: "cmp_role",
      name: "ecs_execution",
      type: "asset",
      subType: "iam",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [],
      properties: {
        terraform_address: "module.ecs.aws_iam_role.execution",
        resource_type: "aws_iam_role",
      },
    };
    const flows: DetectedDataFlow[] = [];
    const pairKeys = new Set<string>();
    appendTerraformBareProviderAttachmentFlows({
      components: [aws, role],
      flows,
      pairKeys,
    });
    expect(flows).toHaveLength(0);
  });

  it("creates database_query from lambda to db when references match addresses", () => {
    const db: DetectedComponent = {
      id: "cmp_db",
      name: "Aws Db Instance Main",
      type: "asset",
      subType: "database",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [{ filePath: "main.tf", startLine: 5, endLine: 10 }],
      properties: { terraform_address: "aws_db_instance.main" },
    };

    const lambda: DetectedComponent = {
      id: "cmp_lambda",
      name: "Aws Lambda Function Api",
      type: "asset",
      subType: "function",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [{ filePath: "main.tf", startLine: 20, endLine: 35 }],
      properties: {
        terraform_address: "aws_lambda_function.api",
        terraform_references: ["aws_db_instance.main"],
      },
    };

    const { flows, nextIndex } = appendTerraformDataFlows([db, lambda], 0);
    expect(flows).toHaveLength(1);
    expect(flows[0].sourceComponentId).toBe("cmp_lambda");
    expect(flows[0].targetComponentId).toBe("cmp_db");
    expect(flows[0].type).toBe("database_query");
    expect(nextIndex).toBe(1);
  });

  it("creates dependency-direction edges for non-database references (referenced → referrer)", () => {
    const idGen: DetectedComponent = {
      id: "cmp_idgen",
      name: "Widget Factory Code Seed",
      type: "asset",
      subType: "application",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [{ filePath: "main.tf", startLine: 1, endLine: 5 }],
      properties: { terraform_address: "widget_factory.code_seed" },
    };

    const bucket: DetectedComponent = {
      id: "cmp_bucket",
      name: "Aws S3 Bucket",
      type: "asset",
      subType: "storage",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [{ filePath: "main.tf", startLine: 10, endLine: 15 }],
      properties: {
        terraform_address: "aws_s3_bucket.data_store",
        terraform_references: ["widget_factory.code_seed"],
      },
    };

    const { flows } = appendTerraformDataFlows([idGen, bucket], 0);
    expect(flows).toHaveLength(1);
    expect(flows[0].sourceComponentId).toBe("cmp_idgen");
    expect(flows[0].targetComponentId).toBe("cmp_bucket");
    expect(flows[0].type).toBe("api_call");
  });

  it("links aws_* resources to provider.aws via applyDeterministicInferenceFallbacks (bare attachment)", () => {
    const aws: DetectedComponent = {
      id: "cmp_aws",
      name: "Amazon Web Services",
      type: "third_party",
      subType: "cloud_provider",
      confidence: 0.92,
      detectedFrom: [],
      sourceLocations: [{ filePath: "main.tf", startLine: 1, endLine: 5 }],
      properties: {
        terraform_address: "provider.aws",
        provider_name: "aws",
      },
    };

    const bucket: DetectedComponent = {
      id: "cmp_bucket",
      name: "lambda_bucket (aws_s3_bucket)",
      type: "asset",
      subType: "storage",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [{ filePath: "main.tf", startLine: 10, endLine: 15 }],
      properties: {
        terraform_address: "aws_s3_bucket.lambda_bucket",
        resource_type: "aws_s3_bucket",
        block_name: "lambda_bucket",
      },
    };

    const { dataFlows, components: out } = applyDeterministicInferenceFallbacks(
      [aws, bucket],
      [],
    );
    const edge = dataFlows.find(
      (f) => f.sourceComponentId === "cmp_aws" && f.targetComponentId === "cmp_bucket",
    );
    expect(edge).toBeDefined();
    expect(edge?.type).toBe("file_transfer");
    const b = out.find((c) => c.id === "cmp_bucket");
    expect(b?.properties.managed_by_provider).toBe("cmp_aws");
    expect(b?.properties.managed_service_key).toBe("s3");
    expect(b?.name).toBe("Aws S3");
  });

  it("appendTerraformBareProviderAttachmentFlows skips topology-managed assets", () => {
    const aws: DetectedComponent = {
      id: "cmp_aws",
      name: "Amazon Web Services",
      type: "third_party",
      subType: "cloud_provider",
      confidence: 0.92,
      detectedFrom: [],
      sourceLocations: [],
      properties: { terraform_address: "provider.aws", provider_name: "aws" },
    };
    const bucket: DetectedComponent = {
      id: "cmp_bucket",
      name: "Aws S3",
      type: "asset",
      subType: "file_storage",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [],
      properties: {
        terraform_address: "aws_s3_bucket.x",
        resource_type: "aws_s3_bucket",
        managed_by_provider: "cmp_aws",
        managed_service_key: "s3",
      },
    };
    const flows: DetectedDataFlow[] = [];
    const pairKeys = new Set<string>();
    appendTerraformBareProviderAttachmentFlows({
      components: [aws, bucket],
      flows,
      pairKeys,
    });
    expect(flows).toHaveLength(0);
  });
});
