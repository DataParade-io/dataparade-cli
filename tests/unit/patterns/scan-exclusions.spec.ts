import fs from "fs";
import os from "os";
import path from "path";

import {
  DEFAULT_EXCLUDED_FILE_GLOBS,
  shouldSkipDirectoryName,
} from "../../../src/patterns/scan-exclusions";
import { ingestFileSystem } from "../../../src/ingest/file-system";

describe("patterns/scan-exclusions", () => {
  it("skips __stories__ and storybook-static directory names", () => {
    expect(shouldSkipDirectoryName("__stories__")).toBe(true);
    expect(shouldSkipDirectoryName("storybook-static")).toBe(true);
    expect(shouldSkipDirectoryName("__tests__")).toBe(true);
    expect(shouldSkipDirectoryName("src")).toBe(false);
  });

  it("skips .storybook as a hidden directory", () => {
    expect(shouldSkipDirectoryName(".storybook")).toBe(true);
  });

  it("excludes Storybook story files via default file globs", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cli-stories-"));
    try {
      fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
      fs.mkdirSync(path.join(tempRoot, "__stories__"), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, "src", "app.ts"), "export {};\n", "utf8");
      fs.writeFileSync(
        path.join(tempRoot, "Button.stories.tsx"),
        "export default {};\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(tempRoot, "__stories__", "Demo.stories.tsx"),
        "export default {};\n",
        "utf8",
      );

      const files = await ingestFileSystem(tempRoot, {
        excludePaths: [...DEFAULT_EXCLUDED_FILE_GLOBS],
        maxFileCount: 100,
      });
      const paths = files.map((f) => f.path);

      expect(paths).toContain("src/app.ts");
      expect(paths).not.toContain("Button.stories.tsx");
      expect(paths.some((p) => p.includes("__stories__"))).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("skips __stories__ directories even without explicit file globs", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cli-stories-dir-"));
    try {
      fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
      fs.mkdirSync(path.join(tempRoot, "__stories__"), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, "src", "app.ts"), "export {};\n", "utf8");
      fs.writeFileSync(
        path.join(tempRoot, "__stories__", "only-in-stories.ts"),
        "export {};\n",
        "utf8",
      );

      const files = await ingestFileSystem(tempRoot, { maxFileCount: 100 });
      const paths = files.map((f) => f.path);

      expect(paths).toContain("src/app.ts");
      expect(paths.some((p) => p.includes("__stories__"))).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
