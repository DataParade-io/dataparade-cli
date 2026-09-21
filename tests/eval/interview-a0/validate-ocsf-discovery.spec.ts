import { spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.join(__dirname, "../../..");
const validatorPath = path.join(
  repoRoot,
  "tests/eval/interview-a0/bin/validate-ocsf-discovery.mjs",
);
const fixturesDir = path.join(repoRoot, "tests/eval/interview-a0/fixtures");

function runValidator(...recordPaths: string[]) {
  return spawnSync("node", [validatorPath, ...recordPaths], {
    encoding: "utf-8",
    cwd: repoRoot,
  });
}

describe("validate-ocsf-discovery.mjs", () => {
  it("accepts a minimal valid Architecture Discovery record", () => {
    const fixture = path.join(fixturesDir, "valid-minimal-discovery.json");
    const result = runValidator(fixture);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("rejects an OCSF Finding class_uid in category 2", () => {
    const fixture = path.join(fixturesDir, "invalid-finding-class-uid.json");
    const result = runValidator(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/invalid-finding-class-uid\.json/);
    expect(result.stderr).toMatch(/class_uid/);
  });

  it("rejects a record missing dataparade.source", () => {
    const fixture = path.join(fixturesDir, "invalid-missing-source.json");
    const result = runValidator(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/invalid-missing-source\.json/);
    expect(result.stderr).toMatch(/source/);
  });
});
