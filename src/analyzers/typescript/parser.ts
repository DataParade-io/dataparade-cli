import * as nodePath from "path";
import * as ts from "typescript";

import type { FileInfo, FileLanguage, SourceLocation } from "../../core/types/file";

type ParserLanguage = Extract<FileLanguage, "typescript" | "javascript">;

export interface ImportEntry {
  moduleSpecifier: string;
  importedNames: string[];
  isTypeOnly: boolean;
  resolvedPath?: string;
  location: SourceLocation;
}

export type ExportKind = "named" | "default";

export interface FunctionEntry {
  name: string;
  isExported: boolean;
  exportKind?: ExportKind;
  location: SourceLocation;
}

export interface ParserResult {
  file: FileInfo;
  normalizedPath: string;
  language: ParserLanguage;
  imports: ImportEntry[];
  functions: FunctionEntry[];
  /**
   * Non-fatal issues encountered while parsing or indexing the file.
   * Callers should surface these as warnings, not hard failures.
   */
  warnings: string[];
}

/**
 * Normalize a file system path to a POSIX-style string (forward slashes).
 * This keeps path handling consistent across platforms.
 */
export function normalizePath(p: string): string {
  if (!p) return "";
  return p.split("\\").join("/");
}

/**
 * Build a lightweight code model for a TypeScript/JavaScript file.
 *
 * - Ensures the language is correctly inferred for TS/JS files.
 * - Indexes import statements and simple require() calls.
 * - Indexes top-level function declarations, exported functions, and basic
 *   arrow/function expressions assigned to exported variables.
 * - Surfaces parser/diagnostic issues as warnings instead of throwing.
 */
export function buildCodeModel(file: FileInfo): ParserResult {
  const warnings: string[] = [];
  const normalizedPath = normalizePath(file.path);

  const language = ensureParserLanguage(file, warnings);
  if (!language) {
    warnings.push(
      `Unsupported language '${file.language}' for TS/JS parser in file '${file.path}'.`,
    );

    // Return a minimal, non-fatal result so callers can safely continue.
    return {
      file,
      normalizedPath,
      // Fallback language is arbitrary here; callers should rely on file.language
      // and the warning above rather than this value when language is unsupported.
      language: "javascript",
      imports: [],
      functions: [],
      warnings,
    };
  }

  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      file.path,
      file.content ?? "",
      ts.ScriptTarget.Latest,
      /*setParentNodes*/ true,
      language === "typescript"
        ? ts.ScriptKind.TSX // covers .ts and .tsx
        : ts.ScriptKind.JSX, // covers .js, .jsx, .mjs, .cjs
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown parser error creating SourceFile";
    warnings.push(
      `Failed to parse '${file.path}' as ${language}: ${message}`,
    );

    return {
      file,
      normalizedPath,
      language,
      imports: [],
      functions: [],
      warnings,
    };
  }

  const diagnostics = (sourceFile as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics;

  if (diagnostics && diagnostics.length > 0) {
    const first = diagnostics[0];
    const msg = ts.flattenDiagnosticMessageText(first.messageText, " ");
    warnings.push(`Parse diagnostics in '${file.path}': ${msg}`);
  }

  const imports: ImportEntry[] = [];
  const functions: FunctionEntry[] = [];

  const toLocation = (node: ts.Node): SourceLocation => {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    return {
      filePath: file.path,
      startLine: start.line + 1,
      endLine: end.line + 1,
    };
  };

  const resolveRelativeImport = (moduleSpecifier: string): string | undefined => {
    if (!moduleSpecifier.startsWith(".")) return undefined;
    const baseDir = normalizePath(nodePath.dirname(file.path));
    const joined = normalizePath(nodePath.join(baseDir, moduleSpecifier));
    return joined;
  };

  const collectImport = (node: ts.ImportDeclaration): void => {
    const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
    const importedNames: string[] = [];

    const clause = node.importClause;
    const isTypeOnly = !!clause?.isTypeOnly;

    if (clause) {
      if (clause.name) {
        importedNames.push(clause.name.text);
      }

      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          importedNames.push(clause.namedBindings.name.text);
        } else if (ts.isNamedImports(clause.namedBindings)) {
          for (const spec of clause.namedBindings.elements) {
            importedNames.push(spec.name.text);
          }
        }
      }
    }

    imports.push({
      moduleSpecifier,
      importedNames,
      isTypeOnly,
      resolvedPath: resolveRelativeImport(moduleSpecifier),
      location: toLocation(node),
    });
  };

  const collectRequireCall = (node: ts.CallExpression): void => {
    const expression = node.expression;
    if (!ts.isIdentifier(expression) || expression.text !== "require") return;
    if (node.arguments.length === 0) return;

    const arg = node.arguments[0];
    if (!ts.isStringLiteral(arg)) return;

    const moduleSpecifier = arg.text;
    const importedNames: string[] = [];

    // Try to infer the bound identifier from a simple `const x = require("y")` pattern.
    if (
      ts.isVariableDeclaration(node.parent) &&
      ts.isIdentifier(node.parent.name)
    ) {
      importedNames.push(node.parent.name.text);
    }

    imports.push({
      moduleSpecifier,
      importedNames,
      isTypeOnly: false,
      resolvedPath: resolveRelativeImport(moduleSpecifier),
      location: toLocation(node),
    });
  };

  const hasExportModifier = (modifiers: ts.NodeArray<ts.ModifierLike> | undefined) =>
    !!modifiers?.some(
      (m) =>
        m.kind === ts.SyntaxKind.ExportKeyword ||
        m.kind === ts.SyntaxKind.DefaultKeyword,
    );

  const collectFunctionDeclaration = (node: ts.FunctionDeclaration): void => {
    const name = node.name?.text ?? "<anonymous>";
    const isExported = !!node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    const exportKind: ExportKind | undefined = node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
    )
      ? "default"
      : isExported
        ? "named"
        : undefined;

    functions.push({
      name,
      isExported,
      exportKind,
      location: toLocation(node),
    });
  };

  const collectVariableFunctions = (node: ts.VariableStatement): void => {
    const isExported = hasExportModifier(node.modifiers);

    for (const decl of node.declarationList.declarations) {
      const init = decl.initializer;
      if (
        !init ||
        (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init))
      ) {
        continue;
      }

      let name = "<anonymous>";
      if (ts.isIdentifier(decl.name)) {
        name = decl.name.text;
      }

      functions.push({
        name,
        isExported,
        exportKind: isExported ? "named" : undefined,
        location: toLocation(init),
      });
    }
  };

  const collectMethodDeclaration = (node: ts.MethodDeclaration): void => {
    let name = "<anonymous>";
    if (ts.isIdentifier(node.name)) {
      name = node.name.text;
    }

    const parent = node.parent;
    const parentIsExported =
      ts.isClassDeclaration(parent) && hasExportModifier(parent.modifiers);

    functions.push({
      name,
      isExported: parentIsExported,
      exportKind: parentIsExported ? "named" : undefined,
      location: toLocation(node),
    });
  };

  const collectExportAssignment = (node: ts.ExportAssignment): void => {
    const expr = node.expression;
    if (!ts.isFunctionExpression(expr) && !ts.isArrowFunction(expr)) return;

    const name = "<anonymous>";
    functions.push({
      name,
      isExported: true,
      exportKind: "default",
      location: toLocation(expr),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      collectImport(node);
    } else if (ts.isCallExpression(node)) {
      collectRequireCall(node);
    } else if (ts.isFunctionDeclaration(node)) {
      collectFunctionDeclaration(node);
    } else if (ts.isVariableStatement(node)) {
      collectVariableFunctions(node);
    } else if (ts.isMethodDeclaration(node)) {
      collectMethodDeclaration(node);
    } else if (ts.isExportAssignment(node)) {
      collectExportAssignment(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return {
    file,
    normalizedPath,
    language,
    imports,
    functions,
    warnings,
  };
}

function ensureParserLanguage(
  file: FileInfo,
  warnings: string[],
): ParserLanguage | undefined {
  const ext = nodePath.extname(file.name || file.path).toLowerCase();

  let fromExtension: ParserLanguage | undefined;
  if (ext === ".ts" || ext === ".tsx") {
    fromExtension = "typescript";
  } else if (
    ext === ".js" ||
    ext === ".jsx" ||
    ext === ".mjs" ||
    ext === ".cjs"
  ) {
    fromExtension = "javascript";
  }

  if (!fromExtension) {
    if (file.language === "typescript" || file.language === "javascript") {
      return file.language;
    }
    return undefined;
  }

  if (file.language !== fromExtension) {
    warnings.push(
      `File language '${file.language}' adjusted to '${fromExtension}' based on extension '${ext}' for '${file.path}'.`,
    );
  }

  return fromExtension;
}

