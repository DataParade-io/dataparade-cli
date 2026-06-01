/**
 * Shared property-detection config loader.
 * Reads patterns/property.patterns.yaml (language-agnostic regexes and rules).
 * Used by TypeScript and other analyzers to map findings → component properties.
 */

import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";

import { PATTERN_IDS, type PatternId } from "../core/types/detection";
import { DETECTABLE_PROPERTY_KEYS } from "../classifier/enhance-defaults";

export interface EnhanceConfig {
  mainAppSubtypes: Set<string>;
  defaultThirdPartyHosting: string;
  cloudAssetSubtypes: Set<string>;
  onPremAssetSubtypes: Set<string>;
  supportedOperationsBySubType: Record<string, string[]>;
}

export interface PropertyDetectionConfig {
  regexes: Record<string, RegExp>;
  cloudProviderEnv: Array<{ regex: RegExp; value: string }>;
  knownDatabaseNames: Set<string>;
  externalApiKnownDocumentationUrls: Record<string, string>;
  externalApiKnownPackageNames: Record<string, string>;
  lookupTables: Record<string, Record<string, string>>;
  inferenceRules: Record<string, unknown[]>;
  enhance: EnhanceConfig;
}

interface RawConfig {
  regexes?: Record<string, string>;
  cloud_provider_env?: Array<{ regex: string; value: string }>;
  known_database_names?: string[];
  external_api_known_documentation_urls?: Record<string, string>;
  external_api_known_package_names?: Record<string, string>;
  inference_rules?: Record<string, unknown[]>;
  enhance?: {
    main_app_subtypes?: string[];
    default_third_party_hosting?: string;
    cloud_asset_subtypes?: string[];
    on_prem_asset_subtypes?: string[];
    supported_operations?: Record<string, string[]>;
  };
}

function getConfigPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const cliRoot =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "..", "..");
  return path.join(cliRoot, "patterns", "property.patterns.yaml");
}

function compileRegexes(raw: Record<string, string> | undefined): Record<string, RegExp> {
  const regexes: Record<string, RegExp> = {};
  if (!raw || typeof raw !== "object") return regexes;
  for (const [name, pattern] of Object.entries(raw)) {
    if (typeof pattern === "string") {
      try {
        regexes[name] = new RegExp(pattern, "i");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`property-detection.regexes['${name}'] invalid regex: ${msg}`);
      }
    }
  }
  return regexes;
}

let cached: PropertyDetectionConfig | undefined;

export function clearPropertyDetectionConfigCache(): void {
  cached = undefined;
}

export function loadPropertyDetectionConfig(): PropertyDetectionConfig {
  if (cached) return cached;

  const configPath = getConfigPath();
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Property detection config is required but could not be read from '${configPath}': ${message}`,
    );
  }

  const parsed = YAML.parse(raw) as RawConfig | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `Property detection config at '${configPath}' did not parse to an object.`,
    );
  }

  const regexes = compileRegexes(parsed.regexes);

  const cloudProviderEnv: Array<{ regex: RegExp; value: string }> = [];
  if (Array.isArray(parsed.cloud_provider_env)) {
    for (const entry of parsed.cloud_provider_env) {
      const re = regexes[entry.regex];
      if (re && typeof entry.value === "string") {
        cloudProviderEnv.push({ regex: re, value: entry.value });
      }
    }
  }

  const knownDatabaseNames = new Set<string>();
  if (Array.isArray(parsed.known_database_names)) {
    for (const name of parsed.known_database_names) {
      if (typeof name === "string" && name.trim()) {
        knownDatabaseNames.add(name.trim().toLowerCase());
      }
    }
  }

  const externalApiKnownDocumentationUrls: Record<string, string> = {};
  if (
    parsed.external_api_known_documentation_urls &&
    typeof parsed.external_api_known_documentation_urls === "object"
  ) {
    for (const [k, v] of Object.entries(
      parsed.external_api_known_documentation_urls,
    )) {
      if (typeof v === "string") {
        externalApiKnownDocumentationUrls[k.toLowerCase()] = v;
      }
    }
  }

  const externalApiKnownPackageNames: Record<string, string> = {};
  if (parsed.external_api_known_package_names && typeof parsed.external_api_known_package_names === "object") {
    for (const [k, v] of Object.entries(parsed.external_api_known_package_names)) {
      if (typeof v === "string") {
        externalApiKnownPackageNames[k.toLowerCase()] = v;
      }
    }
  }

  const inferenceRules: Record<string, unknown[]> =
    (parsed.inference_rules && typeof parsed.inference_rules === "object"
      ? (parsed.inference_rules as Record<string, unknown[]>)
      : {}) ?? {};

  const allowedInferenceInputs = new Set<string>([
    "content",
    "key",
    "library",
    "strategy",
    "strategyStr",
    "serviceName",
    "documentationUrl",
    "apiVersion",
    "url",
    "httpMethods",
    "path",
  ]);

  const inferenceRuleWhenSchema: z.ZodTypeAny = z.lazy(() =>
    z.union([
      z.object({ always: z.boolean() }).strict(),
      z.object({ notSet: z.string() }).strict(),
      z.object({ exists: z.string() }).strict(),
      z.object({
        regex: z.object({
          input: z.string(),
          regex: z.string(),
        }),
      }).strict(),
      z.object({
        equals: z.object({
          input: z.string(),
          value: z.any(),
        }),
      }).strict(),
      z.object({
        anyOf: z.array(inferenceRuleWhenSchema),
      }).strict(),
      z.object({
        allOf: z.array(inferenceRuleWhenSchema),
      }).strict(),
      z.object({
        not: inferenceRuleWhenSchema,
      }).strict(),
    ]),
  );

  const lookupAssignmentSchema = z.object({
    lookup: z.object({
      map: z.string(),
      keyInput: z.string(),
      transform: z.string().optional(),
      onMissing: z.string().optional(),
    }),
  });

  const preferInputOrConstantSchema = z.object({
    preferInputOrConstant: z.object({
      input: z.string(),
      fallback: z.union([z.string(), z.number(), z.boolean()]),
    }),
  });

  const fromInputAssignmentSchema = z.object({
    fromInput: z.string(),
  });

  const assignmentSchema = z.union([
    // Constants.
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    // Derived values.
    fromInputAssignmentSchema,
    preferInputOrConstantSchema,
    lookupAssignmentSchema,
  ]);

  const setSchema = z.record(z.string(), assignmentSchema);

  const inferenceRuleSchema = z.object({
    when: inferenceRuleWhenSchema,
    set: setSchema,
  });

  const inferenceRulesSchema = z.record(z.string(), z.array(inferenceRuleSchema));

  const validatedInference = inferenceRulesSchema.safeParse(inferenceRules);
  if (!validatedInference.success) {
    const messages = validatedInference.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(
      `Property inference rules invalid at 'inference_rules': ${messages}`,
    );
  }

  const invalidPatternKeys = Object.keys(inferenceRules).filter(
    (pid) => !PATTERN_IDS.includes(pid as PatternId),
  );
  if (invalidPatternKeys.length > 0) {
    throw new Error(
      `Property inference rules invalid patternId keys: ${invalidPatternKeys.join(", ")}`,
    );
  }

  const lookupTables: Record<string, Record<string, string>> = {
    external_api_known_documentation_urls: externalApiKnownDocumentationUrls,
    external_api_known_package_names: externalApiKnownPackageNames,
  };

  function validateWhenSemantic(
    when: any,
    ctx: { patternId: string; ruleIdx: number },
  ): void {
    if (!when || typeof when !== "object") return;

    if (when.always === true) return;

    if (typeof when.notSet === "string") {
      const input = when.notSet;
      // `notSet` checks whether the output property is still undefined (i.e.
      // `out[input] === undefined`), so it refers to output property keys.
      if (!DETECTABLE_PROPERTY_KEYS.has(input)) {
        throw new Error(
          `Invalid inference_rules['${ctx.patternId}'][${ctx.ruleIdx}].when.notSet input '${input}': must be a detectable/assignable property key.`,
        );
      }
      return;
    }

    if (typeof when.exists === "string") {
      const input = when.exists;
      if (!allowedInferenceInputs.has(input)) {
        throw new Error(
          `Invalid inference_rules['${ctx.patternId}'][${ctx.ruleIdx}].when.exists input '${input}'.`,
        );
      }
      return;
    }

    if (when.regex && typeof when.regex === "object") {
      const input = String(when.regex.input);
      const regexName = String(when.regex.regex);
      if (!allowedInferenceInputs.has(input)) {
        throw new Error(
          `Invalid inference_rules['${ctx.patternId}'][${ctx.ruleIdx}].when.regex.input '${input}'.`,
        );
      }
      if (!(regexName in regexes)) {
        throw new Error(
          `Invalid inference_rules['${ctx.patternId}'][${ctx.ruleIdx}].when.regex.regex '${regexName}' (missing from property.patterns.yaml.regexes).`,
        );
      }
      return;
    }

    if (when.equals && typeof when.equals === "object") {
      const input = String(when.equals.input);
      if (!allowedInferenceInputs.has(input)) {
        throw new Error(
          `Invalid inference_rules['${ctx.patternId}'][${ctx.ruleIdx}].when.equals.input '${input}'.`,
        );
      }
      return;
    }

    if (Array.isArray(when.anyOf)) {
      for (let i = 0; i < when.anyOf.length; i += 1) {
        validateWhenSemantic(when.anyOf[i], ctx);
      }
      return;
    }

    if (Array.isArray(when.allOf)) {
      for (let i = 0; i < when.allOf.length; i += 1) {
        validateWhenSemantic(when.allOf[i], ctx);
      }
      return;
    }

    if (when.not) {
      validateWhenSemantic(when.not, ctx);
      return;
    }
  }

  function validateSetSemantic(
    setObj: any,
    ctx: { patternId: string; ruleIdx: number },
  ): void {
    if (!setObj || typeof setObj !== "object") return;

    for (const [outKey, assignment] of Object.entries(setObj as Record<string, unknown>)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _outKey = outKey;
      if (assignment === undefined || assignment === null) continue;

      if (!DETECTABLE_PROPERTY_KEYS.has(outKey)) {
        throw new Error(
          `Invalid inference_rules['${ctx.patternId}'][${ctx.ruleIdx}].set.${outKey}: unknown/unsupported property key (must be in DETECTABLE_PROPERTY_KEYS).`,
        );
      }

      if (typeof assignment === "string" || typeof assignment === "number" || typeof assignment === "boolean") {
        continue;
      }

      if (typeof assignment !== "object") {
        throw new Error(
          `Invalid inference_rules['${ctx.patternId}'][${ctx.ruleIdx}].set value for '${outKey}'.`,
        );
      }

      const a = assignment as any;

      if (typeof a.fromInput === "string") {
        const input = a.fromInput;
        if (!allowedInferenceInputs.has(input)) {
          throw new Error(
            `Invalid inference_rules['${ctx.patternId}'][${ctx.ruleIdx}].set.${outKey}.fromInput '${input}'.`,
          );
        }
        continue;
      }

      if (a.preferInputOrConstant && typeof a.preferInputOrConstant === "object") {
        const input = String(a.preferInputOrConstant.input);
        if (!allowedInferenceInputs.has(input)) {
          throw new Error(
            `Invalid inference_rules['${ctx.patternId}'][${ctx.ruleIdx}].set.${outKey}.preferInputOrConstant.input '${input}'.`,
          );
        }
        continue;
      }

      if (a.lookup && typeof a.lookup === "object") {
        const lookupMap = String(a.lookup.map);
        const keyInput = String(a.lookup.keyInput);

        if (!(lookupMap in lookupTables)) {
          throw new Error(
            `Invalid inference_rules['${ctx.patternId}'][${ctx.ruleIdx}].set.${outKey}.lookup.map '${lookupMap}'.`,
          );
        }
        if (!allowedInferenceInputs.has(keyInput)) {
          throw new Error(
            `Invalid inference_rules['${ctx.patternId}'][${ctx.ruleIdx}].set.${outKey}.lookup.keyInput '${keyInput}'.`,
          );
        }

        const transform = a.lookup.transform;
        if (transform !== undefined && transform !== "lowercase") {
          throw new Error(
            `Invalid inference_rules['${ctx.patternId}'][${ctx.ruleIdx}].set.${outKey}.lookup.transform '${String(
              transform,
            )}' (only 'lowercase' is supported).`,
          );
        }

        const onMissing = a.lookup.onMissing;
        if (onMissing !== undefined && onMissing !== "skip") {
          throw new Error(
            `Invalid inference_rules['${ctx.patternId}'][${ctx.ruleIdx}].set.${outKey}.lookup.onMissing '${String(
              onMissing,
            )}' (only 'skip' is supported).`,
          );
        }

        continue;
      }
    }
  }

  // Semantic validation pass (fail-fast) after schema validation.
  // Validates:
  // - `when.*.input` refers to a supported inference context input
  // - `when.regex.regex` refers to an actual regex in `regexes`
  // - `set.*.lookup.map` refers to a known lookup table
  // - `set.*` only assigns detectable/supported property keys
  for (const [patternId, rulesForPattern] of Object.entries(inferenceRules)) {
    const pid = String(patternId);
    const rulesArray = Array.isArray(rulesForPattern) ? rulesForPattern : [];

    for (let ruleIdx = 0; ruleIdx < rulesArray.length; ruleIdx += 1) {
      const rule = rulesArray[ruleIdx] as any;
      validateWhenSemantic(rule?.when, { patternId: pid, ruleIdx });
      validateSetSemantic(rule?.set, { patternId: pid, ruleIdx });
    }
  }

  const rawEnhance = parsed.enhance;
  const enhance: EnhanceConfig = {
    mainAppSubtypes: toSet(rawEnhance?.main_app_subtypes, ["api", "service"]),
    defaultThirdPartyHosting:
      typeof rawEnhance?.default_third_party_hosting === "string"
        ? rawEnhance.default_third_party_hosting
        : "saas",
    cloudAssetSubtypes: toSet(rawEnhance?.cloud_asset_subtypes, [
      "api",
      "service",
      "database",
      "cache",
      "container",
      "auth_service",
      "function",
    ]),
    onPremAssetSubtypes: toSet(rawEnhance?.on_prem_asset_subtypes, ["config"]),
    supportedOperationsBySubType:
      rawEnhance?.supported_operations && typeof rawEnhance.supported_operations === "object"
        ? rawEnhance.supported_operations
        : {},
  };

  cached = {
    regexes,
    cloudProviderEnv,
    knownDatabaseNames,
    externalApiKnownDocumentationUrls,
    externalApiKnownPackageNames,
    lookupTables,
    inferenceRules: validatedInference.data,
    enhance,
  };
  return cached;
}

function toSet(arr: string[] | undefined, defaultVal: string[]): Set<string> {
  const out = new Set<string>();
  const src = Array.isArray(arr) && arr.length > 0 ? arr : defaultVal;
  for (const s of src) {
    if (typeof s === "string" && s.trim()) out.add(s.trim());
  }
  return out;
}
