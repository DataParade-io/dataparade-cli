import assert from "node:assert";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { Given, Then, When } from "@cucumber/cucumber";

const repoRoot = join(__dirname, "..", "..");
const featuresDir = join(repoRoot, "features");

let featureFileNames: string[] = [];
let jestTestMatch: string[] = [];

Given("Gherkin files for local Plexus evaluation", function () {
  featureFileNames = readdirSync(featuresDir).filter((name) =>
    name.endsWith(".feature"),
  );
  assert.ok(
    featureFileNames.length > 0,
    "Expected at least one .feature file under features/",
  );
});

When("the feature runner loads those files", function () {
  assert.ok(
    featureFileNames.length > 0,
    "Feature files must be discovered before the runner can load them",
  );
});

Then("the discovered files include plexus-eval.feature", function () {
  assert.ok(
    featureFileNames.includes("plexus-eval.feature"),
    `Expected plexus-eval.feature among: ${featureFileNames.join(", ")}`,
  );
});

Given("the Jest configuration for this repository", function () {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jestConfig = require(join(repoRoot, "jest.config.cjs")) as {
    testMatch: string[];
  };
  jestTestMatch = jestConfig.testMatch;
  assert.ok(Array.isArray(jestTestMatch) && jestTestMatch.length > 0);
});

When("I inspect its test file patterns", function () {
  assert.ok(jestTestMatch.length > 0, "Jest testMatch must be defined");
});

Then(
  /^it matches only tests under tests\/\*\*\/\*\.spec\.ts and tests\/eval\/\*\*\/\*\.test\.ts$/,
  function () {
    assert.deepStrictEqual(jestTestMatch, [
      "**/tests/**/*.spec.ts",
      "**/tests/eval/**/*.test.ts",
    ]);
    for (const pattern of jestTestMatch) {
      assert.ok(
        !pattern.includes(".feature"),
        `Jest pattern must not include Gherkin files: ${pattern}`,
      );
    }
  },
);
