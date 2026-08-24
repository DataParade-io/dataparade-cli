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

describe("structural scan - JVM repositories", () => {
  it("produces components, flows, and parser stats for a Spring service", async () => {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult, files, findings } = await scan(
      fixturePath("java-basic"),
      config,
    );

    expect(files.some((file) => file.language === "java")).toBe(true);

    const routeNames = findings
      .filter((f) => f.pattern === "express_route")
      .map((f) => f.name);
    expect(routeNames).toEqual(
      expect.arrayContaining([
        "GET /api/customers/{id}",
        "POST /api/customers",
        "DELETE /api/customers/{id}",
      ]),
    );

    const patterns = new Set(findings.map((f) => f.pattern));
    expect(patterns.has("database_connection")).toBe(true);
    expect(patterns.has("external_api_call")).toBe(true);
    expect(patterns.has("auth_middleware")).toBe(true);
    expect(patterns.has("env_variable")).toBe(true);

    expect(scanResult.components.length).toBeGreaterThan(0);

    const stats = (scanResult.languageStats ?? []).find(
      (stat) => stat.language === "java",
    );
    expect(stats).toBeDefined();
    expect(stats?.filesParsed).toBe(3);
    expect(stats?.warnings).toEqual([]);

    const serviceNames = scanResult.components
      .filter((c) => c.type === "third_party")
      .map((c) => c.properties?.serviceName);
    expect(serviceNames).toContain("stripe");

    // The JDBC URL should surface postgres, not a generic SQL node.
    const postgres = findings.filter(
      (f) =>
        f.pattern === "database_connection" &&
        f.properties.databaseType === "postgres",
    );
    expect(postgres.length).toBeGreaterThan(0);
  });

  it("scans a Kotlin service through the same analyzer", async () => {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult, files, findings } = await scan(
      fixturePath("kotlin-basic"),
      config,
    );

    expect(files.some((file) => file.language === "kotlin")).toBe(true);

    const routeNames = findings
      .filter((f) => f.pattern === "express_route")
      .map((f) => f.name);
    expect(routeNames).toEqual(
      expect.arrayContaining(["GET /health", "POST /api/invoices"]),
    );

    const databases = findings.filter(
      (f) => f.pattern === "database_connection",
    );
    expect(databases.map((f) => f.name)).toContain("exposed");

    const stats = (scanResult.languageStats ?? []).find(
      (stat) => stat.language === "kotlin",
    );
    expect(stats?.filesParsed).toBe(1);
    expect(stats?.warnings).toEqual([]);
  });
});

describe("section discovery - JVM build files", () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-jvm-sections-"));

    write(
      path.join(root, "services", "billing", "pom.xml"),
      "<project><groupId>com.acme</groupId><artifactId>billing</artifactId></project>",
    );
    write(
      path.join(root, "services", "billing", "src", "main", "java", "App.java"),
      "package com.acme.billing;\n\npublic class App {}\n",
    );

    write(
      path.join(root, "services", "ledger", "build.gradle.kts"),
      'dependencies {\n    implementation("org.postgresql:postgresql:42.7.1")\n}\n',
    );
    write(
      path.join(root, "services", "ledger", "src", "main", "kotlin", "App.kt"),
      "package com.acme.ledger\n\nfun main() {}\n",
    );

    // A settings file marks the root of a multi-project build, not a module.
    write(path.join(root, "settings.gradle.kts"), 'rootProject.name = "acme"\n');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("treats pom.xml and build.gradle.kts as service boundaries", async () => {
    const { sections } = await discoverServiceSections(root);
    const serviceDirs = sections
      .filter((section) => section.role === "service")
      .map((section) => section.sectionDir)
      .sort();

    expect(serviceDirs).toEqual(["services/billing", "services/ledger"]);
  });

  it("does not promote settings.gradle.kts to a service section", async () => {
    const { sections } = await discoverServiceSections(root);
    const rootSection = sections.find((section) => section.sectionDir === "");

    // A settings file marks a multi-project build, not a deployable module,
    // so the repository root stays the root section.
    expect(rootSection?.role).toBe("root");
  });
});
