import type { RawFinding } from "../../../src/core/types/detection";
import { classifyRawFindings } from "../../../src/classifier/component-factory";
import { enhanceComponents } from "../../../src/classifier/enhance";

function tfResource(
  address: string,
  resourceType: string,
  blockName: string,
  subType: string,
): RawFinding {
  return {
    pattern: "terraform_resource",
    name: address,
    confidence: 0.9,
    location: { filePath: "main.tf", startLine: 1, endLine: 5 },
    properties: {
      terraform_address: address,
      terraform_block_kind: "resource",
      resource_type: resourceType,
      block_name: blockName,
      componentSubType: subType,
      cloud_provider: "aws",
      section_id: "root",
      section_label: "root",
      terraform_references: [],
    },
  };
}

describe("classifier terraform grouping", () => {
  it("groups each terraform address separately (no merge on normalized labels)", () => {
    const findings: RawFinding[] = [
      tfResource("aws_s3_bucket.lambda_bucket", "aws_s3_bucket", "lambda_bucket", "storage"),
      tfResource(
        "aws_lambda_function.lambda_bucket",
        "aws_lambda_function",
        "lambda_bucket",
        "function",
      ),
    ];
    const components = classifyRawFindings(findings);
    expect(components).toHaveLength(2);
    const labels = components.map((c) => c.name).sort();
    expect(labels).toEqual([
      "lambda_bucket (aws_lambda_function)",
      "lambda_bucket (aws_s3_bucket)",
    ]);
  });

  it("uses block_name (resource_type) labels so lambda_* bucket names are not confused with Lambda compute", () => {
    const components = classifyRawFindings([
      tfResource("aws_s3_bucket.lambda_bucket", "aws_s3_bucket", "lambda_bucket", "storage"),
    ]);
    expect(components[0]?.name).toBe("lambda_bucket (aws_s3_bucket)");
  });

  it("classifies terraform_provider findings as third_party cloud providers", () => {
    const components = classifyRawFindings([
      {
        pattern: "terraform_provider",
        name: "provider:kubernetes",
        confidence: 0.92,
        location: {
          filePath: "packages/acme/k8s/terraform/main.tf",
          startLine: 4,
          endLine: 6,
        },
        properties: {
          terraform_address: "provider.kubernetes",
          provider_name: "kubernetes",
          serviceName: "Kubernetes",
          section_id: "packages/acme/k8s/terraform",
          section_label: "terraform",
        },
      },
    ]);
    expect(components).toHaveLength(1);
    expect(components[0]?.type).toBe("third_party");
    expect(components[0]?.subType).toBe("cloud_provider");
    expect(components[0]?.name).toBe("Kubernetes");
    expect(components[0]?.properties?.terraform_address).toBe("provider.kubernetes");
  });

  it("drops utility terraform resources (random_pet) from classified components", () => {
    const components = classifyRawFindings([
      {
        pattern: "terraform_resource",
        name: "random_pet.lambda_bucket_name",
        confidence: 0.9,
        location: { filePath: "main.tf", startLine: 1, endLine: 3 },
        properties: {
          terraform_address: "random_pet.lambda_bucket_name",
          terraform_block_kind: "resource",
          resource_type: "random_pet",
          block_name: "lambda_bucket_name",
          componentSubType: "application",
          cloud_provider: "terraform",
          section_id: "root",
          section_label: "root",
          terraform_references: [],
        },
      },
      tfResource("aws_s3_bucket.lambda_bucket", "aws_s3_bucket", "lambda_bucket", "storage"),
    ]);
    expect(components).toHaveLength(1);
    expect(components[0]?.properties?.terraform_address).toBe(
      "aws_s3_bucket.lambda_bucket",
    );
    const enhanced = enhanceComponents(components);
    expect(enhanced.some((c) => c.properties.isMainApplication === true)).toBe(
      false,
    );
  });
});
