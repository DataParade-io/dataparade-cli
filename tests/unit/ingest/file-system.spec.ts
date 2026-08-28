import fs from "fs";
import os from "os";
import path from "path";
import {
  ingestFileSystem,
  resolveScanFilesystemEntry,
} from "../../../src/ingest/file-system";

describe("ingest/file-system - DP-P0-CLI-101", () => {
  const fixtureRoot = path.resolve(
    __dirname,
    "../../fixtures/ingest-basic",
  );

  it("applies default excluded directories and .gitignore rules", async () => {
    const files = await ingestFileSystem(fixtureRoot);
    const paths = files.map((f) => f.path);

    const excludedDirNames = [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      "out",
      "coverage",
      ".vscode",
      ".idea",
    ];

    for (const p of paths) {
      for (const dirName of excludedDirNames) {
        expect(p).not.toContain(`${dirName}/`);
        expect(p).not.toContain(`/${dirName}`);
      }
    }

    // .gitignore at root should ignore ignored.ts and temp/**
    expect(paths).not.toContain("ignored.ts");
    expect(paths.some((p) => p.startsWith("temp/"))).toBe(false);

    // .gitignore in src should ignore ignored-in-src.ts
    expect(paths).not.toContain("src/ignored-in-src.ts");

    // Normal files under non-excluded directories should still be present
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("src/app.jsx");
    expect(paths).toContain("config/app.yaml");
    expect(paths).toContain("data/sample.json");
  });

  it("maps extensions to FileLanguage and skips unsupported ones", async () => {
    const files = await ingestFileSystem(fixtureRoot);
    const byPath = new Map(files.map((f) => [f.path, f]));

    expect(byPath.get("src/index.ts")?.language).toBe("typescript");
    expect(byPath.get("src/app.jsx")?.language).toBe("javascript");
    expect(byPath.get("config/app.yaml")?.language).toBe("yaml");
    expect(byPath.get("data/sample.json")?.language).toBe("json");

    // Python files should be detected as python
    const pyFile = byPath.get("scripts/example.py");
    if (pyFile) {
      expect(pyFile.language).toBe("python");
    }

    // Unsupported extension (.md) should not be included
    expect(byPath.has("README.md")).toBe(false);
  });

  it("populates content and size for included files", async () => {
    const files = await ingestFileSystem(fixtureRoot);
    const file = files.find((f) => f.path === "src/index.ts");

    expect(file).toBeDefined();
    expect(file?.content.length).toBeGreaterThan(0);
    expect(file?.size).toBeGreaterThan(0);
  });

  it("skips files that exceed maxFileSizeBytes", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cli-ingest-"));
    const warnings: string[] = [];

    try {
      fs.writeFileSync(path.join(tempRoot, "small.ts"), "x", "utf8");
      fs.writeFileSync(path.join(tempRoot, "big.ts"), "a".repeat(20), "utf8");

      const files = await ingestFileSystem(tempRoot, {
        maxFileSizeBytes: 10,
        maxFileCount: 100,
        maxTotalBytes: 10_000,
        onWarning: (w) => warnings.push(w),
      });

      const paths = files.map((f) => f.path);
      expect(paths).toContain("small.ts");
      expect(paths).not.toContain("big.ts");
      expect(warnings.some((w) => w.includes("exceeds max file size"))).toBe(
        true,
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("stops ingest when maxFileCount is reached", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cli-ingest-"));
    const warnings: string[] = [];

    try {
      for (let i = 0; i < 10; i += 1) {
        fs.writeFileSync(
          path.join(tempRoot, `f${i}.ts`),
          `console.log(${i});`,
          "utf8",
        );
      }

      const files = await ingestFileSystem(tempRoot, {
        maxFileSizeBytes: 10_000,
        maxFileCount: 3,
        maxTotalBytes: 10_000_000,
        onWarning: (w) => warnings.push(w),
      });

      expect(files).toHaveLength(3);
      expect(
        warnings.some((w) => w.includes("max file count") && w.includes("Stopped")),
      ).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("maps .rs files to rust language", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cli-ingest-rs-"));
    try {
      fs.writeFileSync(
        path.join(tempRoot, "types.rs"),
        "pub struct CardData { pub pan: String }\n",
        "utf8",
      );
      fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tempRoot, "src", "main.rs"),
        "fn main() {}\n",
        "utf8",
      );

      const files = await ingestFileSystem(tempRoot);
      const byPath = new Map(files.map((f) => [f.path, f]));

      expect(byPath.get("types.rs")?.language).toBe("rust");
      expect(byPath.get("src/main.rs")?.language).toBe("rust");
      expect(byPath.get("types.rs")?.content).toContain("CardData");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("maps .tf and .tfvars to terraform language", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cli-ingest-tf-"));
    try {
      fs.writeFileSync(
        path.join(tempRoot, "main.tf"),
        'resource "null_resource" "x" {}\n',
        "utf8",
      );
      fs.writeFileSync(
        path.join(tempRoot, "prod.auto.tfvars"),
        'region = "us-east-1"\n',
        "utf8",
      );

      const files = await ingestFileSystem(tempRoot);
      const byName = new Map(files.map((f) => [f.name, f]));
      expect(byName.get("main.tf")?.language).toBe("terraform");
      expect(byName.get("prod.auto.tfvars")?.language).toBe("terraform");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("ingest/file-system - DP-P0-CLI-105", () => {
  const FIXTURE_ROOT = path.join(
    __dirname,
    "../../fixtures/typescript-basic",
  );

  it("returns FileInfo[] for TypeScript files with correct metadata", async () => {
    const files = await ingestFileSystem(FIXTURE_ROOT);

    const tsFiles = files.filter((f) => f.language === "typescript");
    const paths = tsFiles.map((f) => f.path).sort();

    expect(tsFiles.length).toBeGreaterThanOrEqual(3);
    expect(paths).toContain("server.ts");
    expect(paths).toContain("db.ts");
    expect(paths).toContain("external-api.ts");

    for (const file of tsFiles) {
      expect(file.name.endsWith(".ts")).toBe(true);
      expect(file.size).toBeGreaterThan(0);
    }
  });

  it("applies default excluded directories such as node_modules", async () => {
    const files = await ingestFileSystem(FIXTURE_ROOT);

    const nodeModuleFiles = files.filter((f) =>
      f.path.includes("node_modules/"),
    );

    expect(nodeModuleFiles).toHaveLength(0);
  });

  it("respects .gitignore rules under the fixture root", async () => {
    const files = await ingestFileSystem(FIXTURE_ROOT);

    const ignored = files.find((f) => f.path.endsWith("ignored.ts"));

    expect(ignored).toBeUndefined();
  });

  it("ingests a single .rs file when the path is a supported source file", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cli-ingest-rs-file-"));
    try {
      const rsPath = path.join(tempRoot, "types.rs");
      fs.writeFileSync(
        rsPath,
        "pub struct CardData { pub pan: String }\n",
        "utf8",
      );

      const files = await ingestFileSystem(rsPath);
      expect(files).toHaveLength(1);
      expect(files[0]?.path).toBe("types.rs");
      expect(files[0]?.language).toBe("rust");
      expect(files[0]?.content).toContain("CardData");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("ingests a single file when the path is a supported source file", async () => {
    const tfPath = path.resolve(
      __dirname,
      "../../fixtures/terraform-basic/main.tf",
    );
    const files = await ingestFileSystem(tfPath);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("main.tf");
    expect(files[0]?.language).toBe("terraform");
    expect(files[0]?.content).toContain("resource");
  });

  it("skips a single .env file path with a security warning", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cli-ingest-env-"));
    const warnings: string[] = [];
    try {
      const envPath = path.join(tempRoot, ".env");
      fs.writeFileSync(envPath, "SECRET=x", "utf8");

      const files = await ingestFileSystem(envPath, {
        onWarning: (w) => warnings.push(w),
      });
      expect(files).toHaveLength(0);
      expect(warnings.some((w) => w.includes("excluded for security"))).toBe(
        true,
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("resolveScanFilesystemEntry maps a file to its parent directory", async () => {
    const tfPath = path.resolve(
      __dirname,
      "../../fixtures/terraform-basic/main.tf",
    );
    const dir = path.dirname(tfPath);
    const entry = await resolveScanFilesystemEntry(tfPath);
    expect(entry.scanRootDir).toBe(dir);
    expect(entry.ingestTarget).toBe(tfPath);

    const dirEntry = await resolveScanFilesystemEntry(dir);
    expect(dirEntry.scanRootDir).toBe(dir);
    expect(dirEntry.ingestTarget).toBe(dir);
  });
});

