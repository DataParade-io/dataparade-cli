import path from "path";

import type { RawFinding } from "../../../src/core/types/detection";
import {
  mergeTerraformShowJsonFindings,
  mergeTerraformShowJsonFromDoc,
} from "../../../src/analyzers/terraform/terraform-show-json";

describe("terraform-show-json merge", () => {
  it("mergeTerraformShowJsonFromDoc adds resources not already in static findings", () => {
    const existing: RawFinding[] = [
      {
        pattern: "terraform_resource",
        name: "aws_s3_bucket.data",
        confidence: 0.9,
        location: { filePath: "main.tf", startLine: 1, endLine: 5 },
        properties: {
          terraform_address: "aws_s3_bucket.data",
          terraform_block_kind: "resource",
          resource_type: "aws_s3_bucket",
        },
      },
    ];

    const doc = {
      planned_values: {
        root_module: {
          resources: [
            {
              address: "aws_s3_bucket.data",
              type: "aws_s3_bucket",
              name: "data",
            },
            {
              address: "aws_s3_bucket.only_in_plan",
              type: "aws_s3_bucket",
              name: "only_in_plan",
            },
          ],
        },
      },
    };

    const merged = mergeTerraformShowJsonFromDoc(
      existing,
      doc as Record<string, unknown>,
      "fixture.json",
    );

    expect(merged.mergedCount).toBe(1);
    expect(merged.findings).toHaveLength(1);
    expect(merged.findings[0]?.properties?.terraform_address).toBe(
      "aws_s3_bucket.only_in_plan",
    );
    expect(merged.findings[0]?.properties?.terraform_json_source).toBe(true);
  });

  it("mergeTerraformShowJsonFromDoc does not add aws_iam_* resources", () => {
    const existing: RawFinding[] = [];
    const doc = {
      planned_values: {
        root_module: {
          resources: [
            {
              address: "aws_iam_role.exec",
              type: "aws_iam_role",
              name: "exec",
            },
            {
              address: "aws_lambda_function.api",
              type: "aws_lambda_function",
              name: "api",
            },
          ],
        },
      },
    };

    const merged = mergeTerraformShowJsonFromDoc(
      existing,
      doc as Record<string, unknown>,
      "plan.json",
    );

    expect(merged.mergedCount).toBe(1);
    expect(merged.findings[0]?.properties?.resource_type).toBe(
      "aws_lambda_function",
    );
  });

  it("mergeTerraformShowJsonFindings reads fixture file from disk", () => {
    const fixturePath = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "terraform-show-extra-bucket.json",
    );
    const merged = mergeTerraformShowJsonFindings([], fixturePath);
    expect(merged.mergedCount).toBe(1);
    expect(merged.findings[0]?.name).toBe("aws_s3_bucket.only_in_plan");
  });
});
