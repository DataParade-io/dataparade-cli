import fs from "fs";
import path from "path";

describe("npm publish manifest", () => {
  const pkgPath = path.resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    files?: string[];
    bin?: Record<string, string>;
  };

  it("lists typescript as a runtime dependency (required by TS analyzer)", () => {
    expect(pkg.dependencies?.typescript).toBeDefined();
    expect(pkg.devDependencies?.typescript).toBeUndefined();
  });

  it("bundles @dataparade/scanner instead of depending on it at install time", () => {
    // A git dependency makes `npm install -g` clone and build the scanner (DATAP-730).
    expect(pkg.dependencies?.["@dataparade/scanner"]).toBeUndefined();
    expect(pkg.devDependencies?.["@dataparade/scanner"]).toBeDefined();
    expect(pkg.files).not.toContain("patterns");
    expect(pkg.files).toContain("dist");
  });

  it("has no git/url/file dependency specs in runtime dependencies", () => {
    for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
      expect({ name, spec }).toEqual({ name, spec: expect.not.stringMatching(/^(github:|git[+:]|https?:|file:|link:)/) });
    }
  });

  it("installs the command as `dataparade`, matching `--help`", () => {
    // npm drops the scope from a scoped bin key, so "@dataparade/cli" installed as `cli`.
    expect(pkg.bin).toEqual({ dataparade: "dist/bin/cli.js" });
  });

  it("lists the scanner's runtime dependencies as CLI dependencies", () => {
    for (const dep of ["typescript", "yaml", "zod"]) {
      expect(pkg.dependencies?.[dep]).toBeDefined();
    }
  });
});
