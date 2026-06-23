import fs from "fs";
import path from "path";

describe("npm publish manifest", () => {
  const pkgPath = path.resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    files?: string[];
  };

  it("lists typescript as a runtime dependency (required by TS analyzer)", () => {
    expect(pkg.dependencies?.typescript).toBeDefined();
    expect(pkg.devDependencies?.typescript).toBeUndefined();
  });

  it("includes patterns/ in published files (runtime YAML configs)", () => {
    expect(pkg.files).toContain("patterns");
  });
});
