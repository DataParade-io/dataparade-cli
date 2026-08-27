import assert from "node:assert";
import { join } from "node:path";

import { Given, Then, When } from "@cucumber/cucumber";

import {
  collectEvalFindings,
  type EvalFinding,
} from "../../src/core/pipeline/collect-eval-findings";

const repoRoot = join(__dirname, "..", "..");
const fixtureRoot = join(repoRoot, "features", "fixtures", "scan-findings");

interface ScanFindingsWorld {
  rootPath?: string;
  findings?: EvalFinding[];
}

function getWorld(context: unknown): ScanFindingsWorld {
  return context as ScanFindingsWorld;
}

function isEvalFinding(value: unknown): value is EvalFinding {
  if (!value || typeof value !== "object") {
    return false;
  }
  const finding = value as Record<string, unknown>;
  return (
    typeof finding.filePath === "string" &&
    typeof finding.startLine === "number" &&
    typeof finding.endLine === "number"
  );
}

Given("a tiny source tree on disk", function () {
  const w = getWorld(this);
  w.rootPath = fixtureRoot;
});

When("I request scanner findings for that tree", async function () {
  const w = getWorld(this);
  assert.ok(w.rootPath, "fixture root path must be set");

  const result = await collectEvalFindings(w.rootPath);
  w.findings = result.findings;
});

Then(
  "the results include a finding with a file path and line span",
  function () {
    const w = getWorld(this);
    assert.ok(Array.isArray(w.findings), "findings must be an array");
    assert.ok(w.findings!.length > 0, "expected at least one finding");

    const finding = w.findings!.find(isEvalFinding);
    assert.ok(
      finding,
      "expected a finding with filePath, startLine, and endLine",
    );
    assert.ok(finding.filePath.length > 0, "finding filePath must be non-empty");
    assert.ok(finding.startLine >= 1, "finding startLine must be positive");
    assert.ok(
      finding.endLine >= finding.startLine,
      "finding endLine must be >= startLine",
    );
  },
);
