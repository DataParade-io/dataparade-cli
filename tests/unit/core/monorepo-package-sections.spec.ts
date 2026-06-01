import fs from "fs";
import os from "os";
import path from "path";

import {
  discoverServiceSections,
  inferMonorepoPackageSectionPathDepth,
  rollupSectionIdToMonorepoDepth,
  tagFindingsWithServiceSections,
} from "../../../src/core/sectioning/discover-service-sections";
import { injectApplicationAssetsPerSectionIfMissing } from "../../../src/classifier/application-injection";
import type { RawFinding } from "../../../src/core/types/detection";

function write(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

describe("monorepo package sections", () => {
  it("inferMonorepoPackageSectionPathDepth picks shallowest depth with multiple packages", () => {
    expect(
      inferMonorepoPackageSectionPathDepth([
        "packages/server/package.json",
        "packages/front/package.json",
        "packages/apps/nested/package.json",
      ]),
    ).toBe(2);
  });

  it("rollupSectionIdToMonorepoDepth trims nested package paths", () => {
    expect(
      rollupSectionIdToMonorepoDepth("packages/apps/nested", 2),
    ).toBe("packages/apps");
  });

  it("uses package.json name for section label and rolls up nested packages", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-mono-"));
    try {
      write(
        path.join(root, "packages", "twenty-server", "package.json"),
        JSON.stringify({ name: "@twenty/twenty-server" }),
      );
      write(
        path.join(root, "packages", "twenty-front", "package.json"),
        JSON.stringify({ name: "@twenty/twenty-front" }),
      );
      write(
        path.join(root, "packages", "twenty-apps", "hello", "package.json"),
        JSON.stringify({ name: "@twenty/hello-app" }),
      );
      write(
        path.join(root, "packages", "twenty-apps", "hello", "src", "routes.ts"),
        "export const x = 1;\n",
      );

      const { sections, inferredMonorepoPackageSectionPathDepth } =
        await discoverServiceSections(root);

      expect(inferredMonorepoPackageSectionPathDepth).toBe(2);

      const server = sections.find((s) => s.id === "packages/twenty-server");
      expect(server?.label).toBe("twenty-server");
      expect(server?.isPrimaryMonorepoPackage).toBe(true);

      const appsParent = sections.find((s) => s.id === "packages/twenty-apps");
      expect(appsParent).toBeDefined();
      expect(appsParent?.isPrimaryMonorepoPackage).toBe(true);

      const nested = sections.find(
        (s) => s.id === "packages/twenty-apps/hello",
      );
      expect(nested?.isPrimaryMonorepoPackage).toBe(false);

      const findings: RawFinding[] = [
        {
          pattern: "express_route",
          name: "GET /hello",
          confidence: 0.9,
          location: {
            filePath: "packages/twenty-apps/hello/src/routes.ts",
            startLine: 1,
            endLine: 1,
          },
          properties: {},
        },
      ];

      tagFindingsWithServiceSections(findings, sections, {
        monorepoPackageSectionPathDepth: 2,
      });

      expect(findings[0]?.properties.section_id).toBe("packages/twenty-apps");
      expect(findings[0]?.properties.section_label).toBe("twenty-apps");
      expect(findings[0]?.properties.package_name).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("discoverServiceSections honors explicit monorepoPackageSectionPathDepth override", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-mono-depth-"));
    try {
      write(
        path.join(root, "packages", "twenty-server", "package.json"),
        JSON.stringify({ name: "twenty-server" }),
      );
      write(
        path.join(root, "packages", "twenty-apps", "hello", "package.json"),
        JSON.stringify({ name: "hello" }),
      );

      const at2 = await discoverServiceSections(root, {
        monorepoPackageSectionPathDepth: 2,
      });
      const helloAt2 = at2.sections.find(
        (s) => s.id === "packages/twenty-apps/hello",
      );
      expect(helloAt2?.isPrimaryMonorepoPackage).toBe(false);

      const at3 = await discoverServiceSections(root, {
        monorepoPackageSectionPathDepth: 3,
      });
      const helloAt3 = at3.sections.find(
        (s) => s.id === "packages/twenty-apps/hello",
      );
      expect(helloAt3?.isPrimaryMonorepoPackage).toBe(true);
      expect(at3.monorepoPackageSectionPathDepth).toBe(3);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("injectApplicationAssetsPerSectionIfMissing only targets primary workspace packages", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-mono-inj-"));
    try {
      write(
        path.join(root, "packages", "api", "package.json"),
        JSON.stringify({ name: "api" }),
      );
      write(
        path.join(root, "packages", "ui", "package.json"),
        JSON.stringify({ name: "ui" }),
      );
      write(
        path.join(root, "packages", "ui", "widget", "package.json"),
        JSON.stringify({ name: "widget" }),
      );
      write(
        path.join(root, "packages", "docs", "package.json"),
        JSON.stringify({ name: "docs" }),
      );

      const { sections } = await discoverServiceSections(root);
      const injected = injectApplicationAssetsPerSectionIfMissing(
        [
          {
            id: "cmp_1",
            name: "Postgres",
            type: "asset",
            subType: "database",
            confidence: 1,
            detectedFrom: [],
            sourceLocations: [],
            properties: { section_id: "packages/api" },
          },
        ],
        sections,
        { projectName: "ignored" },
      );

      const placeholderIds = injected
        .filter(
          (c) =>
            c.properties?.sourceContext === "injected_project_placeholder",
        )
        .map((c) => c.properties?.section_id)
        .sort();
      expect(placeholderIds).toEqual(["packages/api"]);
      expect(placeholderIds).not.toContain("packages/ui");
      expect(placeholderIds).not.toContain("packages/ui/widget");
      expect(placeholderIds).not.toContain("packages/docs");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
