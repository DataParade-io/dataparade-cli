import * as nodePath from "path";

import type { FileInfo, SourceLocation } from "../../core/types/file";
import { stripCommentsPreservingLayout } from "../shared/strip-comments";

export interface PhpImportEntry {
  /**
   * Fully-qualified name from a `use` statement, e.g. `GuzzleHttp\Client`,
   * or a require/include path for non-PSR files.
   */
  path: string;
  /** Alias from `use Foo\Bar as Baz`. */
  alias?: string;
  /** True for `require` / `include` (and `_once` variants). */
  isRequire: boolean;
  location: SourceLocation;
}

export interface PhpFunctionEntry {
  name: string;
  /** Class name for methods: `function foo()` inside `class Bar`. */
  className?: string;
  location: SourceLocation;
}

export interface PhpTypeEntry {
  name: string;
  kind: "class" | "interface" | "trait";
  location: SourceLocation;
}

export interface PhpCallEntry {
  callee: string;
  argumentsSnippet: string;
  location: SourceLocation;
}

export interface PhpSourceFileModel {
  file: FileInfo;
  normalizedPath: string;
  /** Source with comments blanked out; line/column offsets are preserved. */
  strippedContent: string;
  namespace?: string;
  imports: PhpImportEntry[];
  functions: PhpFunctionEntry[];
  types: PhpTypeEntry[];
  calls: PhpCallEntry[];
  warnings: string[];
}

const NAMESPACE_REGEX = /^namespace\s+([A-Za-z_\\][\w\\]*)\s*;/;
const USE_REGEX =
  /^use\s+(?:function\s+|const\s+)?([A-Za-z_\\][\w\\]*)(?:\s+as\s+([A-Za-z_]\w*))?\s*;/;
/** `use Foo\Bar\{A, B as Alias, Nested\C};` (and function/const variants). */
const USE_GROUP_REGEX =
  /^use\s+(?:function\s+|const\s+)?([A-Za-z_\\][\w\\]*)\\\{([^}]+)\}\s*;/;
const USE_GROUP_MEMBER_REGEX =
  /^([A-Za-z_\\][\w\\]*)(?:\s+as\s+([A-Za-z_]\w*))?$/;
const REQUIRE_REGEX =
  /^(?:require|include)(?:_once)?\s*\(?\s*["']([^"']+)["']/;
const TYPE_REGEX =
  /^(?:(?:abstract|final)\s+)?(class|interface|trait)\s+([A-Za-z_]\w*)/;
const FUNCTION_REGEX = /^(?:(?:public|protected|private|static|final)\s+)*function\s+&?([A-Za-z_]\w*)\s*\(/;

const STATIC_CALL_REGEX =
  /([A-Za-z_\\][\w\\]*)::([A-Za-z_]\w*)\s*\(/g;
const METHOD_CALL_REGEX =
  /\$[A-Za-z_]\w*\s*\??->\s*([A-Za-z_]\w*)\s*\(/g;
const NEW_CALL_REGEX = /\bnew\s+([A-Za-z_\\][\w\\]*)\s*\(/g;
const FUNC_CALL_REGEX = /\b([A-Za-z_]\w*)\s*\(/g;

const PHP_KEYWORDS = new Set([
  "if",
  "else",
  "elseif",
  "for",
  "foreach",
  "while",
  "do",
  "switch",
  "case",
  "function",
  "class",
  "interface",
  "trait",
  "namespace",
  "use",
  "return",
  "echo",
  "print",
  "new",
  "try",
  "catch",
  "finally",
  "throw",
  "match",
  "isset",
  "empty",
  "array",
  "list",
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
): PhpSourceFileModel {
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

function findBlockEndLine(lines: string[], startIndex: number): number {
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

/**
 * Expand a single-line `use` (plain or grouped) into import entries.
 * Returns null when the line is not a `use` statement.
 */
function parseUseImports(
  text: string,
  location: SourceLocation,
): PhpImportEntry[] | null {
  const groupMatch = text.match(USE_GROUP_REGEX);
  if (groupMatch) {
    const prefix = groupMatch[1];
    const entries: PhpImportEntry[] = [];
    for (const rawMember of groupMatch[2].split(",")) {
      const member = rawMember.trim();
      if (!member) continue;
      const memberMatch = member.match(USE_GROUP_MEMBER_REGEX);
      if (!memberMatch) continue;
      entries.push({
        path: `${prefix}\\${memberMatch[1]}`,
        alias: memberMatch[2],
        isRequire: false,
        location,
      });
    }
    return entries;
  }

  const useMatch = text.match(USE_REGEX);
  if (!useMatch) return null;

  return [
    {
      path: useMatch[1],
      alias: useMatch[2],
      isRequire: false,
      location,
    },
  ];
}

function extractCalls(
  lines: string[],
  filePath: string,
): PhpCallEntry[] {
  const calls: PhpCallEntry[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const lineNumber = i + 1;
    const location: SourceLocation = {
      filePath,
      startLine: lineNumber,
      endLine: lineNumber,
    };

    const push = (callee: string, fromIndex: number) => {
      const openParen = line.indexOf("(", fromIndex);
      const closeParen = openParen === -1 ? -1 : line.indexOf(")", openParen);
      const argumentsSnippet =
        openParen !== -1
          ? line.slice(
              openParen + 1,
              closeParen === -1 ? undefined : closeParen,
            )
          : "";
      calls.push({ callee, argumentsSnippet, location });
    };

    STATIC_CALL_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STATIC_CALL_REGEX.exec(line)) !== null) {
      push(`${match[1]}::${match[2]}`, match.index);
    }

    METHOD_CALL_REGEX.lastIndex = 0;
    while ((match = METHOD_CALL_REGEX.exec(line)) !== null) {
      push(`->${match[1]}`, match.index);
    }

    NEW_CALL_REGEX.lastIndex = 0;
    while ((match = NEW_CALL_REGEX.exec(line)) !== null) {
      push(`new ${match[1]}`, match.index);
    }

    FUNC_CALL_REGEX.lastIndex = 0;
    while ((match = FUNC_CALL_REGEX.exec(line)) !== null) {
      const name = match[1];
      if (PHP_KEYWORDS.has(name.toLowerCase())) continue;
      // Skip names already captured as Class::method or after `new `.
      const before = line.slice(Math.max(0, match.index - 2), match.index);
      if (before.endsWith("::") || before.endsWith(">")) continue;
      push(name, match.index);
    }
  }

  return calls;
}

export function parsePhpSourceFile(file: FileInfo): PhpSourceFileModel {
  const warnings: string[] = [];
  const normalizedPath = normalizePath(file.path);

  if (file.language !== "php") {
    warnings.push(
      `Unsupported language '${file.language}' for PHP parser in file '${file.path}'.`,
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
    hashComments: true,
  });
  const lines = strippedContent.split(/\r?\n/);

  const imports: PhpImportEntry[] = [];
  const functions: PhpFunctionEntry[] = [];
  const types: PhpTypeEntry[] = [];
  let namespace: string | undefined;
  let currentClass: string | undefined;
  let classEndLine = 0;

  const toLocation = (startLine: number, endLine: number): SourceLocation => ({
    filePath: file.path,
    startLine,
    endLine,
  });

  for (let i = 0; i < lines.length; i += 1) {
    const text = (lines[i] ?? "").trim();
    const lineNumber = i + 1;
    if (!text || text === "<?php" || text === "<?=") continue;

    if (currentClass && lineNumber > classEndLine) {
      currentClass = undefined;
    }

    if (!namespace) {
      const nsMatch = text.match(NAMESPACE_REGEX);
      if (nsMatch) {
        namespace = nsMatch[1];
        continue;
      }
    }

    const useImports = parseUseImports(text, toLocation(lineNumber, lineNumber));
    if (useImports) {
      imports.push(...useImports);
      continue;
    }

    const requireMatch = text.match(REQUIRE_REGEX);
    if (requireMatch) {
      imports.push({
        path: requireMatch[1],
        isRequire: true,
        location: toLocation(lineNumber, lineNumber),
      });
      continue;
    }

    const typeMatch = text.match(TYPE_REGEX);
    if (typeMatch) {
      const kind = typeMatch[1] as "class" | "interface" | "trait";
      const name = typeMatch[2];
      const endLine = findBlockEndLine(lines, i);
      types.push({
        name,
        kind,
        location: toLocation(lineNumber, endLine),
      });
      if (kind === "class") {
        currentClass = name;
        classEndLine = endLine;
      }
      continue;
    }

    const functionMatch = text.match(FUNCTION_REGEX);
    if (functionMatch) {
      functions.push({
        name: functionMatch[1],
        className: currentClass,
        location: toLocation(lineNumber, findBlockEndLine(lines, i)),
      });
    }
  }

  const calls = extractCalls(lines, file.path);

  return {
    file,
    normalizedPath,
    strippedContent,
    namespace,
    imports,
    functions,
    types,
    calls,
    warnings,
  };
}
