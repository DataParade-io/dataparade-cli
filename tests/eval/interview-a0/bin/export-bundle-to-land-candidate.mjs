#!/usr/bin/env node
/**
 * DATAP-695: convert interview Discovery export bundle → DATAP-694 land-candidate JSON.
 * Does not call land. Rejects exam export paths; stdin or non-exam file only.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distModule = path.join(
  __dirname,
  "../../../../dist/tests/eval/interview-a0/export-bundle-to-land-candidate.js",
);

async function loadConverter() {
  if (!fs.existsSync(distModule)) {
    throw new Error(
      "Build required: pnpm exec tsc -p tsconfig.json before running converter CLI",
    );
  }
  return import(distModule);
}

function parseArgs(argv) {
  const options = {
    reviewer: undefined,
    rawEvidenceRef: undefined,
    landCandidateId: undefined,
    ticket: "DATAP-695",
    reviewedAt: undefined,
    inputPath: undefined,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--reviewer") {
      options.reviewer = argv[++i];
      continue;
    }
    if (arg === "--raw-evidence-ref") {
      options.rawEvidenceRef = argv[++i];
      continue;
    }
    if (arg === "--id") {
      options.landCandidateId = argv[++i];
      continue;
    }
    if (arg === "--ticket") {
      options.ticket = argv[++i];
      continue;
    }
    if (arg === "--reviewed-at") {
      options.reviewedAt = argv[++i];
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    positional.push(arg);
  }

  if (positional.length > 1) {
    throw new Error(`Unexpected arguments: ${positional.slice(1).join(" ")}`);
  }
  options.inputPath = positional[0];
  return options;
}

function printHelp() {
  console.log(`Usage:
  node export-bundle-to-land-candidate.mjs [options] [export.json]

Options:
  --reviewer <human-id>       Human reviewer (never invented)
  --raw-evidence-ref <ref>    Unedited transcript pointer (never copied from export)
  --id <land_candidate_id>    Output land_candidate_id
  --ticket <ticket>           Ticket label (default DATAP-695)
  --reviewed-at <iso>         reviewed_at when --reviewer is set

Reads export JSON from file or stdin. Rejects experiments/datap-* paths.
Outputs land-candidate JSON only — does not call land.`);
}

async function readInput(inputPath) {
  if (inputPath) {
    return {
      json: fs.readFileSync(path.resolve(inputPath), "utf8"),
      sourcePath: path.resolve(inputPath),
    };
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return {
    json: Buffer.concat(chunks).toString("utf8"),
    sourcePath: undefined,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { convertExportBundleJson } = await loadConverter();
  const { json, sourcePath } = await readInput(options.inputPath);

  const candidate = convertExportBundleJson(json, {
    reviewer: options.reviewer,
    rawEvidenceRef: options.rawEvidenceRef,
    landCandidateId: options.landCandidateId,
    ticket: options.ticket,
    reviewedAt: options.reviewedAt,
    sourcePath,
  });

  process.stdout.write(`${JSON.stringify(candidate, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
