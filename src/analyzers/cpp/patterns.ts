import type { RawFinding } from "../../core/types/detection";
import { matchPatterns, type ImportLike } from "../../patterns/engine";
import type { CppTranslationUnitModel } from "./parser";

/**
 * Represent an `#include` as a language-agnostic import so the shared
 * third-party service catalog (which matches lowercase fragments) can see
 * both the header path as written and its normalized segments.
 */
function includesAsImports(model: CppTranslationUnitModel): ImportLike[] {
  return model.includes.map((include) => {
    const header = include.header;
    const lower = header.toLowerCase();
    const segments = lower.split("/").filter(Boolean);
    const names = Array.from(
      new Set([header, lower, ...segments, segments[0] ?? ""]),
    ).filter(Boolean);

    return { module: header, names };
  });
}

export function detectCppPatternsFromModel(
  model: CppTranslationUnitModel,
): RawFinding[] {
  return matchPatterns({
    language: "cpp",
    file: model.file,
    normalizedPath: model.normalizedPath,
    strippedContent: model.strippedContent,
    imports: includesAsImports(model),
    functions: model.functions.map((fn) => ({
      name: fn.name,
      decorators: [],
      location: fn.location,
    })),
    moduleLevelCalls: model.calls.map((call) => ({
      callee: call.callee,
      argumentsSnippet: call.argumentsSnippet,
      location: call.location,
    })),
  });
}
