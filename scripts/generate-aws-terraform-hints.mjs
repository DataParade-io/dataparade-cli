#!/usr/bin/env node
/** @deprecated Use `generate-terraform-provider-hints.mjs --aws-only` or the full generator. */
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "generate-terraform-provider-hints.mjs");
const r = spawnSync(process.execPath, [script, "--aws-only"], { stdio: "inherit" });
process.exit(r.status ?? 1);
