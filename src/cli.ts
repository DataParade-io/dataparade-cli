import "./config/load-cli-env";
import pathModule from "path";
import { Command } from "commander";

import type { DiagramGraphJsonSchema } from "./core/schema";
import { writeDataflowJson } from "./output/json";
import { AI_PROVIDER_IDS, type AiProviderId } from "./ai-enrichment/types";
import type { CliConfigFlags } from "./config/types";
import { parseAiInferenceScope } from "./config/inference-scope";
import { redactScanConfigurationForDisplay } from "./config/redact";
import { resolveScanConfiguration } from "./config/resolve";
import { resolveWorkspaceApiKey } from "./config/scan-env";
import { resolveAiMode } from "./config/validate-scan-ai";
import {
  reportScanCliError,
  type ScanCliAiMode,
} from "./observability/scan-sentry";
import { validateScanConfiguration } from "./core/schema/scan-config.schema";
import type { AiInferenceProposalDetail } from "./core/types";
import { resolveScanFilesystemEntry } from "./ingest/file-system";

function formatEvidence(detail: AiInferenceProposalDetail): string {
  const evidence = detail.evidence;
  if (!evidence || evidence.length === 0) {
    return "none";
  }
  const head = evidence[0];
  const first =
    head != null
      ? `${head.filePath}:${head.startLine}-${head.endLine} (${head.reason})`
      : "none";
  return evidence.length === 1 ? first : `${first}; +${evidence.length - 1} more`;
}

function formatProposalTarget(detail: AiInferenceProposalDetail): string {
  if (detail.kind === "component_patch" && detail.targetComponentId) {
    return `component:${detail.targetComponentId}`;
  }
  if (detail.targetFlowId) return `flow:${detail.targetFlowId}`;
  if (detail.sourceComponentId && detail.targetFlowComponentId) {
    return `flow:${detail.sourceComponentId}->${detail.targetFlowComponentId}`;
  }
  return "unknown";
}

function printAiInferenceVerbose(details: AiInferenceProposalDetail[]): void {
  if (details.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[scan] ai-inference details: no proposals generated");
    return;
  }

  // eslint-disable-next-line no-console
  console.log("[scan] ai-inference details:");
  for (const detail of details) {
    const status =
      detail.status === "applied" ? "applied" : `rejected (${detail.rejectionReason})`;
    const confidence = detail.confidence.toFixed(2);
    // eslint-disable-next-line no-console
    console.log(
      `[scan]   - ${detail.id}: ${status} | ${detail.source} | ${detail.kind} | target=${formatProposalTarget(detail)} | confidence=${confidence} (${detail.confidenceBand})`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[scan]       candidate=${detail.candidateType} agent=${detail.agent} provider=${detail.provider}/${detail.model}`,
    );
    // eslint-disable-next-line no-console
    console.log(`[scan]       evidence=${formatEvidence(detail)}`);
    if (detail.status === "applied" && detail.propertyChanges && detail.propertyChanges.length) {
      const formatted = detail.propertyChanges.map((change) => {
        const from = JSON.stringify(change.from);
        const to = JSON.stringify(change.to);
        return `${change.key}: ${from} -> ${to}`;
      });
      for (const line of formatted) {
        // eslint-disable-next-line no-console
        console.log(`[scan]       changes=${line}`);
      }
    }
  }
}


function formatUsd(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(6)}`;
}

function createProgram(): Command {
  const program = new Command();

  program
    .name("dataparade")
    .description("DataParade CLI - scan codebases for data flow components")
    .version("0.0.0");

  program
    .command("scan <path>")
    .description(
      "Scan a directory (or a single supported source file) for data flow components",
    )
    .option(
      "-o, --output <file>",
      "Write dataflow.json wrapper to the given file (default: ./dataflow.json)",
    )
    .option(
      "--exclude <pattern...>",
      "One or more glob patterns to exclude from scanning",
    )
    .option(
      "--minimum-confidence <number>",
      "Minimum confidence (0-1) for including detections",
    )
    .option(
      "--language <language...>",
      "Limit scanning to specific languages (e.g. typescript, javascript)",
    )
    .option(
      "--project-name <name>",
      "Override the inferred project name used for the application asset",
    )
    .option(
      "--deep-analysis",
      "Enable deeper, potentially slower structural analysis where supported",
    )
    .option(
      "--terraform-json <path>",
      "Merge resource addresses from a saved `terraform show -json` file (absolute or relative to scan root)",
    )
    .option(
      "--terraform-plan <path>",
      "Merge addresses by running `terraform show -json <path>` from the scan root (path relative to scan root; requires terraform on PATH)",
    )
    .option(
      "--terraform-stack-section-path-depth <n>",
      "Register Terraform stack directories as service sections when their path has exactly N segments (e.g. 4 for packages/foo/k8s/terraform)",
    )
    .option(
      "--no-terraform-stack-section-auto",
      "Do not infer terraformStackSectionPathDepth from .tf layout when depth is unset",
    )
    .option(
      "--monorepo-package-section-path-depth <n>",
      "Workspace package section depth (max 3): primary packages and rollup use N POSIX path segments (e.g. 3 for packages/twenty-apps/hello)",
    )
    .option(
      "--no-monorepo-package-section-auto",
      "Do not infer monorepoPackageSectionPathDepth from package.json layout when depth is unset",
    )
    .option("--ai-inference", "Enable post-scan AI inference pipeline")
    .option(
      "--ai-provider <provider>",
      `AI provider: ${AI_PROVIDER_IDS.join("|")}`,
    )
    .option("--ai-model <model>", "Model name for AI inference")
    .option("--ai-endpoint <url>", "Override provider endpoint URL")
    .option("--ai-temperature <number>", "Sampling temperature for model calls")
    .option("--ai-max-tokens <number>", "Max tokens per inference call")
    .option("--ai-max-calls <number>", "Max model calls for a scan")
    .option("--ai-budget-tokens <number>", "Total token budget for inference")
    .option(
      "--ai-max-candidates-per-agent <number>",
      "Max inference queue items per agent (0 = no cap; default from config: 25)",
    )
    .option(
      "--ai-inference-scope <scope>",
      "default | third_party_only — third_party_only runs AI enrichment only on every third-party node",
    )
    .option(
      "--ai-verbose",
      "Print per-proposal AI inference details (applied/rejected + evidence)",
    )
    .option(
      "--workspace-api-key <key>",
      "DataParade workspace API key (platform AI + quota; env: DATAPARADE_WORKSPACE_API_KEY)",
    )
    .option("--api-key <key>", "(deprecated) alias for --workspace-api-key")
    .option(
      "--byok-provider <provider>",
      `BYOK LLM provider when using your own API key: ${AI_PROVIDER_IDS.join("|")}`,
    )
    .option("--byok-model <model>", "BYOK model name (env: SCAN_BYOK_MODEL)")
    .action(
      async (
        path: string,
        options: {
          output?: string;
          exclude?: string[];
          minimumConfidence?: string;
          language?: string[];
          projectName?: string;
          deepAnalysis?: boolean;
          terraformJson?: string;
          terraformPlan?: string;
          terraformStackSectionPathDepth?: string;
          noTerraformStackSectionAuto?: boolean;
          monorepoPackageSectionPathDepth?: string;
          noMonorepoPackageSectionAuto?: boolean;
          aiInference?: boolean;
          aiProvider?: AiProviderId;
          aiModel?: string;
          aiEndpoint?: string;
          aiTemperature?: string;
          aiMaxTokens?: string;
          aiMaxCalls?: string;
          aiBudgetTokens?: string;
          aiMaxCandidatesPerAgent?: string;
          aiInferenceScope?: string;
          aiVerbose?: boolean;
          workspaceApiKey?: string;
          apiKey?: string;
          byokProvider?: AiProviderId;
          byokModel?: string;
        },
      ) => {
        let cliQuotaJobId: string | undefined;
        let platformQuotaApiKey: string | undefined;
        let quotaCompletionReported = false;
        let fallbackFailureMessage = "CLI scan did not complete successfully";
        let sentryScanRoot: string | undefined;
        let sentryAiMode: ScanCliAiMode | undefined;
        let sentryAiProvider: string | undefined;
        const workspaceApiKey =
          options.workspaceApiKey?.trim() ||
          options.apiKey?.trim() ||
          resolveWorkspaceApiKey(process.env);

        try {
          const rootPathArg = path || ".";
          // Load dataparade.config.json from the directory being scanned, not
          // process.cwd(). Locally these often match; in Lambda the worker cwd
          // is the image root (/var/task) while the scan path is /tmp/.../project.
          const resolvedScanRoot = pathModule.resolve(process.cwd(), rootPathArg);

          let scanEntry: { scanRootDir: string; ingestTarget: string };
          try {
            scanEntry = await resolveScanFilesystemEntry(resolvedScanRoot);
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Path does not exist.";
            sentryScanRoot = resolvedScanRoot;
            await reportScanCliError({
              error: err,
              scanRoot: sentryScanRoot,
              failurePhase: "resolve_path",
              failureCode: "path_not_found",
            });
            // eslint-disable-next-line no-console
            console.error(`[scan] error: ${message}`);
            process.exitCode = 2;
            return;
          }

          const isInteractive = process.stdout.isTTY;
          const [{ scan, createDefaultScanConfiguration }, { buildDiagramGraphFromScanResult }] =
            await Promise.all([
              import("./core/pipeline/orchestrator"),
              import("./core/pipeline/graph-mapping"),
            ]);

          if (isInteractive) {
            // eslint-disable-next-line no-console
            console.log(`[scan] starting scan for ${resolvedScanRoot}`);
          }

          const flags: CliConfigFlags = {
            exclude: options.exclude,
            minimumConfidence:
              typeof options.minimumConfidence === "string"
                ? Number(options.minimumConfidence)
                : undefined,
            language: options.language,
            deepAnalysis: options.deepAnalysis,
            projectName: options.projectName,
            terraformJson: options.terraformJson,
            terraformPlan: options.terraformPlan,
            terraformStackSectionPathDepth:
              typeof options.terraformStackSectionPathDepth === "string"
                ? Number(options.terraformStackSectionPathDepth)
                : undefined,
            noTerraformStackSectionAuto: options.noTerraformStackSectionAuto,
            monorepoPackageSectionPathDepth:
              typeof options.monorepoPackageSectionPathDepth === "string"
                ? Number(options.monorepoPackageSectionPathDepth)
                : undefined,
            noMonorepoPackageSectionAuto: options.noMonorepoPackageSectionAuto,
            aiInference: options.aiInference,
            aiProvider: options.aiProvider,
            aiModel: options.aiModel,
            aiEndpoint: options.aiEndpoint,
            aiTemperature:
              typeof options.aiTemperature === "string"
                ? Number(options.aiTemperature)
                : undefined,
            aiMaxTokens:
              typeof options.aiMaxTokens === "string"
                ? Number(options.aiMaxTokens)
                : undefined,
            aiMaxModelCalls:
              typeof options.aiMaxCalls === "string"
                ? Number(options.aiMaxCalls)
                : undefined,
            aiBudgetTokens:
              typeof options.aiBudgetTokens === "string"
                ? Number(options.aiBudgetTokens)
                : undefined,
            aiMaxCandidatesPerAgent:
              typeof options.aiMaxCandidatesPerAgent === "string"
                ? Number(options.aiMaxCandidatesPerAgent)
                : undefined,
            aiInferenceScope: parseAiInferenceScope(options.aiInferenceScope),
            aiVerbose: options.aiVerbose,
            workspaceApiKey,
            byokProvider: options.byokProvider,
            byokModel: options.byokModel,
          };

          const { overrides, warnings } = resolveScanConfiguration({
            cwd: scanEntry.scanRootDir,
            flags,
          });

          const config = createDefaultScanConfiguration(overrides);
          if (workspaceApiKey) {
            config.workspaceApiKey = workspaceApiKey;
          }

          const aiMode = resolveAiMode(config);
          const usesByok = aiMode === "byok";
          sentryScanRoot = scanEntry.scanRootDir;
          sentryAiMode = aiMode;
          sentryAiProvider = config.aiProvider;

          // Quota preflight for platform billing. Structural-only scans (AI off) do not use quota API.
          if (workspaceApiKey && !usesByok && config.enableAiInference) {
            const [{ cliScanPreflight }, { estimateScanFootprint }] =
              await Promise.all([
                import("./platform-api/scan-quota-client"),
                import("./platform-api/estimate-scan-footprint"),
              ]);
            const footprint = await estimateScanFootprint(
              scanEntry.scanRootDir,
              config.excludePaths ?? [],
            );
            const preflight = await cliScanPreflight({
              apiKey: workspaceApiKey,
              enableAi: config.enableAiInference,
              projectName: config.projectName,
              fileCount: footprint.fileCount,
              bytesIngested: footprint.bytesIngested,
            });
            cliQuotaJobId = preflight.jobId;
            platformQuotaApiKey = workspaceApiKey;
            config.cliQuotaJobId = preflight.jobId;
            if (
              config.enableAiInference &&
              preflight.suggestedAiBudgetTokens > 0
            ) {
              config.aiBudgetTokens = preflight.suggestedAiBudgetTokens;
            }
            if (preflight.aiDelivery === "platform_proxy") {
              config.aiMode = "platform";
            }
            if (isInteractive) {
              // eslint-disable-next-line no-console
              console.log(
                `[scan] quota: scans_remaining=${preflight.scansRemaining} ai_tokens_remaining=${preflight.aiTokensRemaining} job_id=${preflight.jobId}`,
              );
            }
          }

          const configValidation = validateScanConfiguration(config);
          if (!configValidation.ok) {
            await reportScanCliError({
              error: configValidation.errors.join("\n"),
              scanRoot: sentryScanRoot,
              jobId: cliQuotaJobId,
              aiMode: sentryAiMode,
              aiProvider: sentryAiProvider,
              failurePhase: "config_validation",
              failureCode: "invalid_configuration",
            });
            // eslint-disable-next-line no-console
            console.error(
              `[scan] invalid configuration:\n${configValidation.errors.map((e) => `  - ${e}`).join("\n")}`,
            );
            process.exitCode = 2;
            return;
          }

          if (isInteractive && warnings.length > 0) {
            // eslint-disable-next-line no-console
            console.warn(
              `[scan] warnings:\n${warnings.map((w) => `  - ${w}`).join("\n")}`,
            );
          }

          const { scanResult } = await scan(
            resolvedScanRoot,
            config,
            (progress) => {
              if (!isInteractive) return;
              // eslint-disable-next-line no-console
              console.log(
                `[scan] ${progress.phase}: ${progress.message ?? ""}`.trim(),
              );
            },
          );

          if (scanResult.structuralEnrichmentSummary) {
            const st = scanResult.structuralEnrichmentSummary;
            // eslint-disable-next-line no-console
            console.log(
              `[scan] structural enrichment: proposals=${st.proposalsGenerated} applied=${st.proposalsApplied} rejected=${st.proposalsRejected}`,
            );
          }

          if (scanResult.aiInferenceSummary) {
            const s = scanResult.aiInferenceSummary;
            // eslint-disable-next-line no-console
            console.log(
              `[scan] llm-inference summary: candidates=${s.candidatesConsidered} proposals=${s.proposalsGenerated} (provider=${s.proposalsGeneratedProvider}) applied=${s.proposalsApplied} (provider=${s.proposalsAppliedProvider}) rejected=${s.proposalsRejected} (${s.aiProvider}/${s.aiModel})`,
            );
            if (options.aiVerbose) {
              // eslint-disable-next-line no-console
              console.log(
                `[scan] ai-usage totals: provider_calls=${s.providerCalls} tokens_in=${s.inputTokens} tokens_out=${s.outputTokens} tokens_total=${s.totalTokens} estimated_cost_usd=${formatUsd(s.estimatedCostUsd)}`,
              );
            }
            if (options.aiVerbose && scanResult.aiInferenceProposalDetails) {
              printAiInferenceVerbose(scanResult.aiInferenceProposalDetails);
            }
          }

          for (const w of scanResult.warnings ?? []) {
            if (w.startsWith("ai-provider:")) {
              await reportScanCliError({
                error: w,
                scanRoot: sentryScanRoot,
                jobId: cliQuotaJobId,
                aiMode: sentryAiMode,
                aiProvider: sentryAiProvider,
                failurePhase: "ai_provider",
                failureCode: "ai_provider_warning",
              });
              // eslint-disable-next-line no-console
              console.warn(`[scan] ${w}`);
            }
          }

          if (scanResult.errors?.length) {
            await reportScanCliError({
              error: scanResult.errors.join("\n"),
              scanRoot: sentryScanRoot,
              jobId: cliQuotaJobId,
              aiMode: sentryAiMode,
              aiProvider: sentryAiProvider,
              failurePhase: "scan_pipeline",
              failureCode: "scan_errors",
              extra: { errorCount: scanResult.errors.length },
            });
            process.exitCode = 1;
          }

          let diagramGraph: DiagramGraphJsonSchema | undefined;
          try {
            diagramGraph = buildDiagramGraphFromScanResult(scanResult);
          } catch (graphError) {
            await reportScanCliError({
              error: graphError,
              scanRoot: sentryScanRoot,
              jobId: cliQuotaJobId,
              aiMode: sentryAiMode,
              aiProvider: sentryAiProvider,
              failurePhase: "diagram_graph",
              failureCode: "graph_build_failed",
            });
            if (isInteractive) {
              const message =
                graphError instanceof Error
                  ? graphError.message
                  : "Unknown error while building diagram graph.";
              // eslint-disable-next-line no-console
              console.error(
                `[scan] warning: unable to build diagram graph: ${message}`,
              );
            }
            process.exitCode = 1;
          }

          if (diagramGraph) {
            const dataflowOutputPath = pathModule.resolve(
              process.cwd(),
              options.output ?? "dataflow.json",
            );

            try {
              writeDataflowJson({
                scanResult,
                graph: diagramGraph,
                outputPath: dataflowOutputPath,
              });

              // Always print a short message so non-interactive callers and
              // tests can rely on it.
              // eslint-disable-next-line no-console
              console.log(`[scan] dataflow.json written to ${dataflowOutputPath}`);
            } catch (dataflowError) {
              await reportScanCliError({
                error: dataflowError,
                scanRoot: sentryScanRoot,
                jobId: cliQuotaJobId,
                aiMode: sentryAiMode,
                aiProvider: sentryAiProvider,
                failurePhase: "dataflow_output",
                failureCode: "dataflow_write_failed",
              });
              const message =
                dataflowError instanceof Error
                  ? dataflowError.message
                  : "Unknown error while writing dataflow.json.";
              // eslint-disable-next-line no-console
              console.error(
                `[scan] error: failed to write dataflow.json: ${message}`,
              );
              process.exitCode = 1;
            }
          }

          if (platformQuotaApiKey && cliQuotaJobId) {
            const { cliScanComplete } = await import("./platform-api/scan-quota-client");
            const exitFailed = (process.exitCode ?? 0) !== 0;
            const platformAiMode = resolveAiMode(config) === "platform";
            await cliScanComplete({
              apiKey: platformQuotaApiKey,
              jobId: cliQuotaJobId,
              status: exitFailed ? "failed" : "completed",
              aiTokensUsed: platformAiMode
                ? 0
                : (scanResult.aiInferenceSummary?.totalTokens ?? 0),
              failureCode: exitFailed ? "scan_failed" : undefined,
              failureMessage: exitFailed ? "CLI scan did not complete successfully" : undefined,
            });
            quotaCompletionReported = true;
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown error during scan.";
          fallbackFailureMessage = message;
          const { CliScanQuotaExceededError } = await import(
            "./platform-api/scan-quota-client"
          );
          const quotaBlocked = err instanceof CliScanQuotaExceededError;
          await reportScanCliError({
            error: err,
            scanRoot: sentryScanRoot,
            jobId: cliQuotaJobId,
            aiMode: sentryAiMode,
            aiProvider: sentryAiProvider,
            failurePhase: quotaBlocked ? "preflight" : "scan_command",
            failureCode: quotaBlocked ? "scan_quota_exceeded" : "scan_exception",
          });
          // eslint-disable-next-line no-console
          console.error(
            quotaBlocked
              ? `[scan] workspace quota: ${message}`
              : `Scan failed: ${message}`,
          );
          process.exitCode = 1;
        } finally {
          if (platformQuotaApiKey && cliQuotaJobId && !quotaCompletionReported) {
            try {
              const { cliScanComplete } = await import("./platform-api/scan-quota-client");
              await cliScanComplete({
                apiKey: platformQuotaApiKey,
                jobId: cliQuotaJobId,
                status: "failed",
                failureCode: "scan_failed",
                failureMessage: fallbackFailureMessage,
              });
              quotaCompletionReported = true;
            } catch {
              // Quota report failure must not mask the original scan error.
            }
          }
        }
      },
    );

  program
    .command("config")
    .description("View the effective configuration for the current project")
    .argument("[path]", "Project directory (default: current working directory)")
    .action(async (pathArg?: string) => {
      try {
        const [{ createDefaultScanConfiguration }] = await Promise.all([
          import("./core/pipeline/orchestrator"),
        ]);

        const rootPathArg = pathArg?.trim() || ".";
        const resolvedRoot = pathModule.resolve(process.cwd(), rootPathArg);
        let configCwd = resolvedRoot;
        try {
          const scanEntry = await resolveScanFilesystemEntry(resolvedRoot);
          configCwd = scanEntry.scanRootDir;
        } catch {
          // Fall back to resolved path when it does not exist yet (config-only preview).
        }

        const { overrides } = resolveScanConfiguration({
          cwd: configCwd,
          flags: {},
        });

        const config = createDefaultScanConfiguration(overrides);
        const displayConfig = redactScanConfigurationForDisplay(config);

        // eslint-disable-next-line no-console
        console.log(JSON.stringify(displayConfig, null, 2));
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unknown error while loading configuration.";
        // eslint-disable-next-line no-console
        console.error("Failed to read configuration:", message);
        process.exitCode = 1;
      }
    });

  return program;
}

export async function run(argv?: string[]): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
}
