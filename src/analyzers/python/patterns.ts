import type { RawFinding } from "../../core/types/detection";
import type { PythonModuleModel } from "./parser";
import {
  matchPatterns,
  type ImportLike,
  type PatternContext,
} from "../../patterns/engine";

function buildPythonPatternContext(
  moduleModel: PythonModuleModel,
): PatternContext {
  const { file, imports, functions, normalizedPath, strippedContent } =
    moduleModel;

  const importsForEngine: ImportLike[] = imports.map((imp) => ({
    module: imp.module,
    names: imp.names,
  }));

  return {
    language: "python",
    file,
    imports: importsForEngine,
    strippedContent,
    normalizedPath,
    functions: functions.map((fn) => ({
      name: fn.name,
      decorators: fn.decorators,
      location: fn.location,
    })),
    moduleLevelCalls: moduleModel.moduleLevelCalls.map((call) => ({
      callee: call.callee,
      argumentsSnippet: call.argumentsSnippet,
      location: call.location,
    })),
  };
}

export function detectPythonRoutePatterns(
  moduleModel: PythonModuleModel,
): RawFinding[] {
  return matchPatterns(buildPythonPatternContext(moduleModel)).filter(
    (f) => f.pattern === "express_route",
  );
}

export function detectPythonDatabaseConnections(
  moduleModel: PythonModuleModel,
): RawFinding[] {
  return matchPatterns(buildPythonPatternContext(moduleModel)).filter(
    (f) => f.pattern === "database_connection",
  );
}

export function detectPythonExternalApiCalls(
  moduleModel: PythonModuleModel,
): RawFinding[] {
  return matchPatterns(buildPythonPatternContext(moduleModel)).filter(
    (f) => f.pattern === "external_api_call",
  );
}

export function detectPythonAuthPatterns(
  moduleModel: PythonModuleModel,
): RawFinding[] {
  return matchPatterns(buildPythonPatternContext(moduleModel)).filter(
    (f) => f.pattern === "auth_middleware",
  );
}

export function detectPythonConfigAndEnvUsage(
  moduleModel: PythonModuleModel,
): RawFinding[] {
  return matchPatterns(buildPythonPatternContext(moduleModel)).filter(
    (f) => f.pattern === "env_variable" || f.pattern === "config_file",
  );
}

export function detectPythonServerlessHandlers(
  moduleModel: PythonModuleModel,
): RawFinding[] {
  return matchPatterns(buildPythonPatternContext(moduleModel)).filter(
    (f) => f.pattern === "lambda_handler",
  );
}
