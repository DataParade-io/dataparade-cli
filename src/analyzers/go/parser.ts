import * as nodePath from "path";

import type { FileInfo, SourceLocation } from "../../core/types/file";
import {
  extractCFamilyCalls,
  type CFamilyCallEntry,
} from "../shared/c-family-calls";
import { stripCommentsPreservingLayout } from "../shared/strip-comments";

export interface GoImportEntry {
  /** Import path as written, e.g. `net/http` or `github.com/lib/pq`. */
  path: string;
  /** Alias for `m "github.com/gorilla/mux"`. */
  alias?: string;
  /**
   * True for `_ "github.com/lib/pq"`. Blank imports exist purely for their
   * side effects — in Go this is how database drivers register themselves,
   * so they are the strongest available signal for driver detection.
   */
  isBlank: boolean;
  location: SourceLocation;
}

export interface GoFunctionEntry {
  name: string;
  /** Receiver type for methods: `func (s *Server) Handle()` → `Server`. */
  receiverType?: string;
  location: SourceLocation;
}

export interface GoTypeEntry {
  name: string;
  kind: "struct" | "interface";
  location: SourceLocation;
}

export type GoCallEntry = CFamilyCallEntry;

export interface GoSourceFileModel {
  file: FileInfo;
  normalizedPath: string;
  /** Source with comments blanked out; line/column offsets are preserved. */
  strippedContent: string;
  packageName?: string;
  imports: GoImportEntry[];
  functions: GoFunctionEntry[];
  types: GoTypeEntry[];
  calls: GoCallEntry[];
  warnings: string[];
}

const PACKAGE_REGEX = /^package\s+([A-Za-z_]\w*)/;
const SINGLE_IMPORT_REGEX =
  /^import\s+(?:(_|\.|[A-Za-z_]\w*)\s+)?"([^"]+)"/;
const IMPORT_BLOCK_START_REGEX = /^import\s*\(/;
const IMPORT_BLOCK_ENTRY_REGEX = /^(?:(_|\.|[A-Za-z_]\w*)\s+)?"([^"]+)"/;
const FUNCTION_REGEX =
  /^func\s+(?:\(\s*(?:[A-Za-z_]\w*\s+)?\*?([A-Za-z_][\w.]*)\s*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\(/;
const TYPE_REGEX = /^type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+(struct|interface)\b/;

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
): GoSourceFileModel {
  return {
    file,
    normalizedPath,
    strippedContent: "",
    imports: [],
    functions: [],
    types: [],
    calls: [],
    warnings,
  };
}

export function parseGoSourceFile(file: FileInfo): GoSourceFileModel {
  const warnings: string[] = [];
  const normalizedPath = normalizePath(file.path);

  if (file.language !== "go") {
    warnings.push(
      `Unsupported language '${file.language}' for Go parser in file '${file.path}'.`,
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
    backtickStrings: true,
  });
  const lines = strippedContent.split(/\r?\n/);

  const imports: GoImportEntry[] = [];
  const functions: GoFunctionEntry[] = [];
  const types: GoTypeEntry[] = [];
  let packageName: string | undefined;
  let inImportBlock = false;

  const toLocation = (startLine: number, endLine: number): SourceLocation => ({
    filePath: file.path,
    startLine,
    endLine,
  });

  const pushImport = (
    prefix: string | undefined,
    importPath: string,
    lineNumber: number,
  ) => {
    imports.push({
      path: importPath,
      alias: prefix && prefix !== "_" && prefix !== "." ? prefix : undefined,
      isBlank: prefix === "_",
      location: toLocation(lineNumber, lineNumber),
    });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const text = (lines[i] ?? "").trim();
    const lineNumber = i + 1;
    if (!text) continue;

    if (inImportBlock) {
      if (text.startsWith(")")) {
        inImportBlock = false;
        continue;
      }
      const entry = text.match(IMPORT_BLOCK_ENTRY_REGEX);
      if (entry) pushImport(entry[1], entry[2], lineNumber);
      continue;
    }

    if (!packageName) {
      const packageMatch = text.match(PACKAGE_REGEX);
      if (packageMatch) {
        packageName = packageMatch[1];
        continue;
      }
    }

    if (IMPORT_BLOCK_START_REGEX.test(text)) {
      inImportBlock = true;
      continue;
    }

    const singleImport = text.match(SINGLE_IMPORT_REGEX);
    if (singleImport) {
      pushImport(singleImport[1], singleImport[2], lineNumber);
      continue;
    }

    const typeMatch = text.match(TYPE_REGEX);
    if (typeMatch) {
      types.push({
        name: typeMatch[1],
        kind: typeMatch[2] === "interface" ? "interface" : "struct",
        location: toLocation(lineNumber, lineNumber),
      });
      continue;
    }

    const functionMatch = text.match(FUNCTION_REGEX);
    if (functionMatch) {
      functions.push({
        name: functionMatch[2],
        receiverType: functionMatch[1],
        location: toLocation(lineNumber, findFunctionEndLine(lines, i)),
      });
    }
  }

  const calls = extractCFamilyCalls(lines, { filePath: file.path });

  return {
    file,
    normalizedPath,
    strippedContent,
    packageName,
    imports,
    functions,
    types,
    calls,
    warnings,
  };
}

/**
 * Walk braces forward from a function declaration to find its closing line.
 * Go always brace-delimits function bodies, so this is reliable.
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
