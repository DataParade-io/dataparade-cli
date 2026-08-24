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
  packageNames?: string[];
  includeHeaders?: string[];
  callNames?: string[];
  callNamePrefixes?: string[];
  contentRegexes?: string[];
  confidence?: number;
}

interface RawAuthLibraryConfig {
  id: string;
  patternId: string;
  packageNames?: string[];
  includeHeaders?: string[];
  callNames?: string[];
  contentRegexes?: string[];
  strategy?: string;
  confidence?: number;
}

interface RawRouteFrameworkConfig {
  id: string;
  patternId: string;
  includeHeaders?: string[];
  routeRegexes?: RawRouteRegex[];
  confidence?: number;
}

interface RawHttpClientConfig {
  id: string;
  patternId: string;
  clientName: string;
  includeHeaders?: string[];
  callNames?: string[];
  callNamePrefixes?: string[];
  urlRegex?: string;
  confidence?: number;
}

interface RawCppPatternConfig {
  db_clients?: RawDbClientConfig[];
  auth?: {
    libraries?: RawAuthLibraryConfig[];
  };
  routes?: {
    frameworks?: RawRouteFrameworkConfig[];
  };
  env_config?: {
    envVariable?: {
      patternId: string;
      regex?: string;
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

export interface CppRouteRegex {
  regex: RegExp;
  methodGroup?: number;
  pathGroup?: number;
  defaultMethod?: string;
}

export interface CppDbClientConfig {
  id: string;
  patternId: PatternId;
  databaseType: string;
  /** Package-manager names (vcpkg/Conan/CMake), matched against manifests. */
  packageNames: string[];
  includeHeaders: string[];
  callNames: string[];
  callNamePrefixes: string[];
  contentRegexes: RegExp[];
  confidence: number;
}

export interface CppAuthLibraryConfig {
  id: string;
  patternId: PatternId;
  packageNames: string[];
  includeHeaders: string[];
  callNames: string[];
  contentRegexes: RegExp[];
  strategy?: string;
  confidence: number;
}

export interface CppRouteFrameworkConfig {
  id: string;
  patternId: PatternId;
  includeHeaders: string[];
  routeRegexes: CppRouteRegex[];
  confidence: number;
}

export interface CppHttpClientConfig {
  id: string;
  patternId: PatternId;
  clientName: string;
  includeHeaders: string[];
  callNames: string[];
  callNamePrefixes: string[];
  urlRegex: RegExp;
  confidence: number;
}

export interface CppPatternConfig {
  dbClients: CppDbClientConfig[];
  auth: {
    libraries: CppAuthLibraryConfig[];
  };
  routes: {
    frameworks: CppRouteFrameworkConfig[];
  };
  envConfig: {
    envVariable?: {
      patternId: PatternId;
      regex: RegExp;
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
    httpClients: CppHttpClientConfig[];
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
  return path.join(cliRoot, "patterns", "cpp.patterns.yaml");
}

/** Header paths and package names are compared case-insensitively. */
function normalizeTokens(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean);
}

function normalizeRouteRegexes(
  raw: RawRouteRegex[] | undefined,
  context: string,
): CppRouteRegex[] {
  return (raw ?? []).map((entry, index) => ({
    regex: compileRegex(entry.regex, `${context}.routeRegexes[${index}]`),
    methodGroup: entry.methodGroup,
    pathGroup: entry.pathGroup,
    defaultMethod: entry.defaultMethod,
  }));
}

function normalizeRawConfig(raw: RawCppPatternConfig): CppPatternConfig {
  const dbClients: CppDbClientConfig[] =
    raw.db_clients?.map((c) => ({
      id: c.id,
      patternId: validatePatternId(
        c.patternId,
        `cpp.db_clients entry '${c.id}'`,
      ),
      databaseType: c.databaseType,
      packageNames: normalizeTokens(c.packageNames),
      includeHeaders: normalizeTokens(c.includeHeaders),
      callNames: c.callNames ?? [],
      callNamePrefixes: c.callNamePrefixes ?? [],
      contentRegexes: (c.contentRegexes ?? []).map((p) =>
        compileRegex(p, `cpp.db_clients['${c.id}'].contentRegexes`),
      ),
      confidence: c.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const authLibraries: CppAuthLibraryConfig[] =
    raw.auth?.libraries?.map((lib) => ({
      id: lib.id,
      patternId: validatePatternId(
        lib.patternId,
        `cpp.auth.libraries['${lib.id}']`,
      ),
      packageNames: normalizeTokens(lib.packageNames),
      includeHeaders: normalizeTokens(lib.includeHeaders),
      callNames: lib.callNames ?? [],
      contentRegexes: (lib.contentRegexes ?? []).map((p) =>
        compileRegex(p, `cpp.auth.libraries['${lib.id}'].contentRegexes`),
      ),
      strategy: lib.strategy,
      confidence: lib.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const routeFrameworks: CppRouteFrameworkConfig[] =
    raw.routes?.frameworks?.map((fw) => ({
      id: fw.id,
      patternId: validatePatternId(
        fw.patternId,
        `cpp.routes.frameworks['${fw.id}']`,
      ),
      includeHeaders: normalizeTokens(fw.includeHeaders),
      routeRegexes: normalizeRouteRegexes(
        fw.routeRegexes,
        `cpp.routes.frameworks['${fw.id}']`,
      ),
      confidence: fw.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const envVarRaw = raw.env_config?.envVariable;
  const envVariable =
    envVarRaw && envVarRaw.patternId && envVarRaw.regex
      ? {
          patternId: validatePatternId(
            envVarRaw.patternId,
            "cpp.env_config.envVariable.patternId",
          ),
          regex: compileRegex(
            envVarRaw.regex,
            "cpp.env_config.envVariable.regex",
          ),
          confidence: envVarRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const configFileRaw = raw.env_config?.configFile;
  const configFile =
    configFileRaw && configFileRaw.patternId && configFileRaw.fileNameRegex
      ? {
          patternId: validatePatternId(
            configFileRaw.patternId,
            "cpp.env_config.configFile.patternId",
          ),
          fileNameRegex: compileRegex(
            configFileRaw.fileNameRegex,
            "cpp.env_config.configFile.fileNameRegex",
          ),
          name: configFileRaw.name ?? "cpp_config",
          confidence: configFileRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const httpClients: CppHttpClientConfig[] =
    raw.external_apis?.httpClients?.map((client) => ({
      id: client.id,
      patternId: validatePatternId(
        client.patternId,
        `cpp.external_apis.httpClients['${client.id}']`,
      ),
      clientName: client.clientName,
      includeHeaders: normalizeTokens(client.includeHeaders),
      callNames: client.callNames ?? [],
      callNamePrefixes: client.callNamePrefixes ?? [],
      urlRegex: compileRegex(
        client.urlRegex ?? DEFAULT_URL_REGEX,
        `cpp.external_apis.httpClients['${client.id}'].urlRegex`,
      ),
      confidence: client.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  return {
    dbClients,
    auth: { libraries: authLibraries },
    routes: { frameworks: routeFrameworks },
    envConfig: { envVariable, configFile },
    externalApis: { httpClients },
  };
}

let cachedConfig: CppPatternConfig | undefined;

export function clearCppPatternConfigCache(): void {
  cachedConfig = undefined;
}

export function loadCppPatternConfig(): CppPatternConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  let rawYaml: string;
  try {
    rawYaml = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `C++ pattern config is required but could not be read from '${configPath}': ${msg}`,
    );
  }

  const parsed = YAML.parse(rawYaml) as RawCppPatternConfig | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `C++ pattern config at '${configPath}' did not parse to an object.`,
    );
  }

  const normalized = normalizeRawConfig(parsed);
  cachedConfig = normalized;
  return normalized;
}
