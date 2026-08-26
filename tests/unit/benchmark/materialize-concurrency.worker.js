const fs = require("fs");
const path = require("path");

const {
  acquireLock,
  createNodeMaterializeDeps,
  releaseLock,
  runMaterializeOrchestration,
} = require("../../../dist/tests/benchmark/materialize-orchestrator");
const { lockFilePath } = require("../../../dist/tests/benchmark/materialize-paths");

const config = JSON.parse(process.env.MATERIALIZE_WORKER_CONFIG ?? "{}");
const { role, cacheRoot, targetDir, commit } = config;

function writeCompleteTarget(dir, pinnedCommit) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".head"), `${pinnedCommit}\n`, "utf8");
}

function createTestReadHead(target) {
  return fs.readFileSync(path.join(target, ".head"), "utf8").trim();
}

const deps = createNodeMaterializeDeps(createTestReadHead);

function sleep(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // busy-wait for short peer-materialization polls
  }
}

function runFollower() {
  const result = runMaterializeOrchestration({
    cacheRoot,
    targetDir,
    commit,
    includePaths: [],
    currentPid: process.pid,
    waitPollMs: 50,
    deps,
    materializeToStaging: (stagingDir) => {
      writeCompleteTarget(stagingDir, commit);
    },
  });

  console.log(JSON.stringify({ role: "follower", result }));
}

function runLeader() {
  const lockPath = lockFilePath(targetDir);
  fs.mkdirSync(cacheRoot, { recursive: true });

  if (!acquireLock(lockPath, process.pid, deps, Date.now())) {
    throw new Error("leader could not acquire lock");
  }

  try {
    sleep(400);
    const stagingDir = `${targetDir}.staging-leader`;
    writeCompleteTarget(stagingDir, commit);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, targetDir);
    console.log(JSON.stringify({ role: "leader", result: { action: "materialized" } }));
  } finally {
    releaseLock(lockPath, deps);
  }
}

function runPeerFailure() {
  const lockPath = lockFilePath(targetDir);
  fs.mkdirSync(cacheRoot, { recursive: true });
  acquireLock(lockPath, 999_999, deps, Date.now() - 1_000);

  const startedAt = Date.now();
  const result = runMaterializeOrchestration({
    cacheRoot,
    targetDir,
    commit,
    includePaths: [],
    currentPid: process.pid,
    waitPollMs: 50,
    deps,
    materializeToStaging: (stagingDir) => {
      writeCompleteTarget(stagingDir, commit);
    },
  });

  console.log(
    JSON.stringify({
      role: "peer-failure",
      elapsedMs: Date.now() - startedAt,
      result,
    }),
  );
}

switch (role) {
  case "follower":
    runFollower();
    break;
  case "leader":
    runLeader();
    break;
  case "peer-failure":
    runPeerFailure();
    break;
  default:
    throw new Error(`Unknown worker role '${role}'`);
}
