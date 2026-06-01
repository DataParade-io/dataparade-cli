import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import type { ParserResult } from "./parser";
import { matchPatterns, type ImportLike } from "../../patterns/engine";

export function detectExternalApiCalls(
  file: FileInfo,
  model: ParserResult,
): RawFinding[] {
  const importsForEngine: ImportLike[] = model.imports.map((imp) => ({
    module: imp.moduleSpecifier,
    names: imp.importedNames,
  }));

  return matchPatterns({
    language: model.language,
    file,
    imports: importsForEngine,
    includeThirdPartyHttpLinePatterns: true,
  }).filter((f) => f.pattern === "external_api_call");
}
