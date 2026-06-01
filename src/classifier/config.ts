import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";

import {
  type PatternId,
  PATTERN_IDS,
} from "../core/types/detection";
import type { ComponentType } from "../core/types/component";

export interface NameNormalizationConfig {
  removeSuffixes: string[];
  removeSuffixPatterns: RegExp[];
  trimChars: string;
}

export interface PatternDefaultConfig {
  patternId: PatternId;
  type: ComponentType;
  subType?: string;
  /** Lower values indicate higher priority when resolving conflicts. */
  priority: number;
}

export interface DatabaseTypeMappingEntry {
  subType: string;
}

export interface ThirdPartyConfigEntry {
  serviceName: string;
  matchKeys: string[];
  type: "third_party";
  subType: string;
}

export type ConfidenceAggregationStrategy = "max" | "average";

export interface ResolutionConfig {
  preferThirdPartyOverAsset: boolean;
  confidenceAggregation: ConfidenceAggregationStrategy;
}

export interface ClassifierConfig {
  nameNormalization: NameNormalizationConfig;
  patternDefaults: PatternDefaultConfig[];
  databaseTypeMapping: Record<string, DatabaseTypeMappingEntry>;
  thirdParties: ThirdPartyConfigEntry[];
  resolution: ResolutionConfig;
  envVariableExcludeKeys: Set<string>;
}

const thirdPartyEntrySchema = z.object({
  serviceName: z.string(),
  matchKeys: z.array(z.string()).default([]),
  type: z.literal("third_party"),
  subType: z.string(),
});

const rawClassifierConfigSchema = z.object({
  name_normalization: z
    .object({
      remove_suffixes: z.array(z.string()).default([]),
      remove_suffix_patterns: z.array(z.string()).default([]),
      trim_chars: z.string().default(" _-"),
    })
    .default({
      remove_suffixes: [],
      remove_suffix_patterns: [],
      trim_chars: " _-",
    }),
  pattern_defaults: z.record(
    z.string(),
    z.object({
      type: z.enum(["asset", "actor", "third_party"]),
      subType: z.string().optional(),
      priority: z.number().int().optional(),
    }),
  ),
  database_type_mapping: z
    .record(
      z.string(),
      z.object({
        subType: z.string(),
      }),
    )
    .default({}),
  third_parties: z.array(thirdPartyEntrySchema).default([]),
  resolution: z
    .object({
      prefer_third_party_over_asset: z.boolean().default(true),
      confidence_aggregation: z.enum(["max", "average"]).default("max"),
    })
    .default({
      prefer_third_party_over_asset: true,
      confidence_aggregation: "max",
    }),
  env_variable_exclude_keys: z.array(z.string()).default([]),
});

const rawActorPatternDefaultsSchema = z.object({
  pattern_defaults: z.record(
    z.string(),
    z.object({
      type: z.enum(["asset", "actor", "third_party"]),
      subType: z.string().optional(),
      priority: z.number().int().optional(),
    }),
  ),
});

const thirdPartyCatalogSchema = z.object({
  third_parties: z.array(thirdPartyEntrySchema).default([]),
});

type RawClassifierConfig = z.infer<typeof rawClassifierConfigSchema>;
type RawActorPatternConfig = z.infer<typeof rawActorPatternDefaultsSchema>;
type RawThirdPartyCatalogConfig = z.infer<typeof thirdPartyCatalogSchema>;
type RawThirdPartyEntry = z.infer<typeof thirdPartyEntrySchema>;

function validatePatternId(rawValue: unknown, context: string): PatternId {
  const id = String(rawValue);
  if (!PATTERN_IDS.includes(id as PatternId)) {
    throw new Error(`Invalid patternId '${rawValue}' in ${context}`);
  }
  return id as PatternId;
}

function compileRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown regex compilation error";
    throw new Error(`Invalid regex pattern '${pattern}': ${message}`);
  }
}

function normalizeRawConfig(
  raw: RawClassifierConfig,
  actorPatterns?: RawActorPatternConfig,
): ClassifierConfig {
  const nn = raw.name_normalization;

  const nameNormalization: NameNormalizationConfig = {
    removeSuffixes: nn.remove_suffixes.map((s) => s.toLowerCase()),
    removeSuffixPatterns: nn.remove_suffix_patterns.map((p) => compileRegex(p)),
    trimChars: nn.trim_chars,
  };

  const patternDefaults: PatternDefaultConfig[] = [];

  for (const [patternKey, def] of Object.entries(raw.pattern_defaults)) {
    const patternId = validatePatternId(
      patternKey,
      `pattern_defaults['${patternKey}']`,
    );

    patternDefaults.push({
      patternId,
      type: def.type as ComponentType,
      subType: def.subType,
      priority: def.priority ?? 100,
    });
  }

  if (actorPatterns) {
    for (const [patternKey, def] of Object.entries(
      actorPatterns.pattern_defaults,
    )) {
      const patternId = validatePatternId(
        patternKey,
        `actor.pattern_defaults['${patternKey}']`,
      );

      patternDefaults.push({
        patternId,
        type: def.type as ComponentType,
        subType: def.subType,
        priority: def.priority ?? 100,
      });
    }
  }

  const databaseTypeMapping: Record<string, DatabaseTypeMappingEntry> = {};
  for (const [key, value] of Object.entries(raw.database_type_mapping)) {
    const normalizedKey = key.toLowerCase();
    databaseTypeMapping[normalizedKey] = {
      subType: value.subType,
    };
  }

  const thirdParties = normalizeThirdParties(raw.third_parties);

  const resolution: ResolutionConfig = {
    preferThirdPartyOverAsset:
      raw.resolution.prefer_third_party_over_asset ?? true,
    confidenceAggregation:
      raw.resolution.confidence_aggregation ?? "max",
  };

  const envVariableExcludeKeys = new Set<string>(
    (raw.env_variable_exclude_keys ?? []).map((k) => k.toUpperCase()),
  );

  return {
    nameNormalization,
    patternDefaults,
    databaseTypeMapping,
    thirdParties,
    resolution,
    envVariableExcludeKeys,
  };
}

function normalizeThirdParties(
  rawThirdParties: RawThirdPartyEntry[],
): ThirdPartyConfigEntry[] {
  return rawThirdParties.map((tp) => ({
    serviceName: tp.serviceName,
    matchKeys: tp.matchKeys.map((k) => k.toLowerCase()),
    type: "third_party",
    subType: tp.subType,
  }));
}

let cachedConfig: ClassifierConfig | undefined;

export function clearClassifierConfigCacheForTest(): void {
  cachedConfig = undefined;
}

function getPatternsFilePath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");

  let cliRoot: string;
  if (distIndex !== -1) {
    // e.g. /path/to/cli/dist/src/classifier -> /path/to/cli
    cliRoot = parts.slice(0, distIndex).join(path.sep);
  } else {
    // e.g. /path/to/cli/src/classifier -> /path/to/cli
    cliRoot = path.resolve(__dirname, "..", "..");
  }

  return path.join(
    cliRoot,
    "patterns",
    "classifier",
    "components.classifier.yaml",
  );
}

export function loadClassifierConfig(): ClassifierConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = getPatternsFilePath();
  const thirdPartyConfigPath = ((): string => {
    const parts = __dirname.split(path.sep);
    const distIndex = parts.lastIndexOf("dist");

    let cliRoot: string;
    if (distIndex !== -1) {
      cliRoot = parts.slice(0, distIndex).join(path.sep);
    } else {
      cliRoot = path.resolve(__dirname, "..", "..");
    }

    return path.join(cliRoot, "patterns", "classifier", "third-party.classifier.yaml");
  })();

  const actorPatternsPath = ((): string => {
    const parts = __dirname.split(path.sep);
    const distIndex = parts.lastIndexOf("dist");

    let cliRoot: string;
    if (distIndex !== -1) {
      cliRoot = parts.slice(0, distIndex).join(path.sep);
    } else {
      cliRoot = path.resolve(__dirname, "..", "..");
    }

    return path.join(cliRoot, "patterns", "classifier", "actors.classifier.yaml");
  })();

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Classifier config is required but could not be read from '${configPath}': ${message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Classifier config at '${configPath}' could not be parsed as YAML: ${message}`,
    );
  }

  let rawConfig: RawClassifierConfig;
  try {
    rawConfig = rawClassifierConfigSchema.parse(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Classifier config at '${configPath}' failed schema validation: ${message}`,
    );
  }

  let actorPatterns: RawActorPatternConfig;
  try {
    const rawActors = fs.readFileSync(actorPatternsPath, "utf8");
    const parsedActors = YAML.parse(rawActors);
    actorPatterns = rawActorPatternDefaultsSchema.parse(parsedActors);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Classifier actor config at '${actorPatternsPath}' could not be loaded or validated: ${message}`,
    );
  }

  let normalized: ClassifierConfig;
  try {
    normalized = normalizeRawConfig(rawConfig, actorPatterns);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Classifier config at '${configPath}' is invalid: ${message}`,
    );
  }

  let thirdPartyRaw: string;
  try {
    thirdPartyRaw = fs.readFileSync(thirdPartyConfigPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Third-party classifier catalog is required but could not be read from '${thirdPartyConfigPath}': ${message}`,
    );
  }

  let thirdPartyParsed: unknown;
  try {
    thirdPartyParsed = YAML.parse(thirdPartyRaw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Third-party classifier catalog at '${thirdPartyConfigPath}' could not be parsed as YAML: ${message}`,
    );
  }

  let thirdPartyRawConfig: RawThirdPartyCatalogConfig;
  try {
    thirdPartyRawConfig = thirdPartyCatalogSchema.parse(thirdPartyParsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Third-party classifier catalog at '${thirdPartyConfigPath}' failed schema validation: ${message}`,
    );
  }

  try {
    const extraThirdParties = normalizeThirdParties(
      thirdPartyRawConfig.third_parties,
    );
    normalized.thirdParties = [...normalized.thirdParties, ...extraThirdParties];
    cachedConfig = normalized;
    return normalized;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Third-party classifier catalog at '${thirdPartyConfigPath}' is invalid: ${message}`,
    );
  }
}

