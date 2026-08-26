import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import {
  lockFilePath,
  stagingDirectoryName,
} from "../../benchmark/materialize-paths";
import {
  createNodeMaterializeDeps,
  evaluateMaterializationAtPath,
  runMaterializeOrchestration,
  type MaterializeOrchestratorDeps,
} from "../../benchmark/materialize-orchestrator";

const COMMIT = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const WORKER_PATH = path.join(__dirname, "materialize-concurrency.worker.js");

function createTestReadHead(targetDir: string): string {
  return fs.readFileSync(path.join(targetDir, ".head"), "utf8").trim();
}

function writeCompleteTarget(targetDir: string, commit: string = COMMIT): void {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, ".head"), `${commit}\n`, "utf8");
}

function createTestDeps(
  overrides: Partial<MaterializeOrchestratorDeps> = {},
): MaterializeOrchestratorDeps {
  return {
    ...createNodeMaterializeDeps(createTestReadHead),
    ...overrides,
  };
}

function runWorker(
  config: Record<string, unknown>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER_PATH], {
      env: {
        ...process.env,
        MATERIALIZE_WORKER_CONFIG: JSON.stringify(config),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("materialize orchestrator process concurrency", () => {
  let tempRoot: string;
  let cacheRoot: string;
  let targetDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "materialize-process-"));
    cacheRoot = path.join(tempRoot, "cache");
    targetDir = path.join(cacheRoot, `fixture@${COMMIT}`);
    fs.mkdirSync(cacheRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("lets a follower process wait for a live leader and reuse the published target", async () => {
    const followerPromise = runWorker({
      role: "follower",
      cacheRoot,
      targetDir,
      commit: COMMIT,
    });
    await sleep(100);
    const leaderPromise = runWorker({
      role: "leader",
      cacheRoot,
      targetDir,
      commit: COMMIT,
    });

    const [follower, leader] = await Promise.all([followerPromise, leaderPromise]);
    expect(follower.code).toBe(0);
    expect(leader.code).toBe(0);
    expect(
      evaluateMaterializationAtPath(targetDir, COMMIT, [], createTestDeps()),
    ).toEqual({ complete: true });
  }, 30_000);

  it("recovers in a child process when the lock owner is dead", async () => {
    const result = await runWorker({
      role: "peer-failure",
      cacheRoot,
      targetDir,
      commit: COMMIT,
    });

    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout.trim().split("\n").pop() ?? "{}");
    expect(payload.elapsedMs).toBeLessThan(5_000);
    expect(payload.result.action).toBe("materialized");
    expect(
      evaluateMaterializationAtPath(targetDir, COMMIT, [], createTestDeps()),
    ).toEqual({ complete: true });
  }, 30_000);

  it("removes a stale lock and materializes without waiting 15 minutes", () => {
    const lockPath = lockFilePath(targetDir);
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999_999, startedAtMs: Date.now() - 20 * 60 * 1000 }),
      "utf8",
    );

    const startedAt = Date.now();
    const result = runMaterializeOrchestration({
      cacheRoot,
      targetDir,
      commit: COMMIT,
      includePaths: [],
      currentPid: process.pid,
      deps: createTestDeps(),
      materializeToStaging: (stagingDir) => {
        writeCompleteTarget(stagingDir);
      },
    });

    expect(result.action).toBe("materialized");
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("removes a partial target without a lock instead of waiting for a peer", () => {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, "partial.txt"), "incomplete", "utf8");

    const startedAt = Date.now();
    const result = runMaterializeOrchestration({
      cacheRoot,
      targetDir,
      commit: COMMIT,
      includePaths: [],
      currentPid: process.pid,
      deps: createTestDeps(),
      materializeToStaging: (stagingDir) => {
        writeCompleteTarget(stagingDir);
      },
    });

    expect(result.action).toBe("materialized");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(
      evaluateMaterializationAtPath(targetDir, COMMIT, [], createTestDeps()),
    ).toEqual({ complete: true });
  });

  it("cleans abandoned staging directories before materializing", () => {
    const abandoned = stagingDirectoryName(targetDir, "dead-peer");
    fs.mkdirSync(abandoned, { recursive: true });
    fs.writeFileSync(path.join(abandoned, "stale.txt"), "x", "utf8");

    runMaterializeOrchestration({
      cacheRoot,
      targetDir,
      commit: COMMIT,
      includePaths: [],
      currentPid: process.pid,
      deps: createTestDeps(),
      materializeToStaging: (stagingDir) => {
        writeCompleteTarget(stagingDir);
      },
    });

    expect(fs.existsSync(abandoned)).toBe(false);
    expect(
      evaluateMaterializationAtPath(targetDir, COMMIT, [], createTestDeps()),
    ).toEqual({ complete: true });
  });

  it("removes a dead-peer lock during in-process orchestration", () => {
    const lockPath = lockFilePath(targetDir);
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999_999, startedAtMs: Date.now() }),
      "utf8",
    );

    const result = runMaterializeOrchestration({
      cacheRoot,
      targetDir,
      commit: COMMIT,
      includePaths: [],
      currentPid: process.pid,
      deps: createTestDeps(),
      materializeToStaging: (stagingDir) => {
        writeCompleteTarget(stagingDir);
      },
    });

    expect(result.action).toBe("materialized");
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

describe("materialize orchestrator helpers", () => {
  it("detects live and dead processes", () => {
    const { isProcessAlive } = require("../../benchmark/materialize-orchestrator");
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(999_999)).toBe(false);
  });
});
