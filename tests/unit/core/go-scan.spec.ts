import fs from "fs";
import os from "os";
import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";
import { discoverServiceSections } from "../../../src/core/sectioning/discover-service-sections";
import { ingestFileSystem } from "../../../src/ingest/file-system";

function fixturePath(name: string): string {
  return path.join(__dirname, "..", "..", "fixtures", name);
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("structural scan - Go repositories", () => {
  it("produces components, flows, and parser stats for a Go service", async () => {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult, files, findings } = await scan(
      fixturePath("go-basic"),
      config,
    );

    expect(files.some((file) => file.language === "go")).toBe(true);

    const routeNames = findings
      .filter((f) => f.pattern === "express_route")
      .map((f) => f.name);
    expect(routeNames).toEqual(
      expect.arrayContaining(["GET /customers", "POST /charges"]),
    );

    const patterns = new Set(findings.map((f) => f.pattern));
    expect(patterns.has("database_connection")).toBe(true);
    expect(patterns.has("external_api_call")).toBe(true);
    expect(patterns.has("auth_middleware")).toBe(true);
    expect(patterns.has("env_variable")).toBe(true);

    expect(scanResult.components.length).toBeGreaterThan(0);
    expect(scanResult.dataFlows.length).toBeGreaterThan(0);

    const stats = (scanResult.languageStats ?? []).find(
      (stat) => stat.language === "go",
    );
    expect(stats).toBeDefined();
    expect(stats?.filesParsed).toBe(2);
    expect(stats?.warnings).toEqual([]);

    const serviceNames = scanResult.components
      .filter((c) => c.type === "third_party")
      .map((c) => c.properties?.serviceName);
    expect(serviceNames).toContain("stripe");

    // sql.Open("postgres", ...) should surface as postgres, not generic SQL.
    const postgres = findings.filter(
      (f) =>
        f.pattern === "database_connection" &&
        f.properties.databaseType === "postgres",
    );
    expect(postgres.length).toBeGreaterThan(0);
  });

  it("honours the language filter for Go", async () => {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { files } = await scan(fixturePath("go-basic"), {
      ...config,
      languages: ["python"],
    });

    expect(files.every((file) => file.language === "python")).toBe(true);
  });

  it("maps .go files to the go language on ingest", async () => {
    const files = await ingestFileSystem(fixturePath("go-basic"));
    const byPath = new Map(files.map((file) => [file.path, file.language]));

    expect(byPath.get("main.go")).toBe("go");
    expect(byPath.get("handlers.go")).toBe("go");
  });

  it("registers a section per Go module in a multi-module repository", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-go-sections-"));
    try {
      write(
        path.join(root, "services", "api", "go.mod"),
        "module github.com/acme/api\n\ngo 1.22\n",
      );
      write(
        path.join(root, "services", "worker", "go.mod"),
        "module github.com/acme/worker\n\ngo 1.22\n",
      );

      const { sections } = await discoverServiceSections(root);
      const serviceDirs = sections
        .filter((section) => section.role === "service")
        .map((section) => section.sectionDir)
        .sort();

      expect(serviceDirs).toEqual(["services/api", "services/worker"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
