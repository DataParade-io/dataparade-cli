import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";
import { getScannerPackageRoot } from "../scanner-package-root";

const piiSignalRuleSchema = z.object({
  id: z.string().min(1),
  category: z.enum(["identifiers", "profile_data", "credentials"]),
  labels: z.array(z.string().min(1)).default([]),
  patterns: z.array(z.string().min(1)).default([]),
});

const piiSignalCatalogSchema = z.object({
  pii_signal_rules: z.array(piiSignalRuleSchema).default([]),
});

export interface PiiSignalRule {
  id: string;
  category: "identifiers" | "profile_data" | "credentials";
  labels: string[];
  patterns: RegExp[];
}

let cachedRules: PiiSignalRule[] | undefined;

export function clearPiiSignalRulesCacheForTest(): void {
  cachedRules = undefined;
}

function getPiiSignalRulesPath(): string {
  return path.join(getScannerPackageRoot(), "patterns", "pii-signals.rules.yaml");
}

export function loadPiiSignalRules(): PiiSignalRule[] {
  if (cachedRules) return cachedRules;
  const configPath = getPiiSignalRulesPath();

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `PII signal rules are required but could not be read from '${configPath}': ${message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `PII signal rules at '${configPath}' could not be parsed as YAML: ${message}`,
    );
  }

  let normalized: z.infer<typeof piiSignalCatalogSchema>;
  try {
    normalized = piiSignalCatalogSchema.parse(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `PII signal rules at '${configPath}' failed schema validation: ${message}`,
    );
  }

  cachedRules = normalized.pii_signal_rules.map((rule) => ({
    id: rule.id.trim().toLowerCase(),
    category: rule.category,
    labels: rule.labels.map((label) => label.trim()).filter(Boolean),
    patterns: rule.patterns.map((pattern) => new RegExp(pattern, "i")),
  }));
  return cachedRules;
}

