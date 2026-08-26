import fs from "fs";
import path from "path";

import {
  isLockStale,
  isMaterializationComplete,
  lockFilePath,
  planMaterializeConcurrency,
  readHeadSafely,
  stagingDirectoryName,
  type MaterializeConcurrencyAction,
  type SafeHeadReadResult,
} from "./materialize-paths";

export interface LockMetadata {
  pid: number;
  startedAtMs: number;
}

export interface MaterializationStatus {
  complete: boolean;
  reason?: string;
}

export interface MaterializeOrchestratorDeps {
  exists: (filePath: string) => boolean;
  readFile: (filePath: string, encoding: "utf8") => string;
  writeFile: (filePath: string, content: string, options?: { flag?: string }) => void;
  remove: (filePath: string, options?: { recursive?: boolean; force?: boolean }) => void;
  rename: (from: string, to: string) => void;
  mkdir: (dirPath: string, options?: { recursive?: boolean }) => void;
  readdir: (dirPath: string) => string[];
  stat: (filePath: string) => { isDirectory: () => boolean };
  readHead: (targetDir: string) => string;
  isProcessAlive: (pid: number) => boolean;
  now: () => number;
  sleep: (ms: number) => void;
}

export const DEFAULT_LOCK_MAX_AGE_MS = 15 * 60 * 1000;
export const DEFAULT_WAIT_POLL_MS = 500;
export const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60 * 1000;

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    ) {
      return false;
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    ) {
      return true;
    }
    return false;
  }
}

export function readLockMetadata(
  lockPath: string,
  readFile: (filePath: string, encoding: "utf8") => string,
  exists: (filePath: string) => boolean,
): LockMetadata | null {
  if (!exists(lockPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFile(lockPath, "utf8")) as {
      pid?: unknown;
      startedAtMs?: unknown;
    };
    const startedAtMs = Number(parsed.startedAtMs ?? 0);
    const pid = Number(parsed.pid ?? 0);
    if (!startedAtMs) {
      return null;
    }
    return { pid, startedAtMs };
  } catch {
    return null;
  }
}

export function readSparseCheckoutContent(
  targetDir: string,
  exists: (filePath: string) => boolean,
  readFile: (filePath: string, encoding: "utf8") => string,
): string | null {
  const sparseCheckoutPath = path.join(targetDir, ".git", "info", "sparse-checkout");
  if (!exists(sparseCheckoutPath)) {
    return null;
  }
  return readFile(sparseCheckoutPath, "utf8");
}

export function evaluateMaterializationAtPath(
  targetDir: string,
  commit: string,
  includePaths: string[],
  deps: Pick<
    MaterializeOrchestratorDeps,
    "exists" | "readFile" | "stat" | "readHead"
  >,
): MaterializationStatus {
  const headRead = readHeadSafely(() => deps.readHead(targetDir));
  if (headRead.status !== "ok") {
    return { complete: false, reason: "repository head not available" };
  }

  return isMaterializationComplete({
    head: headRead.head,
    commit,
    includePaths,
    exists: (relativePath) => deps.exists(path.join(targetDir, relativePath)),
    isDirectory: (relativePath) =>
      deps.stat(path.join(targetDir, relativePath)).isDirectory(),
    sparseCheckoutContent:
      includePaths.length > 0
        ? readSparseCheckoutContent(targetDir, deps.exists, deps.readFile)
        : null,
  });
}

export function listAbandonedStagingDirs(
  cacheRoot: string,
  targetDir: string,
  readdir: (dirPath: string) => string[],
  exists: (filePath: string) => boolean,
): string[] {
  if (!exists(cacheRoot)) {
    return [];
  }

  const targetBase = path.basename(targetDir);
  const stagingPrefix = `${targetBase}.staging-`;
  return readdir(cacheRoot)
    .filter((entry) => entry.startsWith(stagingPrefix))
    .map((entry) => path.join(cacheRoot, entry));
}

export interface ConcurrencySnapshot {
  action: MaterializeConcurrencyAction;
  targetExists: boolean;
  headRead: SafeHeadReadResult;
  materialization: MaterializationStatus;
  lockHeldByPeer: boolean;
  lockStale: boolean;
  lockLive: boolean;
}

export interface PlanConcurrencyInput {
  targetDir: string;
  lockPath: string;
  commit: string;
  includePaths: string[];
  currentPid: number;
  lockMaxAgeMs?: number;
  deps: MaterializeOrchestratorDeps;
}

export function removeStaleOrDeadLock(
  lockPath: string,
  lockMeta: LockMetadata | null,
  deps: MaterializeOrchestratorDeps,
  currentPid: number,
  lockMaxAgeMs: number = DEFAULT_LOCK_MAX_AGE_MS,
): boolean {
  if (!lockMeta) {
    return false;
  }

  const stale = isLockStale(deps.now() - lockMeta.startedAtMs, lockMaxAgeMs);
  const heldByOther = lockMeta.pid !== currentPid;
  const peerAlive = heldByOther && deps.isProcessAlive(lockMeta.pid);

  if (stale || (heldByOther && !peerAlive)) {
    deps.remove(lockPath, { force: true });
    return true;
  }

  return false;
}

export function planConcurrencyState(input: PlanConcurrencyInput): ConcurrencySnapshot {
  const lockMaxAgeMs = input.lockMaxAgeMs ?? DEFAULT_LOCK_MAX_AGE_MS;
  const { deps, targetDir, lockPath, commit, includePaths, currentPid } = input;

  let lockMeta = readLockMetadata(lockPath, deps.readFile, deps.exists);
  removeStaleOrDeadLock(lockPath, lockMeta, deps, currentPid, lockMaxAgeMs);
  lockMeta = readLockMetadata(lockPath, deps.readFile, deps.exists);

  const targetExists = deps.exists(targetDir);
  const headRead: SafeHeadReadResult = targetExists
    ? readHeadSafely(() => deps.readHead(targetDir))
    : { status: "missing" };
  const materialization = targetExists
    ? evaluateMaterializationAtPath(targetDir, commit, includePaths, deps)
    : { complete: false };

  const lockAgeMs = lockMeta ? deps.now() - lockMeta.startedAtMs : 0;
  const lockStale = lockMeta !== null && isLockStale(lockAgeMs, lockMaxAgeMs);
  const lockLive =
    lockMeta !== null &&
    !lockStale &&
    lockMeta.pid !== currentPid &&
    deps.isProcessAlive(lockMeta.pid);
  const lockHeldByPeer = lockMeta !== null && lockMeta.pid !== currentPid;

  const action = planMaterializeConcurrency({
    targetExists,
    headRead,
    materialization,
    lockHeldByPeer: lockHeldByPeer && lockLive,
    lockStale,
  });

  return {
    action,
    targetExists,
    headRead,
    materialization,
    lockHeldByPeer,
    lockStale,
    lockLive,
  };
}

export function cleanupAbandonedStaging(
  cacheRoot: string,
  targetDir: string,
  deps: Pick<MaterializeOrchestratorDeps, "readdir" | "exists" | "remove">,
): void {
  for (const stagingDir of listAbandonedStagingDirs(
    cacheRoot,
    targetDir,
    deps.readdir,
    deps.exists,
  )) {
    deps.remove(stagingDir, { recursive: true, force: true });
  }
}

export function acquireLock(
  lockPath: string,
  currentPid: number,
  deps: Pick<MaterializeOrchestratorDeps, "writeFile">,
  now: number,
): boolean {
  const payload = JSON.stringify({ pid: currentPid, startedAtMs: now });
  try {
    deps.writeFile(lockPath, payload, { flag: "wx" });
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EEXIST"
    ) {
      return false;
    }
    throw error;
  }
}

export function releaseLock(
  lockPath: string,
  deps: Pick<MaterializeOrchestratorDeps, "exists" | "remove">,
): void {
  if (deps.exists(lockPath)) {
    deps.remove(lockPath, { force: true });
  }
}

export interface WaitForPeerOptions {
  targetDir: string;
  lockPath: string;
  commit: string;
  includePaths: string[];
  currentPid: number;
  lockMaxAgeMs?: number;
  waitPollMs?: number;
  waitTimeoutMs?: number;
  deps: MaterializeOrchestratorDeps;
}

export function waitForPeerMaterialization(options: WaitForPeerOptions): void {
  const waitPollMs = options.waitPollMs ?? DEFAULT_WAIT_POLL_MS;
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const lockMaxAgeMs = options.lockMaxAgeMs ?? DEFAULT_LOCK_MAX_AGE_MS;
  const deadline = options.deps.now() + waitTimeoutMs;

  while (options.deps.now() < deadline) {
    const status = evaluateMaterializationAtPath(
      options.targetDir,
      options.commit,
      options.includePaths,
      options.deps,
    );
    if (status.complete) {
      return;
    }

    const lockMeta = readLockMetadata(
      options.lockPath,
      options.deps.readFile,
      options.deps.exists,
    );
    if (!lockMeta || lockMeta.pid === options.currentPid) {
      return;
    }

    const lockStale = isLockStale(options.deps.now() - lockMeta.startedAtMs, lockMaxAgeMs);
    const peerAlive = options.deps.isProcessAlive(lockMeta.pid);
    if (lockStale || !peerAlive) {
      removeStaleOrDeadLock(
        options.lockPath,
        lockMeta,
        options.deps,
        options.currentPid,
        lockMaxAgeMs,
      );
      return;
    }

    options.deps.sleep(waitPollMs);
  }

  throw new Error(
    `Timed out waiting for concurrent materialization of ${options.targetDir}`,
  );
}

export interface MaterializeOrchestrationInput {
  cacheRoot: string;
  targetDir: string;
  commit: string;
  includePaths: string[];
  currentPid: number;
  lockMaxAgeMs?: number;
  waitPollMs?: number;
  waitTimeoutMs?: number;
  deps: MaterializeOrchestratorDeps;
  materializeToStaging: (stagingDir: string) => void;
}

export interface MaterializeOrchestrationResult {
  action: "used-existing" | "materialized";
  targetDir: string;
}

export function runMaterializeOrchestration(
  input: MaterializeOrchestrationInput,
): MaterializeOrchestrationResult {
  const lockPath = lockFilePath(input.targetDir);
  const lockMaxAgeMs = input.lockMaxAgeMs ?? DEFAULT_LOCK_MAX_AGE_MS;

  cleanupAbandonedStaging(input.cacheRoot, input.targetDir, input.deps);

  let snapshot = planConcurrencyState({
    targetDir: input.targetDir,
    lockPath,
    commit: input.commit,
    includePaths: input.includePaths,
    currentPid: input.currentPid,
    lockMaxAgeMs,
    deps: input.deps,
  });

  while (snapshot.action === "wait-for-peer") {
    waitForPeerMaterialization({
      targetDir: input.targetDir,
      lockPath,
      commit: input.commit,
      includePaths: input.includePaths,
      currentPid: input.currentPid,
      lockMaxAgeMs,
      waitPollMs: input.waitPollMs,
      waitTimeoutMs: input.waitTimeoutMs,
      deps: input.deps,
    });
    snapshot = planConcurrencyState({
      targetDir: input.targetDir,
      lockPath,
      commit: input.commit,
      includePaths: input.includePaths,
      currentPid: input.currentPid,
      lockMaxAgeMs,
      deps: input.deps,
    });
  }

  if (snapshot.action === "use-complete") {
    return { action: "used-existing", targetDir: input.targetDir };
  }

  if (snapshot.action === "remove-incomplete" && input.deps.exists(input.targetDir)) {
    input.deps.remove(input.targetDir, { recursive: true, force: true });
  }

  input.deps.mkdir(input.cacheRoot, { recursive: true });

  if (!acquireLock(lockPath, input.currentPid, input.deps, input.deps.now())) {
    waitForPeerMaterialization({
      targetDir: input.targetDir,
      lockPath,
      commit: input.commit,
      includePaths: input.includePaths,
      currentPid: input.currentPid,
      lockMaxAgeMs,
      waitPollMs: input.waitPollMs,
      waitTimeoutMs: input.waitTimeoutMs,
      deps: input.deps,
    });

    const afterWait = planConcurrencyState({
      targetDir: input.targetDir,
      lockPath,
      commit: input.commit,
      includePaths: input.includePaths,
      currentPid: input.currentPid,
      lockMaxAgeMs,
      deps: input.deps,
    });
    if (afterWait.action === "use-complete") {
      return { action: "used-existing", targetDir: input.targetDir };
    }
    if (!acquireLock(lockPath, input.currentPid, input.deps, input.deps.now())) {
      throw new Error(`Could not acquire materialization lock for ${input.targetDir}`);
    }
  }

  const stagingDir = stagingDirectoryName(
    input.targetDir,
    `${input.currentPid}-${input.deps.now()}`,
  );

  try {
    input.deps.remove(stagingDir, { recursive: true, force: true });
    input.materializeToStaging(stagingDir);

    const finalStatus = evaluateMaterializationAtPath(
      stagingDir,
      input.commit,
      input.includePaths,
      input.deps,
    );
    if (!finalStatus.complete) {
      throw new Error(
        `Materialization failed validation: ${finalStatus.reason ?? "unknown error"}`,
      );
    }

    input.deps.remove(input.targetDir, { recursive: true, force: true });
    input.deps.rename(stagingDir, input.targetDir);
    return { action: "materialized", targetDir: input.targetDir };
  } catch (error) {
    input.deps.remove(stagingDir, { recursive: true, force: true });
    throw error;
  } finally {
    releaseLock(lockPath, input.deps);
  }
}

export function createNodeMaterializeDeps(
  readHeadFromDir: (targetDir: string) => string,
): MaterializeOrchestratorDeps {
  return {
    exists: (filePath) => fs.existsSync(filePath),
    readFile: (filePath, encoding) => fs.readFileSync(filePath, encoding),
    writeFile: (filePath, content, options) => {
      fs.writeFileSync(filePath, content, options);
    },
    remove: (filePath, options) => {
      fs.rmSync(filePath, options);
    },
    rename: (from, to) => {
      fs.renameSync(from, to);
    },
    mkdir: (dirPath, options) => {
      fs.mkdirSync(dirPath, options);
    },
    readdir: (dirPath) => fs.readdirSync(dirPath),
    stat: (filePath) => fs.statSync(filePath),
    readHead: readHeadFromDir,
    isProcessAlive,
    now: () => Date.now(),
    sleep: (ms) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        // busy-wait for short peer-materialization polls
      }
    },
  };
}
