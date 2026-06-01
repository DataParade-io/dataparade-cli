import {
  terraformAssetMatchesManagedServiceTopologyRule,
  terraformResourceTypeMatchesTopologyRule,
} from "../../../src/ai-enrichment/provider-topology-shared";
import type { DetectedComponent } from "../../../src/core/types/component";

describe("provider topology — AWS Terraform resource_type rules", () => {
  const awsS3Node = {
    key: "s3",
    usageSignals: ["s3", "bucket"],
    terraformResourceTypes: [] as string[],
    terraformResourceTypePrefixes: ["aws_s3_"],
  };

  const awsLambdaNode = {
    key: "lambda",
    usageSignals: ["lambda", "function"],
    terraformResourceTypes: [] as string[],
    terraformResourceTypePrefixes: ["aws_lambda_"],
  };

  it("matches HashiCorp aws_s3_* types by prefix only", () => {
    expect(
      terraformResourceTypeMatchesTopologyRule("aws_s3_bucket", [], ["aws_s3_"]),
    ).toBe(true);
    expect(
      terraformResourceTypeMatchesTopologyRule("aws_s3_bucket_acl", [], ["aws_s3_"]),
    ).toBe(true);
    expect(
      terraformResourceTypeMatchesTopologyRule("aws_lambda_function", [], ["aws_s3_"]),
    ).toBe(false);
  });

  it("matches aws_db_instance by exact type", () => {
    expect(
      terraformResourceTypeMatchesTopologyRule(
        "aws_db_instance",
        ["aws_db_instance"],
        [],
      ),
    ).toBe(true);
    expect(
      terraformResourceTypeMatchesTopologyRule(
        "aws_db_subnet_group",
        ["aws_db_instance"],
        [],
      ),
    ).toBe(false);
  });

  it("does not treat lambda_* block naming as Lambda when resource_type is S3", () => {
    const bucket: DetectedComponent = {
      id: "b1",
      name: "lambda_bucket",
      type: "asset",
      confidence: 1,
      detectedFrom: [],
      sourceLocations: [],
      properties: {
        resource_type: "aws_s3_bucket",
        block_name: "lambda_bucket",
        terraform_address: "aws_s3_bucket.lambda_bucket",
      },
    };
    expect(terraformAssetMatchesManagedServiceTopologyRule(bucket, awsLambdaNode)).toBe(
      false,
    );
    expect(terraformAssetMatchesManagedServiceTopologyRule(bucket, awsS3Node)).toBe(true);
  });
});
