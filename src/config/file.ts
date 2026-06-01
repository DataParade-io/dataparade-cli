import fs from "fs";
import path from "path";

import { z } from "zod";

import { AI_PROVIDER_IDS } from "../ai-enrichment/types";
import type { CliConfigFile } from "./types";
import type { FileLanguage } from "../core/types";

const fileLanguageEnum = z.enum([
  "typescript",
  "javascript",
  "json",
  "yaml",
  "env",
  "python",
  "terraform",
  "dockerfile",
] satisfies [FileLanguage, ...FileLanguage[]]);

const cliConfigFileSchema = z
  .object({
    projectName: z.string().min(1).max(255).optional(),
    excludePaths: z.array(z.string().min(1)).optional(),
    enableAPIDetection: z.boolean().optional(),
    enableDatabaseDetection: z.boolean().optional(),
    enableDataFlowDetection: z.boolean().optional(),
    languages: z.array(fileLanguageEnum).optional(),
    minimumConfidence: z.number().min(0).max(1).optional(),
    deepAnalysis: z.boolean().optional(),
    terraformJsonPath: z.string().min(1).optional(),
    terraformPlanPath: z.string().min(1).optional(),
    terraformStackSectionPathDepth: z.number().int().positive().optional(),
    autoInferTerraformStackSectionPathDepth: z.boolean().optional(),
    monorepoPackageSectionPathDepth: z.number().int().positive().optional(),
    autoInferMonorepoPackageSectionPathDepth: z.boolean().optional(),
    enableAiInference: z.boolean().optional(),
    aiProvider: z.enum(AI_PROVIDER_IDS).optional(),
    aiModel: z.string().min(1).optional(),
    aiEndpoint: z.string().min(1).optional(),
    aiTemperature: z.number().min(0).max(2).optional(),
    aiMaxTokens: z.number().int().positive().optional(),
    aiMaxModelCalls: z.number().int().positive().optional(),
    aiBudgetTokens: z.number().int().positive().optional(),
    aiProviderConcurrency: z.number().int().positive().optional(),
    aiMaxCandidatesPerAgent: z.number().int().min(0).optional(),
    aiInferenceScope: z.enum(["default", "third_party_only"]).optional(),
    aiVerbose: z.boolean().optional(),
    aiToolLoopMaxRounds: z.number().int().positive().optional(),
    aiToolLoopMaxFiles: z.number().int().positive().optional(),
    aiToolLoopMaxSearches: z.number().int().positive().optional(),
    aiThirdPartyDataFlowEnabled: z.boolean().optional(),
  })
  .strict();

export interface LoadedCliConfigFile {
  config: CliConfigFile;
  warnings: string[];
}

export function loadCliConfigFile(cwd: string): LoadedCliConfigFile | null {
  const configPath = path.join(cwd, "dataparade.config.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const contents = fs.readFileSync(configPath, "utf8");

  try {
    const parsed = JSON.parse(contents);
    const result = cliConfigFileSchema.safeParse(parsed);

    if (!result.success) {
      const messages = result.error.issues.map(
        (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
      );

      throw new Error(
        `Invalid dataparade.config.json:\n${messages.join("\n")}`,
      );
    }

    return { config: result.data, warnings: [] };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error parsing config file.";

    throw new Error(`Failed to read dataparade.config.json: ${message}`);
  }
}

