import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";

const nonPiiSignalRuleSchema = z.object({
  id: z.string().min(1),
  category: z.enum(["auth_artifacts", "usage_metadata", "telemetry", "content_files", "identifiers"]),
  labels: z.array(z.string().min(1)).default([]),
  patterns: z.array(z.string().min(1)).default([]),
  capabilities: z.array(z.string().min(1)).default([]),
  directionHint: z.enum(["outbound_to_third_party", "inbound_from_third_party"]).optional(),
});

const nonPiiSignalCatalogSchema = z.object({
  non_pii_signal_rules: z.array(nonPiiSignalRuleSchema).default([]),
});

export interface NonPiiSignalRule {
  id: string;
  category: "auth_artifacts" | "usage_metadata" | "telemetry" | "content_files" | "identifiers";
  labels: string[];
  patterns: RegExp[];
  capabilities: string[];
  directionHint?: "outbound_to_third_party" | "inbound_from_third_party";
}

let cachedRules: NonPiiSignalRule[] | undefined;

export function clearNonPiiSignalRulesCacheForTest(): void {
  cachedRules = undefined;
}

function getNonPiiSignalRulesPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const cliRoot =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "..", "..");
  return path.join(cliRoot, "patterns", "non-pii-signals.rules.yaml");
}

export function loadNonPiiSignalRules(): NonPiiSignalRule[] {
  if (cachedRules) return cachedRules;
  const configPath = getNonPiiSignalRulesPath();

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Non-PII signal rules are required but could not be read from '${configPath}': ${message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Non-PII signal rules at '${configPath}' could not be parsed as YAML: ${message}`,
    );
  }

  let normalized: z.infer<typeof nonPiiSignalCatalogSchema>;
  try {
    normalized = nonPiiSignalCatalogSchema.parse(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Non-PII signal rules at '${configPath}' failed schema validation: ${message}`,
    );
  }

  cachedRules = normalized.non_pii_signal_rules.map((rule) => ({
    id: rule.id.trim().toLowerCase(),
    category: rule.category,
    labels: rule.labels.map((label) => label.trim()).filter(Boolean),
    patterns: rule.patterns.map((pattern) => new RegExp(pattern, "i")),
    capabilities: rule.capabilities.map((cap) => cap.trim().toLowerCase()).filter(Boolean),
    directionHint: rule.directionHint,
  }));
  return cachedRules;
}

