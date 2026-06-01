import path from "path";

import type { FileInfo } from "../../../../src/core/types/file";
import {
  buildTerraformModuleCallManifest,
  moduleInstancePrefixesForFile,
} from "../../../../src/analyzers/terraform/terraform-module-manifest";

function file(rel: string, content: string): FileInfo {
  return {
    path: rel.replace(/\\/g, "/"),
    name: path.basename(rel),
    content,
    language: "terraform",
    size: content.length,
  };
}

describe("terraform-module-manifest", () => {
  const root = "/repo/aws_fullstack_terraform";

  it("indexes module instance addresses by resolved filesystem module source", () => {
    const files: FileInfo[] = [
      file(
        "environments/dev/main.tf",
        `
module "vpc" {
  source = "../../modules/vpc"
}
module "ecs_frontend" {
  source = "../../modules/ecs-service"
}
module "ecs_backend" {
  source = "../../modules/ecs-service"
}
`,
      ),
    ];

    const manifest = buildTerraformModuleCallManifest(root, files);

    const vpcInstances = manifest.instancesByModuleSourceDir.get("modules/vpc");
    expect(vpcInstances).toEqual(["module.vpc"]);

    const ecsInstances = manifest.instancesByModuleSourceDir.get(
      "modules/ecs-service",
    );
    expect(ecsInstances).toEqual(["module.ecs_backend", "module.ecs_frontend"]);
  });

  it("moduleInstancePrefixesForFile returns callers for a shared module directory", () => {
    const manifest = buildTerraformModuleCallManifest(root, [
      file(
        "environments/dev/main.tf",
        `
module "a" {
  source = "../../modules/m"
}
module "b" {
  source = "../../modules/m"
}
`,
      ),
    ]);

    const prefixes = moduleInstancePrefixesForFile(
      manifest,
      root,
      "modules/m/main.tf",
    );
    expect(prefixes).toEqual(["module.a", "module.b"]);
  });

  it("ignores registry module sources", () => {
    const manifest = buildTerraformModuleCallManifest(root, [
      file(
        "root/main.tf",
        `
module "x" {
  source = "terraform-aws-modules/vpc/aws"
}
`,
      ),
    ]);
    expect(manifest.instancesByModuleSourceDir.size).toBe(0);
  });
});
