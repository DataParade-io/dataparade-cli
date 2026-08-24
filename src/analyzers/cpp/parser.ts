import * as nodePath from "path";

import type { FileInfo, SourceLocation } from "../../core/types/file";
import {
  extractCFamilyCalls,
  type CFamilyCallEntry,
} from "../shared/c-family-calls";
import { stripCommentsPreservingLayout } from "../shared/strip-comments";

export interface CppIncludeEntry {
  /** Header path as written, e.g. `pqxx/pqxx` or `nlohmann/json.hpp`. */
  header: string;
  /** True for `#include <...>`, false for `#include "..."`. */
  isSystem: boolean;
  location: SourceLocation;
}

export interface CppFunctionEntry {
  name: string;
  /** Qualified name when the definition is written as `Class::method`. */
  qualifier?: string;
  location: SourceLocation;
}

export interface CppTypeEntry {
  name: string;
  kind: "class" | "struct";
  baseTypes: string[];
  location: SourceLocation;
}

export type CppCallEntry = CFamilyCallEntry;

export interface CppTranslationUnitModel {
  file: FileInfo;
  normalizedPath: string;
  /** Source with comments blanked out; line/column offsets are preserved. */
  strippedContent: string;
  includes: CppIncludeEntry[];
  functions: CppFunctionEntry[];
  types: CppTypeEntry[];
  calls: CppCallEntry[];
  namespaces: string[];
  warnings: string[];
}

const INCLUDE_REGEX = /^#\s*include\s*(?:<([^>]+)>|"([^"]+)")/;
const NAMESPACE_REGEX = /^namespace\s+([A-Za-z_][A-Za-z0-9_:]*)/;
const USING_NAMESPACE_REGEX = /^using\s+namespace\s+([A-Za-z_][A-Za-z0-9_:]*)/;
const TYPE_REGEX =
  /^(?:template\s*<[^>]*>\s*)?(class|struct)\s+(?:[A-Z_][A-Z0-9_]*\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([^{;]+))?/;

/**
 * Best-effort function definition heuristic: a return type, a (possibly
 * qualified) name, an argument list, and a body brace — no trailing semicolon,
 * which would make it a declaration rather than a definition.
 */
const FUNCTION_REGEX =
  /^(?:[A-Za-z_~][A-Za-z0-9_:<>,\s*&]*?\s[*&]?\s*)?([A-Za-z_~][A-Za-z0-9_]*(?:::[A-Za-z_~][A-Za-z0-9_]*)*)\s*\([^;]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?(?:->\s*[^{;]+)?\{?\s*$/;

const NON_FUNCTION_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "sizeof",
  "else",
  "do",
  "case",
  "throw",
]);

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

function emptyModel(
  file: FileInfo,
  normalizedPath: string,
  warnings: string[],
): CppTranslationUnitModel {
  return {
    file,
    normalizedPath,
    strippedContent: "",
    includes: [],
    functions: [],
    types: [],
    calls: [],
    namespaces: [],
    warnings,
  };
}

export function parseCppTranslationUnit(
  file: FileInfo,
): CppTranslationUnitModel {
  const warnings: string[] = [];
  const normalizedPath = normalizePath(file.path);

  if (file.language !== "cpp") {
    warnings.push(
      `Unsupported language '${file.language}' for C++ parser in file '${file.path}'.`,
    );
    return emptyModel(file, normalizedPath, warnings);
  }

  const content = file.content ?? "";
  if (content.includes("\u0000")) {
    warnings.push(
      `File '${file.path}' appears unreadable (contains null bytes); parser will continue with best-effort analysis.`,
    );
  }

  const strippedContent = stripCommentsPreservingLayout(content, {
    rawStrings: true,
  });
  const lines = strippedContent.split(/\r?\n/);

  const includes: CppIncludeEntry[] = [];
  const functions: CppFunctionEntry[] = [];
  const types: CppTypeEntry[] = [];
  const namespaces: string[] = [];

  const toLocation = (startLine: number, endLine: number): SourceLocation => ({
    filePath: file.path,
    startLine,
    endLine,
  });

  for (let i = 0; i < lines.length; i += 1) {
    const text = (lines[i] ?? "").trim();
    const lineNumber = i + 1;
    if (!text) continue;

    const includeMatch = text.match(INCLUDE_REGEX);
    if (includeMatch) {
      const systemHeader = includeMatch[1];
      const localHeader = includeMatch[2];
      includes.push({
        header: (systemHeader ?? localHeader ?? "").trim(),
        isSystem: Boolean(systemHeader),
        location: toLocation(lineNumber, lineNumber),
      });
      continue;
    }

    if (text.startsWith("#")) continue;

    const usingNamespaceMatch = text.match(USING_NAMESPACE_REGEX);
    if (usingNamespaceMatch) {
      namespaces.push(usingNamespaceMatch[1]);
      continue;
    }

    const namespaceMatch = text.match(NAMESPACE_REGEX);
    if (namespaceMatch) {
      namespaces.push(namespaceMatch[1]);
      continue;
    }

    const typeMatch = text.match(TYPE_REGEX);
    if (typeMatch) {
      const baseTypes = (typeMatch[3] ?? "")
        .split(",")
        .map((base) =>
          base
            .replace(/\b(public|protected|private|virtual)\b/g, "")
            .trim(),
        )
        .filter(Boolean);

      types.push({
        name: typeMatch[2],
        kind: typeMatch[1] === "class" ? "class" : "struct",
        baseTypes,
        location: toLocation(lineNumber, lineNumber),
      });
      continue;
    }

    const functionMatch = text.match(FUNCTION_REGEX);
    if (functionMatch) {
      const qualifiedName = functionMatch[1];
      const segments = qualifiedName.split("::");
      const name = segments[segments.length - 1];

      if (!NON_FUNCTION_KEYWORDS.has(name)) {
        functions.push({
          name,
          qualifier:
            segments.length > 1
              ? segments.slice(0, -1).join("::")
              : undefined,
          location: toLocation(lineNumber, findFunctionEndLine(lines, i)),
        });
      }
    }
  }

  const calls = extractCFamilyCalls(lines, { filePath: file.path });

  return {
    file,
    normalizedPath,
    strippedContent,
    includes,
    functions,
    types,
    calls,
    namespaces: Array.from(new Set(namespaces)),
    warnings,
  };
}

/**
 * Walk braces forward from a function definition to find its closing line.
 * Falls back to the opening line when braces never balance.
 */
function findFunctionEndLine(lines: string[], startIndex: number): number {
  let depth = 0;
  let seenOpening = false;

  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    for (const char of line) {
      if (char === "{") {
        depth += 1;
        seenOpening = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if (seenOpening && depth <= 0) return i + 1;
  }

  return startIndex + 1;
}
