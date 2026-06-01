import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import type { ParserResult } from "./parser";
import { detectExternalApiCalls as detectExternalApiCallsFromThirdParty } from "./third-party-detection";
import {
  matchPatterns,
  type ImportLike,
} from "../../patterns/engine";

type TsPatternDetector = (file: FileInfo, model: ParserResult) => RawFinding[];

function toImportLikes(model: ParserResult): ImportLike[] {
  return model.imports.map((imp) => ({
    module: imp.moduleSpecifier,
    names: imp.importedNames,
  }));
}

export const detectRoutePatterns: TsPatternDetector = (file, model) => {
  const importsForEngine = toImportLikes(model);
  const allFindings = matchPatterns({
    language: model.language,
    file,
    imports: importsForEngine,
    normalizedPath: model.normalizedPath,
  });

  return allFindings.filter((f) => f.pattern === "express_route");
};

export const detectDatabaseConnections: TsPatternDetector = (file, model) => {
  const importsForEngine = toImportLikes(model);
  const allFindings = matchPatterns({
    language: model.language,
    file,
    imports: importsForEngine,
    normalizedPath: model.normalizedPath,
  });

  return allFindings.filter((f) => f.pattern === "database_connection");
};

export const detectExternalApiCalls: TsPatternDetector = (file, model) =>
  detectExternalApiCallsFromThirdParty(file, model);

export const detectAuthMiddleware: TsPatternDetector = (file, model) => {
  const importsForEngine = toImportLikes(model);
  const allFindings = matchPatterns({
    language: model.language,
    file,
    imports: importsForEngine,
    normalizedPath: model.normalizedPath,
  });

  return allFindings.filter((f) => f.pattern === "auth_middleware");
};

export const detectConfigAndEnvUsage: TsPatternDetector = (file, model) => {
  const importsForEngine = toImportLikes(model);
  const allFindings = matchPatterns({
    language: model.language,
    file,
    imports: importsForEngine,
    normalizedPath: model.normalizedPath,
  });

  return allFindings.filter(
    (f) => f.pattern === "env_variable" || f.pattern === "config_file",
  );
};

