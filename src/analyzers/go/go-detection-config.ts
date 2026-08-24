import fs from "fs";
import path from "path";
import YAML from "yaml";

import { type PatternId, PATTERN_IDS } from "../../core/types/detection";

interface RawRouteRegex {
  regex: string;
  methodGroup?: number;
  pathGroup?: number;
  defaultMethod?: string;
}

interface RawDbClientConfig {
  id: string;
  patternId: string;
  databaseType: string;
  importPaths?: string[];
  callNames?: string[];
  confidence?: number;
}

interface RawAuthLibraryConfig {
  id: string;
  patternId: string;
  importPaths?: string[];
  callNames?: string[];
  contentRegexes?: string[];
  strategy?: string;
  confidence?: number;
}

interface RawRouteFrameworkConfig {
  id: string;
  patternId: string;
  importPaths?: string[];
  routeRegexes?: RawRouteRegex[];
  confidence?: number;
}

interface RawServerlessHandlerConfig {
  id: string;
  patternId: string;
  importPaths?: string[];
  callNames?: string[];
  confidence?: number;
}

interface RawConfigLoader {
  id: string;
  importPaths?: string[];
  callNames?: string[];
}

interface RawHttpClientConfig {
  id: string;
  patternId: string;
  clientName: string;
  importPaths?: string[];
  callNames?: string[];
  callNameSuffixes?: string[];
  urlRegex?: string;
  confidence?: number;
}

interface RawGoPatternConfig {
  db_clients?: RawDbClientConfig[];
  sql_open?: {
    patternId: string;
    regex?: string;
    name?: string;
    confidence?: number;
    drivers?: Record<string, string>;
    defaultDatabaseType?: string;
  };
  auth?: {
    libraries?: RawAuthLibraryConfig[];
  };
  routes?: {
    frameworks?: RawRouteFrameworkConfig[];
  };
  serverless?: {
    handlers?: RawServerlessHandlerConfig[];
  };
  env_config?: {
    envVariable?: {
      patternId: string;
      regex?: string;
      confidence?: number;
    };
    configLoaders?: {
      patternId: string;
      confidence?: number;
      loaders?: RawConfigLoader[];
    };
    configFile?: {
      patternId: string;
      fileNameRegex?: string;
      name?: string;
      confidence?: number;
    };
  };
  external_apis?: {
    httpClients?: RawHttpClientConfig[];
  };
}

export interface GoRouteRegex {
  regex: RegExp;
  methodGroup?: number;
  pathGroup?: number;
  defaultMethod?: string;
}

export interface GoDbClientConfig {
  id: string;
  patternId: PatternId;
  databaseType: string;
  importPaths: string[];
  callNames: string[];
  confidence: number;
}

export interface GoAuthLibraryConfig {
  id: string;
  patternId: PatternId;
  importPaths: string[];
  callNames: string[];
  contentRegexes: RegExp[];
  strategy?: string;
  confidence: number;
}

export interface GoRouteFrameworkConfig {
  id: string;
  patternId: PatternId;
  importPaths: string[];
  routeRegexes: GoRouteRegex[];
  confidence: number;
}

export interface GoServerlessHandlerConfig {
  id: string;
  patternId: PatternId;
  importPaths: string[];
  callNames: string[];
  confidence: number;
}

export interface GoConfigLoader {
  id: string;
  importPaths: string[];
  callNames: string[];
}

export interface GoHttpClientConfig {
  id: string;
  patternId: PatternId;
  clientName: string;
  importPaths: string[];
  callNames: string[];
  callNameSuffixes: string[];
  urlRegex: RegExp;
  confidence: number;
}

export interface GoPatternConfig {
  dbClients: GoDbClientConfig[];
  sqlOpen?: {
    patternId: PatternId;
    regex: RegExp;
    name: string;
    confidence: number;
    /** Driver name (as passed to `sql.Open`) → component `databaseType`. */
    drivers: Record<string, string>;
    defaultDatabaseType: string;
  };
  auth: {
    libraries: GoAuthLibraryConfig[];
  };
  routes: {
    frameworks: GoRouteFrameworkConfig[];
  };
  serverless: {
    handlers: GoServerlessHandlerConfig[];
  };
  envConfig: {
    envVariable?: {
      patternId: PatternId;
      regex: RegExp;
      confidence: number;
    };
    configLoaders?: {
      patternId: PatternId;
      confidence: number;
      loaders: GoConfigLoader[];
    };
    configFile?: {
      patternId: PatternId;
      fileNameRegex: RegExp;
      name: string;
      confidence: number;
    };
  };
  externalApis: {
    httpClients: GoHttpClientConfig[];
  };
}

const DEFAULT_CONFIDENCE = 0.8;
const DEFAULT_URL_REGEX = '"(https?:\\/\\/[^\\s"]+)"';

function validatePatternId(raw: unknown, context: string): PatternId {
  const id = String(raw);
  if (!PATTERN_IDS.includes(id as PatternId)) {
    throw new Error(`Invalid patternId '${raw}' in ${context}`);
  }
  return id as PatternId;
}

function compileRegex(pattern: string, context: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid regex in ${context}: ${msg}`);
  }
}

function getConfigPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const cliRoot =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "../../..");
  return path.join(cliRoot, "patterns", "go.patterns.yaml");
}

function normalizeImportPaths(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter(Boolean);
}

function normalizeRouteRegexes(
  raw: RawRouteRegex[] | undefined,
  context: string,
): GoRouteRegex[] {
  return (raw ?? []).map((entry, index) => ({
    regex: compileRegex(entry.regex, `${context}.routeRegexes[${index}]`),
    methodGroup: entry.methodGroup,
    pathGroup: entry.pathGroup,
    defaultMethod: entry.defaultMethod,
  }));
}

function normalizeRawConfig(raw: RawGoPatternConfig): GoPatternConfig {
  const dbClients: GoDbClientConfig[] =
    raw.db_clients?.map((c) => ({
      id: c.id,
      patternId: validatePatternId(
        c.patternId,
        `go.db_clients entry '${c.id}'`,
      ),
      databaseType: c.databaseType,
      importPaths: normalizeImportPaths(c.importPaths),
      callNames: c.callNames ?? [],
      confidence: c.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const sqlOpenRaw = raw.sql_open;
  const sqlOpen =
    sqlOpenRaw && sqlOpenRaw.patternId && sqlOpenRaw.regex
      ? {
          patternId: validatePatternId(
            sqlOpenRaw.patternId,
            "go.sql_open.patternId",
          ),
          regex: compileRegex(sqlOpenRaw.regex, "go.sql_open.regex"),
          name: sqlOpenRaw.name ?? "database_sql",
          confidence: sqlOpenRaw.confidence ?? DEFAULT_CONFIDENCE,
          drivers: sqlOpenRaw.drivers ?? {},
          defaultDatabaseType: sqlOpenRaw.defaultDatabaseType ?? "sql",
        }
      : undefined;

  const authLibraries: GoAuthLibraryConfig[] =
    raw.auth?.libraries?.map((lib) => ({
      id: lib.id,
      patternId: validatePatternId(
        lib.patternId,
        `go.auth.libraries['${lib.id}']`,
      ),
      importPaths: normalizeImportPaths(lib.importPaths),
      callNames: lib.callNames ?? [],
      contentRegexes: (lib.contentRegexes ?? []).map((p) =>
        compileRegex(p, `go.auth.libraries['${lib.id}'].contentRegexes`),
      ),
      strategy: lib.strategy,
      confidence: lib.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const routeFrameworks: GoRouteFrameworkConfig[] =
    raw.routes?.frameworks?.map((fw) => ({
      id: fw.id,
      patternId: validatePatternId(
        fw.patternId,
        `go.routes.frameworks['${fw.id}']`,
      ),
      importPaths: normalizeImportPaths(fw.importPaths),
      routeRegexes: normalizeRouteRegexes(
        fw.routeRegexes,
        `go.routes.frameworks['${fw.id}']`,
      ),
      confidence: fw.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const serverlessHandlers: GoServerlessHandlerConfig[] =
    raw.serverless?.handlers?.map((handler) => ({
      id: handler.id,
      patternId: validatePatternId(
        handler.patternId,
        `go.serverless.handlers['${handler.id}']`,
      ),
      importPaths: normalizeImportPaths(handler.importPaths),
      callNames: handler.callNames ?? [],
      confidence: handler.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const envVarRaw = raw.env_config?.envVariable;
  const envVariable =
    envVarRaw && envVarRaw.patternId && envVarRaw.regex
      ? {
          patternId: validatePatternId(
            envVarRaw.patternId,
            "go.env_config.envVariable.patternId",
          ),
          regex: compileRegex(
            envVarRaw.regex,
            "go.env_config.envVariable.regex",
          ),
          confidence: envVarRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const configLoadersRaw = raw.env_config?.configLoaders;
  const configLoaders =
    configLoadersRaw && configLoadersRaw.patternId
      ? {
          patternId: validatePatternId(
            configLoadersRaw.patternId,
            "go.env_config.configLoaders.patternId",
          ),
          confidence: configLoadersRaw.confidence ?? DEFAULT_CONFIDENCE,
          loaders: (configLoadersRaw.loaders ?? []).map((loader) => ({
            id: loader.id,
            importPaths: normalizeImportPaths(loader.importPaths),
            callNames: loader.callNames ?? [],
          })),
        }
      : undefined;

  const configFileRaw = raw.env_config?.configFile;
  const configFile =
    configFileRaw && configFileRaw.patternId && configFileRaw.fileNameRegex
      ? {
          patternId: validatePatternId(
            configFileRaw.patternId,
            "go.env_config.configFile.patternId",
          ),
          fileNameRegex: compileRegex(
            configFileRaw.fileNameRegex,
            "go.env_config.configFile.fileNameRegex",
          ),
          name: configFileRaw.name ?? "go_config",
          confidence: configFileRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const httpClients: GoHttpClientConfig[] =
    raw.external_apis?.httpClients?.map((client) => ({
      id: client.id,
      patternId: validatePatternId(
        client.patternId,
        `go.external_apis.httpClients['${client.id}']`,
      ),
      clientName: client.clientName,
      importPaths: normalizeImportPaths(client.importPaths),
      callNames: client.callNames ?? [],
      callNameSuffixes: client.callNameSuffixes ?? [],
      urlRegex: compileRegex(
        client.urlRegex ?? DEFAULT_URL_REGEX,
        `go.external_apis.httpClients['${client.id}'].urlRegex`,
      ),
      confidence: client.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  return {
    dbClients,
    sqlOpen,
    auth: { libraries: authLibraries },
    routes: { frameworks: routeFrameworks },
    serverless: { handlers: serverlessHandlers },
    envConfig: { envVariable, configLoaders, configFile },
    externalApis: { httpClients },
  };
}

let cachedConfig: GoPatternConfig | undefined;

export function clearGoPatternConfigCache(): void {
  cachedConfig = undefined;
}

export function loadGoPatternConfig(): GoPatternConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  let rawYaml: string;
  try {
    rawYaml = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Go pattern config is required but could not be read from '${configPath}': ${msg}`,
    );
  }

  const parsed = YAML.parse(rawYaml) as RawGoPatternConfig | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `Go pattern config at '${configPath}' did not parse to an object.`,
    );
  }

  const normalized = normalizeRawConfig(parsed);
  cachedConfig = normalized;
  return normalized;
}
