import type { FileInfo, SourceLocation } from "../../core/types/file";
import type { RawFinding, PatternId } from "../../core/types/detection";
import type {
  PythonFunctionEntry,
  PythonImportEntry,
  PythonModuleLevelCallEntry,
  PythonModuleModel,
} from "./parser";
import {
  matchPatterns,
  type ImportLike,
} from "../../patterns/engine";

function createLocation(
  filePath: string,
  startLine: number,
  endLine?: number,
  code?: string,
): SourceLocation {
  return {
    filePath,
    startLine,
    endLine: endLine ?? startLine,
    code,
  };
}

function createFinding(params: {
  pattern: PatternId;
  name: string;
  confidence: number;
  location: SourceLocation;
  properties?: Record<string, unknown>;
}): RawFinding {
  return {
    pattern: params.pattern,
    name: params.name,
    confidence: params.confidence,
    location: params.location,
    properties: params.properties ?? {},
  };
}

function hasImportModule(
  imports: PythonImportEntry[],
  predicate: (module: string) => boolean,
): boolean {
  return imports.some((imp) => predicate(imp.module));
}

function hasImportedName(
  imports: PythonImportEntry[],
  name: string,
): boolean {
  return imports.some((imp) => imp.names.includes(name));
}

function functionHasDecorator(
  fn: PythonFunctionEntry,
  predicate: (decorator: string) => boolean,
): boolean {
  return fn.decorators.some((dec) => predicate(dec));
}

export function detectPythonRoutePatterns(
  moduleModel: PythonModuleModel,
): RawFinding[] {
  const { file, imports, functions, normalizedPath } = moduleModel;

  const importsForEngine: ImportLike[] = imports.map((imp) => ({
    module: imp.module,
    names: imp.names,
  }));

  return matchPatterns({
    language: "python",
    file,
    imports: importsForEngine,
    functions: functions.map((fn) => ({
      name: fn.name,
      decorators: fn.decorators,
      location: fn.location,
    })),
    normalizedPath,
  }).filter((f) => f.pattern === "express_route");
}

export function detectPythonDatabaseConnections(
  moduleModel: PythonModuleModel,
): RawFinding[] {
  const { file, imports } = moduleModel;

  const importsForEngine: ImportLike[] = imports.map((imp) => ({
    module: imp.module,
    names: imp.names,
  }));

  return matchPatterns({
    language: "python",
    file,
    imports: importsForEngine,
  }).filter((f) => f.pattern === "database_connection");
}

export function detectPythonExternalApiCalls(
  moduleModel: PythonModuleModel,
): RawFinding[] {
  const { file, imports, moduleLevelCalls } = moduleModel;

  const importsForEngine: ImportLike[] = imports.map((imp) => ({
    module: imp.module,
    names: imp.names,
  }));

  return matchPatterns({
    language: "python",
    file,
    imports: importsForEngine,
    moduleLevelCalls: moduleLevelCalls.map((call) => ({
      callee: call.callee,
      argumentsSnippet: call.argumentsSnippet,
      location: call.location,
    })),
  }).filter((f) => f.pattern === "external_api_call");
}

export function detectPythonAuthPatterns(
  moduleModel: PythonModuleModel,
): RawFinding[] {
  const { file, imports } = moduleModel;

  const importsForEngine: ImportLike[] = imports.map((imp) => ({
    module: imp.module,
    names: imp.names,
  }));

  return matchPatterns({
    language: "python",
    file,
    imports: importsForEngine,
  }).filter((f) => f.pattern === "auth_middleware");
}

export function detectPythonConfigAndEnvUsage(
  moduleModel: PythonModuleModel,
): RawFinding[] {
  const { file, imports } = moduleModel;

  const importsForEngine: ImportLike[] = imports.map((imp) => ({
    module: imp.module,
    names: imp.names,
  }));

  return matchPatterns({
    language: "python",
    file,
    imports: importsForEngine,
  }).filter(
    (f) =>
      f.pattern === "env_variable" ||
      f.pattern === "config_file",
  );
}

