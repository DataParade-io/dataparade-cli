import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(scriptDir, "../fixtures/ocsf-discovery.schema.json");

function loadValidator() {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

function summarizeErrors(errors) {
  return errors
    .map((err) => {
      const where = err.instancePath || "/";
      const detail = err.message ?? "invalid";
      return `${where}: ${detail}`;
    })
    .join("; ");
}

function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error(
      "usage: node tests/eval/interview-a0/bin/validate-ocsf-discovery.mjs <record.json> [more.json...]",
    );
    process.exit(1);
  }

  const validate = loadValidator();
  let failed = false;

  for (const inputPath of paths) {
    const absPath = resolve(inputPath);
    let raw;
    try {
      raw = readFileSync(absPath, "utf8");
    } catch (err) {
      failed = true;
      const message =
        err && typeof err === "object" && "code" in err && err.code === "ENOENT"
          ? "file not found"
          : String(err);
      console.error(`${absPath}: ${message}`);
      continue;
    }

    let record;
    try {
      record = JSON.parse(raw);
    } catch (err) {
      failed = true;
      console.error(`${absPath}: invalid JSON (${String(err)})`);
      continue;
    }

    if (!validate(record)) {
      failed = true;
      console.error(`${absPath}: ${summarizeErrors(validate.errors ?? [])}`);
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
