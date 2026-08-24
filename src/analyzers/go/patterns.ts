import type { RawFinding } from "../../core/types/detection";
import { matchPatterns, type ImportLike } from "../../patterns/engine";
import type { GoSourceFileModel } from "./parser";

/**
 * Represent a Go import as a language-agnostic import.
 *
 * Go import paths are already lowercase URLs (`github.com/getsentry/sentry-go`),
 * which is exactly the shape the shared third-party catalog matches its
 * lowercase fragments against — no case juggling needed. The trailing path
 * segments are carried as names so `sentry-go` and `sentry` both resolve.
 */
function importsForEngine(model: GoSourceFileModel): ImportLike[] {
  return model.imports.map((entry) => {
    const importPath = entry.path;
    const segments = importPath.split("/").filter(Boolean);
    const names = Array.from(
      new Set([
        importPath,
        ...segments,
        ...(entry.alias ? [entry.alias] : []),
      ]),
    ).filter(Boolean);

    return { module: importPath, names };
  });
}

export function detectGoPatternsFromModel(
  model: GoSourceFileModel,
): RawFinding[] {
  return matchPatterns({
    language: "go",
    file: model.file,
    normalizedPath: model.normalizedPath,
    strippedContent: model.strippedContent,
    imports: importsForEngine(model),
    functions: model.functions.map((fn) => ({
      name: fn.name,
      decorators: [],
      location: fn.location,
    })),
    types: model.types.map((type) => ({
      name: type.name,
      kind: type.kind,
      baseTypes: [],
      decorators: [],
      location: type.location,
    })),
    moduleLevelCalls: model.calls.map((call) => ({
      callee: call.callee,
      argumentsSnippet: call.argumentsSnippet,
      location: call.location,
    })),
  });
}
