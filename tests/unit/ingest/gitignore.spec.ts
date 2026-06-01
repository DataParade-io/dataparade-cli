import fs from "fs";
import os from "os";
import path from "path";

import { ingestFileSystem } from "../../../src/ingest/file-system";

describe("ingest/gitignore", () => {
  it("skips paths matched by test-project-scan/* at any depth", async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "dp-cli-gitignore-scan-"),
    );

    try {
      fs.writeFileSync(
        path.join(tempRoot, ".gitignore"),
        "test-project-scan/*\n",
        "utf8",
      );
      fs.mkdirSync(path.join(tempRoot, "test-project-scan", "app", "src"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(tempRoot, "test-project-scan", "app", "src", "index.ts"),
        "export const x = 1;\n",
        "utf8",
      );
      fs.mkdirSync(path.join(tempRoot, "included"), { recursive: true });
      fs.writeFileSync(
        path.join(tempRoot, "included", "index.ts"),
        "export const y = 2;\n",
        "utf8",
      );

      const files = await ingestFileSystem(tempRoot);
      const paths = files.map((f) => f.path);

      expect(paths).toContain("included/index.ts");
      expect(paths.some((p) => p.startsWith("test-project-scan/"))).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
