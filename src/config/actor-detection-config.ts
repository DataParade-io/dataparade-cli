/**
 * Shared actor-detection config loader.
 * Reads patterns/actor.patterns.yaml (language-agnostic regexes and rules).
 * Used by analyzers to emit actor-related RawFindings (web_actor, service_actor).
 */

import fs from "fs";
import path from "path";
import YAML from "yaml";

import {
  type PatternId,
  PATTERN_IDS,
} from "../core/types/detection";

export interface ActorRule {
  id: string;
  patternId: PatternId;
  name: string;
  filePathRegex?: RegExp;
  contentRegex?: RegExp;
  confidence: number;
  properties: Record<string, unknown>;
}

export interface ActorDetectionConfig {
  regexes: Record<string, RegExp>;
  rules: ActorRule[];
}

interface RawRule {
  id: string;
  patternId: string;
  name?: string;
  file_path_regex?: string;
  content_regex?: string;
  confidence?: number;
  properties?: Record<string, unknown>;
}

interface RawConfig {
  regexes?: Record<string, string>;
  rules?: RawRule[];
}

function getConfigPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const cliRoot =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "..", "..");
  return path.join(cliRoot, "patterns", "actor.patterns.yaml");
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
        throw new Error(`actor-detection.regexes['${name}'] invalid regex: ${msg}`);
      }
    }
  }
  return regexes;
}

function validatePatternId(rawValue: unknown, context: string): PatternId {
  const id = String(rawValue);
  if (!PATTERN_IDS.includes(id as PatternId)) {
    throw new Error(`Invalid patternId '${rawValue}' in ${context}`);
  }
  return id as PatternId;
}

let cached: ActorDetectionConfig | undefined;

export function clearActorDetectionConfigCache(): void {
  cached = undefined;
}

export function loadActorDetectionConfig(): ActorDetectionConfig {
  if (cached) return cached;

  const configPath = getConfigPath();
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Actor detection config is required but could not be read from '${configPath}': ${message}`,
    );
  }

  const parsed = YAML.parse(raw) as RawConfig | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `Actor detection config at '${configPath}' did not parse to an object.`,
    );
  }

  const regexes = compileRegexes(parsed.regexes);

  const rules: ActorRule[] = [];
  if (Array.isArray(parsed.rules)) {
    for (const rawRule of parsed.rules) {
      const patternId = validatePatternId(
        rawRule.patternId,
        `actor-detection.rules['${rawRule.id}']`,
      );

      const filePathRegex =
        rawRule.file_path_regex != null
          ? regexes[rawRule.file_path_regex]
          : undefined;
      const contentRegex =
        rawRule.content_regex != null
          ? regexes[rawRule.content_regex]
          : undefined;

      if (!filePathRegex && !contentRegex) {
        // Skip rules that have neither file path nor content regex.
        continue;
      }

      rules.push({
        id: rawRule.id,
        patternId,
        name: rawRule.name ?? rawRule.id,
        filePathRegex,
        contentRegex,
        confidence: rawRule.confidence ?? 0.8,
        properties: rawRule.properties ?? {},
      });
    }
  }

  cached = { regexes, rules };
  return cached;
}

