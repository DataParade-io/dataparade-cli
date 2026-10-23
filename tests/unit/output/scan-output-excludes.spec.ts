import { scanOutputExcludes } from "../../../src/output/scan-output-excludes";

describe("scanOutputExcludes", () => {
  it("excludes the default .dataparade folder inside the scanned repo", () => {
    expect(scanOutputExcludes("/repo", "/repo/.dataparade/dataflow.json")).toEqual([".dataparade/**"]);
    expect(scanOutputExcludes("/repo", "/repo/out/kb/dataflow.json")).toEqual(["out/kb/**"]);
  });

  it("excludes the scan's own outputs when writing to the repo root", () => {
    const globs = scanOutputExcludes("/repo", "/repo/dataflow.json");
    expect(globs).toEqual(
      expect.arrayContaining(["dataflow.json", "facts.json", "data-items/**", "graphify.json", "answers.json", "briefs/**", "evidence/**"]),
    );
    // Output of CLI 0.0.26 and earlier is still kept out of a rescan.
    expect(globs).toEqual(expect.arrayContaining(["ocsf-discoveries/**", "graphify-out/**", "dataparade-graph.json"]));
  });

  it("adds nothing when the output is outside the repo", () => {
    expect(scanOutputExcludes("/repo", "/tmp/kb/dataflow.json")).toEqual([]);
  });
});
