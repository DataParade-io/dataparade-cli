/**
 * Shared third-party detection config loader.
 * Reads patterns/third-party.patterns.yaml (known HTTP clients and services).
 * Used by analyzers to detect external_api_call findings.
 */

import fs from "fs";
import path from "path";
import YAML from "yaml";

import {
  type PatternId,
  PATTERN_IDS,
} from "../core/types/detection";

export interface ThirdPartyHttpClientConfig {
  clientId: string;
  patternId: PatternId;
  callRegexes: RegExp[];
  confidence: number;
}

export interface ThirdPartyServiceConfig {
  serviceName: string;
  patternId: PatternId;
  importFragments: string[];
  confidence: number;
  urlHostPatterns: string[];
}

export interface ThirdPartyDetectionConfig {
  httpClients: ThirdPartyHttpClientConfig[];
  services: ThirdPartyServiceConfig[];
}

interface RawHttpClient {
  clientId: string;
  patternId: string;
  regexes?: string[];
  confidence?: number;
}

interface RawService {
  serviceName: string;
  patternId: string;
  importFragments?: string[];
  confidence?: number;
  url_host_patterns?: string[];
}

interface RawConfig {
  http_clients?: RawHttpClient[];
  services?: RawService[];
}

const DEFAULT_CONFIDENCE = 0.8;

function getConfigPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const cliRoot =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "..", "..");
  return path.join(cliRoot, "patterns", "third-party.patterns.yaml");
}

function compileRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`third-party-detection regex '${pattern}' invalid: ${msg}`);
  }
}

function compileRegexList(patterns: string[] | undefined): RegExp[] {
  if (!patterns || patterns.length === 0) return [];
  return patterns.map((p) => compileRegex(p));
}

function validatePatternId(rawValue: unknown, context: string): PatternId {
  const id = String(rawValue);
  if (!PATTERN_IDS.includes(id as PatternId)) {
    throw new Error(`Invalid patternId '${rawValue}' in ${context}`);
  }
  return id as PatternId;
}

let cached: ThirdPartyDetectionConfig | undefined;

export function clearThirdPartyDetectionConfigCache(): void {
  cached = undefined;
}

export function loadThirdPartyDetectionConfig(): ThirdPartyDetectionConfig {
  if (cached) return cached;

  const configPath = getConfigPath();
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Third-party detection config is required but could not be read from '${configPath}': ${message}`,
    );
  }

  const parsed = YAML.parse(raw) as RawConfig | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `Third-party detection config at '${configPath}' did not parse to an object.`,
    );
  }

  const httpClients: ThirdPartyHttpClientConfig[] = [];
  if (Array.isArray(parsed.http_clients)) {
    for (const hc of parsed.http_clients) {
      const patternId = validatePatternId(
        hc.patternId,
        `third-party-detection.http_clients['${hc.clientId}']`,
      );
      httpClients.push({
        clientId: hc.clientId,
        patternId,
        callRegexes: compileRegexList(hc.regexes),
        confidence: hc.confidence ?? DEFAULT_CONFIDENCE,
      });
    }
  }

  const services: ThirdPartyServiceConfig[] = [];
  if (Array.isArray(parsed.services)) {
    for (const svc of parsed.services) {
      const patternId = validatePatternId(
        svc.patternId,
        `third-party-detection.services['${svc.serviceName}']`,
      );
      const urlHostPatterns: string[] = Array.isArray(svc.url_host_patterns)
        ? svc.url_host_patterns.filter((p): p is string => typeof p === "string")
        : [];
      services.push({
        serviceName: svc.serviceName,
        patternId,
        importFragments: svc.importFragments ?? [],
        confidence: svc.confidence ?? DEFAULT_CONFIDENCE,
        urlHostPatterns,
      });
    }
  }

  cached = { httpClients, services };
  return cached;
}

