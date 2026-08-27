#!/usr/bin/env node
/**
 * Emit structural scanner findings as JSON for detector Score evaluation.
 *
 * Usage:
 *   npx ts-node scripts/scan-findings.ts --root <materialized-dir>
 */

import { parseArgs } from "node:util";

import {
  collectEvalFindings,
  type EvalFindingsPayload,
} from "../src/core/pipeline/collect-eval-findings";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
    },
  });

  const rootPath = values.root?.trim();
  if (!rootPath) {
    throw new Error("--root is required");
  }

  const { findings, filesScanned, warnings, errors } = await collectEvalFindings(rootPath);

  for (const warning of warnings) {
    console.error(warning);
  }
  for (const error of errors) {
    console.error(error);
  }

  const payload: EvalFindingsPayload = { findings, filesScanned };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

export { main };
