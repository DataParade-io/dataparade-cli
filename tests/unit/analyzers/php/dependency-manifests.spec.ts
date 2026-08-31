import path from "path";

import {
  detectPhpPatternsFromDependencyManifests,
  parsePhpDependencyManifests,
} from "../../../../src/analyzers/php/dependency-manifests";
import { parseComposerJson } from "../../../../src/analyzers/php/manifest-parsers";

const FIXTURE_ROOT = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "php-dependency-manifests-basic",
);

describe("PHP manifest parsers", () => {
  it("parses require and require-dev package names, skipping php/ext", () => {
    const content = JSON.stringify({
      name: "acme/gateway",
      require: {
        php: "^8.2",
        "ext-json": "*",
        "guzzlehttp/guzzle": "^7.0",
        "laravel/framework": "^11.0",
      },
      "require-dev": {
        "phpunit/phpunit": "^10.0",
      },
    });

    const parsed = parseComposerJson(content);

    expect(parsed.name).toBe("acme/gateway");
    expect(parsed.packages.sort()).toEqual([
      "guzzlehttp/guzzle",
      "laravel/framework",
      "phpunit/phpunit",
    ]);
  });

  it("returns empty packages for invalid JSON", () => {
    expect(parseComposerJson("{not json").packages).toEqual([]);
  });
});

describe("PHP dependency manifests", () => {
  it("walks composer.json fixtures and feeds package names to matchPatterns", async () => {
    const manifests = await parsePhpDependencyManifests(FIXTURE_ROOT);
    expect(manifests.length).toBe(1);
    expect(manifests[0].packageName).toBe("acme/billing-api");
    expect(manifests[0].packages).toEqual(
      expect.arrayContaining([
        "guzzlehttp/guzzle",
        "laravel/framework",
        "stripe/stripe-php",
        "phpunit/phpunit",
      ]),
    );

    const findings = await detectPhpPatternsFromDependencyManifests(FIXTURE_ROOT);
    expect(findings.length).toBeGreaterThan(0);

    const dbs = findings.filter((f) => f.pattern === "database_connection");
    expect(dbs.some((d) => d.name === "eloquent")).toBe(true);

    const apis = findings.filter((f) => f.pattern === "external_api_call");
    expect(
      apis.some(
        (a) =>
          a.properties.serviceName === "stripe" || a.name.includes("stripe"),
      ),
    ).toBe(true);
  });
});
