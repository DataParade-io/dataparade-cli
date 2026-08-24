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

interface RawAnnotationRoute {
  annotation: string;
  method?: string;
}

interface RawDbClientConfig {
  id: string;
  patternId: string;
  databaseType: string;
  importPackages?: string[];
  packageCoordinates?: string[];
  callNames?: string[];
  annotationNames?: string[];
  confidence?: number;
}

interface RawAuthLibraryConfig {
  id: string;
  patternId: string;
  importPackages?: string[];
  packageCoordinates?: string[];
  callNames?: string[];
  contentRegexes?: string[];
  strategy?: string;
  confidence?: number;
}

interface RawAuthAnnotationConfig {
  id: string;
  patternId: string;
  annotationNames?: string[];
  strategy?: string;
  confidence?: number;
}

interface RawRouteFrameworkConfig {
  id: string;
  patternId: string;
  importPackages?: string[];
  controllerAnnotations?: string[];
  controllerRouteAnnotations?: string[];
  pathAnnotations?: string[];
  annotationRoutes?: RawAnnotationRoute[];
  routeRegexes?: RawRouteRegex[];
  confidence?: number;
}

interface RawServerlessHandlerConfig {
  id: string;
  patternId: string;
  importPackages?: string[];
  packageCoordinates?: string[];
  annotationNames?: string[];
  baseTypes?: string[];
  typeNames?: string[];
  callNames?: string[];
  confidence?: number;
}

interface RawConfigLoader {
  id: string;
  importPackages?: string[];
  packageCoordinates?: string[];
  callNames?: string[];
}

interface RawHttpClientConfig {
  id: string;
  patternId: string;
  clientName: string;
  importPackages?: string[];
  callNames?: string[];
  callNameSuffixes?: string[];
  urlRegex?: string;
  requireUrlMatch?: boolean;
  confidence?: number;
}

interface RawJvmPatternConfig {
  db_clients?: RawDbClientConfig[];
  jdbc_url?: {
    patternId: string;
    regex?: string;
    name?: string;
    confidence?: number;
    drivers?: Record<string, string>;
    defaultDatabaseType?: string;
  };
  auth?: {
    libraries?: RawAuthLibraryConfig[];
    annotations?: RawAuthAnnotationConfig[];
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
    propertyKeys?: {
      patternId: string;
      regexes?: string[];
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

export interface JvmRouteRegex {
  regex: RegExp;
  methodGroup?: number;
  pathGroup?: number;
  defaultMethod?: string;
}

export interface JvmAnnotationRoute {
  annotation: string;
  method?: string;
}

export interface JvmDbClientConfig {
  id: string;
  patternId: PatternId;
  databaseType: string;
  importPackages: string[];
  packageCoordinates: string[];
  callNames: string[];
  annotationNames: string[];
  confidence: number;
}

export interface JvmAuthLibraryConfig {
  id: string;
  patternId: PatternId;
  importPackages: string[];
  packageCoordinates: string[];
  callNames: string[];
  contentRegexes: RegExp[];
  strategy?: string;
  confidence: number;
}

export interface JvmAuthAnnotationConfig {
  id: string;
  patternId: PatternId;
  annotationNames: string[];
  strategy?: string;
  confidence: number;
}

export interface JvmRouteFrameworkConfig {
  id: string;
  patternId: PatternId;
  importPackages: string[];
  controllerAnnotations: string[];
  controllerRouteAnnotations: string[];
  /**
   * Annotations that carry a member's sub-path when the route annotation
   * itself does not — JAX-RS splits `@GET` from `@Path("/{id}")`.
   */
  pathAnnotations: string[];
  annotationRoutes: JvmAnnotationRoute[];
  routeRegexes: JvmRouteRegex[];
  confidence: number;
}

export interface JvmServerlessHandlerConfig {
  id: string;
  patternId: PatternId;
  importPackages: string[];
  packageCoordinates: string[];
  annotationNames: string[];
  baseTypes: string[];
  typeNames: string[];
  callNames: string[];
  confidence: number;
}

export interface JvmConfigLoader {
  id: string;
  importPackages: string[];
  packageCoordinates: string[];
  callNames: string[];
}

export interface JvmHttpClientConfig {
  id: string;
  patternId: PatternId;
  clientName: string;
  importPackages: string[];
  callNames: string[];
  callNameSuffixes: string[];
  urlRegex: RegExp;
  /**
   * Require a literal URL in the call arguments before emitting. Needed where
   * a client shares method names with a server routing DSL (Ktor), so a route
   * registration cannot be reported as an outbound call.
   */
  requireUrlMatch: boolean;
  confidence: number;
}

export interface JvmPatternConfig {
  dbClients: JvmDbClientConfig[];
  jdbcUrl?: {
    patternId: PatternId;
    regex: RegExp;
    name: string;
    confidence: number;
    /** JDBC sub-protocol (`jdbc:<driver>:`) → component `databaseType`. */
    drivers: Record<string, string>;
    defaultDatabaseType: string;
  };
  auth: {
    libraries: JvmAuthLibraryConfig[];
    annotations: JvmAuthAnnotationConfig[];
  };
  routes: {
    frameworks: JvmRouteFrameworkConfig[];
  };
  serverless: {
    handlers: JvmServerlessHandlerConfig[];
  };
  envConfig: {
    envVariable?: {
      patternId: PatternId;
      regex: RegExp;
      confidence: number;
    };
    propertyKeys?: {
      patternId: PatternId;
      regexes: RegExp[];
      confidence: number;
    };
    configLoaders?: {
      patternId: PatternId;
      confidence: number;
      loaders: JvmConfigLoader[];
    };
    configFile?: {
      patternId: PatternId;
      fileNameRegex: RegExp;
      name: string;
      confidence: number;
    };
  };
  externalApis: {
    httpClients: JvmHttpClientConfig[];
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
  return path.join(cliRoot, "patterns", "jvm.patterns.yaml");
}

function normalizeTokens(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter(Boolean);
}

function normalizeRouteRegexes(
  raw: RawRouteRegex[] | undefined,
  context: string,
): JvmRouteRegex[] {
  return (raw ?? []).map((entry, index) => ({
    regex: compileRegex(entry.regex, `${context}.routeRegexes[${index}]`),
    methodGroup: entry.methodGroup,
    pathGroup: entry.pathGroup,
    defaultMethod: entry.defaultMethod,
  }));
}

function normalizeRawConfig(raw: RawJvmPatternConfig): JvmPatternConfig {
  const dbClients: JvmDbClientConfig[] =
    raw.db_clients?.map((c) => ({
      id: c.id,
      patternId: validatePatternId(
        c.patternId,
        `jvm.db_clients entry '${c.id}'`,
      ),
      databaseType: c.databaseType,
      importPackages: normalizeTokens(c.importPackages),
      packageCoordinates: normalizeTokens(c.packageCoordinates),
      callNames: c.callNames ?? [],
      annotationNames: c.annotationNames ?? [],
      confidence: c.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const jdbcUrlRaw = raw.jdbc_url;
  const jdbcUrl =
    jdbcUrlRaw && jdbcUrlRaw.patternId && jdbcUrlRaw.regex
      ? {
          patternId: validatePatternId(
            jdbcUrlRaw.patternId,
            "jvm.jdbc_url.patternId",
          ),
          regex: compileRegex(jdbcUrlRaw.regex, "jvm.jdbc_url.regex"),
          name: jdbcUrlRaw.name ?? "jdbc",
          confidence: jdbcUrlRaw.confidence ?? DEFAULT_CONFIDENCE,
          drivers: jdbcUrlRaw.drivers ?? {},
          defaultDatabaseType: jdbcUrlRaw.defaultDatabaseType ?? "sql",
        }
      : undefined;

  const authLibraries: JvmAuthLibraryConfig[] =
    raw.auth?.libraries?.map((lib) => ({
      id: lib.id,
      patternId: validatePatternId(
        lib.patternId,
        `jvm.auth.libraries['${lib.id}']`,
      ),
      importPackages: normalizeTokens(lib.importPackages),
      packageCoordinates: normalizeTokens(lib.packageCoordinates),
      callNames: lib.callNames ?? [],
      contentRegexes: (lib.contentRegexes ?? []).map((p) =>
        compileRegex(p, `jvm.auth.libraries['${lib.id}'].contentRegexes`),
      ),
      strategy: lib.strategy,
      confidence: lib.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const authAnnotations: JvmAuthAnnotationConfig[] =
    raw.auth?.annotations?.map((entry) => ({
      id: entry.id,
      patternId: validatePatternId(
        entry.patternId,
        `jvm.auth.annotations['${entry.id}']`,
      ),
      annotationNames: normalizeTokens(entry.annotationNames),
      strategy: entry.strategy,
      confidence: entry.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const routeFrameworks: JvmRouteFrameworkConfig[] =
    raw.routes?.frameworks?.map((fw) => ({
      id: fw.id,
      patternId: validatePatternId(
        fw.patternId,
        `jvm.routes.frameworks['${fw.id}']`,
      ),
      importPackages: normalizeTokens(fw.importPackages),
      controllerAnnotations: normalizeTokens(fw.controllerAnnotations),
      controllerRouteAnnotations: normalizeTokens(fw.controllerRouteAnnotations),
      pathAnnotations: normalizeTokens(fw.pathAnnotations),
      annotationRoutes: (fw.annotationRoutes ?? []).map((entry) => ({
        annotation: entry.annotation,
        method: entry.method,
      })),
      routeRegexes: normalizeRouteRegexes(
        fw.routeRegexes,
        `jvm.routes.frameworks['${fw.id}']`,
      ),
      confidence: fw.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const serverlessHandlers: JvmServerlessHandlerConfig[] =
    raw.serverless?.handlers?.map((handler) => ({
      id: handler.id,
      patternId: validatePatternId(
        handler.patternId,
        `jvm.serverless.handlers['${handler.id}']`,
      ),
      importPackages: normalizeTokens(handler.importPackages),
      packageCoordinates: normalizeTokens(handler.packageCoordinates),
      annotationNames: normalizeTokens(handler.annotationNames),
      baseTypes: normalizeTokens(handler.baseTypes),
      typeNames: normalizeTokens(handler.typeNames),
      callNames: handler.callNames ?? [],
      confidence: handler.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const envVarRaw = raw.env_config?.envVariable;
  const envVariable =
    envVarRaw && envVarRaw.patternId && envVarRaw.regex
      ? {
          patternId: validatePatternId(
            envVarRaw.patternId,
            "jvm.env_config.envVariable.patternId",
          ),
          regex: compileRegex(
            envVarRaw.regex,
            "jvm.env_config.envVariable.regex",
          ),
          confidence: envVarRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const propertyKeysRaw = raw.env_config?.propertyKeys;
  const propertyKeys =
    propertyKeysRaw && propertyKeysRaw.patternId
      ? {
          patternId: validatePatternId(
            propertyKeysRaw.patternId,
            "jvm.env_config.propertyKeys.patternId",
          ),
          regexes: (propertyKeysRaw.regexes ?? []).map((p, index) =>
            compileRegex(p, `jvm.env_config.propertyKeys.regexes[${index}]`),
          ),
          confidence: propertyKeysRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const configLoadersRaw = raw.env_config?.configLoaders;
  const configLoaders =
    configLoadersRaw && configLoadersRaw.patternId
      ? {
          patternId: validatePatternId(
            configLoadersRaw.patternId,
            "jvm.env_config.configLoaders.patternId",
          ),
          confidence: configLoadersRaw.confidence ?? DEFAULT_CONFIDENCE,
          loaders: (configLoadersRaw.loaders ?? []).map((loader) => ({
            id: loader.id,
            importPackages: normalizeTokens(loader.importPackages),
            packageCoordinates: normalizeTokens(loader.packageCoordinates),
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
            "jvm.env_config.configFile.patternId",
          ),
          fileNameRegex: compileRegex(
            configFileRaw.fileNameRegex,
            "jvm.env_config.configFile.fileNameRegex",
          ),
          name: configFileRaw.name ?? "jvm_config",
          confidence: configFileRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const httpClients: JvmHttpClientConfig[] =
    raw.external_apis?.httpClients?.map((client) => ({
      id: client.id,
      patternId: validatePatternId(
        client.patternId,
        `jvm.external_apis.httpClients['${client.id}']`,
      ),
      clientName: client.clientName,
      importPackages: normalizeTokens(client.importPackages),
      callNames: client.callNames ?? [],
      callNameSuffixes: client.callNameSuffixes ?? [],
      urlRegex: compileRegex(
        client.urlRegex ?? DEFAULT_URL_REGEX,
        `jvm.external_apis.httpClients['${client.id}'].urlRegex`,
      ),
      requireUrlMatch: client.requireUrlMatch ?? false,
      confidence: client.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  return {
    dbClients,
    jdbcUrl,
    auth: { libraries: authLibraries, annotations: authAnnotations },
    routes: { frameworks: routeFrameworks },
    serverless: { handlers: serverlessHandlers },
    envConfig: { envVariable, propertyKeys, configLoaders, configFile },
    externalApis: { httpClients },
  };
}

let cachedConfig: JvmPatternConfig | undefined;

export function clearJvmPatternConfigCache(): void {
  cachedConfig = undefined;
}

export function loadJvmPatternConfig(): JvmPatternConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  let rawYaml: string;
  try {
    rawYaml = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `JVM pattern config is required but could not be read from '${configPath}': ${msg}`,
    );
  }

  const parsed = YAML.parse(rawYaml) as RawJvmPatternConfig | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `JVM pattern config at '${configPath}' did not parse to an object.`,
    );
  }

  const normalized = normalizeRawConfig(parsed);
  cachedConfig = normalized;
  return normalized;
}
