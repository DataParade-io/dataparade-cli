#!/usr/bin/env node
/**
 * DATAP-696: validate one OCSF Architecture Discovery JSON record (Zod wire schema).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distModule = path.join(
  __dirname,
  "../../../../dist/tests/eval/interview-a0/ocsf-discovery-types.js",
);

async function loadSchemaModule() {
  if (!fs.existsSync(distModule)) {
    throw new Error(
      "Build required: pnpm exec tsc -p tsconfig.json before running validate-ocsf-discovery CLI",
    );
  }
  return import(distModule);
}

async function main() {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: validate-ocsf-discovery.mjs <record.json>");
    process.exit(1);
  }

  const { ocsfDiscoveryRecordSchema } = await loadSchemaModule();
  const json = fs.readFileSync(path.resolve(recordPath), "utf8");
  const parsed = JSON.parse(json);
  ocsfDiscoveryRecordSchema.parse(parsed);
  process.stdout.write(`valid: ${path.resolve(recordPath)}\n`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
