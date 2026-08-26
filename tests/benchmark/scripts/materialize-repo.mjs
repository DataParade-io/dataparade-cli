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
  isLockStale,
  isMaterializationComplete,
  lockFilePath,
  planMaterializeConcurrency,
  readHeadSafely,
  sparseConeDirectories,
  stagingDirectoryName,
} from "../materialize-paths.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const benchmarkRoot = path.resolve(__dirname, "..");
const reposRoot = path.join(benchmarkRoot, "repos");
const cacheRoot = path.join(benchmarkRoot, ".cache", "repos");
const LOCK_MAX_AGE_MS = 15 * 60 * 1000;
const WAIT_POLL_MS = 500;
const WAIT_TIMEOUT_MS = 15 * 60 * 1000;

function usage() {
  console.log(
    "Usage: node tests/benchmark/scripts/materialize-repo.mjs <repo-key> | --all",
  );
  console.log("Example: pnpm run benchmark:materialize vgs-django");
}

function sleep(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // busy-wait for short peer-materialization polls
  }
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

function readHeadFromDir(targetDir) {
  return execSync("git rev-parse HEAD", {
    cwd: targetDir,
    encoding: "utf8",
  });
}

function evaluateMaterialization(targetDir, commit, include) {
  const headRead = readHeadSafely(() => readHeadFromDir(targetDir));
  if (headRead.status !== "ok") {
    return { complete: false, reason: "repository head not available" };
  }

  return isMaterializationComplete({
    head: headRead.head,
    commit,
    includePaths: include,
    exists: (relativePath) => fs.existsSync(path.join(targetDir, relativePath)),
    isDirectory: (relativePath) =>
      fs.statSync(path.join(targetDir, relativePath)).isDirectory(),
    sparseCheckoutContent:
      include.length > 0 ? readSparseCheckoutContent(targetDir) : null,
  });
}

function readLockMetadata(lockPath) {
  if (!fs.existsSync(lockPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    const startedAt = Number(parsed.startedAtMs ?? 0);
    const pid = Number(parsed.pid ?? 0);
    if (!startedAt) {
      return null;
    }
    return { pid, startedAtMs: startedAt };
  } catch {
    return null;
  }
}

function acquireLock(lockPath) {
  const payload = JSON.stringify({
    pid: process.pid,
    startedAtMs: Date.now(),
  });
  try {
    fs.writeFileSync(lockPath, payload, { flag: "wx" });
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

function releaseLock(lockPath) {
  if (fs.existsSync(lockPath)) {
    fs.rmSync(lockPath, { force: true });
  }
}

function waitForPeerMaterialization(targetDir, commit, include) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!fs.existsSync(targetDir)) {
      sleep(WAIT_POLL_MS);
      continue;
    }

    const status = evaluateMaterialization(targetDir, commit, include);
    if (status.complete) {
      return;
    }

    sleep(WAIT_POLL_MS);
  }

  throw new Error(
    `Timed out waiting for concurrent materialization of ${targetDir}`,
  );
}

function removeIfExists(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
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
  const lockPath = lockFilePath(targetDir);
  const cloneUrl = `https://github.com/${repository}.git`;

  const planOnce = () => {
    const targetExists = fs.existsSync(targetDir);
    const headRead = targetExists
      ? readHeadSafely(() => readHeadFromDir(targetDir))
      : { status: "missing" };
    const materialization = targetExists
      ? evaluateMaterialization(targetDir, commit, include)
      : { complete: false };
    const lockMeta = readLockMetadata(lockPath);
    const lockHeldByPeer = lockMeta !== null && lockMeta.pid !== process.pid;
    const lockStale =
      lockMeta !== null && isLockStale(Date.now() - lockMeta.startedAtMs, LOCK_MAX_AGE_MS);

    return planMaterializeConcurrency({
      targetExists,
      headRead,
      materialization,
      lockHeldByPeer,
      lockStale,
    });
  };

  let plan = planOnce();
  while (plan === "wait-for-peer") {
    waitForPeerMaterialization(targetDir, commit, include);
    plan = planOnce();
  }

  if (plan === "use-complete") {
    console.log(`Already materialized: ${targetDir}`);
    printInstructions(repoKey, targetDir, manifest);
    return;
  }

  if (plan === "remove-incomplete") {
    const status = evaluateMaterialization(targetDir, commit, include);
    console.log(
      `Removing incomplete clone at ${targetDir} (${status.reason ?? "incomplete materialization"})`,
    );
    removeIfExists(targetDir);
  }

  fs.mkdirSync(cacheRoot, { recursive: true });

  if (!acquireLock(lockPath)) {
    waitForPeerMaterialization(targetDir, commit, include);
    if (planOnce() === "use-complete") {
      console.log(`Already materialized: ${targetDir}`);
      printInstructions(repoKey, targetDir, manifest);
      return;
    }
    if (!acquireLock(lockPath)) {
      throw new Error(`Could not acquire materialization lock for ${repoKey}`);
    }
  }

  const stagingDir = stagingDirectoryName(
    targetDir,
    `${process.pid}-${Date.now()}`,
  );

  try {
    removeIfExists(stagingDir);
    console.log(`Cloning ${repository} at ${commit} ...`);
    cloneAndConfigure(stagingDir, cloneUrl, commit, include);

    const finalStatus = evaluateMaterialization(stagingDir, commit, include);
    if (!finalStatus.complete) {
      throw new Error(
        `Materialization for '${repoKey}' failed validation: ${finalStatus.reason ?? "unknown error"}`,
      );
    }

    removeIfExists(targetDir);
    fs.renameSync(stagingDir, targetDir);

    console.log(`Materialized ${repoKey} -> ${targetDir}`);
    printInstructions(repoKey, targetDir, manifest);
  } catch (error) {
    removeIfExists(stagingDir);
    throw error;
  } finally {
    releaseLock(lockPath);
  }
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
