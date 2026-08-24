import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";

function fixturePath(name: string): string {
  return path.join(__dirname, "..", "..", "fixtures", name);
}

describe("structural scan - C++ and .NET repositories", () => {
  it("produces components, flows, and parser stats for a C++ service", async () => {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult, files, findings } = await scan(
      fixturePath("cpp-basic"),
      config,
    );

    expect(files.some((file) => file.language === "cpp")).toBe(true);

    const patterns = new Set(findings.map((f) => f.pattern));
    expect(patterns.has("express_route")).toBe(true);
    expect(patterns.has("database_connection")).toBe(true);
    expect(patterns.has("external_api_call")).toBe(true);
    expect(patterns.has("env_variable")).toBe(true);

    expect(scanResult.components.length).toBeGreaterThan(0);
    expect(scanResult.dataFlows.length).toBeGreaterThan(0);

    const stats = (scanResult.languageStats ?? []).find(
      (stat) => stat.language === "cpp",
    );
    expect(stats).toBeDefined();
    expect(stats?.filesParsed).toBeGreaterThan(0);
    expect(stats?.warnings).toEqual([]);

    const serviceNames = scanResult.components
      .filter((c) => c.type === "third_party")
      .map((c) => c.properties?.serviceName);
    expect(serviceNames).toContain("stripe");
  });

  it("produces components, flows, and parser stats for a .NET service", async () => {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult, files, findings } = await scan(
      fixturePath("csharp-basic"),
      config,
    );

    expect(files.some((file) => file.language === "csharp")).toBe(true);

    const routeNames = findings
      .filter((f) => f.pattern === "express_route")
      .map((f) => f.name);
    expect(routeNames).toEqual(
      expect.arrayContaining([
        "GET api/Customers/{id}",
        "POST api/Customers",
        "GET /health",
      ]),
    );

    const patterns = new Set(findings.map((f) => f.pattern));
    expect(patterns.has("database_connection")).toBe(true);
    expect(patterns.has("auth_middleware")).toBe(true);
    expect(patterns.has("env_variable")).toBe(true);

    expect(scanResult.components.length).toBeGreaterThan(0);
    expect(scanResult.dataFlows.length).toBeGreaterThan(0);

    const stats = (scanResult.languageStats ?? []).find(
      (stat) => stat.language === "csharp",
    );
    expect(stats).toBeDefined();
    expect(stats?.filesParsed).toBe(3);
    expect(stats?.warnings).toEqual([]);

    const serviceNames = scanResult.components
      .filter((c) => c.type === "third_party")
      .map((c) => c.properties?.serviceName);
    expect(serviceNames).toContain("stripe");
  });

  it("honours the language filter for C++ and C#", async () => {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { files } = await scan(fixturePath("csharp-basic"), {
      ...config,
      languages: ["cpp"],
    });

    expect(files.every((file) => file.language === "cpp")).toBe(true);
  });
});
