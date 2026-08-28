import { z } from "zod";
import { AI_PROVIDER_IDS } from "../../ai-enrichment/types";
import { validateAiInferenceCredentials } from "../../config/validate-scan-ai";
import type { ScanConfiguration } from "../types";
import type { FileLanguage } from "../types";

const fileLanguageEnum = z.enum([
  "typescript",
  "javascript",
  "json",
  "yaml",
  "env",
  "python",
  "cpp",
  "csharp",
  "go",
  "java",
  "kotlin",
  "terraform",
  "dockerfile",
  "rust",
] satisfies [FileLanguage, ...FileLanguage[]]);

export const scanConfigurationSchema = z.object({
  projectName: z.string().min(1).max(255).optional(),
  excludePaths: z.array(z.string().min(1)).optional(),
  enableAPIDetection: z.boolean(),
  enableDatabaseDetection: z.boolean(),
  enableDataFlowDetection: z.boolean(),
  languages: z.array(fileLanguageEnum).optional(),
  minimumConfidence: z.number().min(0).max(1),
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
  aiApiKey: z.string().min(1).optional(),
  aiTemperature: z.number().min(0).max(2).optional(),
  aiMaxTokens: z.number().int().positive().optional(),
  aiMaxModelCalls: z.number().int().positive().optional(),
  aiBudgetTokens: z.number().int().positive().optional(),
  aiProviderConcurrency: z.number().int().positive().optional(),
  aiMaxCandidatesPerAgent: z.number().int().min(0).optional(),
  aiInferenceScope: z.enum(["default", "third_party_only"]).optional(),
  aiVerbose: z.boolean().optional(),
  workspaceApiKey: z.string().min(1).optional(),
  anonSessionToken: z.string().min(1).optional(),
  aiMode: z.enum(["byok", "platform", "hosted_worker", "none"]).optional(),
  platformApiBaseUrl: z.string().min(1).optional(),
  cliQuotaJobId: z.string().min(1).optional(),
  hostedInferProxyUrl: z.string().min(1).optional(),
});

export function parseScanConfiguration(input: unknown): ScanConfiguration {
  return scanConfigurationSchema.parse(input) as ScanConfiguration;
}

export function validateScanConfiguration(input: unknown):
  | { ok: true; value: ScanConfiguration }
  | { ok: false; errors: string[] } {
  const result = scanConfigurationSchema.safeParse(input);

  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
    );
    return { ok: false, errors };
  }

  const value = result.data as ScanConfiguration;
  const aiErrors = validateAiInferenceCredentials(value);
  if (aiErrors.length > 0) {
    return { ok: false, errors: aiErrors };
  }

  return { ok: true, value };
}

