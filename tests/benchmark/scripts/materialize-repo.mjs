#!/usr/bin/env node
/**
 * Materialize a pinned benchmark repository for local development.
 *
 *   node tests/benchmark/scripts/materialize-repo.mjs vgs-django
 *   node tests/benchmark/scripts/materialize-repo.mjs easy-school
 *   node tests/benchmark/scripts/materialize-repo.mjs --all
 *
 * Not invoked by CI or pnpm test.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import YAML from "yaml";
import { sparseConeDirectories } from "../materialize-paths.ts";
import {
  createNodeMaterializeDeps,
  runMaterializeOrchestration,
} from "../materialize-orchestrator.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const benchmarkRoot = path.resolve(__dirname, "..");
const reposRoot = path.join(benchmarkRoot, "repos");
const cacheRoot = path.join(benchmarkRoot, ".cache", "repos");

function usage() {
  console.log(
    "Usage: node tests/benchmark/scripts/materialize-repo.mjs <repo-key> | --all",
  );
  console.log("Example: pnpm run benchmark:materialize vgs-django");
}

function listRepoKeys() {
  return fs
    .readdirSync(reposRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function loadManifest(repoKey) {
  const manifestPath = path.join(reposRoot, repoKey, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest for repo key '${repoKey}'`);
  }
  const parsed = YAML.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid manifest YAML at ${manifestPath}`);
  }
  return parsed;
}

function readHeadFromDir(targetDir) {
  return execSync("git rev-parse HEAD", {
    cwd: targetDir,
    encoding: "utf8",
  });
}

function cloneAndConfigure(targetDir, cloneUrl, commit, include) {
  execSync(`git clone --no-checkout ${cloneUrl} ${targetDir}`, {
    stdio: "inherit",
  });
  execSync(`git checkout ${commit}`, { cwd: targetDir, stdio: "inherit" });

  if (include.length > 0) {
    const sparsePaths = sparseConeDirectories(include);
    execSync("git sparse-checkout init --cone", { cwd: targetDir, stdio: "inherit" });
    execSync(`git sparse-checkout set ${sparsePaths.map((p) => JSON.stringify(p)).join(" ")}`, {
      cwd: targetDir,
      stdio: "inherit",
    });
  }
}

function materializeRepo(repoKey) {
  const manifest = loadManifest(repoKey);
  const repository = String(manifest.repository ?? "");
  const commit = String(manifest.commit ?? "");
  const include = Array.isArray(manifest.scope?.include) ? manifest.scope.include : [];

  if (!repository || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error(`Manifest for '${repoKey}' must define repository and full commit SHA`);
  }

  const targetDir = path.join(cacheRoot, `${repoKey}@${commit}`);
  const cloneUrl = `https://github.com/${repository}.git`;
  const deps = createNodeMaterializeDeps(readHeadFromDir);

  const result = runMaterializeOrchestration({
    cacheRoot,
    targetDir,
    commit,
    includePaths: include,
    currentPid: process.pid,
    deps,
    materializeToStaging: (stagingDir) => {
      console.log(`Cloning ${repository} at ${commit} ...`);
      cloneAndConfigure(stagingDir, cloneUrl, commit, include);
    },
  });

  if (result.action === "used-existing") {
    console.log(`Already materialized: ${targetDir}`);
  } else {
    console.log(`Materialized ${repoKey} -> ${targetDir}`);
  }

  printInstructions(repoKey, targetDir, manifest);
}

function printInstructions(repoKey, targetDir, manifest) {
  const include = Array.isArray(manifest.scope?.include) ? manifest.scope.include : [];
  console.log("");
  console.log("Local benchmark development:");
  console.log(`  Repo key:     ${repoKey}`);
  console.log(`  Clone path:   ${targetDir}`);
  console.log(`  Pinned commit: ${manifest.commit}`);
  if (include.length > 0) {
    console.log(`  Sparse scope: ${include.join(", ")}`);
  }
  console.log("  Review annotations in tests/benchmark/repos/" + repoKey + "/annotations/");
  console.log("  Run unit tests: pnpm test tests/unit/benchmark/");
}

const args = process.argv.slice(2);
if (args.length === 0) {
  usage();
  process.exit(1);
}

if (args[0] === "--all") {
  for (const key of listRepoKeys()) {
    materializeRepo(key);
  }
} else {
  const repoKey = args[0];
  if (!fs.existsSync(path.join(reposRoot, repoKey))) {
    throw new Error(`Unknown repo key '${repoKey}'. Known: ${listRepoKeys().join(", ")}`);
  }
  materializeRepo(repoKey);
}
