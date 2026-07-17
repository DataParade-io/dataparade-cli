import type { FileLanguage } from "./file";
import type { AiInferenceScope, AiProviderId } from "../../ai-enrichment/types";

export interface ScanConfiguration {
  projectName?: string;
  excludePaths?: string[];
  enableAPIDetection: boolean;
  enableDatabaseDetection: boolean;
  enableDataFlowDetection: boolean;
  languages?: FileLanguage[];
  minimumConfidence: number;
  deepAnalysis?: boolean;
  terraformJsonPath?: string;
  terraformPlanPath?: string;
  terraformStackSectionPathDepth?: number;
  /** When true (default), infer stack section depth from `.tf` layout if depth is unset. */
  autoInferTerraformStackSectionPathDepth?: boolean;
  /** Fixed workspace package depth (POSIX segments); overrides inference when set. */
  monorepoPackageSectionPathDepth?: number;
  /** When true (default), infer workspace package depth from `package.json` layout. */
  autoInferMonorepoPackageSectionPathDepth?: boolean;
  enableAiInference?: boolean;
  aiProvider?: AiProviderId;
  aiModel?: string;
  aiEndpoint?: string;
  aiApiKey?: string;
  aiTemperature?: number;
  aiMaxTokens?: number;
  aiMaxModelCalls?: number;
  aiBudgetTokens?: number;
  /** Max in-flight provider calls for tpAgent (batch size / burst control). */
  aiProviderConcurrency?: number;
  /**
   * Max inference work items queued per agent (property, third-party, etc.).
   * Use `0` for no cap (every matching node / flow can be queued — costly).
   */
  aiMaxCandidatesPerAgent?: number;
  /** Default: full inference; `third_party_only` runs AI only on every third_party node. */
  aiInferenceScope?: AiInferenceScope;
  /** When true, include per-proposal AI inference details in scan output/logs. */
  aiVerbose?: boolean;
  /** Max iterative rounds for third-party orchestrator tool loop. */
  aiToolLoopMaxRounds?: number;
  /** Max distinct files reviewed per third-party candidate in tool loop. */
  aiToolLoopMaxFiles?: number;
  /** Max seeded search terms per third-party candidate in tool loop. */
  aiToolLoopMaxSearches?: number;
  /** Toggle third-party data-flow inference summary generation in AI metadata. */
  aiThirdPartyDataFlowEnabled?: boolean;
  /** DataParade workspace API key (quota + platform LLM proxy). */
  workspaceApiKey?: string;
  /**
   * Anonymous platform AI session token (`dp_anon_…`) from
   * POST /api/scans/cli/ai/anonymous-session. Mutually exclusive with workspaceApiKey.
   */
  anonSessionToken?: string;
  /** How LLM inference is billed: byok (direct provider) or platform (API proxy). */
  aiMode?: "byok" | "platform" | "hosted_worker" | "none";
  /** Base URL for platform API (preflight / infer / complete). */
  platformApiBaseUrl?: string;
  /** CLI quota job id from preflight (platform mode). */
  cliQuotaJobId?: string;
  /** Loopback infer URL when hosted scan runs inside VPC scan worker. */
  hostedInferProxyUrl?: string;
}

