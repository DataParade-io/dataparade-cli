import * as path from "path";

import type { FileInfo } from "../../../../src/core/types/file";
import type { RawFinding } from "../../../../src/core/types/detection";
import { ingestFileSystem } from "../../../../src/ingest/file-system";
import {
  __clearAnalyzersForTest,
  registerAnalyzer,
  runAnalyzers,
} from "../../../../src/analyzers/registry";
import { createTypeScriptAnalyzer } from "../../../../src/analyzers/typescript";

describe("TS analyzer + ingest integration - DP-P0-CLI-105", () => {
  const FIXTURE_ROOT = path.join(
    __dirname,
    "../../../fixtures/typescript-basic",
  );

  beforeEach(() => {
    __clearAnalyzersForTest();
  });

  afterAll(() => {
    __clearAnalyzersForTest();
  });

  it("detects external API calls and env variable usage via ingest + analyzer", async () => {
    const files: FileInfo[] = await ingestFileSystem(FIXTURE_ROOT);

    const tsAnalyzer = createTypeScriptAnalyzer();
    registerAnalyzer("typescript", tsAnalyzer);
    registerAnalyzer("javascript", tsAnalyzer);

    const findings: RawFinding[] = runAnalyzers(files);

    const byPattern = (pattern: string): RawFinding[] =>
      findings.filter((f) => f.pattern === pattern);

    const externalApis = byPattern("external_api_call");
    const envVars = byPattern("env_variable");

    expect(externalApis.length).toBeGreaterThan(0);
    expect(envVars.length).toBeGreaterThan(0);

    const externalFinding = externalApis[0];
    expect(typeof externalFinding.properties.url).toBe("string");

    const envKeys = envVars.map((f) => f.properties.key);
    expect(envKeys).toContain("API_KEY");
  });
});

