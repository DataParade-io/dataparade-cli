import fs from "fs";
import path from "path";
import YAML from "yaml";

import {
  type PatternId,
  PATTERN_IDS,
} from "../../core/types/detection";

interface RawDbClientConfig {
  id: string;
  patternId: string;
  databaseType: string;
  importModules?: string[];
  callNames?: string[];
  confidence?: number;
  heuristics?: {
    usesObjectsAttribute?: boolean;
  };
}

interface RawPythonPatternConfig {
  db_clients?: RawDbClientConfig[];
  auth?: {
    jwt?: {
      patternId: string;
      importModules?: string[];
      contentRegexes?: string[];
      strategy?: string;
      confidence?: number;
    };
    decorators?: Array<{
      id: string;
      patternId: string;
      callNames?: string[];
      confidence?: number;
    }>;
    libraries?: Array<{
      id: string;
      patternId: string;
      importModules?: string[];
      contentRegexes?: string[];
      strategy?: string;
      confidence?: number;
    }>;
  };
  serverless?: {
    handlers?: Array<{
      id: string;
      patternId: string;
      importModules?: string[];
      functionNameRegexes?: string[];
      decoratorNames?: string[];
      confidence?: number;
    }>;
  };
  routes?: {
    frameworks?: Array<{
      id: string;
      patternId: string;
      importModules?: string[];
      decoratorPrefixes?: string[];
      decoratorNames?: string[];
      urlsFileSuffix?: string;
      pathRegex?: string;
      confidence?: number;
    }>;
  };
  env_config?: {
    envVariable?: {
      patternId: string;
      regex?: string;
      confidence?: number;
    };
    djangoSettings?: {
      patternId: string;
      fileSuffix?: string;
      name?: string;
      confidence?: number;
    };
    dotenvConfig?: {
      patternId: string;
      requiresOsImport?: boolean;
      contentSubstring?: string;
      name?: string;
      confidence?: number;
    };
  };
  external_apis?: {
    httpClients?: Array<{
      id: string;
      patternId: string;
      clientName: string;
      importModules?: string[];
      callNames?: string[];
      urlRegex?: string;
      confidence?: number;
    }>;
  };
}

export interface PythonDbClientConfig {
  id: string;
  patternId: PatternId;
  databaseType: string;
  importModules: string[];
  callNames: string[];
  confidence: number;
  heuristics: {
    usesObjectsAttribute: boolean;
  };
}

export interface PythonPatternConfig {
  dbClients: PythonDbClientConfig[];
  auth: {
    jwt?: {
      patternId: PatternId;
      importModules: string[];
      contentRegexes: RegExp[];
      strategy?: string;
      confidence: number;
    };
    decorators: Array<{
      id: string;
      patternId: PatternId;
      callNames: string[];
      confidence: number;
    }>;
    libraries: Array<{
      id: string;
      patternId: PatternId;
      importModules: string[];
      contentRegexes: RegExp[];
      strategy?: string;
      confidence: number;
    }>;
  };
  serverless: {
    handlers: Array<{
      id: string;
      patternId: PatternId;
      importModules: string[];
      functionNameRegexes: RegExp[];
      decoratorNames: string[];
      confidence: number;
    }>;
  };
  routes: {
    frameworks: Array<{
      id: string;
      patternId: PatternId;
      importModules: string[];
      decoratorPrefixes: string[];
      decoratorNames: string[];
      urlsFileSuffix?: string;
      pathRegex?: RegExp;
      confidence: number;
    }>;
  };
  envConfig: {
    envVariable?: {
      patternId: PatternId;
      regex: RegExp;
      confidence: number;
    };
    djangoSettings?: {
      patternId: PatternId;
      fileSuffix: string;
      name: string;
      confidence: number;
    };
    dotenvConfig?: {
      patternId: PatternId;
      requiresOsImport: boolean;
      contentSubstring: string;
      name: string;
      confidence: number;
    };
  };
  externalApis: {
    httpClients: Array<{
      id: string;
      patternId: PatternId;
      clientName: string;
      importModules: string[];
      callNames: string[];
      urlRegex: RegExp;
      confidence: number;
    }>;
  };
}

const DEFAULT_CONFIDENCE = 0.8;

function validatePatternId(raw: unknown, context: string): PatternId {
  const id = String(raw);
  if (!PATTERN_IDS.includes(id as PatternId)) {
    throw new Error(`Invalid patternId '${raw}' in ${context}`);
  }
  return id as PatternId;
}

function getConfigPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const cliRoot =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "../../..");
  return path.join(cliRoot, "patterns", "python.patterns.yaml");
}

function normalizeRawConfig(raw: RawPythonPatternConfig): PythonPatternConfig {
  const dbClients: PythonDbClientConfig[] =
    raw.db_clients?.map((c) => {
      const patternId = validatePatternId(
        c.patternId,
        `python.db_clients entry '${c.id}'`,
      );
      return {
        id: c.id,
        patternId,
        databaseType: c.databaseType,
        importModules: c.importModules ?? [],
        callNames: c.callNames ?? [],
        confidence: c.confidence ?? DEFAULT_CONFIDENCE,
        heuristics: {
          usesObjectsAttribute: c.heuristics?.usesObjectsAttribute ?? false,
        },
      };
    }) ?? [];

  const authJwtRaw = raw.auth?.jwt;
  const authJwt =
    authJwtRaw && authJwtRaw.patternId
      ? {
          patternId: validatePatternId(
            authJwtRaw.patternId,
            "python.auth.jwt.patternId",
          ),
          importModules: authJwtRaw.importModules ?? [],
          contentRegexes: (authJwtRaw.contentRegexes ?? []).map(
            (p) => new RegExp(p),
          ),
          strategy: authJwtRaw.strategy,
          confidence: authJwtRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const authDecorators =
    raw.auth?.decorators?.map((d) => ({
      id: d.id,
      patternId: validatePatternId(
        d.patternId,
        `python.auth.decorators['${d.id}']`,
      ),
      callNames: d.callNames ?? [],
      confidence: d.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const authLibraries =
    raw.auth?.libraries?.map((lib) => ({
      id: lib.id,
      patternId: validatePatternId(
        lib.patternId,
        `python.auth.libraries['${lib.id}']`,
      ),
      contentRegexes: (lib.contentRegexes ?? []).map((p) => new RegExp(p)),
      importModules: lib.importModules ?? [],
      strategy: lib.strategy,
      confidence: lib.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const serverlessHandlers =
    raw.serverless?.handlers?.map((handler) => ({
      id: handler.id,
      patternId: validatePatternId(
        handler.patternId,
        `python.serverless.handlers['${handler.id}']`,
      ),
      importModules: handler.importModules ?? [],
      functionNameRegexes: (handler.functionNameRegexes ?? []).map(
        (p) => new RegExp(p),
      ),
      decoratorNames: handler.decoratorNames ?? [],
      confidence: handler.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const routeFrameworks =
    raw.routes?.frameworks?.map((fw) => ({
      id: fw.id,
      patternId: validatePatternId(
        fw.patternId,
        `python.routes.frameworks['${fw.id}']`,
      ),
      importModules: fw.importModules ?? [],
      decoratorPrefixes: fw.decoratorPrefixes ?? [],
      decoratorNames: fw.decoratorNames ?? [],
      urlsFileSuffix: fw.urlsFileSuffix,
      pathRegex: fw.pathRegex ? new RegExp(fw.pathRegex) : undefined,
      confidence: fw.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const envVarRaw = raw.env_config?.envVariable;
  const envVariable =
    envVarRaw && envVarRaw.patternId && envVarRaw.regex
      ? {
          patternId: validatePatternId(
            envVarRaw.patternId,
            "python.env_config.envVariable.patternId",
          ),
          regex: new RegExp(envVarRaw.regex),
          confidence: envVarRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const djangoSettingsRaw = raw.env_config?.djangoSettings;
  const djangoSettings =
    djangoSettingsRaw && djangoSettingsRaw.patternId
      ? {
          patternId: validatePatternId(
            djangoSettingsRaw.patternId,
            "python.env_config.djangoSettings.patternId",
          ),
          fileSuffix: djangoSettingsRaw.fileSuffix ?? "settings.py",
          name: djangoSettingsRaw.name ?? "django_settings",
          confidence: djangoSettingsRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const dotenvRaw = raw.env_config?.dotenvConfig;
  const dotenvConfig =
    dotenvRaw && dotenvRaw.patternId && dotenvRaw.contentSubstring
      ? {
          patternId: validatePatternId(
            dotenvRaw.patternId,
            "python.env_config.dotenvConfig.patternId",
          ),
          requiresOsImport: dotenvRaw.requiresOsImport ?? true,
          contentSubstring: dotenvRaw.contentSubstring,
          name: dotenvRaw.name ?? "dotenv_config",
          confidence: dotenvRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const externalHttpClients =
    raw.external_apis?.httpClients?.map((client) => ({
      id: client.id,
      patternId: validatePatternId(
        client.patternId,
        `python.external_apis.httpClients['${client.id}']`,
      ),
      clientName: client.clientName,
      importModules: client.importModules ?? [],
      callNames: client.callNames ?? [],
      urlRegex: new RegExp(
        client.urlRegex ??
          "['\\\"](https?:\\/\\/[^\\s'\\\"]+)['\\\"]",
      ),
      confidence: client.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  return {
    dbClients,
    auth: {
      jwt: authJwt,
      decorators: authDecorators,
      libraries: authLibraries,
    },
    serverless: {
      handlers: serverlessHandlers,
    },
    routes: {
      frameworks: routeFrameworks,
    },
    envConfig: {
      envVariable,
      djangoSettings,
      dotenvConfig,
    },
    externalApis: {
      httpClients: externalHttpClients,
    },
  };
}

let cachedConfig: PythonPatternConfig | undefined;

export function clearPythonPatternConfigCache(): void {
  cachedConfig = undefined;
}

export function loadPythonPatternConfig(): PythonPatternConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  let rawYaml: string;
  try {
    rawYaml = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Python pattern config is required but could not be read from '${configPath}': ${msg}`,
    );
  }

  const parsed = YAML.parse(rawYaml) as RawPythonPatternConfig | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `Python pattern config at '${configPath}' did not parse to an object.`,
    );
  }

  const normalized = normalizeRawConfig(parsed);
  cachedConfig = normalized;
  return normalized;
}

