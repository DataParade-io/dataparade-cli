import * as path from "path";
import type { FileInfo } from "../../../src/core/types/file";
import type { RawFinding } from "../../../src/core/types/detection";
import type { Analyzer } from "../../../src/analyzers/types";
import {
  __clearAnalyzersForTest,
  getAnalyzerForFile,
  registerAnalyzer,
  runAnalyzers,
  runAnalyzersForRootPath,
} from "../../../src/analyzers/registry";
import { ingestFileSystem } from "../../../src/ingest/file-system";

describe("analyzers/registry - DP-P0-CLI-102", () => {
  beforeEach(() => {
    __clearAnalyzersForTest();
  });

  it("dispatches files to analyzers by language and skips unsupported languages", () => {
    const seenByTs: string[] = [];
    const seenByJs: string[] = [];
    const seenByPy: string[] = [];

    const tsAnalyzer: Analyzer = {
      detect(file: FileInfo): RawFinding[] {
        seenByTs.push(file.path);
        return [
          {
            pattern: "express_route",
            name: `ts-${file.name}`,
            confidence: 0.9,
            location: {
              filePath: file.path,
              startLine: 1,
              endLine: 1,
            },
            properties: {},
          },
        ];
      },
    };

    const jsAnalyzer: Analyzer = {
      detect(file: FileInfo): RawFinding[] {
        seenByJs.push(file.path);
        return [
          {
            pattern: "external_api_call",
            name: `js-${file.name}`,
            confidence: 0.8,
            location: {
              filePath: file.path,
              startLine: 1,
              endLine: 1,
            },
            properties: {},
          },
        ];
      },
    };

    const pyAnalyzer: Analyzer = {
      detect(file: FileInfo): RawFinding[] {
        seenByPy.push(file.path);
        return [
          {
            pattern: "external_api_call",
            name: `py-${file.name}`,
            confidence: 0.85,
            location: {
              filePath: file.path,
              startLine: 1,
              endLine: 1,
            },
            properties: {},
          },
        ];
      },
    };

    registerAnalyzer("typescript", tsAnalyzer);
    registerAnalyzer("javascript", jsAnalyzer);
    registerAnalyzer("python", pyAnalyzer);

    const files: FileInfo[] = [
      {
        path: "src/index.ts",
        name: "index.ts",
        content: "console.log('ts');",
        language: "typescript",
        size: 10,
      },
      {
        path: "src/app.jsx",
        name: "app.jsx",
        content: "console.log('js');",
        language: "javascript",
        size: 10,
      },
      {
        path: "config/app.yaml",
        name: "app.yaml",
        content: "key: value",
        language: "yaml",
        size: 10,
      },
      {
        path: "scripts/example.py",
        name: "example.py",
        content: "print('hi')",
        language: "python",
        size: 10,
      },
    ];

    const findings = runAnalyzers(files);

    expect(seenByTs).toEqual(["src/index.ts"]);
    expect(seenByJs).toEqual(["src/app.jsx"]);
    expect(seenByPy).toEqual(["scripts/example.py"]);

    const findingNames = findings.map((f) => f.name);
    expect(findingNames).toContain("ts-index.ts");
    expect(findingNames).toContain("js-app.jsx");
    expect(findingNames).toContain("py-example.py");
    expect(findingNames.length).toBe(3);
  });

  it("returns undefined for files without a registered analyzer", () => {
    const file: FileInfo = {
      path: "data/sample.json",
      name: "sample.json",
      content: '{"ok":true}',
      language: "json",
      size: 15,
    };

    expect(getAnalyzerForFile(file)).toBeUndefined();
  });

  it("processes files in a deterministic order", () => {
    const calls: string[] = [];

    const tsAnalyzer: Analyzer = {
      detect(file: FileInfo): RawFinding[] {
        calls.push(`ts:${file.path}`);
        return [];
      },
    };

    registerAnalyzer("typescript", tsAnalyzer);

    const files: FileInfo[] = [
      {
        path: "b.ts",
        name: "b.ts",
        content: "",
        language: "typescript",
        size: 0,
      },
      {
        path: "a.ts",
        name: "a.ts",
        content: "",
        language: "typescript",
        size: 0,
      },
    ];

    runAnalyzers(files);

    expect(calls).toEqual(["ts:b.ts", "ts:a.ts"]);
  });

  it("integrates with ingest to analyze only supported languages", async () => {
    const seenByTs: string[] = [];
    const seenByJs: string[] = [];

    const tsAnalyzer: Analyzer = {
      detect(file: FileInfo): RawFinding[] {
        seenByTs.push(file.path);
        return [];
      },
    };

    const jsAnalyzer: Analyzer = {
      detect(file: FileInfo): RawFinding[] {
        seenByJs.push(file.path);
        return [];
      },
    };

    registerAnalyzer("typescript", tsAnalyzer);
    registerAnalyzer("javascript", jsAnalyzer);

    const fixtureRoot = path.resolve(
      __dirname,
      "../../fixtures/ingest-basic",
    );

    const filesFromIngest = await ingestFileSystem(fixtureRoot);
    const findings = runAnalyzers(filesFromIngest);

    expect(findings).toEqual([]);
    expect(seenByTs.length).toBeGreaterThan(0);
    expect(seenByJs.length).toBeGreaterThan(0);

    const allSeen = [...seenByTs, ...seenByJs];
    expect(allSeen.every((p) => p.endsWith(".ts") || p.endsWith(".jsx"))).toBe(
      true,
    );
  });

  it("runs analyzers via runAnalyzersForRootPath helper", async () => {
    const seen: string[] = [];

    const tsAnalyzer: Analyzer = {
      detect(file: FileInfo): RawFinding[] {
        seen.push(file.path);
        return [
          {
            pattern: "express_route",
            name: `ts-${file.name}`,
            confidence: 1,
            location: {
              filePath: file.path,
              startLine: 1,
              endLine: 1,
            },
            properties: {},
          },
        ];
      },
    };

    registerAnalyzer("typescript", tsAnalyzer);

    const fixtureRoot = path.resolve(
      __dirname,
      "../../fixtures/ingest-basic",
    );

    const findings = await runAnalyzersForRootPath(fixtureRoot);

    expect(findings.length).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(0);
  });
});

