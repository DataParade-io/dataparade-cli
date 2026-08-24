import * as nodePath from "path";

import type { FileInfo, SourceLocation } from "../../core/types/file";
import {
  extractCFamilyCalls,
  type CFamilyCallEntry,
} from "../shared/c-family-calls";
import { stripCommentsPreservingLayout } from "../shared/strip-comments";

export interface CSharpUsingEntry {
  /** Namespace as written, e.g. `Microsoft.AspNetCore.Mvc`. */
  namespace: string;
  /** Alias target for `using Foo = Bar.Baz;`. */
  alias?: string;
  isStatic: boolean;
  isGlobal: boolean;
  location: SourceLocation;
}

export interface CSharpAttributeEntry {
  /** Attribute name without the `Attribute` suffix, e.g. `HttpGet`. */
  name: string;
  /** Argument list as written, e.g. `"users/{id}"`. */
  argumentsSnippet: string;
  /** Full attribute text, e.g. `HttpGet("users/{id}")`. */
  raw: string;
}

export interface CSharpTypeEntry {
  name: string;
  kind: "class" | "interface" | "record" | "struct" | "enum";
  baseTypes: string[];
  attributes: CSharpAttributeEntry[];
  location: SourceLocation;
}

export interface CSharpMethodEntry {
  name: string;
  isAsync: boolean;
  attributes: CSharpAttributeEntry[];
  /** Enclosing type name when the method is inside one. */
  declaringType?: string;
  location: SourceLocation;
}

export type CSharpCallEntry = CFamilyCallEntry;

export interface CSharpCompilationUnitModel {
  file: FileInfo;
  normalizedPath: string;
  /** Source with comments blanked out; line/column offsets are preserved. */
  strippedContent: string;
  namespaceName?: string;
  usings: CSharpUsingEntry[];
  types: CSharpTypeEntry[];
  methods: CSharpMethodEntry[];
  calls: CSharpCallEntry[];
  warnings: string[];
}

const USING_REGEX =
  /^(global\s+)?using\s+(static\s+)?([A-Za-z_][\w.]*)(?:\s*=\s*([A-Za-z_][\w.<>,\s]*))?\s*;/;
const NAMESPACE_REGEX = /^namespace\s+([A-Za-z_][\w.]*)/;
const TYPE_REGEX =
  /^(?:(?:public|internal|private|protected|abstract|sealed|static|partial|readonly|unsafe)\s+)*(class|interface|record\s+class|record\s+struct|record|struct|enum)\s+([A-Za-z_]\w*)(?:\s*<[^>]*>)?\s*(?::\s*([^{]+))?/;
const METHOD_REGEX =
  /^(?:(?:public|private|protected|internal|static|async|virtual|override|sealed|partial|extern|unsafe|new)\s+)+(?:[A-Za-z_][\w<>,.\[\]?\s]*\s+)?([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/;
const ATTRIBUTE_ENTRY_REGEX = /([A-Za-z_][\w.]*)\s*(\([^)]*\))?/g;

/**
 * Split a leading `[...]` attribute group off a line, returning its contents
 * and whatever follows. Brackets are counted and string literals skipped, so
 * route templates such as `[Route("api/[controller]")]` stay intact.
 */
function splitLeadingAttributeGroup(
  text: string,
): { inner: string; rest: string } | null {
  if (!text.startsWith("[")) return null;

  let depth = 0;
  let inString = false;
  let quote = "";

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (char === "\\") {
        i += 1;
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

    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return { inner: text.slice(1, i), rest: text.slice(i + 1).trim() };
      }
    }
  }

  return null;
}

/** Attribute-looking lines that are not member attributes. */
const NON_ATTRIBUTE_PREFIXES = ["assembly:", "module:", "return:"];

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

function parseAttributeList(inner: string): CSharpAttributeEntry[] {
  const trimmed = inner.trim();
  if (!trimmed) return [];
  if (
    NON_ATTRIBUTE_PREFIXES.some((prefix) =>
      trimmed.toLowerCase().startsWith(prefix),
    )
  ) {
    return [];
  }

  const attributes: CSharpAttributeEntry[] = [];
  ATTRIBUTE_ENTRY_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ATTRIBUTE_ENTRY_REGEX.exec(trimmed)) !== null) {
    const name = match[1];
    if (!name) continue;

    const argsWithParens = match[2] ?? "";
    const argumentsSnippet = argsWithParens.slice(1, -1);

    attributes.push({
      name: name.replace(/Attribute$/, ""),
      argumentsSnippet,
      raw: `${name}${argsWithParens}`,
    });
  }

  return attributes;
}

function emptyModel(
  file: FileInfo,
  normalizedPath: string,
  warnings: string[],
): CSharpCompilationUnitModel {
  return {
    file,
    normalizedPath,
    strippedContent: "",
    usings: [],
    types: [],
    methods: [],
    calls: [],
    warnings,
  };
}

export function parseCSharpCompilationUnit(
  file: FileInfo,
): CSharpCompilationUnitModel {
  const warnings: string[] = [];
  const normalizedPath = normalizePath(file.path);

  if (file.language !== "csharp") {
    warnings.push(
      `Unsupported language '${file.language}' for C# parser in file '${file.path}'.`,
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
    verbatimStrings: true,
  });
  const lines = strippedContent.split(/\r?\n/);

  const usings: CSharpUsingEntry[] = [];
  const types: CSharpTypeEntry[] = [];
  const methods: CSharpMethodEntry[] = [];

  let namespaceName: string | undefined;
  let currentType: string | undefined;
  let pendingAttributes: CSharpAttributeEntry[] = [];

  const toLocation = (startLine: number, endLine: number): SourceLocation => ({
    filePath: file.path,
    startLine,
    endLine,
  });

  for (let i = 0; i < lines.length; i += 1) {
    let text = (lines[i] ?? "").trim();
    const lineNumber = i + 1;
    if (!text) continue;

    // Attributes may sit on their own line or share a line with the member
    // they decorate: `[HttpGet("{id}")] public IActionResult Get(int id)`.
    let attributeGroup = splitLeadingAttributeGroup(text);
    while (attributeGroup) {
      pendingAttributes.push(...parseAttributeList(attributeGroup.inner));
      text = attributeGroup.rest;
      attributeGroup = text ? splitLeadingAttributeGroup(text) : null;
    }
    if (!text) continue;

    const usingMatch = text.match(USING_REGEX);
    if (usingMatch) {
      const isAlias = Boolean(usingMatch[4]);
      usings.push({
        namespace: isAlias ? usingMatch[4]!.trim() : usingMatch[3],
        alias: isAlias ? usingMatch[3] : undefined,
        isStatic: Boolean(usingMatch[2]),
        isGlobal: Boolean(usingMatch[1]),
        location: toLocation(lineNumber, lineNumber),
      });
      pendingAttributes = [];
      continue;
    }

    const namespaceMatch = text.match(NAMESPACE_REGEX);
    if (namespaceMatch) {
      namespaceName = namespaceMatch[1];
      pendingAttributes = [];
      continue;
    }

    const typeMatch = text.match(TYPE_REGEX);
    if (typeMatch) {
      const baseTypes = (typeMatch[3] ?? "")
        .split(",")
        .map((base) => base.trim())
        .filter(Boolean);

      const name = typeMatch[2];
      currentType = name;

      types.push({
        name,
        kind: normalizeTypeKind(typeMatch[1]),
        baseTypes,
        attributes: pendingAttributes,
        location: toLocation(lineNumber, lineNumber),
      });

      pendingAttributes = [];
      continue;
    }

    const methodMatch = text.match(METHOD_REGEX);
    if (methodMatch) {
      const name = methodMatch[1];

      methods.push({
        name,
        isAsync: /\basync\b/.test(text),
        attributes: pendingAttributes,
        declaringType: currentType,
        location: toLocation(lineNumber, findMethodEndLine(lines, i)),
      });

      pendingAttributes = [];
      continue;
    }

    pendingAttributes = [];
  }

  const calls = extractCFamilyCalls(lines, { filePath: file.path });

  return {
    file,
    normalizedPath,
    strippedContent,
    namespaceName,
    usings,
    types,
    methods,
    calls,
    warnings,
  };
}

function normalizeTypeKind(raw: string): CSharpTypeEntry["kind"] {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.startsWith("record")) return "record";
  if (normalized === "interface") return "interface";
  if (normalized === "struct") return "struct";
  if (normalized === "enum") return "enum";
  return "class";
}

/**
 * Walk braces forward from a method signature to find its closing line.
 * Expression-bodied members (`=> Ok();`) end on their own line.
 */
function findMethodEndLine(lines: string[], startIndex: number): number {
  const startLine = lines[startIndex] ?? "";
  if (/=>/.test(startLine) && startLine.trimEnd().endsWith(";")) {
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
