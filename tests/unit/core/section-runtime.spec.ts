import type { DetectedComponent } from "../../../src/core/types/component";
import {
  isScaffoldOrTemplatePackageSection,
  isTerraformDerivedComponent,
  isTerraformStackSection,
  sectionHasRuntimeCodeComponents,
  sectionQualifiesForSyntheticApplication,
  shouldInjectUserActorForMainApp,
} from "../../../src/core/sectioning/section-runtime";

function comp(
  partial: Partial<DetectedComponent> & Pick<DetectedComponent, "id">,
): DetectedComponent {
  return {
    name: partial.id,
    type: "asset",
    confidence: 1,
    detectedFrom: [],
    sourceLocations: [],
    properties: {},
    ...partial,
  };
}

describe("section-runtime", () => {
  it("isTerraformDerivedComponent detects terraform_address and patterns", () => {
    expect(
      isTerraformDerivedComponent(
        comp({
          id: "tf1",
          properties: { terraform_address: "aws_s3_bucket.x" },
        }),
      ),
    ).toBe(true);
    expect(
      isTerraformDerivedComponent(
        comp({
          id: "tf2",
          detectedFrom: [{ pattern: "terraform_resource" }],
        }),
      ),
    ).toBe(true);
    expect(
      isTerraformDerivedComponent(
        comp({
          id: "app1",
          detectedFrom: [{ pattern: "express_route" }],
          sourceLocations: [{ filePath: "api/route.ts", startLine: 1, endLine: 2 }],
        }),
      ),
    ).toBe(false);
  });

  it("sectionHasRuntimeCodeComponents ignores terraform-only assets in a module section", () => {
    const components = [
      comp({
        id: "tf_rds",
        detectedFrom: [{ pattern: "terraform_resource" }],
        sourceLocations: [
          { filePath: "terraform/modules/aurora/main.tf", startLine: 1, endLine: 10 },
        ],
        properties: {
          section_id: "terraform/modules/aurora",
          terraform_address: "module.aurora.aws_rds_cluster.this",
        },
      }),
    ];
    expect(
      sectionHasRuntimeCodeComponents(components, "terraform/modules/aurora"),
    ).toBe(false);
  });

  it("sectionQualifiesForSyntheticApplication skips terraform stack module sections", () => {
    const components = [
      comp({
        id: "tf_rds",
        detectedFrom: [{ pattern: "terraform_resource" }],
        sourceLocations: [
          { filePath: "terraform/modules/aurora/main.tf", startLine: 1, endLine: 5 },
        ],
        properties: { section_id: "terraform/modules/aurora" },
      }),
    ];
    expect(
      sectionQualifiesForSyntheticApplication(
        {
          id: "terraform/modules/aurora",
          label: "aurora",
          role: "service",
          sectionDir: "terraform/modules/aurora",
          manifestPaths: [],
        },
        components,
      ),
    ).toBe(false);
    expect(isTerraformStackSection({ id: "terraform/modules/aurora", sectionDir: "terraform/modules/aurora" })).toBe(true);
  });

  it("sectionQualifiesForSyntheticApplication skips discovery-flagged terraform stacks", () => {
    expect(
      sectionQualifiesForSyntheticApplication(
        {
          id: "infra/stack",
          label: "stack",
          role: "service",
          sectionDir: "infra/stack",
          manifestPaths: ["infra/stack/main.tf"],
          isTerraformStack: true,
        },
        [],
      ),
    ).toBe(false);
    expect(
      isTerraformStackSection({
        id: "infra/stack",
        sectionDir: "infra/stack",
        isTerraformStack: true,
      }),
    ).toBe(true);
  });

  it("sectionHasRuntimeCodeComponents detects routes and databases", () => {
    const components = [
      comp({
        id: "c1",
        detectedFrom: [{ pattern: "express_route" }],
        sourceLocations: [{ filePath: "packages/api/src/routes.ts", startLine: 1, endLine: 2 }],
        properties: { section_id: "packages/api" },
      }),
    ];
    expect(sectionHasRuntimeCodeComponents(components, "packages/api")).toBe(true);
    expect(sectionHasRuntimeCodeComponents(components, "packages/cli")).toBe(false);
  });

  it("sectionQualifiesForSyntheticApplication includes manifest package with classified components", () => {
    const components: DetectedComponent[] = [
      comp({
        id: "tp1",
        type: "third_party",
        properties: { section_id: "packages/twenty-companion" },
      }),
    ];
    expect(
      sectionQualifiesForSyntheticApplication(
        {
          id: "packages/twenty-companion",
          label: "twenty-companion",
          role: "service",
          sectionDir: "packages/twenty-companion",
          manifestPaths: ["packages/twenty-companion/package.json"],
          isPrimaryMonorepoPackage: true,
        },
        components,
      ),
    ).toBe(true);
  });

  it("isScaffoldOrTemplatePackageSection uses path layout and shouting-case names only", () => {
    expect(
      isScaffoldOrTemplatePackageSection({
        id: "packages/acme-cli/src/constants/template",
        sectionDir: "packages/acme-cli/src/constants/template",
        packageName: "TO-BE-GENERATED",
      }),
    ).toBe(true);
    expect(
      isScaffoldOrTemplatePackageSection({
        id: "packages/twenty-server",
        sectionDir: "packages/twenty-server",
        packageName: "twenty-server",
      }),
    ).toBe(false);
  });

  it("sectionQualifiesForSyntheticApplication skips generator template sections", () => {
    expect(
      sectionQualifiesForSyntheticApplication(
        {
          id: "packages/acme-cli/src/constants/template",
          label: "TO-BE-GENERATED",
          role: "service",
          sectionDir: "packages/acme-cli/src/constants/template",
          manifestPaths: ["packages/acme-cli/src/constants/template/package.json"],
          packageName: "TO-BE-GENERATED",
        },
        [],
      ),
    ).toBe(false);
  });

  it("shouldInjectUserActorForMainApp skips injected placeholder in terraform module sections", () => {
    const components: DetectedComponent[] = [
      comp({
        id: "tf_rds",
        detectedFrom: [{ pattern: "terraform_resource" }],
        sourceLocations: [
          { filePath: "terraform/modules/aurora/main.tf", startLine: 1, endLine: 5 },
        ],
        properties: { section_id: "terraform/modules/aurora" },
      }),
    ];
    expect(
      shouldInjectUserActorForMainApp(
        comp({
          id: "main",
          subType: "application",
          properties: {
            isMainApplication: true,
            sourceContext: "injected_project_placeholder",
            section_id: "terraform/modules/aurora",
          },
        }),
        components,
      ),
    ).toBe(false);
  });

  it("shouldInjectUserActorForMainApp skips placeholder tooling mains", () => {
    const components: DetectedComponent[] = [];
    expect(
      shouldInjectUserActorForMainApp(
        comp({
          id: "main",
          subType: "application",
          properties: {
            isMainApplication: true,
            sourceContext: "injected_project_placeholder",
            section_id: "packages/twenty-zapier",
          },
        }),
        components,
      ),
    ).toBe(false);
  });
});
