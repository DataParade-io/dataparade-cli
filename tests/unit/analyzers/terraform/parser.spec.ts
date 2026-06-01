import path from "path";
import fs from "fs";
import {
  extractTerraformReferences,
  lineBraceDelta,
  parseTerraformFile,
  sectionIdFromFilePath,
} from "../../../../src/analyzers/terraform/parser";
import { loadTerraformPatternConfig } from "../../../../src/analyzers/terraform/terraform-detection-config";

describe("analyzers/terraform/parser", () => {
  const tfConfig = loadTerraformPatternConfig();
  it("lineBraceDelta ignores braces inside double-quoted strings", () => {
    expect(lineBraceDelta('x = "{}"')).toBe(0);
    expect(lineBraceDelta("outer {")).toBe(1);
    expect(lineBraceDelta("}")).toBe(-1);
  });

  it("parses resource, module, and provider blocks from terraform-basic fixture", () => {
    const root = path.join(__dirname, "../../../fixtures/terraform-basic");
    const mainPath = path.join(root, "main.tf");
    const content = fs.readFileSync(mainPath, "utf8");
    const { blocks, warnings } = parseTerraformFile(
      {
        path: "main.tf",
        name: "main.tf",
        content,
        language: "terraform",
        size: content.length,
      },
      tfConfig,
    );

    expect(warnings).toEqual([]);
    const addresses = blocks.map((b) => b.address).sort();
    expect(addresses).toContain("aws_db_instance.main");
    expect(addresses).toContain("aws_lambda_function.api");
    expect(addresses).toContain("aws_s3_bucket.data");
    expect(addresses).toContain("aws_iam_role.lambda_exec");
  });

  it("extracts cross-resource references from lambda environment", () => {
    const root = path.join(__dirname, "../../../fixtures/terraform-basic");
    const mainPath = path.join(root, "main.tf");
    const content = fs.readFileSync(mainPath, "utf8");
    const { blocks } = parseTerraformFile(
      {
        path: "main.tf",
        name: "main.tf",
        content,
        language: "terraform",
        size: content.length,
      },
      tfConfig,
    );
    const lambda = blocks.find((b) => b.address === "aws_lambda_function.api");
    expect(lambda).toBeDefined();
    const refs = extractTerraformReferences(lambda!.bodyText, tfConfig);
    expect(refs).toContain("aws_db_instance.main");
    expect(refs).toContain("aws_iam_role.lambda_exec");
  });

  it("sectionIdFromFilePath normalizes directory", () => {
    expect(sectionIdFromFilePath("infra/main.tf")).toBe("infra");
    expect(sectionIdFromFilePath("main.tf")).toBe("root");
  });
});
