import fs from "fs";
import os from "os";
import path from "path";

import {
  discoverServiceSections,
  inferTerraformStackSectionPathDepth,
  tagFindingsWithServiceSections,
} from "../../../src/core/sectioning/discover-service-sections";
import type { RawFinding } from "../../../src/core/types/detection";

function write(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

describe("inferTerraformStackSectionPathDepth", () => {
  it("prefers depths with the most main.tf directories", () => {
    const depth = inferTerraformStackSectionPathDepth([
      "a/b/main.tf",
      "a/b/c/main.tf",
      "a/b/c/d/main.tf",
      "x/y/main.tf",
      "x/y/main.tf",
    ]);
    expect(depth).toBe(2);
  });

  it("returns undefined when no terraform config paths", () => {
    expect(inferTerraformStackSectionPathDepth([])).toBeUndefined();
  });
});

describe("discoverServiceSections — terraformStackSectionPathDepth", () => {
  it("registers a section when dirname segment count equals N and a .tf config exists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-tfsec-"));
    try {
      write(path.join(root, "a", "b", "main.tf"), 'resource "null_resource" "x" {}\n');

      const { sections } = await discoverServiceSections(root, {
        terraformStackSectionPathDepth: 2,
        autoInferTerraformStackSectionPathDepth: false,
      });

      const svc = sections.find((s) => s.id === "a/b");
      expect(svc).toBeDefined();
      expect(svc?.role).toBe("service");
      expect(svc?.manifestPaths).toContain("a/b/main.tf");
      expect(svc?.isTerraformStack).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not register deeper stacks when N is smaller", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-tfsec-"));
    try {
      write(
        path.join(root, "a", "b", "c", "main.tf"),
        'resource "null_resource" "x" {}\n',
      );

      const { sections } = await discoverServiceSections(root, {
        terraformStackSectionPathDepth: 2,
        autoInferTerraformStackSectionPathDepth: false,
      });

      expect(sections.some((s) => s.id === "a/b/c")).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("registers depth-3 stack when N is 3", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-tfsec-"));
    try {
      write(
        path.join(root, "a", "b", "c", "main.tf"),
        'resource "null_resource" "x" {}\n',
      );

      const { sections } = await discoverServiceSections(root, {
        terraformStackSectionPathDepth: 3,
        autoInferTerraformStackSectionPathDepth: false,
      });

      const svc = sections.find((s) => s.id === "a/b/c");
      expect(svc).toBeDefined();
      expect(svc?.manifestPaths).toContain("a/b/c/main.tf");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("registers stack with only resources.tf (no main.tf)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-tfsec-"));
    try {
      write(
        path.join(root, "a", "b", "resources.tf"),
        'resource "null_resource" "x" {}\n',
      );

      const { sections } = await discoverServiceSections(root, {
        terraformStackSectionPathDepth: 2,
        autoInferTerraformStackSectionPathDepth: false,
      });

      const svc = sections.find((s) => s.id === "a/b");
      expect(svc).toBeDefined();
      expect(svc?.manifestPaths).toContain("a/b/resources.tf");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges main.tf with package.json in the same directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-tfsec-"));
    try {
      write(path.join(root, "x", "y", "package.json"), "{}");
      write(path.join(root, "x", "y", "main.tf"), 'resource "null_resource" "x" {}\n');

      const { sections } = await discoverServiceSections(root, {
        terraformStackSectionPathDepth: 2,
        autoInferTerraformStackSectionPathDepth: false,
      });

      const svc = sections.find((s) => s.id === "x/y");
      expect(svc).toBeDefined();
      expect(svc?.manifestPaths.sort()).toEqual(
        ["x/y/main.tf", "x/y/package.json"].sort(),
      );
      expect(svc?.isTerraformStack).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips terraform stack when sectionDir matches excludePaths", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-tfsec-"));
    try {
      write(path.join(root, "svc", "stack", "main.tf"), 'resource "null_resource" "x" {}\n');

      const { sections } = await discoverServiceSections(root, {
        terraformStackSectionPathDepth: 2,
        autoInferTerraformStackSectionPathDepth: false,
        excludePaths: ["svc/stack"],
      });

      expect(sections.some((s) => s.id === "svc/stack")).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not add terraform-only sections when auto-infer is disabled", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-tfsec-"));
    try {
      write(path.join(root, "a", "b", "main.tf"), 'resource "null_resource" "x" {}\n');

      const { sections } = await discoverServiceSections(root, {
        autoInferTerraformStackSectionPathDepth: false,
      });

      expect(sections.some((s) => s.id === "a/b")).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("auto-infers depth and registers Twenty-like k8s/terraform stack", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-tfsec-twenty-"));
    try {
      write(
        path.join(
          root,
          "packages",
          "twenty-docker",
          "k8s",
          "terraform",
          "main.tf",
        ),
        'resource "kubernetes_deployment" "api" {}\n',
      );
      write(
        path.join(
          root,
          "packages",
          "twenty-docker",
          "k8s",
          "terraform",
          "variables.tf",
        ),
        'variable "x" {}\n',
      );

      const { sections, inferredTerraformStackSectionPathDepth } =
        await discoverServiceSections(root);

      expect(inferredTerraformStackSectionPathDepth).toBe(4);
      const stack = sections.find(
        (s) => s.id === "packages/twenty-docker/k8s/terraform",
      );
      expect(stack).toBeDefined();
      expect(stack?.label).toBe("terraform");
      expect(stack?.manifestPaths).toEqual(
        expect.arrayContaining([
          "packages/twenty-docker/k8s/terraform/main.tf",
          "packages/twenty-docker/k8s/terraform/variables.tf",
        ]),
      );
      expect(stack?.isTerraformStack).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("sets isTerraformStack for non-terraform/ layout (e.g. infra/stack)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-tfsec-infra-"));
    try {
      write(path.join(root, "infra", "stack", "main.tf"), 'resource "null_resource" "x" {}\n');

      const { sections } = await discoverServiceSections(root, {
        terraformStackSectionPathDepth: 2,
        autoInferTerraformStackSectionPathDepth: false,
      });

      const stack = sections.find((s) => s.id === "infra/stack");
      expect(stack).toBeDefined();
      expect(stack?.isTerraformStack).toBe(true);
      expect(stack?.manifestPaths).toEqual(["infra/stack/main.tf"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("tagFindingsWithServiceSections — terraform stacks", () => {
  it("tags terraform findings with the nearest stack section, not root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-tfsec-tag-"));
    try {
      const tfRel = "packages/twenty-docker/k8s/terraform/main.tf";
      write(path.join(root, tfRel), 'resource "null_resource" "x" {}\n');

      const { sections } = await discoverServiceSections(root, {
        terraformStackSectionPathDepth: 4,
      });

      const findings: RawFinding[] = [
        {
          pattern: "terraform_resource",
          name: "null_resource.x",
          confidence: 0.9,
          location: { filePath: tfRel, startLine: 1, endLine: 1 },
          properties: {},
        },
      ];

      tagFindingsWithServiceSections(findings, sections);

      expect(findings[0]?.properties.section_id).toBe(
        "packages/twenty-docker/k8s/terraform",
      );
      expect(findings[0]?.properties.section_label).toBe("terraform");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
