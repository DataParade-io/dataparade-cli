import path from "path";

import { resolveDefaultBenchmarkRoot } from "../../benchmark/paths";
import { getBenchmarkRoot, listBenchmarkRepoKeys } from "../../benchmark/run-benchmark";

describe("benchmark paths", () => {
  it("resolves metadata from tests/benchmark when invoked from dist output", () => {
    const packageRoot = path.resolve(__dirname, "../../..");
    const distModuleDir = path.join(packageRoot, "dist", "tests", "benchmark");

    expect(resolveDefaultBenchmarkRoot(distModuleDir)).toBe(
      path.join(packageRoot, "tests", "benchmark"),
    );
  });

  it("lists repo keys from the source benchmark tree by default", () => {
    const packageRoot = path.resolve(__dirname, "../../..");
    expect(getBenchmarkRoot()).toBe(path.join(packageRoot, "tests", "benchmark"));
    expect(listBenchmarkRepoKeys()).toEqual(
      expect.arrayContaining(["easy-school", "vgs-django"]),
    );
  });
});
