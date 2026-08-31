import type { RawFinding } from "../../core/types/detection";
import { matchPatterns, type ImportLike } from "../../patterns/engine";
import type { PhpSourceFileModel } from "./parser";

/**
 * Represent a PHP `use` / require as a language-agnostic import.
 *
 * Namespaces keep their `\` separators so PHP detectors can prefix-match.
 * Path segments and the final class name are also listed in `names` so the
 * shared third-party catalog (lowercase fragments) can still resolve them.
 */
function importsForEngine(model: PhpSourceFileModel): ImportLike[] {
  return model.imports.map((entry) => {
    const importPath = entry.path;
    const segments = importPath.split(/[\\/]/).filter(Boolean);
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

export function detectPhpPatternsFromModel(
  model: PhpSourceFileModel,
): RawFinding[] {
  return matchPatterns({
    language: "php",
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
