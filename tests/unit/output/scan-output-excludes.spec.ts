import { scanOutputExcludes } from "../../../src/output/scan-output-excludes";

describe("scanOutputExcludes", () => {
  it("excludes a KB folder inside the scanned repo", () => {
    expect(scanOutputExcludes("/repo", "/repo/.dataparade/dataflow.json")).toEqual([".dataparade/**"]);
    expect(scanOutputExcludes("/repo", "/repo/out/kb/dataflow.json")).toEqual(["out/kb/**"]);
  });

  it("excludes the scan's own outputs when writing to the repo root", () => {
    const globs = scanOutputExcludes("/repo", "/repo/dataflow.json");
    expect(globs).toEqual(expect.arrayContaining(["dataflow.json", "ocsf-discoveries/**", "briefs/**", "evidence/**"]));
  });

  it("adds nothing when the output is outside the repo", () => {
    expect(scanOutputExcludes("/repo", "/tmp/kb/dataflow.json")).toEqual([]);
  });
});
