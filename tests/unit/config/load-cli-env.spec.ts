import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findCliPackageRoot } from "../../../src/config/load-cli-env";

const CLI_PACKAGE_NAME = "@dataparade/cli";

function writeCliPackageJson(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: CLI_PACKAGE_NAME, version: "0.0.0" }),
  );
}

describe("findCliPackageRoot", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dataparade-cli-root-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("prefers the package root over dist/ when tsc copies package.json", () => {
    const packageRoot = path.join(tempRoot, "cli");
    writeCliPackageJson(packageRoot);
    writeCliPackageJson(path.join(packageRoot, "dist"));

    const startDir = path.join(packageRoot, "dist", "src", "config");
    fs.mkdirSync(startDir, { recursive: true });

    expect(findCliPackageRoot(startDir)).toBe(packageRoot);
  });

  it("returns the npm package root when dist/ contains a copied package.json", () => {
    const packageRoot = path.join(tempRoot, "node_modules", "@dataparade", "cli");
    writeCliPackageJson(packageRoot);
    writeCliPackageJson(path.join(packageRoot, "dist"));

    const startDir = path.join(packageRoot, "dist", "src", "config");
    fs.mkdirSync(startDir, { recursive: true });

    expect(findCliPackageRoot(startDir)).toBe(packageRoot);
  });

  it("returns dist/ when it is the only matching package root", () => {
    const distRoot = path.join(tempRoot, "dist-only");
    writeCliPackageJson(distRoot);

    const startDir = path.join(distRoot, "src", "config");
    fs.mkdirSync(startDir, { recursive: true });

    expect(findCliPackageRoot(startDir)).toBe(distRoot);
  });

  it("returns undefined when no @dataparade/cli package.json exists", () => {
    const startDir = path.join(tempRoot, "other", "src");
    fs.mkdirSync(startDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "other", "package.json"),
      JSON.stringify({ name: "other-package" }),
    );

    expect(findCliPackageRoot(startDir)).toBeUndefined();
  });
});
