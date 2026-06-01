import fs from "fs";
import os from "os";
import path from "path";
import { ingestFileSystem } from "../../../src/ingest/file-system";

describe("ingest env exclusion", () => {
  it("does not ingest .env files by default", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-env-exclude-"));
    try {
      fs.writeFileSync(path.join(root, "app.ts"), "export const x = 1;", "utf8");
      fs.writeFileSync(path.join(root, ".env"), "API_KEY=secret", "utf8");
      fs.writeFileSync(path.join(root, ".env.local"), "TOKEN=secret", "utf8");

      const files = await ingestFileSystem(root);
      const paths = files.map((f) => f.path);
      expect(paths).toContain("app.ts");
      expect(paths).not.toContain(".env");
      expect(paths).not.toContain(".env.local");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not ingest a single .env file path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-env-single-"));
    const warnings: string[] = [];
    try {
      const envPath = path.join(root, ".env");
      fs.writeFileSync(envPath, "API_KEY=secret", "utf8");

      const files = await ingestFileSystem(envPath, {
        onWarning: (w) => warnings.push(w),
      });
      expect(files).toHaveLength(0);
      expect(warnings.some((w) => w.includes("excluded for security"))).toBe(
        true,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
