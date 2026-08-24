import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import type { ParserResult } from "./parser";
import { stripCommentsPreservingLayout } from "../shared/strip-comments";
import {
  matchPatterns,
  type ImportLike,
  type PatternContext,
} from "../../patterns/engine";

type TsPatternDetector = (file: FileInfo, model: ParserResult) => RawFinding[];

function toImportLikes(model: ParserResult): ImportLike[] {
  return model.imports.map((imp) => ({
    module: imp.moduleSpecifier,
    names: imp.importedNames,
  }));
}

function buildPatternContext(file: FileInfo, model: ParserResult): PatternContext {
  return {
    language: model.language,
    file,
    imports: toImportLikes(model),
    normalizedPath: model.normalizedPath,
    strippedContent: stripCommentsPreservingLayout(file.content ?? "", {
      backtickStrings: true,
    }),
  };
}

export const detectRoutePatterns: TsPatternDetector = (file, model) => {
  const allFindings = matchPatterns(buildPatternContext(file, model));
  return allFindings.filter((f) => f.pattern === "express_route");
};

export const detectDatabaseConnections: TsPatternDetector = (file, model) => {
  const allFindings = matchPatterns(buildPatternContext(file, model));
  return allFindings.filter((f) => f.pattern === "database_connection");
};

export const detectExternalApiCalls: TsPatternDetector = (file, model) => {
  const allFindings = matchPatterns({
    ...buildPatternContext(file, model),
    includeThirdPartyHttpLinePatterns: true,
  });
  return allFindings.filter((f) => f.pattern === "external_api_call");
};

export const detectAuthMiddleware: TsPatternDetector = (file, model) => {
  const allFindings = matchPatterns(buildPatternContext(file, model));
  return allFindings.filter((f) => f.pattern === "auth_middleware");
};

export const detectConfigAndEnvUsage: TsPatternDetector = (file, model) => {
  const allFindings = matchPatterns(buildPatternContext(file, model));
  return allFindings.filter(
    (f) => f.pattern === "env_variable" || f.pattern === "config_file",
  );
};

export const detectServerlessHandlers: TsPatternDetector = (file, model) => {
  const allFindings = matchPatterns(buildPatternContext(file, model));
  return allFindings.filter((f) => f.pattern === "lambda_handler");
};
