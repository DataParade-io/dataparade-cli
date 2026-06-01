import fs from "node:fs";
import path from "node:path";
import "../config/load-cli-env";
import { createDefaultScanConfiguration, scan } from "../core/pipeline/orchestrator";
import type { AiProviderId } from "../ai-enrichment/types";
import { computeEvalScores } from "./metrics";

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

async function run(): Promise<void> {
  const fixturePath = parseArg("--fixture");
  const modelsArg = parseArg("--models") ?? "mock:heuristic";
  if (!fixturePath) {
    throw new Error("Missing --fixture <path>");
  }
  const models = modelsArg.split(",").map((entry) => entry.trim()).filter(Boolean);

  const report: Array<{
    model: string;
    provider: string;
    scores: ReturnType<typeof computeEvalScores>;
    warnings: string[];
    errors: string[];
  }> = [];

  for (const modelEntry of models) {
    const [provider, model] = modelEntry.includes(":")
      ? modelEntry.split(":")
      : ["mock", modelEntry];
    const config = createDefaultScanConfiguration({
      enableAiInference: provider !== "none",
      aiProvider: provider as AiProviderId,
      aiModel: model,
    });
    const result = await scan(path.resolve(process.cwd(), fixturePath), config);
    report.push({
      model,
      provider,
      scores: computeEvalScores({
        components: result.scanResult.components,
        dataFlows: result.scanResult.dataFlows,
      }),
      warnings: result.scanResult.warnings,
      errors: result.scanResult.errors,
    });
  }

  const outputDir = path.resolve(process.cwd(), "outputs");
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "model-eval-report.json");
  const markdownPath = path.join(outputDir, "model-eval-report.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const markdown = [
    "# Model Eval Report",
    "",
    ...report.map((entry) =>
      [
        `## ${entry.provider}:${entry.model}`,
        `- nodePropertyFillRate: ${entry.scores.nodePropertyFillRate.toFixed(3)}`,
        `- tieredPropertyCompleteness: ${entry.scores.tieredPropertyCompleteness.toFixed(3)}`,
        `- thirdPartyCompleteness: ${entry.scores.thirdPartyCompleteness.toFixed(3)}`,
        `- directionAccuracy: ${entry.scores.directionAccuracy.toFixed(3)}`,
        `- interactionRecall: ${entry.scores.interactionRecall.toFixed(3)}`,
        `- precisionGuardrail: ${entry.scores.precisionGuardrail.toFixed(3)}`,
      ].join("\n"),
    ),
  ].join("\n");
  fs.writeFileSync(markdownPath, markdown, "utf8");

  // eslint-disable-next-line no-console
  console.log(`Model eval reports written:\n- ${jsonPath}\n- ${markdownPath}`);
}

void run();

