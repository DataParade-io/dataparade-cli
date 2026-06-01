import fs from "fs/promises";
import os from "os";
import path from "path";

import { discoverServiceSections } from "../../../src/core/sectioning/discover-service-sections";

describe("core/sectioning/discover-service-sections excludes", () => {
  it("ignores hidden internal package.json directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dp-sections-hidden-"));
    try {
      await fs.mkdir(path.join(root, ".internal"), { recursive: true });
      await fs.writeFile(
        path.join(root, ".internal", "package.json"),
        JSON.stringify({ name: "internal-tooling" }),
      );
      await fs.mkdir(path.join(root, "service-a"), { recursive: true });
      await fs.writeFile(
        path.join(root, "service-a", "package.json"),
        JSON.stringify({ name: "service-a" }),
      );

      const { sections } = await discoverServiceSections(root, {
        autoInferTerraformStackSectionPathDepth: false,
      });
      const sectionIds = sections.map((s) => s.id);

      expect(sectionIds).toContain("service-a");
      expect(sectionIds).not.toContain(".internal");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("respects root .gitignore patterns such as test-project-scan/*", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dp-sections-gitignore-"));
    try {
      await fs.writeFile(
        path.join(root, ".gitignore"),
        "test-project-scan/*\n",
        "utf8",
      );
      await fs.mkdir(
        path.join(root, "test-project-scan", "sample-app", "nested"),
        { recursive: true },
      );
      await fs.writeFile(
        path.join(root, "test-project-scan", "sample-app", "package.json"),
        JSON.stringify({ name: "ignored-sample" }),
      );
      await fs.writeFile(
        path.join(
          root,
          "test-project-scan",
          "sample-app",
          "nested",
          "package.json",
        ),
        JSON.stringify({ name: "ignored-nested" }),
      );
      await fs.mkdir(path.join(root, "service-a"), { recursive: true });
      await fs.writeFile(
        path.join(root, "service-a", "package.json"),
        JSON.stringify({ name: "service-a" }),
      );

      const { sections } = await discoverServiceSections(root, {
        autoInferTerraformStackSectionPathDepth: false,
      });
      const sectionIds = sections.map((s) => s.id);

      expect(sectionIds).toContain("service-a");
      expect(sectionIds.some((id) => id.startsWith("test-project-scan"))).toBe(
        false,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
