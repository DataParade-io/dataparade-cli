import type { RawFinding } from "../../core/types/detection";
import { matchPatterns, type ImportLike } from "../../patterns/engine";
import type { JvmAnnotationEntry, JvmSourceFileModel } from "./parser";

/**
 * Represent a JVM import as a language-agnostic import.
 *
 * The shared third-party catalog matches lowercase fragments (`stripe`,
 * `sendgrid`) while JVM fully-qualified names mix cases
 * (`com.stripe.StripeClient`), so the lowercased forms are carried alongside
 * the segments.
 */
function importsForEngine(model: JvmSourceFileModel): ImportLike[] {
  return model.imports.map((entry) => {
    const qualifiedName = entry.qualifiedName;
    const segments = qualifiedName.split(".").filter(Boolean);
    const names = Array.from(
      new Set([
        qualifiedName,
        qualifiedName.toLowerCase(),
        ...segments,
        ...segments.map((segment) => segment.toLowerCase()),
        ...(entry.alias ? [entry.alias] : []),
      ]),
    ).filter(Boolean);

    return { module: qualifiedName, names };
  });
}

/**
 * Annotations are carried as decorator strings, both with and without their
 * argument list: `GetMapping("/{id}")` and `GetMapping`.
 */
function annotationsAsDecorators(annotations: JvmAnnotationEntry[]): string[] {
  const decorators = new Set<string>();
  for (const annotation of annotations) {
    decorators.add(annotation.raw);
    decorators.add(annotation.name);
  }
  return Array.from(decorators);
}

export function detectJvmPatternsFromModel(
  model: JvmSourceFileModel,
): RawFinding[] {
  return matchPatterns({
    language: model.file.language,
    file: model.file,
    normalizedPath: model.normalizedPath,
    strippedContent: model.strippedContent,
    imports: importsForEngine(model),
    functions: model.methods.map((method) => ({
      name: method.name,
      decorators: annotationsAsDecorators(method.annotations),
      location: method.location,
    })),
    types: model.types.map((type) => ({
      name: type.name,
      kind: type.kind,
      baseTypes: type.baseTypes,
      decorators: annotationsAsDecorators(type.annotations),
      location: type.location,
    })),
    moduleLevelCalls: model.calls.map((call) => ({
      callee: call.callee,
      argumentsSnippet: call.argumentsSnippet,
      location: call.location,
    })),
  });
}
