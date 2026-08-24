/**
 * Call-site extraction shared by the C-family parsers (C++, C#).
 *
 * Both languages express external I/O as call expressions on qualified names
 * (`curl_easy_setopt(...)`, `httpClient.GetAsync(...)`, `cpr::Get(...)`), so
 * the same line scanner serves both. Callers pass comment-stripped lines.
 */

import type { SourceLocation } from "../../core/types/file";

export interface CFamilyCallEntry {
  /** Fully qualified callee as written, e.g. `cpr::Get` or `client.GetAsync`. */
  callee: string;
  argumentsSnippet: string;
  location: SourceLocation;
}

/** Keywords that look like calls but are control flow, not invocations. */
const CONTROL_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "sizeof",
  "throw",
  "lock",
  "using",
  "fixed",
  "foreach",
  "do",
  "else",
  "case",
  "new",
  "typeof",
  "nameof",
  "alignof",
  "decltype",
  "static_assert",
  "defined",
  // Go keywords and builtins that read as calls but are not invocations.
  "func",
  "make",
  "len",
  "cap",
  "append",
  "copy",
  "panic",
  "recover",
  "delete",
  "print",
  "println",
  "range",
  "select",
  "go",
  "defer",
  // Java and Kotlin: declarations, control flow, and constructor delegation
  // that read as calls but are not invocations.
  "assert",
  "synchronized",
  "instanceof",
  "super",
  "this",
  "when",
  "try",
  "finally",
  "class",
  "object",
  "init",
  "constructor",
  "val",
  "var",
  "is",
  "as",
  "in",
  "yield",
  "record",
]);

const CALL_REGEX =
  /\b([A-Za-z_][A-Za-z0-9_]*(?:(?:::|\.|->)[A-Za-z_][A-Za-z0-9_]*)*)\s*\(/g;

const MAX_ARGUMENTS_SNIPPET_LENGTH = 200;

export interface ExtractCallsOptions {
  filePath: string;
  /** Guard against pathological files; callers keep the default. */
  maxCalls?: number;
}

const DEFAULT_MAX_CALLS = 5_000;

/**
 * Extract call sites from comment-stripped source lines.
 *
 * Stripping blanks comments only, so string literals (including URLs) are
 * still intact in the arguments snippet.
 */
export function extractCFamilyCalls(
  strippedLines: string[],
  options: ExtractCallsOptions,
): CFamilyCallEntry[] {
  const maxCalls = options.maxCalls ?? DEFAULT_MAX_CALLS;
  const calls: CFamilyCallEntry[] = [];

  for (let i = 0; i < strippedLines.length; i += 1) {
    if (calls.length >= maxCalls) break;

    const line = strippedLines[i] ?? "";
    if (!line.includes("(")) continue;

    CALL_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = CALL_REGEX.exec(line)) !== null) {
      if (calls.length >= maxCalls) break;

      const callee = match[1];
      const lastSegment = callee.split(/::|\.|->/).pop() ?? callee;
      if (CONTROL_KEYWORDS.has(callee) || CONTROL_KEYWORDS.has(lastSegment)) {
        continue;
      }

      const openParenIndex = match.index + match[0].length - 1;
      const argumentsSnippet = line
        .slice(openParenIndex + 1)
        .slice(0, MAX_ARGUMENTS_SNIPPET_LENGTH);

      calls.push({
        callee,
        argumentsSnippet,
        location: {
          filePath: options.filePath,
          startLine: i + 1,
          endLine: i + 1,
          code: line.trim().slice(0, MAX_ARGUMENTS_SNIPPET_LENGTH),
        },
      });
    }
  }

  return calls;
}
