import type { RawFinding } from "../../core/types/detection";
import { matchPatterns, type ImportLike } from "../../patterns/engine";
import type {
  CSharpAttributeEntry,
  CSharpCompilationUnitModel,
} from "./parser";

/**
 * Represent a `using` as a language-agnostic import. The shared third-party
 * catalog matches lowercase fragments (`stripe`, `sendgrid`), while .NET
 * namespaces are PascalCase, so the lowercased forms are carried alongside.
 */
function usingsAsImports(model: CSharpCompilationUnitModel): ImportLike[] {
  return model.usings.map((entry) => {
    const namespaceName = entry.namespace;
    const segments = namespaceName.split(".").filter(Boolean);
    const names = Array.from(
      new Set([
        namespaceName,
        namespaceName.toLowerCase(),
        ...segments,
        ...segments.map((segment) => segment.toLowerCase()),
      ]),
    ).filter(Boolean);

    return { module: namespaceName, names };
  });
}

/** Attributes are carried as decorator strings: both `HttpGet("x")` and `HttpGet`. */
function attributesAsDecorators(
  attributes: CSharpAttributeEntry[],
): string[] {
  const decorators = new Set<string>();
  for (const attribute of attributes) {
    decorators.add(attribute.raw);
    decorators.add(attribute.name);
  }
  return Array.from(decorators);
}

export function detectCSharpPatternsFromModel(
  model: CSharpCompilationUnitModel,
): RawFinding[] {
  return matchPatterns({
    language: "csharp",
    file: model.file,
    normalizedPath: model.normalizedPath,
    strippedContent: model.strippedContent,
    imports: usingsAsImports(model),
    functions: model.methods.map((method) => ({
      name: method.name,
      decorators: attributesAsDecorators(method.attributes),
      location: method.location,
    })),
    types: model.types.map((type) => ({
      name: type.name,
      kind: type.kind,
      baseTypes: type.baseTypes,
      decorators: attributesAsDecorators(type.attributes),
      location: type.location,
    })),
    moduleLevelCalls: model.calls.map((call) => ({
      callee: call.callee,
      argumentsSnippet: call.argumentsSnippet,
      location: call.location,
    })),
  });
}
