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

interface RawAttributeRoute {
  attribute: string;
  method?: string;
}

interface RawDbClientConfig {
  id: string;
  patternId: string;
  databaseType: string;
  usingNamespaces?: string[];
  callNames?: string[];
  baseTypes?: string[];
  confidence?: number;
}

interface RawAuthLibraryConfig {
  id: string;
  patternId: string;
  usingNamespaces?: string[];
  callNames?: string[];
  strategy?: string;
  confidence?: number;
}

interface RawAuthAttributeConfig {
  id: string;
  patternId: string;
  attributeNames?: string[];
  strategy?: string;
  confidence?: number;
}

interface RawRouteFrameworkConfig {
  id: string;
  patternId: string;
  usingNamespaces?: string[];
  attributeRoutes?: RawAttributeRoute[];
  controllerAttributes?: string[];
  controllerRouteAttributes?: string[];
  controllerBaseTypes?: string[];
  routeRegexes?: RawRouteRegex[];
  confidence?: number;
}

interface RawServerlessHandlerConfig {
  id: string;
  patternId: string;
  usingNamespaces?: string[];
  attributeNames?: string[];
  typeNames?: string[];
  confidence?: number;
}

interface RawHttpClientConfig {
  id: string;
  patternId: string;
  clientName: string;
  usingNamespaces?: string[];
  callNames?: string[];
  callNameSuffixes?: string[];
  urlRegex?: string;
  confidence?: number;
}

interface RawCSharpPatternConfig {
  db_clients?: RawDbClientConfig[];
  auth?: {
    libraries?: RawAuthLibraryConfig[];
    attributes?: RawAuthAttributeConfig[];
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
    configurationKeys?: {
      patternId: string;
      regexes?: string[];
      confidence?: number;
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

export interface CSharpRouteRegex {
  regex: RegExp;
  methodGroup?: number;
  pathGroup?: number;
  defaultMethod?: string;
}

export interface CSharpAttributeRoute {
  attribute: string;
  method?: string;
}

export interface CSharpDbClientConfig {
  id: string;
  patternId: PatternId;
  databaseType: string;
  usingNamespaces: string[];
  callNames: string[];
  baseTypes: string[];
  confidence: number;
}

export interface CSharpAuthLibraryConfig {
  id: string;
  patternId: PatternId;
  usingNamespaces: string[];
  callNames: string[];
  strategy?: string;
  confidence: number;
}

export interface CSharpAuthAttributeConfig {
  id: string;
  patternId: PatternId;
  attributeNames: string[];
  strategy?: string;
  confidence: number;
}

export interface CSharpRouteFrameworkConfig {
  id: string;
  patternId: PatternId;
  usingNamespaces: string[];
  attributeRoutes: CSharpAttributeRoute[];
  controllerAttributes: string[];
  controllerRouteAttributes: string[];
  controllerBaseTypes: string[];
  routeRegexes: CSharpRouteRegex[];
  confidence: number;
}

export interface CSharpServerlessHandlerConfig {
  id: string;
  patternId: PatternId;
  usingNamespaces: string[];
  attributeNames: string[];
  typeNames: string[];
  confidence: number;
}

export interface CSharpHttpClientConfig {
  id: string;
  patternId: PatternId;
  clientName: string;
  usingNamespaces: string[];
  callNames: string[];
  callNameSuffixes: string[];
  urlRegex: RegExp;
  confidence: number;
}

export interface CSharpPatternConfig {
  dbClients: CSharpDbClientConfig[];
  auth: {
    libraries: CSharpAuthLibraryConfig[];
    attributes: CSharpAuthAttributeConfig[];
  };
  routes: {
    frameworks: CSharpRouteFrameworkConfig[];
  };
  serverless: {
    handlers: CSharpServerlessHandlerConfig[];
  };
  envConfig: {
    envVariable?: {
      patternId: PatternId;
      regex: RegExp;
      confidence: number;
    };
    configurationKeys?: {
      patternId: PatternId;
      regexes: RegExp[];
      confidence: number;
    };
    configFile?: {
      patternId: PatternId;
      fileNameRegex: RegExp;
      name: string;
      confidence: number;
    };
  };
  externalApis: {
    httpClients: CSharpHttpClientConfig[];
  };
}

const DEFAULT_CONFIDENCE = 0.8;
const DEFAULT_URL_REGEX = '@?"(https?:\\/\\/[^\\s"]+)"';

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
  return path.join(cliRoot, "patterns", "csharp.patterns.yaml");
}

function normalizeRouteRegexes(
  raw: RawRouteRegex[] | undefined,
  context: string,
): CSharpRouteRegex[] {
  return (raw ?? []).map((entry, index) => ({
    regex: compileRegex(entry.regex, `${context}.routeRegexes[${index}]`),
    methodGroup: entry.methodGroup,
    pathGroup: entry.pathGroup,
    defaultMethod: entry.defaultMethod,
  }));
}

function normalizeRawConfig(raw: RawCSharpPatternConfig): CSharpPatternConfig {
  const dbClients: CSharpDbClientConfig[] =
    raw.db_clients?.map((c) => ({
      id: c.id,
      patternId: validatePatternId(
        c.patternId,
        `csharp.db_clients entry '${c.id}'`,
      ),
      databaseType: c.databaseType,
      usingNamespaces: c.usingNamespaces ?? [],
      callNames: c.callNames ?? [],
      baseTypes: c.baseTypes ?? [],
      confidence: c.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const authLibraries: CSharpAuthLibraryConfig[] =
    raw.auth?.libraries?.map((lib) => ({
      id: lib.id,
      patternId: validatePatternId(
        lib.patternId,
        `csharp.auth.libraries['${lib.id}']`,
      ),
      usingNamespaces: lib.usingNamespaces ?? [],
      callNames: lib.callNames ?? [],
      strategy: lib.strategy,
      confidence: lib.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const authAttributes: CSharpAuthAttributeConfig[] =
    raw.auth?.attributes?.map((attr) => ({
      id: attr.id,
      patternId: validatePatternId(
        attr.patternId,
        `csharp.auth.attributes['${attr.id}']`,
      ),
      attributeNames: attr.attributeNames ?? [],
      strategy: attr.strategy,
      confidence: attr.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const routeFrameworks: CSharpRouteFrameworkConfig[] =
    raw.routes?.frameworks?.map((fw) => ({
      id: fw.id,
      patternId: validatePatternId(
        fw.patternId,
        `csharp.routes.frameworks['${fw.id}']`,
      ),
      usingNamespaces: fw.usingNamespaces ?? [],
      attributeRoutes:
        fw.attributeRoutes?.map((route) => ({
          attribute: route.attribute,
          method: route.method,
        })) ?? [],
      controllerAttributes: fw.controllerAttributes ?? [],
      controllerRouteAttributes: fw.controllerRouteAttributes ?? [],
      controllerBaseTypes: fw.controllerBaseTypes ?? [],
      routeRegexes: normalizeRouteRegexes(
        fw.routeRegexes,
        `csharp.routes.frameworks['${fw.id}']`,
      ),
      confidence: fw.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const serverlessHandlers: CSharpServerlessHandlerConfig[] =
    raw.serverless?.handlers?.map((handler) => ({
      id: handler.id,
      patternId: validatePatternId(
        handler.patternId,
        `csharp.serverless.handlers['${handler.id}']`,
      ),
      usingNamespaces: handler.usingNamespaces ?? [],
      attributeNames: handler.attributeNames ?? [],
      typeNames: handler.typeNames ?? [],
      confidence: handler.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const envVarRaw = raw.env_config?.envVariable;
  const envVariable =
    envVarRaw && envVarRaw.patternId && envVarRaw.regex
      ? {
          patternId: validatePatternId(
            envVarRaw.patternId,
            "csharp.env_config.envVariable.patternId",
          ),
          regex: compileRegex(
            envVarRaw.regex,
            "csharp.env_config.envVariable.regex",
          ),
          confidence: envVarRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const configKeysRaw = raw.env_config?.configurationKeys;
  const configurationKeys =
    configKeysRaw && configKeysRaw.patternId
      ? {
          patternId: validatePatternId(
            configKeysRaw.patternId,
            "csharp.env_config.configurationKeys.patternId",
          ),
          regexes: (configKeysRaw.regexes ?? []).map((p, index) =>
            compileRegex(
              p,
              `csharp.env_config.configurationKeys.regexes[${index}]`,
            ),
          ),
          confidence: configKeysRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const configFileRaw = raw.env_config?.configFile;
  const configFile =
    configFileRaw && configFileRaw.patternId && configFileRaw.fileNameRegex
      ? {
          patternId: validatePatternId(
            configFileRaw.patternId,
            "csharp.env_config.configFile.patternId",
          ),
          fileNameRegex: compileRegex(
            configFileRaw.fileNameRegex,
            "csharp.env_config.configFile.fileNameRegex",
          ),
          name: configFileRaw.name ?? "dotnet_config",
          confidence: configFileRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const httpClients: CSharpHttpClientConfig[] =
    raw.external_apis?.httpClients?.map((client) => ({
      id: client.id,
      patternId: validatePatternId(
        client.patternId,
        `csharp.external_apis.httpClients['${client.id}']`,
      ),
      clientName: client.clientName,
      usingNamespaces: client.usingNamespaces ?? [],
      callNames: client.callNames ?? [],
      callNameSuffixes: client.callNameSuffixes ?? [],
      urlRegex: compileRegex(
        client.urlRegex ?? DEFAULT_URL_REGEX,
        `csharp.external_apis.httpClients['${client.id}'].urlRegex`,
      ),
      confidence: client.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  return {
    dbClients,
    auth: { libraries: authLibraries, attributes: authAttributes },
    routes: { frameworks: routeFrameworks },
    serverless: { handlers: serverlessHandlers },
    envConfig: { envVariable, configurationKeys, configFile },
    externalApis: { httpClients },
  };
}

let cachedConfig: CSharpPatternConfig | undefined;

export function clearCSharpPatternConfigCache(): void {
  cachedConfig = undefined;
}

export function loadCSharpPatternConfig(): CSharpPatternConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  let rawYaml: string;
  try {
    rawYaml = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `C# pattern config is required but could not be read from '${configPath}': ${msg}`,
    );
  }

  const parsed = YAML.parse(rawYaml) as RawCSharpPatternConfig | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `C# pattern config at '${configPath}' did not parse to an object.`,
    );
  }

  const normalized = normalizeRawConfig(parsed);
  cachedConfig = normalized;
  return normalized;
}
