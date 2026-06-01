import path from "path";
import fs from "fs";
import { detectTerraformPatterns } from "../../../../src/analyzers/terraform/detector";
import { loadTerraformPatternConfig } from "../../../../src/analyzers/terraform/terraform-detection-config";

describe("analyzers/terraform/detector", () => {
  const tfConfig = loadTerraformPatternConfig();
  it("emits terraform_resource and terraform_provider findings for fixture", () => {
    const root = path.join(__dirname, "../../../fixtures/terraform-basic");
    const mainPath = path.join(root, "main.tf");
    const provPath = path.join(root, "providers.tf");
    const mainContent = fs.readFileSync(mainPath, "utf8");
    const provContent = fs.readFileSync(provPath, "utf8");

    const mainFindings = detectTerraformPatterns(
      {
        path: "main.tf",
        name: "main.tf",
        content: mainContent,
        language: "terraform",
        size: mainContent.length,
      },
      tfConfig,
    );

    const res = mainFindings.filter((f) => f.pattern === "terraform_resource");
    expect(res.length).toBeGreaterThanOrEqual(3);

    const lambda = res.find(
      (f) => f.properties.terraform_address === "aws_lambda_function.api",
    );
    expect(lambda).toBeDefined();
    const refs = lambda?.properties.terraform_references as string[];
    expect(Array.isArray(refs)).toBe(true);
    expect(refs).toContain("aws_db_instance.main");
    expect(refs).not.toContain("aws_iam_role.lambda_exec");

    expect(
      res.some((f) => f.properties?.resource_type === "aws_iam_role"),
    ).toBe(false);

    const provFindings = detectTerraformPatterns(
      {
        path: "providers.tf",
        name: "providers.tf",
        content: provContent,
        language: "terraform",
        size: provContent.length,
      },
      tfConfig,
    );
    expect(
      provFindings.some((f) => f.pattern === "terraform_provider"),
    ).toBe(true);
  });

  it("returns empty for non-terraform language", () => {
    expect(
      detectTerraformPatterns(
        {
          path: "x.ts",
          name: "x.ts",
          content: "export {}",
          language: "typescript",
          size: 10,
        },
        tfConfig,
      ),
    ).toEqual([]);
  });

  it("merges S3 ACL and ownership satellite resources into the bucket finding", () => {
    const content = `
resource "aws_s3_bucket" "app_data" {
  bucket = "example-app-data"
}

resource "aws_s3_bucket_ownership_controls" "app_data" {
  bucket = aws_s3_bucket.app_data.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_acl" "app_data" {
  bucket = aws_s3_bucket.app_data.id
  acl    = "private"
}
`;
    const findings = detectTerraformPatterns(
      {
        path: "storage.tf",
        name: "storage.tf",
        content,
        language: "terraform",
        size: content.length,
      },
      tfConfig,
    );
    const resources = findings.filter((f) => f.pattern === "terraform_resource");
    expect(resources).toHaveLength(1);
    expect(resources[0]?.properties?.terraform_address).toBe("aws_s3_bucket.app_data");
    const sats = resources[0]?.properties?.terraform_satellites as
      | { terraform_address: string }[]
      | undefined;
    expect(Array.isArray(sats)).toBe(true);
    expect(sats?.length).toBe(2);
    const satAddrs = new Set(sats?.map((s) => s.terraform_address));
    expect(satAddrs.has("aws_s3_bucket_ownership_controls.app_data")).toBe(true);
    expect(satAddrs.has("aws_s3_bucket_acl.app_data")).toBe(true);
  });

  it("does not emit a terraform_resource finding for random_pet utility resources", () => {
    const content = `
resource "random_pet" "lambda_bucket_name" {
  length = 4
}

resource "aws_s3_bucket" "lambda_bucket" {
  bucket = random_pet.lambda_bucket_name.id
}
`;
    const findings = detectTerraformPatterns(
      {
        path: "main.tf",
        name: "main.tf",
        content,
        language: "terraform",
        size: content.length,
      },
      tfConfig,
    );
    const resources = findings.filter((f) => f.pattern === "terraform_resource");
    expect(resources).toHaveLength(1);
    expect(resources[0]?.properties?.terraform_address).toBe(
      "aws_s3_bucket.lambda_bucket",
    );
    const refs = resources[0]?.properties?.terraform_references as string[];
    expect(refs).toEqual([]);
  });
});
