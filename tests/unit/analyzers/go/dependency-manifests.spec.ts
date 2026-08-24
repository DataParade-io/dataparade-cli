import path from "path";

import {
  detectGoPatternsFromDependencyManifests,
  parseGoDependencyManifests,
} from "../../../../src/analyzers/go/dependency-manifests";
import {
  parseGoMod,
  parseGoWork,
} from "../../../../src/analyzers/go/manifest-parsers";

const FIXTURE_ROOT = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "go-dependency-manifests-basic",
);

describe("Go manifest parsers", () => {
  it("parses the module path and both require forms", () => {
    const content = [
      "module github.com/acme/gateway",
      "",
      "go 1.22",
      "",
      "require (",
      "\tgithub.com/getsentry/sentry-go v0.28.1",
      "\tgithub.com/lib/pq v1.10.9",
      ")",
      "",
      "require github.com/gin-gonic/gin v1.10.0 // indirect",
      "",
    ].join("\n");

    const parsed = parseGoMod(content);

    expect(parsed.modulePath).toBe("github.com/acme/gateway");
    expect(parsed.requires.sort()).toEqual([
      "github.com/getsentry/sentry-go",
      "github.com/gin-gonic/gin",
      "github.com/lib/pq",
    ]);
  });

  it("skips replace, exclude, and retract blocks", () => {
    const content = [
      "module github.com/acme/app",
      "",
      "require github.com/real/dep v1.0.0",
      "",
      "replace (",
      "\tgithub.com/replaced/dep => ../local",
      ")",
      "",
      "exclude (",
      "\tgithub.com/excluded/dep v1.2.3",
      ")",
      "",
    ].join("\n");

    expect(parseGoMod(content).requires).toEqual(["github.com/real/dep"]);
  });

  it("parses go.work workspace members", () => {
    const content = [
      "go 1.22",
      "",
      "use (",
      "\t./services/api",
      "\t./services/worker",
      ")",
      "",
    ].join("\n");

    expect(parseGoWork(content)).toEqual([
      "services/api",
      "services/worker",
    ]);
  });

  it("returns an empty manifest for content with no requires", () => {
    const parsed = parseGoMod("module github.com/acme/tiny\n\ngo 1.22\n");

    expect(parsed.modulePath).toBe("github.com/acme/tiny");
    expect(parsed.requires).toEqual([]);
  });
});

describe("Go dependency manifest scanning", () => {
  it("collects required modules from go.mod", async () => {
    const manifests = await parseGoDependencyManifests(FIXTURE_ROOT);

    expect(manifests.length).toBe(1);
    expect(manifests[0].manifestRelativePath).toBe("go.mod");
    expect(manifests[0].modulePath).toBe("github.com/acme/gateway");
    expect(manifests[0].packages).toEqual(
      expect.arrayContaining([
        "github.com/getsentry/sentry-go",
        "github.com/stripe/stripe-go/v76",
        "github.com/aws/aws-sdk-go-v2",
        "github.com/lib/pq",
        "github.com/redis/go-redis/v9",
      ]),
    );
  });

  it("maps module paths to third-party services and databases", async () => {
    const findings = await detectGoPatternsFromDependencyManifests(
      FIXTURE_ROOT,
    );

    const serviceNames = findings
      .filter((f) => f.pattern === "external_api_call")
      .map((f) => f.properties.serviceName);
    expect(serviceNames).toEqual(
      expect.arrayContaining(["sentry", "stripe", "aws"]),
    );

    const databases = findings
      .filter((f) => f.pattern === "database_connection")
      .map((f) => f.properties.client);
    expect(databases).toEqual(
      expect.arrayContaining(["lib_pq", "go_redis"]),
    );
  });
});
