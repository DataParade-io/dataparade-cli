import fs from "fs";
import path from "path";

export function findPackageRoot(fromDir: string): string {
  let current = path.resolve(fromDir);

  while (true) {
    if (
      fs.existsSync(path.join(current, "package.json")) &&
      path.basename(current) !== "dist"
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not locate package root from ${fromDir}`);
    }
    current = parent;
  }
}

/** Benchmark metadata and cache live under tests/benchmark, not dist/. */
export function resolveDefaultBenchmarkRoot(moduleDir: string = __dirname): string {
  return path.join(findPackageRoot(moduleDir), "tests", "benchmark");
}
