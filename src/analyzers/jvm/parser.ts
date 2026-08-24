import * as nodePath from "path";

import type { FileInfo, SourceLocation } from "../../core/types/file";
import {
  extractCFamilyCalls,
  type CFamilyCallEntry,
} from "../shared/c-family-calls";
import { stripCommentsPreservingLayout } from "../shared/strip-comments";

export interface JvmImportEntry {
  /**
   * Fully qualified name as written, with any trailing `.*` removed:
   * `org.springframework.web.bind.annotation.RestController`, or
   * `org.springframework.web.bind.annotation` for a wildcard import.
   */
  qualifiedName: string;
  /** Alias for Kotlin's `import a.b.C as D`. */
  alias?: string;
  isStatic: boolean;
  isWildcard: boolean;
  location: SourceLocation;
}

export interface JvmAnnotationEntry {
  /** Annotation name without `@` or Kotlin use-site target, e.g. `GetMapping`. */
  name: string;
  /** Argument list as written, e.g. `"users/{id}"` or `value = "/api"`. */
  argumentsSnippet: string;
  /** Full annotation text without `@`, e.g. `GetMapping("users/{id}")`. */
  raw: string;
}

export interface JvmTypeEntry {
  name: string;
  kind: "class" | "interface" | "enum" | "record" | "object" | "annotation";
  /** Supertypes from `extends`/`implements` (Java) or the `:` list (Kotlin). */
  baseTypes: string[];
  annotations: JvmAnnotationEntry[];
  location: SourceLocation;
}

export interface JvmMethodEntry {
  name: string;
  annotations: JvmAnnotationEntry[];
  /** Enclosing type name when the method is declared inside one. */
  declaringType?: string;
  location: SourceLocation;
}

export type JvmCallEntry = CFamilyCallEntry;

export interface JvmSourceFileModel {
  file: FileInfo;
  normalizedPath: string;
  /** Source with comments blanked out; line/column offsets are preserved. */
  strippedContent: string;
  /** True for `.kt`/`.kts` sources; selects the Kotlin declaration grammar. */
  isKotlin: boolean;
  packageName?: string;
  imports: JvmImportEntry[];
  types: JvmTypeEntry[];
  methods: JvmMethodEntry[];
  calls: JvmCallEntry[];
  warnings: string[];
}

const PACKAGE_REGEX = /^package\s+([A-Za-z_][\w.]*)/;
// The `*` lives in the character class rather than as an optional suffix: a
// greedy `[\w.]*` would otherwise swallow the dot before `.*` could match it.
const IMPORT_REGEX =
  /^import\s+(static\s+)?([A-Za-z_][\w.*]*)\s*(?:as\s+([A-Za-z_]\w*))?\s*;?/;

const JAVA_TYPE_MODIFIERS =
  "public|private|protected|abstract|final|static|sealed|non-sealed|strictfp";
const JAVA_TYPE_REGEX = new RegExp(
  `^(?:(?:${JAVA_TYPE_MODIFIERS})\\s+)*(class|interface|enum|record|@interface)\\s+([A-Za-z_]\\w*)`,
);

const KOTLIN_TYPE_MODIFIERS =
  "public|private|protected|internal|open|abstract|final|sealed|data|inner|value|inline|annotation|companion|expect|actual";
const KOTLIN_TYPE_REGEX = new RegExp(
  `^(?:(?:${KOTLIN_TYPE_MODIFIERS})\\s+)*(class|interface|object|enum\\s+class|annotation\\s+class)\\s+([A-Za-z_]\\w*)`,
);

const KOTLIN_FUNCTION_REGEX =
  /^(?:(?:public|private|protected|internal|open|override|abstract|final|inline|suspend|operator|infix|tailrec|external|expect|actual)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[A-Za-z_][\w.<>,\s?]*\.)?([A-Za-z_]\w*)\s*\(/;

const JAVA_METHOD_REGEX =
  /^(?:(?:public|private|protected|static|final|abstract|synchronized|native|strictfp|default)\s+)*(?:<[^>]*>\s*)?[A-Za-z_][\w.<>,\[\]?\s]*\s+([A-Za-z_]\w*)\s*\(/;

/**
 * First tokens that make a line look like a Java method declaration when it is
 * actually a statement (`return foo(...)`, `throw new X(...)`).
 */
const JAVA_STATEMENT_STARTERS = new Set([
  "return",
  "throw",
  "new",
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "do",
  "else",
  "case",
  "assert",
  "synchronized",
  "import",
  "package",
  "yield",
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

/**
 * Consume one `@Annotation(...)` from the start of `text`, following the
 * argument list across lines when it does not close on the current one —
 * Spring routinely wraps `@RequestMapping(value = ..., method = ...)`.
 *
 * Returns the annotation, the remainder of the line it ended on, and that
 * line's index.
 */
function consumeAnnotation(
  lines: string[],
  lineIndex: number,
  text: string,
): { annotation: JvmAnnotationEntry; rest: string; endIndex: number } | null {
  const nameMatch = text.match(/^@\s*(?:([A-Za-z_]\w*)\s*:\s*)?([A-Za-z_][\w.]*)/);
  if (!nameMatch) return null;

  // Kotlin use-site targets (`@field:Autowired`) are dropped; the annotation
  // identity is what rules match on.
  const qualified = nameMatch[2];
  const name = qualified.includes(".")
    ? (qualified.split(".").pop() ?? qualified)
    : qualified;

  let rest = text.slice(nameMatch[0].length);
  let endIndex = lineIndex;
  let argumentsSnippet = "";

  if (rest.trimStart().startsWith("(")) {
    rest = rest.trimStart();
    let depth = 0;
    let inString = false;
    let quote = "";
    let collected = "";
    let consumed = false;

    while (endIndex < lines.length && !consumed) {
      const source = endIndex === lineIndex ? rest : (lines[endIndex] ?? "");
      let cursor = 0;

      for (; cursor < source.length; cursor += 1) {
        const char = source[cursor];

        if (inString) {
          if (char === "\\") {
            cursor += 1;
            continue;
          }
          if (char === quote) inString = false;
          continue;
        }

        if (char === '"' || char === "'") {
          inString = true;
          quote = char;
          continue;
        }

        if (char === "(") {
          depth += 1;
        } else if (char === ")") {
          depth -= 1;
          if (depth === 0) {
            consumed = true;
            break;
          }
        }
      }

      if (consumed) {
        collected += source.slice(0, cursor);
        rest = source.slice(cursor + 1).trim();
      } else {
        collected += `${source} `;
        endIndex += 1;
        rest = "";
      }
    }

    // Unbalanced parentheses: treat the annotation as argument-less rather
    // than swallowing the rest of the file.
    if (!consumed) return null;

    argumentsSnippet = collected.replace(/^\s*\(/, "").trim();
  } else {
    rest = rest.trim();
  }

  return {
    annotation: {
      name,
      argumentsSnippet,
      raw: argumentsSnippet ? `${name}(${argumentsSnippet})` : name,
    },
    rest,
    endIndex,
  };
}

/** Supertypes from a Java `extends A implements B, C` header. */
function javaBaseTypes(header: string): string[] {
  const bases: string[] = [];

  const extendsMatch = header.match(/\bextends\s+([^{]+?)(?=\bimplements\b|\{|$)/);
  if (extendsMatch) bases.push(...splitTypeList(extendsMatch[1]));

  const implementsMatch = header.match(/\bimplements\s+([^{]+?)(?=\{|$)/);
  if (implementsMatch) bases.push(...splitTypeList(implementsMatch[1]));

  return bases;
}

/** Supertypes from a Kotlin `class X(...) : A(), B` header. */
function kotlinBaseTypes(header: string): string[] {
  // Skip the primary constructor's parameter list so its types are not read
  // as supertypes.
  let depth = 0;
  let colonIndex = -1;

  for (let i = 0; i < header.length; i += 1) {
    const char = header[i];
    if (char === "(" || char === "<") depth += 1;
    else if (char === ")" || char === ">") depth -= 1;
    else if (char === ":" && depth === 0) {
      colonIndex = i;
      break;
    }
    else if (char === "{" && depth === 0) break;
  }

  if (colonIndex === -1) return [];

  const tail = header.slice(colonIndex + 1).replace(/\{.*$/, "");
  return splitTypeList(tail);
}

/** Split a comma-separated type list, ignoring commas inside generics/args. */
function splitTypeList(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of raw) {
    if (char === "<" || char === "(") depth += 1;
    else if (char === ">" || char === ")") depth -= 1;

    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts
    // Keep the bare type name: `Foo<Bar>()` and `Foo<Bar>` both yield `Foo`.
    .map((part) => part.trim().replace(/[<(].*$/, "").trim())
    .filter((part) => Boolean(part) && /^[A-Za-z_][\w.]*$/.test(part));
}

function emptyModel(
  file: FileInfo,
  normalizedPath: string,
  isKotlin: boolean,
  warnings: string[],
): JvmSourceFileModel {
  return {
    file,
    normalizedPath,
    strippedContent: "",
    isKotlin,
    imports: [],
    types: [],
    methods: [],
    calls: [],
    warnings,
  };
}

export function parseJvmSourceFile(file: FileInfo): JvmSourceFileModel {
  const warnings: string[] = [];
  const normalizedPath = normalizePath(file.path);
  const isKotlin = file.language === "kotlin";

  if (file.language !== "java" && file.language !== "kotlin") {
    warnings.push(
      `Unsupported language '${file.language}' for JVM parser in file '${file.path}'.`,
    );
    return emptyModel(file, normalizedPath, isKotlin, warnings);
  }

  const content = file.content ?? "";
  if (content.includes("\u0000")) {
    warnings.push(
      `File '${file.path}' appears unreadable (contains null bytes); parser will continue with best-effort analysis.`,
    );
  }

  const strippedContent = stripCommentsPreservingLayout(content, {
    tripleQuotedStrings: true,
    nestedBlockComments: isKotlin,
  });
  const lines = strippedContent.split(/\r?\n/);

  const imports: JvmImportEntry[] = [];
  const types: JvmTypeEntry[] = [];
  const methods: JvmMethodEntry[] = [];

  let packageName: string | undefined;
  let currentType: string | undefined;
  let pendingAnnotations: JvmAnnotationEntry[] = [];

  const toLocation = (startLine: number, endLine: number): SourceLocation => ({
    filePath: file.path,
    startLine,
    endLine,
  });

  const typeRegex = isKotlin ? KOTLIN_TYPE_REGEX : JAVA_TYPE_REGEX;

  for (let i = 0; i < lines.length; i += 1) {
    let text = (lines[i] ?? "").trim();
    // The line an annotation's arguments finished on; declarations on that
    // same line still belong to `i`'s pending annotations.
    let declarationLineIndex = i;
    if (!text) continue;

    // Annotations may sit on their own line, wrap across several, or share a
    // line with the member they decorate.
    while (text.startsWith("@")) {
      const consumed = consumeAnnotation(lines, declarationLineIndex, text);
      if (!consumed) break;

      pendingAnnotations.push(consumed.annotation);
      text = consumed.rest;
      declarationLineIndex = consumed.endIndex;
      i = consumed.endIndex;
    }
    if (!text) continue;

    const lineNumber = declarationLineIndex + 1;

    if (!packageName) {
      const packageMatch = text.match(PACKAGE_REGEX);
      if (packageMatch) {
        packageName = packageMatch[1];
        pendingAnnotations = [];
        continue;
      }
    }

    const importMatch = text.match(IMPORT_REGEX);
    if (importMatch) {
      const raw = importMatch[2];
      const isWildcard = raw.endsWith("*");
      imports.push({
        qualifiedName: raw.replace(/\.?\*$/, ""),
        alias: importMatch[3],
        isStatic: Boolean(importMatch[1]),
        isWildcard,
        location: toLocation(lineNumber, lineNumber),
      });
      pendingAnnotations = [];
      continue;
    }

    const typeMatch = text.match(typeRegex);
    if (typeMatch) {
      const name = typeMatch[2];
      currentType = name;

      types.push({
        name,
        kind: normalizeTypeKind(typeMatch[1]),
        baseTypes: isKotlin ? kotlinBaseTypes(text) : javaBaseTypes(text),
        annotations: pendingAnnotations,
        location: toLocation(lineNumber, lineNumber),
      });

      pendingAnnotations = [];
      continue;
    }

    const methodMatch = isKotlin
      ? text.match(KOTLIN_FUNCTION_REGEX)
      : matchJavaMethod(text);

    if (methodMatch) {
      methods.push({
        name: methodMatch[1],
        annotations: pendingAnnotations,
        declaringType: currentType,
        location: toLocation(
          lineNumber,
          findMemberEndLine(lines, declarationLineIndex),
        ),
      });

      pendingAnnotations = [];
      continue;
    }

    pendingAnnotations = [];
  }

  const calls = extractCFamilyCalls(lines, { filePath: file.path });

  return {
    file,
    normalizedPath,
    strippedContent,
    isKotlin,
    packageName,
    imports,
    types,
    methods,
    calls,
    warnings,
  };
}

/**
 * Java method declarations have no leading keyword of their own — a
 * package-private `void handle()` is just a type followed by a name — so
 * statements that share that shape are rejected explicitly.
 */
function matchJavaMethod(text: string): RegExpMatchArray | null {
  const firstToken = text.match(/^([A-Za-z_]\w*)/)?.[1];
  if (firstToken && JAVA_STATEMENT_STARTERS.has(firstToken)) return null;

  const match = text.match(JAVA_METHOD_REGEX);
  if (!match) return null;

  // An assignment is a field initializer, not a declaration:
  // `private final Foo foo = new Foo(...)`.
  const beforeParen = text.slice(0, text.indexOf("("));
  if (beforeParen.includes("=")) return null;

  return match;
}

function normalizeTypeKind(raw: string): JvmTypeEntry["kind"] {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized === "interface") return "interface";
  if (normalized === "@interface" || normalized === "annotation class") {
    return "annotation";
  }
  if (normalized === "enum" || normalized === "enum class") return "enum";
  if (normalized === "record") return "record";
  if (normalized === "object") return "object";
  return "class";
}

/**
 * Walk braces forward from a declaration to find its closing line. Abstract
 * and interface methods, and Kotlin expression bodies, end on their own line.
 */
function findMemberEndLine(lines: string[], startIndex: number): number {
  const startLine = lines[startIndex] ?? "";
  const trimmed = startLine.trimEnd();
  if (trimmed.endsWith(";")) return startIndex + 1;
  if (/=\s*[^=]*$/.test(trimmed) && !trimmed.endsWith("{")) {
    return startIndex + 1;
  }

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
