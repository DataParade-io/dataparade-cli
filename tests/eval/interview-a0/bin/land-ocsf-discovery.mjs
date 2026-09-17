#!/usr/bin/env node
/**
 * DATAP-696: fail-closed land interview land-candidate → OCSF Discovery JSON.
 * Input: land-candidates/<id>.json only (human reviewer + raw_evidence_ref required).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distModule = path.join(
  __dirname,
  "../../../../dist/tests/eval/interview-a0/land-ocsf-discovery.js",
);

async function loadLandModule() {
  if (!fs.existsSync(distModule)) {
    throw new Error(
      "Build required: pnpm exec tsc -p tsconfig.json before running land-ocsf-discovery CLI",
    );
  }
  return import(distModule);
}

function parseArgs(argv) {
  const options = {
    outputDir: undefined,
    dryRun: false,
    candidatePath: undefined,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output-dir") {
      options.outputDir = argv[++i];
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new Error("Usage: land-ocsf-discovery.mjs [--output-dir <dir>] [--dry-run] <candidate.json>");
  }
  options.candidatePath = positional[0];
  return options;
}

function printHelp() {
  console.log(`Usage:
  node land-ocsf-discovery.mjs [options] <land-candidates/id.json>

Options:
  --output-dir <dir>   Write OCSF JSON under <dir> (default: project/wiki/graph/dogfood/ocsf-discoveries)
  --dry-run            Validate only — do not write files

Rejects experiments/datap-* candidate paths. Requires human reviewer + raw_evidence_ref.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { landOcsfDiscoveriesFromPath } = await loadLandModule();
  const result = landOcsfDiscoveriesFromPath(path.resolve(options.candidatePath), {
    outputDir: options.outputDir,
    dryRun: options.dryRun,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
