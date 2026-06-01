import type { FileInfo } from "../../../../src/core/types/file";
import {
  buildCodeModel,
  normalizePath,
} from "../../../../src/analyzers/typescript/parser";

describe("analyzers/typescript/parser - DP-P0-CLI-103", () => {
  it("normalizes paths to POSIX style", () => {
    expect(normalizePath("already/posix/path.ts")).toBe("already/posix/path.ts");

    const windowsLike = "some\\windows\\path.ts";
    expect(normalizePath(windowsLike)).toBe("some/windows/path.ts");
  });

  it("builds a basic code model for a TypeScript file", () => {
    const file: FileInfo = {
      path: "src/example.ts",
      name: "example.ts",
      content: `
        import fs from "fs";
        import { join } from "path";

        export function foo() {
          return join("a", "b");
        }

        const bar = () => {
          return fs.readFileSync("file.txt", "utf-8");
        };
      `,
      language: "typescript",
      size: 0,
    };

    const result = buildCodeModel(file);

    expect(result.language).toBe("typescript");
    expect(result.normalizedPath).toBe("src/example.ts");
    expect(result.warnings.length).toBe(0);

    const moduleSpecifiers = result.imports.map((i) => i.moduleSpecifier);
    expect(moduleSpecifiers).toContain("fs");
    expect(moduleSpecifiers).toContain("path");

    const importNames = result.imports.flatMap((i) => i.importedNames);
    expect(importNames).toContain("fs");
    expect(importNames).toContain("join");

    const functionNames = result.functions.map((fn) => fn.name);
    expect(functionNames).toContain("foo");
    expect(functionNames).toContain("bar");

    const exportedFunctions = result.functions.filter((fn) => fn.isExported);
    const exportedNames = exportedFunctions.map((fn) => fn.name);
    expect(exportedNames).toContain("foo");
  });

  it("builds a basic code model for a JavaScript file with require()", () => {
    const file: FileInfo = {
      path: "src/example.js",
      name: "example.js",
      content: `
        const http = require("http");

        function handler() {
          return http.createServer();
        }

        module.exports = { handler };
      `,
      language: "javascript",
      size: 0,
    };

    const result = buildCodeModel(file);

    expect(result.language).toBe("javascript");
    expect(result.warnings.length).toBe(0);

    const moduleSpecifiers = result.imports.map((i) => i.moduleSpecifier);
    expect(moduleSpecifiers).toContain("http");

    const importNames = result.imports.flatMap((i) => i.importedNames);
    expect(importNames).toContain("http");

    const functionNames = result.functions.map((fn) => fn.name);
    expect(functionNames).toContain("handler");
  });

  it("surfaces parser diagnostics as warnings for syntactically invalid files", () => {
    const file: FileInfo = {
      path: "src/broken.ts",
      name: "broken.ts",
      content: `
        import from;
        export function oops( {
      `,
      language: "typescript",
      size: 0,
    };

    const result = buildCodeModel(file);

    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns a non-fatal result with warnings for unsupported languages", () => {
    const file: FileInfo = {
      path: "config/settings.json",
      name: "settings.json",
      content: `{"ok": true}`,
      language: "json",
      size: 0,
    };

    const result = buildCodeModel(file as FileInfo);

    expect(result.imports).toEqual([]);
    expect(result.functions).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

