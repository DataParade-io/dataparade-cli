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
  importNamespaces?: string[];
  packageNames?: string[];
  callNames?: unknown[];
  confidence?: number;
}

interface RawAuthLibraryConfig {
  id: string;
  patternId: string;
  importNamespaces?: string[];
  packageNames?: string[];
  callNames?: unknown[];
  contentRegexes?: string[];
  strategy?: string;
  confidence?: number;
}

interface RawRouteFrameworkConfig {
  id: string;
  patternId: string;
  importNamespaces?: string[];
  packageNames?: string[];
  routeRegexes?: RawRouteRegex[];
  confidence?: number;
}

interface RawServerlessHandlerConfig {
  id: string;
  patternId: string;
  importNamespaces?: string[];
  packageNames?: string[];
  callNames?: unknown[];
  confidence?: number;
}

interface RawConfigLoader {
  id: string;
  importNamespaces?: string[];
  packageNames?: string[];
  callNames?: unknown[];
}

interface RawHttpClientConfig {
  id: string;
  patternId: string;
  clientName: string;
  importNamespaces?: string[];
  packageNames?: string[];
  callNames?: unknown[];
  callNameSuffixes?: unknown[];
  urlRegex?: string;
  confidence?: number;
  emitOnPresence?: boolean;
}

interface RawPhpPatternConfig {
  db_clients?: RawDbClientConfig[];
  pdo_dsn?: {
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

export interface PhpRouteRegex {
  regex: RegExp;
  methodGroup?: number;
  pathGroup?: number;
  defaultMethod?: string;
}

export interface PhpDbClientConfig {
  id: string;
  patternId: PatternId;
  databaseType: string;
  importNamespaces: string[];
  packageNames: string[];
  callNames: string[];
  confidence: number;
}

export interface PhpAuthLibraryConfig {
  id: string;
  patternId: PatternId;
  importNamespaces: string[];
  packageNames: string[];
  callNames: string[];
  contentRegexes: RegExp[];
  strategy?: string;
  confidence: number;
}

export interface PhpRouteFrameworkConfig {
  id: string;
  patternId: PatternId;
  importNamespaces: string[];
  packageNames: string[];
  routeRegexes: PhpRouteRegex[];
  confidence: number;
}

export interface PhpServerlessHandlerConfig {
  id: string;
  patternId: PatternId;
  importNamespaces: string[];
  packageNames: string[];
  callNames: string[];
  confidence: number;
}

export interface PhpConfigLoader {
  id: string;
  importNamespaces: string[];
  packageNames: string[];
  callNames: string[];
}

export interface PhpHttpClientConfig {
  id: string;
  patternId: PatternId;
  clientName: string;
  importNamespaces: string[];
  packageNames: string[];
  callNames: string[];
  callNameSuffixes: string[];
  urlRegex: RegExp;
  confidence: number;
  /** When true, gated import/package alone emits a finding (SDK presence). */
  emitOnPresence: boolean;
}

export interface PhpPatternConfig {
  dbClients: PhpDbClientConfig[];
  pdoDsn?: {
    patternId: PatternId;
    regex: RegExp;
    name: string;
    confidence: number;
    drivers: Record<string, string>;
    defaultDatabaseType: string;
  };
  auth: {
    libraries: PhpAuthLibraryConfig[];
  };
  routes: {
    frameworks: PhpRouteFrameworkConfig[];
  };
  serverless: {
    handlers: PhpServerlessHandlerConfig[];
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
      loaders: PhpConfigLoader[];
    };
    configFile?: {
      patternId: PatternId;
      fileNameRegex: RegExp;
      name: string;
      confidence: number;
    };
  };
  externalApis: {
    httpClients: PhpHttpClientConfig[];
  };
}

const DEFAULT_CONFIDENCE = 0.8;
const DEFAULT_URL_REGEX = '["\'](https?:\\/\\/[^"\']+)["\']';

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
  return path.join(cliRoot, "patterns", "php.patterns.yaml");
}

function normalizeList(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((v) => (typeof v === "string" ? v.trim() : String(v ?? "").trim()))
    .filter(Boolean);
}

/** Coerce YAML call-name entries to strings (trailing `::` can parse as maps). */
function normalizeCallNames(values: unknown[] | undefined): string[] {
  if (!values) return [];
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === "string" && v.trim()) {
      out.push(v.trim());
      continue;
    }
    if (v && typeof v === "object") {
      for (const key of Object.keys(v as Record<string, unknown>)) {
        if (key.trim()) out.push(key.trim());
      }
    }
  }
  return out;
}

function normalizeRouteRegexes(
  raw: RawRouteRegex[] | undefined,
  context: string,
): PhpRouteRegex[] {
  return (raw ?? []).map((entry, index) => ({
    regex: compileRegex(entry.regex, `${context}.routeRegexes[${index}]`),
    methodGroup: entry.methodGroup,
    pathGroup: entry.pathGroup,
    defaultMethod: entry.defaultMethod,
  }));
}

function normalizeRawConfig(raw: RawPhpPatternConfig): PhpPatternConfig {
  const dbClients: PhpDbClientConfig[] =
    raw.db_clients?.map((c) => ({
      id: c.id,
      patternId: validatePatternId(
        c.patternId,
        `php.db_clients entry '${c.id}'`,
      ),
      databaseType: c.databaseType,
      importNamespaces: normalizeList(c.importNamespaces),
      packageNames: normalizeList(c.packageNames),
      callNames: normalizeCallNames(c.callNames),
      confidence: c.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const pdoDsnRaw = raw.pdo_dsn;
  const pdoDsn =
    pdoDsnRaw && pdoDsnRaw.patternId && pdoDsnRaw.regex
      ? {
          patternId: validatePatternId(
            pdoDsnRaw.patternId,
            "php.pdo_dsn.patternId",
          ),
          regex: compileRegex(pdoDsnRaw.regex, "php.pdo_dsn.regex"),
          name: pdoDsnRaw.name ?? "pdo_dsn",
          confidence: pdoDsnRaw.confidence ?? DEFAULT_CONFIDENCE,
          drivers: pdoDsnRaw.drivers ?? {},
          defaultDatabaseType: pdoDsnRaw.defaultDatabaseType ?? "sql",
        }
      : undefined;

  const authLibraries: PhpAuthLibraryConfig[] =
    raw.auth?.libraries?.map((lib) => ({
      id: lib.id,
      patternId: validatePatternId(
        lib.patternId,
        `php.auth.libraries['${lib.id}']`,
      ),
      importNamespaces: normalizeList(lib.importNamespaces),
      packageNames: normalizeList(lib.packageNames),
      callNames: normalizeCallNames(lib.callNames),
      contentRegexes: (lib.contentRegexes ?? []).map((p) =>
        compileRegex(p, `php.auth.libraries['${lib.id}'].contentRegexes`),
      ),
      strategy: lib.strategy,
      confidence: lib.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const routeFrameworks: PhpRouteFrameworkConfig[] =
    raw.routes?.frameworks?.map((fw) => ({
      id: fw.id,
      patternId: validatePatternId(
        fw.patternId,
        `php.routes.frameworks['${fw.id}']`,
      ),
      importNamespaces: normalizeList(fw.importNamespaces),
      packageNames: normalizeList(fw.packageNames),
      routeRegexes: normalizeRouteRegexes(
        fw.routeRegexes,
        `php.routes.frameworks['${fw.id}']`,
      ),
      confidence: fw.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const serverlessHandlers: PhpServerlessHandlerConfig[] =
    raw.serverless?.handlers?.map((handler) => ({
      id: handler.id,
      patternId: validatePatternId(
        handler.patternId,
        `php.serverless.handlers['${handler.id}']`,
      ),
      importNamespaces: normalizeList(handler.importNamespaces),
      packageNames: normalizeList(handler.packageNames),
      callNames: normalizeCallNames(handler.callNames),
      confidence: handler.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const envVarRaw = raw.env_config?.envVariable;
  const envVariable =
    envVarRaw && envVarRaw.patternId && envVarRaw.regex
      ? {
          patternId: validatePatternId(
            envVarRaw.patternId,
            "php.env_config.envVariable.patternId",
          ),
          regex: compileRegex(
            envVarRaw.regex,
            "php.env_config.envVariable.regex",
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
            "php.env_config.configLoaders.patternId",
          ),
          confidence: configLoadersRaw.confidence ?? DEFAULT_CONFIDENCE,
          loaders: (configLoadersRaw.loaders ?? []).map((loader) => ({
            id: loader.id,
            importNamespaces: normalizeList(loader.importNamespaces),
            packageNames: normalizeList(loader.packageNames),
            callNames: normalizeCallNames(loader.callNames),
          })),
        }
      : undefined;

  const configFileRaw = raw.env_config?.configFile;
  const configFile =
    configFileRaw && configFileRaw.patternId && configFileRaw.fileNameRegex
      ? {
          patternId: validatePatternId(
            configFileRaw.patternId,
            "php.env_config.configFile.patternId",
          ),
          fileNameRegex: compileRegex(
            configFileRaw.fileNameRegex,
            "php.env_config.configFile.fileNameRegex",
          ),
          name: configFileRaw.name ?? "php_config",
          confidence: configFileRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const httpClients: PhpHttpClientConfig[] =
    raw.external_apis?.httpClients?.map((client) => ({
      id: client.id,
      patternId: validatePatternId(
        client.patternId,
        `php.external_apis.httpClients['${client.id}']`,
      ),
      clientName: client.clientName,
      importNamespaces: normalizeList(client.importNamespaces),
      packageNames: normalizeList(client.packageNames),
      callNames: normalizeCallNames(client.callNames),
      callNameSuffixes: normalizeCallNames(client.callNameSuffixes),
      urlRegex: compileRegex(
        client.urlRegex ?? DEFAULT_URL_REGEX,
        `php.external_apis.httpClients['${client.id}'].urlRegex`,
      ),
      confidence: client.confidence ?? DEFAULT_CONFIDENCE,
      emitOnPresence: client.emitOnPresence === true,
    })) ?? [];

  return {
    dbClients,
    pdoDsn,
    auth: { libraries: authLibraries },
    routes: { frameworks: routeFrameworks },
    serverless: { handlers: serverlessHandlers },
    envConfig: { envVariable, configLoaders, configFile },
    externalApis: { httpClients },
  };
}

let cachedConfig: PhpPatternConfig | undefined;

export function clearPhpPatternConfigCache(): void {
  cachedConfig = undefined;
}

export function loadPhpPatternConfig(): PhpPatternConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  let rawYaml: string;
  try {
    rawYaml = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `PHP pattern config is required but could not be read from '${configPath}': ${msg}`,
    );
  }

  const parsed = YAML.parse(rawYaml) as RawPhpPatternConfig | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `PHP pattern config at '${configPath}' did not parse to an object.`,
    );
  }

  const normalized = normalizeRawConfig(parsed);
  cachedConfig = normalized;
  return normalized;
}
