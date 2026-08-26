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
import {
  isMaterializationComplete,
  sparseConeDirectories,
} from "../materialize-paths.ts";

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

function readSparseCheckoutContent(targetDir) {
  const sparseCheckoutPath = path.join(targetDir, ".git", "info", "sparse-checkout");
  if (!fs.existsSync(sparseCheckoutPath)) {
    return null;
  }
  return fs.readFileSync(sparseCheckoutPath, "utf8");
}

function evaluateMaterialization(targetDir, commit, include) {
  const head = execSync("git rev-parse HEAD", {
    cwd: targetDir,
    encoding: "utf8",
  }).trim();

  return isMaterializationComplete({
    head,
    commit,
    includePaths: include,
    exists: (relativePath) => fs.existsSync(path.join(targetDir, relativePath)),
    isDirectory: (relativePath) =>
      fs.statSync(path.join(targetDir, relativePath)).isDirectory(),
    sparseCheckoutContent:
      include.length > 0 ? readSparseCheckoutContent(targetDir) : null,
  });
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

  if (fs.existsSync(targetDir)) {
    const status = evaluateMaterialization(targetDir, commit, include);
    if (status.complete) {
      console.log(`Already materialized: ${targetDir}`);
      printInstructions(repoKey, targetDir, manifest);
      return;
    }

    const head = execSync("git rev-parse HEAD", {
      cwd: targetDir,
      encoding: "utf8",
    }).trim();
    const reason = status.reason ?? "incomplete materialization";
    if (head === commit) {
      console.log(`Removing incomplete clone at ${targetDir} (${reason})`);
    } else {
      console.log(`Removing stale clone at ${targetDir} (HEAD ${head} != ${commit})`);
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  fs.mkdirSync(cacheRoot, { recursive: true });

  console.log(`Cloning ${repository} at ${commit} ...`);
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

  const finalStatus = evaluateMaterialization(targetDir, commit, include);
  if (!finalStatus.complete) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw new Error(
      `Materialization for '${repoKey}' failed validation: ${finalStatus.reason ?? "unknown error"}`,
    );
  }

  console.log(`Materialized ${repoKey} -> ${targetDir}`);
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
