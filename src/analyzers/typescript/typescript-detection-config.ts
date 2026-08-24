import fs from "fs";
import path from "path";
import YAML from "yaml";

import {
  type PatternId,
  PATTERN_IDS,
} from "../../core/types/detection";

/** Shared shape for raw YAML entries: patternId + optional confidence (default 0.8). */
interface RawWithPatternId {
  patternId: PatternId | string;
  confidence?: number;
}

interface RawRouteFrameworkConfig extends RawWithPatternId {
  id: string;
  imports: string[];
  routeCallRegexes?: string[];
  controllerDecoratorRegexes?: string[];
  routeDecoratorRegexes?: string[];
  routeRegexes?: Array<{
    regex: string;
    methodGroup?: number;
    pathGroup?: number;
    defaultMethod?: string;
  }>;
}

interface RawDbClientConfig extends RawWithPatternId {
  id: string;
  databaseType: string;
  importModules: string[];
  /** Regexes that match client/connection creation (e.g. new Pool(), mongoose.connect). */
  regexes?: string[];
}

interface RawAuthLibraryConfig extends RawWithPatternId {
  id: string;
  importFragments?: string[];
  /** Regexes that match auth usage (e.g. passport.authenticate("jwt")). */
  regexes?: string[];
  contentRegexes?: string[];
  strategy?: string;
}

interface RawServerlessHandlerConfig extends RawWithPatternId {
  id: string;
  importModules?: string[];
  handlerRegexes?: string[];
  typeNames?: string[];
}

interface RawExternalApiClientConfig extends RawWithPatternId {
  id: string;
  clientName: string;
  importFragments?: string[];
  regexes?: string[];
}

interface RawConfigLoaderConfig extends RawWithPatternId {
  id: string;
  importFragments?: string[];
  regexes?: string[];
  name?: string;
}

interface RawConfigKeyConfig extends RawWithPatternId {
  name: string;
}

interface RawHeuristicsConfig {
  processEnv?: { regex?: string; confidence?: number };
  sqlKeyword?: {
    regex?: string;
    patternId?: PatternId | string;
    confidence?: number;
  };
  nextRouteHandler?: { regex?: string; confidence?: number };
  /** Matches config.<identifier>; which keys to report come from config_keys.keys. */
  configKeyAccess?: { regex?: string };
}

interface RawTypeScriptPatternConfig {
  routes?: {
    frameworks?: RawRouteFrameworkConfig[];
  };
  db_clients?: RawDbClientConfig[];
  auth?: {
    libraries?: RawAuthLibraryConfig[];
  };
  serverless?: {
    handlers?: RawServerlessHandlerConfig[];
  };
  external_apis?: {
    httpClients?: RawExternalApiClientConfig[];
  };
  config_loaders?: RawConfigLoaderConfig[];
  heuristics?: RawHeuristicsConfig;
  env_variables?: {
    importantKeys?: string[];
  };
  config_keys?: {
    keys?: RawConfigKeyConfig[];
  };
}

/** Normalized config entries (after validation); patternId is guaranteed valid. */
export interface WithPatternId {
  patternId: PatternId;
}

/** Default confidence when not specified in YAML. */
const DEFAULT_CONFIDENCE = 0.8;

export interface RouteRegexConfig {
  regex: RegExp;
  methodGroup?: number;
  pathGroup?: number;
  defaultMethod?: string;
}

export interface RouteFrameworkConfig extends WithPatternId {
  id: string;
  imports: string[];
  routeCallRegexes: RegExp[];
  controllerDecoratorRegexes: RegExp[];
  routeDecoratorRegexes: RegExp[];
  routeRegexes: RouteRegexConfig[];
  confidence: number;
}

export interface DbClientConfig extends WithPatternId {
  id: string;
  databaseType: string;
  importModules: string[];
  creationRegexes: RegExp[];
  /** Confidence when a creation regex matches; import-only uses confidence - 0.2 (min 0.5). */
  confidence: number;
}

export interface AuthLibraryConfig extends WithPatternId {
  id: string;
  importFragments: string[];
  callRegexes: RegExp[];
  contentRegexes: RegExp[];
  strategy?: string;
  confidence: number;
}

export interface ServerlessHandlerConfig extends WithPatternId {
  id: string;
  importModules: string[];
  handlerRegexes: RegExp[];
  typeNames: string[];
  confidence: number;
}

export interface ExternalApiClientConfig extends WithPatternId {
  id: string;
  clientName: string;
  importFragments: string[];
  callRegexes: RegExp[];
  confidence: number;
}

export interface ConfigLoaderConfig extends WithPatternId {
  id: string;
  importFragments: string[];
  callRegexes: RegExp[];
  name: string;
  confidence: number;
}

export interface ConfigKeyConfig extends WithPatternId {
  name: string;
  confidence: number;
}

export interface HeuristicsConfig {
  processEnv: { regex: RegExp; confidence: number };
  sqlKeyword: {
    regex: RegExp;
    patternId: PatternId;
    confidence: number;
  };
  nextRouteHandler: { regex: RegExp; confidence: number };
  configKeyAccess: { regex: RegExp };
}

export interface TypeScriptPatternConfig {
  routes: {
    frameworks: RouteFrameworkConfig[];
  };
  dbClients: DbClientConfig[];
  auth: {
    libraries: AuthLibraryConfig[];
  };
  serverless: {
    handlers: ServerlessHandlerConfig[];
  };
  externalApis: {
    httpClients: ExternalApiClientConfig[];
  };
  configLoaders: ConfigLoaderConfig[];
  heuristics: HeuristicsConfig;
  envVariables: {
    importantKeys: string[];
  };
  configKeys: {
    keys: ConfigKeyConfig[];
  };
}

function validatePatternId(
  rawValue: unknown,
  context: string,
): PatternId {
  const id = String(rawValue);
  if (!PATTERN_IDS.includes(id as PatternId)) {
    throw new Error(`Invalid patternId '${rawValue}' in ${context}`);
  }
  return id as PatternId;
}

function compileRegex(pattern: string, flags?: string): RegExp {
  try {
    return new RegExp(pattern, flags ?? "");
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown regex compilation error";
    throw new Error(`Invalid regex pattern '${pattern}': ${message}`);
  }
}

function compileRegexList(patterns: string[] | undefined): RegExp[] {
  if (!patterns || patterns.length === 0) {
    return [];
  }
  return patterns.map((p) => compileRegex(p));
}

function normalizeRawConfig(raw: RawTypeScriptPatternConfig): TypeScriptPatternConfig {
  const frameworks: RouteFrameworkConfig[] =
    raw.routes?.frameworks?.map((fw) => {
      const patternId = validatePatternId(
        fw.patternId,
        `routes.frameworks entry '${fw.id}'`,
      );
      return {
        id: fw.id,
        patternId,
        imports: fw.imports ?? [],
        routeCallRegexes: compileRegexList(fw.routeCallRegexes),
        controllerDecoratorRegexes: compileRegexList(
          fw.controllerDecoratorRegexes,
        ),
        routeDecoratorRegexes: compileRegexList(fw.routeDecoratorRegexes),
        routeRegexes:
          fw.routeRegexes?.map((entry) => ({
            regex: compileRegex(entry.regex),
            methodGroup: entry.methodGroup,
            pathGroup: entry.pathGroup,
            defaultMethod: entry.defaultMethod,
          })) ?? [],
        confidence: fw.confidence ?? DEFAULT_CONFIDENCE,
      };
    }) ?? [];

  const dbClients: DbClientConfig[] =
    raw.db_clients?.map((c) => {
      const patternId = validatePatternId(
        c.patternId,
        `db_clients entry '${c.id}'`,
      );
      return {
        id: c.id,
        patternId,
        databaseType: c.databaseType,
        importModules: c.importModules ?? [],
        creationRegexes: compileRegexList(c.regexes),
        confidence: c.confidence ?? DEFAULT_CONFIDENCE,
      };
    }) ?? [];

  const authLibraries: AuthLibraryConfig[] =
    raw.auth?.libraries?.map((lib) => {
      const patternId = validatePatternId(
        lib.patternId,
        `auth.libraries entry '${lib.id}'`,
      );
      return {
        id: lib.id,
        patternId,
        importFragments: lib.importFragments ?? [],
        callRegexes: compileRegexList(lib.regexes),
        contentRegexes: compileRegexList(lib.contentRegexes),
        strategy: lib.strategy,
        confidence: lib.confidence ?? DEFAULT_CONFIDENCE,
      };
    }) ?? [];

  const serverlessHandlers: ServerlessHandlerConfig[] =
    raw.serverless?.handlers?.map((handler) => {
      const patternId = validatePatternId(
        handler.patternId,
        `serverless.handlers entry '${handler.id}'`,
      );
      return {
        id: handler.id,
        patternId,
        importModules: handler.importModules ?? [],
        handlerRegexes: compileRegexList(handler.handlerRegexes),
        typeNames: handler.typeNames ?? [],
        confidence: handler.confidence ?? DEFAULT_CONFIDENCE,
      };
    }) ?? [];

  const externalHttpClients: ExternalApiClientConfig[] =
    raw.external_apis?.httpClients?.map((client) => {
      const patternId = validatePatternId(
        client.patternId,
        `external_apis.httpClients entry '${client.id}'`,
      );
      return {
        id: client.id,
        patternId,
        clientName: client.clientName,
        importFragments: client.importFragments ?? [],
        callRegexes: compileRegexList(client.regexes),
        confidence: client.confidence ?? DEFAULT_CONFIDENCE,
      };
    }) ?? [];

  const configLoaders: ConfigLoaderConfig[] =
    raw.config_loaders?.map((loader) => {
      const patternId = validatePatternId(
        loader.patternId,
        `config_loaders entry '${loader.id}'`,
      );
      return {
        id: loader.id,
        patternId,
        importFragments: loader.importFragments ?? [],
        callRegexes: compileRegexList(loader.regexes),
        name: loader.name ?? loader.id,
        confidence: loader.confidence ?? DEFAULT_CONFIDENCE,
      };
    }) ?? [];

  const configKeys: ConfigKeyConfig[] =
    raw.config_keys?.keys?.map((k) => {
      const patternId = validatePatternId(
        k.patternId,
        `config_keys.keys entry '${k.name}'`,
      );
      return {
        name: k.name,
        patternId,
        confidence: k.confidence ?? DEFAULT_CONFIDENCE,
      };
    }) ?? [];

  const importantKeys: string[] =
    raw.env_variables?.importantKeys?.slice() ?? [];

  const h = raw.heuristics;
  if (!h?.processEnv?.regex || !h?.sqlKeyword?.regex || !h?.nextRouteHandler?.regex || !h?.configKeyAccess?.regex) {
    throw new Error(
      "TypeScript pattern config requires heuristics.processEnv.regex, heuristics.sqlKeyword.regex, heuristics.nextRouteHandler.regex, and heuristics.configKeyAccess.regex in the YAML file.",
    );
  }
  const processEnvRegex = compileRegex(h.processEnv.regex);
  const sqlKeywordRegex = compileRegex(h.sqlKeyword.regex, "i");
  const nextRouteHandlerRegex = compileRegex(h.nextRouteHandler.regex);
  const configKeyAccessRegex = compileRegex(h.configKeyAccess.regex);
  const sqlKeywordPatternId = h.sqlKeyword.patternId
    ? validatePatternId(h.sqlKeyword.patternId, "heuristics.sqlKeyword")
    : ("database_connection" as PatternId);

  const heuristics: HeuristicsConfig = {
    processEnv: {
      regex: processEnvRegex,
      confidence: h.processEnv.confidence ?? 0.95,
    },
    sqlKeyword: {
      regex: sqlKeywordRegex,
      patternId: sqlKeywordPatternId,
      confidence: h.sqlKeyword.confidence ?? 0.6,
    },
    nextRouteHandler: {
      regex: nextRouteHandlerRegex,
      confidence: h.nextRouteHandler.confidence ?? 0.75,
    },
    configKeyAccess: { regex: configKeyAccessRegex },
  };

  return {
    routes: {
      frameworks,
    },
    dbClients,
    auth: {
      libraries: authLibraries,
    },
    serverless: {
      handlers: serverlessHandlers,
    },
    externalApis: {
      httpClients: externalHttpClients,
    },
    configLoaders,
    heuristics,
    envVariables: {
      importantKeys,
    },
    configKeys: {
      keys: configKeys,
    },
  };
}

let cachedConfig: TypeScriptPatternConfig | undefined;

/** Clears the config cache (for tests). */
export function clearTypeScriptPatternConfigCache(): void {
  cachedConfig = undefined;
}

function getPatternsFilePath(): string {
  // During tests, this module runs from src/analyzers/typescript.
  // In the built package, it runs from dist/src/analyzers/typescript.
  // We want the CLI package root that contains the `patterns/` directory.
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");

  let cliRoot: string;
  if (distIndex !== -1) {
    // e.g. /path/to/cli/dist/src/analyzers/typescript -> /path/to/cli
    cliRoot = parts.slice(0, distIndex).join(path.sep);
  } else {
    // e.g. /path/to/cli/src/analyzers/typescript -> /path/to/cli
    cliRoot = path.resolve(__dirname, "../../..");
  }

  return path.join(cliRoot, "patterns", "typescript.patterns.yaml");
}

export function loadTypeScriptPatternConfig(): TypeScriptPatternConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const patternsPath = getPatternsFilePath();

  let raw: string;
  try {
    raw = fs.readFileSync(patternsPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `TypeScript pattern config is required but could not be read from '${patternsPath}': ${message}`,
    );
  }

  const parsed = YAML.parse(raw) as RawTypeScriptPatternConfig;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `TypeScript pattern config at '${patternsPath}' did not parse to an object.`,
    );
  }

  try {
    const normalized = normalizeRawConfig(parsed);
    cachedConfig = normalized;
    return normalized;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Invalid TypeScript pattern config at '${patternsPath}': ${message}`,
    );
  }
}

