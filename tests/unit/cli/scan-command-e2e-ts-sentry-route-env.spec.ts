import path from "path";

import { createDefaultScanConfiguration } from "../../../src/core/pipeline/orchestrator";
import { runScanPipeline } from "../../../src/core/pipeline/scan-pipeline";

describe("cli scan - DP-P0-CLI regression: sentry/route/env", () => {
  it("detects Sentry third_party, Express route, and API_KEY env_variable", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "e2e-ts-sentry-route-env",
    );

    const config = createDefaultScanConfiguration({ enableAiInference: false,
      projectName: "SentryRouteEnvApp",
    });

    const { scanResult, findings } = await runScanPipeline(
      fixturesRoot,
      config,
      undefined,
    );

    const envFinding = findings.find(
      (f) => f.pattern === "env_variable" && f.properties?.key === "API_KEY",
    );
    expect(envFinding).toBeDefined();

    const sentryFinding = findings.find(
      (f) =>
        f.pattern === "external_api_call" &&
        f.properties?.serviceName === "sentry",
    );
    expect(sentryFinding).toBeDefined();
    expect(String(sentryFinding?.properties?.url)).toContain(
      "ingest.sentry.io",
    );

    const componentsById = new Map(
      scanResult.components.map((c) => [c.id, c]),
    );

    const sentryComponent = scanResult.components.find(
      (c) =>
        c.type === "third_party" &&
        typeof c.properties?.serviceName === "string" &&
        c.properties.serviceName.toLowerCase() === "sentry",
    );
    expect(sentryComponent).toBeDefined();

    const routeComponent = scanResult.components.find((c) => {
      if (c.type !== "asset" || c.subType !== "api") return false;
      const pathProp = c.properties?.path;
      if (typeof pathProp === "string") return pathProp === "/users";
      if (Array.isArray(pathProp)) return pathProp.includes("/users");
      return c.name === "HTTP API";
    });
    expect(routeComponent).toBeDefined();

    // Property inference coverage (YAML-driven):
    // express_route → request_validation/connection_encryption/api_type/https_enforced
    expect(routeComponent?.properties?.request_validation).toBe(true);
    expect(routeComponent?.properties?.connection_encryption).toBe(true);
    expect(routeComponent?.properties?.api_type).toBe("rest");
    expect(routeComponent?.properties?.https_enforced).toBe(true);

    // Data-flow edges are created based on raw findings.
    const sentryFlow = scanResult.dataFlows.find(
      (df) => df.type === "api_call" && df.targetComponentId === sentryComponent!.id,
    );
    expect(sentryFlow).toBeDefined();

    const assetDeclaresUsersPath = (
      c: (typeof scanResult.components)[number] | undefined,
    ): boolean => {
      if (!c || c.type !== "asset") return false;
      const pathProp = c.properties?.path;
      if (typeof pathProp === "string") return pathProp === "/users";
      if (Array.isArray(pathProp)) return pathProp.includes("/users");
      return false;
    };

    const routeFlow = scanResult.dataFlows.find((df) => {
      if (df.type !== "api_call") return false;
      const source = componentsById.get(df.sourceComponentId);
      const target = componentsById.get(df.targetComponentId);
      if (target?.id === routeComponent!.id || source?.id === routeComponent!.id) {
        return true;
      }
      return assetDeclaresUsersPath(source) || assetDeclaresUsersPath(target);
    });
    expect(routeFlow).toBeDefined();

    // external_api_call → third_party integration properties (YAML-driven)
    expect(sentryComponent?.properties?.integration_method).toBe("api");
    expect(sentryComponent?.properties?.authentication_method).toBe(
      "api_key",
    );
    expect(sentryComponent?.properties?.integration_status).toBe("active");
    expect(sentryComponent?.properties?.api_type).toBe("rest");
    expect(sentryComponent?.properties?.sdk_available).toBe(true);
    expect(sentryComponent?.properties?.https_enforced).toBe(true);

    // env_variable finding should be present and YAML-driven inference should work.
    const awsEnvFinding = findings.find(
      (f) =>
        f.pattern === "env_variable" &&
        f.properties?.key === "AWS_REGION" &&
        f.properties?.cloud_provider === "AWS",
    );
    expect(awsEnvFinding).toBeDefined();

    // Safety: ensure referenced component IDs are valid.
    for (const df of scanResult.dataFlows) {
      expect(componentsById.has(df.sourceComponentId)).toBe(true);
      expect(componentsById.has(df.targetComponentId)).toBe(true);
    }
  }, 15000);
});

