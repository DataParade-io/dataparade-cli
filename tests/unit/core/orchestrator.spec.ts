import path from "path";
import fs from "fs/promises";
import os from "os";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";

describe("core/pipeline/orchestrator - DP-P0-CLI-401", () => {
  it("runs the full structural pipeline for the typescript-basic fixture", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const config = createDefaultScanConfiguration({ enableAiInference: false });

    const { scanResult } = await scan(fixturesRoot, config);

    expect(scanResult.components.length).toBeGreaterThan(0);
    expect(scanResult.dataFlows.length).toBeGreaterThan(0);
    expect(scanResult.filesScanned).toBeGreaterThan(0);
    expect(scanResult.totalLines).toBeGreaterThan(0);
    expect(scanResult.scanDurationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(scanResult.errors)).toBe(true);
    expect(Array.isArray(scanResult.warnings)).toBe(true);
  });

  it("enables Terraform and monorepo package section auto-inference by default", () => {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    expect(config.autoInferTerraformStackSectionPathDepth).toBe(true);
    expect(config.terraformStackSectionPathDepth).toBeUndefined();
    expect(config.autoInferMonorepoPackageSectionPathDepth).toBe(true);
    expect(config.monorepoPackageSectionPathDepth).toBe(2);
  });

  it("honors excludePaths by reducing the number of scanned files", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const baselineConfig = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult: baseline } = await scan(fixturesRoot, baselineConfig);

    const configWithExcludes = createDefaultScanConfiguration({
      excludePaths: ["**/db.ts"],
    });
    const { scanResult: withExcludes } = await scan(
      fixturesRoot,
      configWithExcludes,
    );

    expect(withExcludes.filesScanned).toBeLessThanOrEqual(
      baseline.filesScanned,
    );
  });

  it("supports ? wildcard in excludePaths patterns", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const baselineConfig = createDefaultScanConfiguration({ enableAiInference: false });
    const { files: baselineFiles } = await scan(fixturesRoot, baselineConfig);

    const configWithQuestionGlob = createDefaultScanConfiguration({
      excludePaths: ["d?.ts"],
    });
    const { files: withQuestionGlob } = await scan(
      fixturesRoot,
      configWithQuestionGlob,
    );

    const baselineHasDbTs = baselineFiles.some((file) => file.path.endsWith("db.ts"));
    const withQuestionGlobHasDbTs = withQuestionGlob.some((file) =>
      file.path.endsWith("db.ts"),
    );

    expect(baselineHasDbTs).toBe(true);
    expect(withQuestionGlobHasDbTs).toBe(false);
  });

  it("filters files by languages when languages are specified", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const baselineConfig = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult: baseline } = await scan(fixturesRoot, baselineConfig);

    const configLanguagesOnlyTs = createDefaultScanConfiguration({
      languages: ["typescript"],
    });

    const { scanResult: tsOnly } = await scan(
      fixturesRoot,
      configLanguagesOnlyTs,
    );

    expect(tsOnly.filesScanned).toBeLessThanOrEqual(baseline.filesScanned);
  });

  it("enforces minimumConfidence across findings, components, and flows", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const baselineConfig = createDefaultScanConfiguration({
      minimumConfidence: 0,
    });
    const { scanResult: baseline, findings: baselineFindings } = await scan(
      fixturesRoot,
      baselineConfig,
    );

    const strictConfig = createDefaultScanConfiguration({
      minimumConfidence: 0.95,
    });
    const { scanResult: strict, findings: strictFindings } = await scan(
      fixturesRoot,
      strictConfig,
    );

    expect(strictFindings.every((f) => f.confidence >= 0.95)).toBe(true);
    expect(strict.components.every((c) => c.confidence >= 0.95)).toBe(true);
    expect(strict.dataFlows.every((f) => f.confidence >= 0.95)).toBe(true);

    expect(strictFindings.length).toBeLessThanOrEqual(baselineFindings.length);
    expect(strict.components.length).toBeLessThanOrEqual(
      baseline.components.length,
    );
    expect(strict.dataFlows.length).toBeLessThanOrEqual(
      baseline.dataFlows.length,
    );
  });

  it("respects enableAPIDetection and enableDatabaseDetection", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const baselineConfig = createDefaultScanConfiguration({ enableAiInference: false });
    const { findings: baselineFindings } = await scan(
      fixturesRoot,
      baselineConfig,
    );

    const apiDisabledConfig = createDefaultScanConfiguration({
      enableAPIDetection: false,
    });
    const { findings: apiDisabledFindings } = await scan(
      fixturesRoot,
      apiDisabledConfig,
    );

    const dbDisabledConfig = createDefaultScanConfiguration({
      enableDatabaseDetection: false,
    });
    const { findings: dbDisabledFindings } = await scan(
      fixturesRoot,
      dbDisabledConfig,
    );

    const countByPattern = (pattern: string, findings: any[]) =>
      findings.filter((f) => f.pattern === pattern).length;

    expect(
      countByPattern("express_route", apiDisabledFindings),
    ).toBeLessThanOrEqual(countByPattern("express_route", baselineFindings));

    expect(
      countByPattern("database_connection", dbDisabledFindings),
    ).toBeLessThanOrEqual(
      countByPattern("database_connection", baselineFindings),
    );
  });

  it("emits ScanProgress events in the expected phase order", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const phases: string[] = [];

    await scan(fixturesRoot, config, (progress) => {
      phases.push(progress.phase);
      expect(progress.progress).toBeGreaterThanOrEqual(0);
      expect(progress.progress).toBeLessThanOrEqual(1);
    });

    // We expect at least one occurrence of each structural phase in order.
    const phaseString = phases.join(">");

    expect(phaseString.indexOf("ingest")).toBeGreaterThanOrEqual(0);
    expect(phaseString.indexOf("analyze")).toBeGreaterThan(
      phaseString.indexOf("ingest"),
    );
    expect(phaseString.indexOf("classify")).toBeGreaterThan(
      phaseString.indexOf("analyze"),
    );
    expect(phaseString.indexOf("data_flow")).toBeGreaterThan(
      phaseString.indexOf("classify"),
    );
    expect(phaseString.lastIndexOf("output")).toBeGreaterThan(
      phaseString.indexOf("data_flow"),
    );
  });

  it("detects third-party services from Python dependency manifests", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "python-dependency-manifests-basic",
    );

    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult } = await scan(fixturesRoot, config);

    const thirdParties = scanResult.components.filter(
      (c) => c.type === "third_party",
    );

    const serviceNames = thirdParties
      .map((c) => c.properties?.serviceName)
      .filter((v): v is string => typeof v === "string");

    expect(serviceNames).toEqual(
      expect.arrayContaining(["openai", "sentry", "aws"]),
    );
    expect(serviceNames).not.toContain("anthropic");
  });

  it("detects third-party services from TypeScript dependency manifests", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-dependency-manifests-basic",
    );

    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult } = await scan(fixturesRoot, config);

    const thirdParties = scanResult.components.filter(
      (c) => c.type === "third_party",
    );

    const serviceNames = thirdParties
      .map((c) => c.properties?.serviceName)
      .filter((v): v is string => typeof v === "string");

    expect(serviceNames).toEqual(
      expect.arrayContaining(["stripe", "sendgrid", "aws", "sentry"]),
    );
    expect(serviceNames).not.toContain("twilio");
  });

  it("applies excludePaths to manifest scanning and section derivation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dp-orch-excludes-"));
    try {
      await fs.mkdir(path.join(root, "sandbox-a"), { recursive: true });
      await fs.mkdir(path.join(root, "sandbox-b"), { recursive: true });
      await fs.mkdir(path.join(root, "src"), { recursive: true });

      await fs.writeFile(
        path.join(root, "src", "app.ts"),
        'export const app = "ok";\n',
      );
      await fs.writeFile(
        path.join(root, "sandbox-a", "package.json"),
        JSON.stringify({
          name: "sandbox-a",
          dependencies: { next: "14.0.0" },
        }),
      );
      await fs.writeFile(
        path.join(root, "sandbox-b", "package.json"),
        JSON.stringify({
          name: "sandbox-b",
          dependencies: { react: "18.0.0" },
        }),
      );

      const baselineConfig = createDefaultScanConfiguration({
        minimumConfidence: 0,
      });
      const { scanResult: baseline } = await scan(root, baselineConfig);

      const excludedConfig = createDefaultScanConfiguration({
        minimumConfidence: 0,
        excludePaths: ["sandbox-a/**", "sandbox-b/**"],
      });
      const { scanResult: excluded } = await scan(root, excludedConfig);

      const sectionIdsBaseline = baseline.components
        .map((c) => c.properties?.section_id)
        .filter((v): v is string => typeof v === "string");
      const sectionIdsExcluded = excluded.components
        .map((c) => c.properties?.section_id)
        .filter((v): v is string => typeof v === "string");

      expect(sectionIdsBaseline).toEqual(
        expect.arrayContaining(["sandbox-a", "sandbox-b"]),
      );
      expect(sectionIdsExcluded).not.toEqual(
        expect.arrayContaining(["sandbox-a", "sandbox-b"]),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("excludes co-located test files and playwright config by default", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "dp-orch-default-excludes-"),
    );
    try {
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app.ts"),
        "export const x = 1;\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(root, "src", "app.spec.ts"),
        "import { x } from './app';\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(root, "playwright.config.ts"),
        "export default {};\n",
        "utf8",
      );

      const { files } = await scan(root, createDefaultScanConfiguration({ enableAiInference: false }));
      const paths = files.map((f) => f.path);

      expect(paths.some((p) => p.endsWith("app.spec.ts"))).toBe(false);
      expect(paths.some((p) => p.includes("playwright.config"))).toBe(false);
      expect(paths.some((p) => p.endsWith("app.ts"))).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("produces a combined ScanResult for mixed TypeScript and Python repos", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "mixed-language-basic",
    );

    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult, files, findings } = await scan(fixturesRoot, config);

    const scannedLanguages = new Set(files.map((file) => file.language));
    expect(scannedLanguages.has("typescript")).toBe(true);
    expect(scannedLanguages.has("python")).toBe(true);

    const findingPaths = findings.map((finding) => finding.location.filePath);
    expect(findingPaths.some((p) => p.endsWith(".ts"))).toBe(true);
    expect(findingPaths.some((p) => p.endsWith(".py"))).toBe(true);

    expect(scanResult.components.length).toBeGreaterThan(0);
    expect(scanResult.dataFlows.length).toBeGreaterThan(0);

    const flowTypes = new Set(scanResult.dataFlows.map((flow) => flow.type));
    expect(flowTypes.has("database_query")).toBe(true);
    expect(flowTypes.has("api_call")).toBe(true);

    const statsByLanguage = new Set(
      (scanResult.languageStats ?? []).map((stat) => stat.language),
    );
    expect(statsByLanguage.has("python")).toBe(true);
  });

  it("keeps direct app -> postgres edges end-to-end when provider nodes are absent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dp-orch-provider-topology-"));
    try {
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify(
          {
            name: "provider-topology-fixture",
            version: "1.0.0",
            dependencies: {
              express: "^4.18.2",
              pg: "^8.13.1",
            },
          },
          null,
          2,
        ),
      );
      await fs.writeFile(
        path.join(root, "src", "app.ts"),
        [
          "import express from 'express';",
          "import { Pool } from 'pg';",
          "",
          "const app = express();",
          "const pool = new Pool({ connectionString: process.env.DATABASE_URL });",
          "",
          "app.get('/users', async (_req, res) => {",
          "  const result = await pool.query('SELECT * FROM users');",
          "  res.json(result.rows ?? []);",
          "});",
          "",
          "export default app;",
          "",
        ].join("\n"),
        "utf8",
      );

      const config = createDefaultScanConfiguration({ enableAiInference: false });
      const { scanResult } = await scan(root, config);

      const postgresTargets = scanResult.components.filter(
        (c) =>
          c.type === "asset" &&
          c.subType === "database" &&
          (String(c.properties?.databaseType ?? "").toLowerCase().includes("postgres") ||
            String(c.properties?.client ?? "").toLowerCase().includes("pg")),
      );
      expect(postgresTargets.length).toBeGreaterThan(0);

      const hasDirectDbFlow = scanResult.dataFlows.some(
        (f) =>
          postgresTargets.some((db) => db.id === f.targetComponentId) &&
          f.type === "database_query",
      );
      expect(hasDirectDbFlow).toBe(true);
      const hasSupabaseNode = scanResult.components.some(
        (c) =>
          c.type === "third_party" &&
          String(c.properties?.serviceName ?? "").toLowerCase() === "supabase",
      );
      expect(hasSupabaseNode).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

