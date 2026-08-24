import * as nodePath from "path";

import type { FileInfo, SourceLocation } from "../../core/types/file";
import { stripCommentsPreservingLayout } from "../shared/strip-comments";

export interface PythonImportEntry {
  module: string;
  names: string[];
  location: SourceLocation;
}

export interface PythonFunctionEntry {
  name: string;
  isAsync: boolean;
  decorators: string[];
  location: SourceLocation;
}

export interface PythonModuleLevelCallEntry {
  callee: string;
  argumentsSnippet: string;
  location: SourceLocation;
}

export interface PythonModuleModel {
  file: FileInfo;
  normalizedPath: string;
  strippedContent: string;
  imports: PythonImportEntry[];
  functions: PythonFunctionEntry[];
  moduleLevelCalls: PythonModuleLevelCallEntry[];
  warnings: string[];
}

export function parsePythonModule(file: FileInfo): PythonModuleModel {
  const warnings: string[] = [];

  const normalizedPath = normalizePath(file.path);

  if (file.language !== "python") {
    warnings.push(
      `Unsupported language '${file.language}' for Python parser in file '${file.path}'.`,
    );

    return {
      file,
      normalizedPath,
      strippedContent: "",
      imports: [],
      functions: [],
      moduleLevelCalls: [],
      warnings,
    };
  }

  const content = file.content ?? "";
  const strippedContent = stripCommentsPreservingLayout(content, {
    hashComments: true,
    tripleQuoteStrings: true,
  });
  if (content.includes("\u0000")) {
    warnings.push(
      `File '${file.path}' appears unreadable (contains null bytes); parser will continue with best-effort analysis.`,
    );
  }
  const lines = content.split(/\r?\n/);

  const imports: PythonImportEntry[] = [];
  const functions: PythonFunctionEntry[] = [];
  const moduleLevelCalls: PythonModuleLevelCallEntry[] = [];

  const toLocation = (startLine: number, endLine: number): SourceLocation => ({
    filePath: file.path,
    startLine,
    endLine,
  });

  // Track decorators immediately above the next function definition.
  let pendingDecorators: string[] = [];

  const importRegex =
    /^(?:from\s+([a-zA-Z0-9_\.]+)\s+import\s+(.+)|import\s+(.+))\s*$/;
  const defRegex = /^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;
  const asyncDefRegex = /^async\s+def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;
  const decoratorRegex = /^@([a-zA-Z_][a-zA-Z0-9_\.]*)/;
  const callRegex = /([a-zA-Z_][a-zA-Z0-9_\.]*)\s*\(/;

  const isIndented = (line: string): boolean =>
    /^\s/.test(line) && !/^\s*#/.test(line);

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trimEnd();
    const text = line.trimStart();
    const lineNumber = i + 1;

    if (!text || text.startsWith("#")) {
      continue;
    }

    const decoratorMatch = text.match(decoratorRegex);
    if (decoratorMatch) {
      pendingDecorators.push(decoratorMatch[1]);
      continue;
    }

    const importMatch = text.match(importRegex);
    if (importMatch) {
      const fromModule = importMatch[1];
      const fromNames = importMatch[2];
      const directImports = importMatch[3];

      if (fromModule) {
        const names = fromNames
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const [name] = part.split(/\s+as\s+/);
            return name.trim();
          });

        imports.push({
          module: fromModule,
          names,
          location: toLocation(lineNumber, lineNumber),
        });
      } else if (directImports) {
        const modules = directImports
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);

        imports.push({
          module: modules.join(", "),
          names: [],
          location: toLocation(lineNumber, lineNumber),
        });
      }

      pendingDecorators = [];
      continue;
    }

    const asyncMatch = text.match(asyncDefRegex);
    const defMatch = text.match(defRegex);

    if (asyncMatch || defMatch) {
      const isAsync = !!asyncMatch;
      const name = (asyncMatch ?? defMatch)![1];

      let endLine = lineNumber;
      for (let j = i + 1; j < lines.length; j += 1) {
        const nextLine = lines[j];
        if (!nextLine.trim()) {
          endLine = j + 1;
          continue;
        }
        if (!isIndented(nextLine)) {
          break;
        }
        endLine = j + 1;
      }

      functions.push({
        name,
        isAsync,
        decorators: pendingDecorators,
        location: toLocation(lineNumber, endLine),
      });

      pendingDecorators = [];
      continue;
    }

    if (text.startsWith("def ") || text.startsWith("async def ")) {
      warnings.push(
        `Potentially malformed function signature in '${file.path}' at line ${lineNumber}.`,
      );
      pendingDecorators = [];
      continue;
    }

    const callMatch = text.match(callRegex);
    if (callMatch) {
      const callee = callMatch[1];
      const firstParenIndex = text.indexOf("(");
      const argsSnippet =
        firstParenIndex >= 0
          ? text.slice(firstParenIndex + 1).slice(0, 120)
          : "";

      moduleLevelCalls.push({
        callee,
        argumentsSnippet: argsSnippet,
        location: toLocation(lineNumber, lineNumber),
      });

      pendingDecorators = [];
      continue;
    }

    pendingDecorators = [];
  }

  return {
    file,
    normalizedPath,
    strippedContent,
    imports,
    functions,
    moduleLevelCalls,
    warnings,
  };
}

function normalizePath(p: string): string {
  if (!p) return "";
  const normalized = p.split("\\").join("/");
  return normalizedPathIsRelativeToCwd(normalized)
    ? normalized
    : normalized.replace(nodePath.resolve(), "").replace(/^\/+/, "");
}

function normalizedPathIsRelativeToCwd(p: string): boolean {
  return !p.startsWith("/") && !p.match(/^[A-Za-z]:\//);
}


