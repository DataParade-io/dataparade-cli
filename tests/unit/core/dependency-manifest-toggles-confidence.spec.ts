import path from "path";

import type { RawFinding } from "../../../src/core/types/detection";
import type { ScanConfiguration } from "../../../src/core/types";
import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";

import {
  detectPythonPatternsFromDependencyManifests,
} from "../../../src/analyzers/python/dependency-manifests";
import {
  detectTypeScriptPatternsFromDependencyManifests,
} from "../../../src/analyzers/typescript/dependency-manifests";
import { runAnalyzers } from "../../../src/analyzers/registry";

jest.mock("../../../src/analyzers/registry", () => ({
  runAnalyzers: jest.fn(() => []),
}));

jest.mock("../../../src/analyzers/typescript/dependency-manifests", () => ({
  detectTypeScriptPatternsFromDependencyManifests: jest.fn(async () => []),
}));

jest.mock("../../../src/analyzers/python/dependency-manifests", () => ({
  detectPythonPatternsFromDependencyManifests: jest.fn(async () => []),
}));

function makeLoc(filePath: string): { filePath: string; startLine: number; endLine: number } {
  return { filePath, startLine: 1, endLine: 1 };
}

function makeFinding(partial: Omit<RawFinding, "location"> & { locationFile: string }): RawFinding {
  const { locationFile, ...rest } = partial as any;
  return {
    ...rest,
    location: makeLoc(locationFile),
  } as RawFinding;
}

function componentHasDetectedFrom(
  component: { detectedFrom?: Array<{ pattern: string }> },
  pattern: string,
): boolean {
  return !!component.detectedFrom?.some((ref) => ref.pattern === pattern);
}

describe("dependency-manifest toggles - APIDetection/DBDetection/minConfidence", () => {
  const tsFindings: RawFinding[] = [
    makeFinding({
      pattern: "express_route",
      name: "Frontend Application",
      confidence: 0.75,
      locationFile: "package.json",
      properties: {
        framework: "nextjs",
        sourceContext: "dependency_manifest",
        httpMethods: [],
        path: undefined,
      },
    }),
    makeFinding({
      pattern: "auth_middleware",
      name: "Auth Middleware",
      confidence: 0.8,
      locationFile: "package.json",
      properties: {
        sourceContext: "dependency_manifest",
      },
    }),
    makeFinding({
      pattern: "database_connection",
      name: "Database",
      confidence: 0.92,
      locationFile: "package.json",
      properties: {
        databaseType: "postgres",
        client: "pg",
        sourceContext: "dependency_manifest",
      },
    }),
  ];

  const pyFindings: RawFinding[] = [
    ...tsFindings.map((f) => ({
      ...f,
      // Keep it in the python fixture tree for section tagging.
      location: makeLoc("requirements.txt"),
    })),
  ];

  beforeEach(() => {
    (runAnalyzers as unknown as jest.Mock).mockReturnValue([]);
    (detectTypeScriptPatternsFromDependencyManifests as unknown as jest.Mock).mockResolvedValue(
      tsFindings,
    );
    (detectPythonPatternsFromDependencyManifests as unknown as jest.Mock).mockResolvedValue(
      pyFindings,
    );
  });

  function runForFixture(
    fixtureDirName: string,
    configOverrides: Partial<ScanConfiguration>,
  ) {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      fixtureDirName,
    );

    const config = createDefaultScanConfiguration(configOverrides);
    return scan(fixturesRoot, config);
  }

  it("enableAPIDetection=false removes express_route/auth_middleware components", async () => {
    const { scanResult } = await runForFixture(
      "typescript-dependency-manifests-basic",
      {
        enableAPIDetection: false,
        enableDatabaseDetection: true,
        enableDataFlowDetection: false,
        minimumConfidence: 0,
      },
    );

    expect(
      scanResult.components.some((c) =>
        componentHasDetectedFrom(c, "express_route"),
      ),
    ).toBe(false);

    expect(
      scanResult.components.some((c) =>
        componentHasDetectedFrom(c, "auth_middleware"),
      ),
    ).toBe(false);

    // database_connection should still be present when only API detection is off.
    expect(
      scanResult.components.some((c) =>
        componentHasDetectedFrom(c, "database_connection"),
      ),
    ).toBe(true);
  });

  it("enableDatabaseDetection=false removes database_connection components", async () => {
    const { scanResult } = await runForFixture(
      "typescript-dependency-manifests-basic",
      {
        enableAPIDetection: true,
        enableDatabaseDetection: false,
        enableDataFlowDetection: false,
        minimumConfidence: 0,
      },
    );

    expect(
      scanResult.components.some((c) =>
        componentHasDetectedFrom(c, "database_connection"),
      ),
    ).toBe(false);

    // express_route/auth_middleware should remain when only database detection is off.
    expect(
      scanResult.components.some((c) =>
        componentHasDetectedFrom(c, "express_route"),
      ),
    ).toBe(true);
  });

  it("minimumConfidence filters manifest-derived findings too", async () => {
    const { scanResult } = await runForFixture(
      "typescript-dependency-manifests-basic",
      {
        enableAPIDetection: true,
        enableDatabaseDetection: true,
        enableDataFlowDetection: false,
        minimumConfidence: 0.9,
      },
    );

    // express_route/auth_middleware are below 0.9 and should be filtered out.
    expect(
      scanResult.components.some((c) =>
        componentHasDetectedFrom(c, "express_route"),
      ),
    ).toBe(false);
    expect(
      scanResult.components.some((c) =>
        componentHasDetectedFrom(c, "auth_middleware"),
      ),
    ).toBe(false);

    // database_connection is above 0.9 and should remain.
    expect(
      scanResult.components.some((c) =>
        componentHasDetectedFrom(c, "database_connection"),
      ),
    ).toBe(true);
  });

  it("works for Python dependency manifests fixture too", async () => {
    const { scanResult } = await runForFixture(
      "python-dependency-manifests-basic",
      {
        enableAPIDetection: false,
        enableDatabaseDetection: true,
        enableDataFlowDetection: false,
        minimumConfidence: 0,
      },
    );

    expect(
      scanResult.components.some((c) =>
        componentHasDetectedFrom(c, "express_route"),
      ),
    ).toBe(false);
    expect(
      scanResult.components.some((c) =>
        componentHasDetectedFrom(c, "auth_middleware"),
      ),
    ).toBe(false);
    expect(
      scanResult.components.some((c) =>
        componentHasDetectedFrom(c, "database_connection"),
      ),
    ).toBe(true);
  });
});

