import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

import {
  After,
  Before,
  Given,
  setDefaultTimeout,
  Then,
  When,
} from "@cucumber/cucumber";

setDefaultTimeout(60_000);

const repoRoot = join(__dirname, "..", "..");
const startScript = join(repoRoot, "scripts", "start-local-graphql.sh");
const STDERR_CAPTURE_LIMIT = 8_000;

const PLEXUS_ROOT_ERROR =
  "PLEXUS_ROOT must be set to a Plexus checkout containing services/private-graphql-proxy";

function requirePlexusRoot(): string {
  const plexusRoot = process.env.PLEXUS_ROOT?.trim();
  if (!plexusRoot) {
    throw new Error(PLEXUS_ROOT_ERROR);
  }
  return plexusRoot;
}

function pythonInterpreter(): string {
  const configured = process.env.PYTHON?.trim();
  return configured || "python3";
}

function appendBoundedCapture(current: string, chunk: Buffer, limit: number): string {
  const next = current + chunk.toString();
  if (next.length <= limit) {
    return next;
  }
  return next.slice(next.length - limit);
}

interface LocalGraphqlWorld {
  dataDir?: string;
  port?: number;
  baseUrl?: string;
  child?: ChildProcess;
  childCommand?: string;
  childEnv?: NodeJS.ProcessEnv;
  itemId?: string;
  accountId?: string;
  itemText?: string;
}

function getWorld(context: unknown): LocalGraphqlWorld {
  return context as LocalGraphqlWorld;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate a free port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForReady(
  baseUrl: string,
  stderrCapture: { text: string },
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "server did not become ready";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      if (response.status === 200) {
        const payload = (await response.json()) as { status?: string };
        if (payload.status === "ready") {
          return;
        }
        lastError = `readyz returned unexpected payload: ${JSON.stringify(payload)}`;
      } else {
        lastError = `readyz returned ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const stderrSuffix = stderrCapture.text.trim()
    ? `\nChild stderr:\n${stderrCapture.text.trim()}`
    : "";
  throw new Error(
    `Timed out waiting for ${baseUrl}/readyz: ${lastError}${stderrSuffix}`,
  );
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 5_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function startLocalGraphqlProcess(w: LocalGraphqlWorld): Promise<void> {
  assert.ok(w.dataDir, "data directory must be configured before starting");
  assert.ok(w.port, "port must be configured before starting");

  const plexusRoot = requirePlexusRoot();
  const python = pythonInterpreter();
  const stderrCapture = { text: "" };

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PLEXUS_ROOT: plexusRoot,
    PLEXUS_DATA_DIR: w.dataDir,
    PLEXUS_GRAPHQL_HOST: "127.0.0.1",
    PLEXUS_GRAPHQL_PORT: String(w.port),
    PYTHON: python,
  };
  delete env.PLEXUS_PROXY_DATABASE_URL;

  const child = spawn("bash", [startScript], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  w.child = child;
  w.childCommand = `bash ${startScript}`;
  w.childEnv = env;
  w.baseUrl = `http://127.0.0.1:${w.port}`;

  child.stdout.on("data", () => undefined);
  child.stderr.on("data", (chunk: Buffer) => {
    stderrCapture.text = appendBoundedCapture(
      stderrCapture.text,
      chunk,
      STDERR_CAPTURE_LIMIT,
    );
  });

  await waitForReady(w.baseUrl, stderrCapture);
}

async function graphqlRequest(
  baseUrl: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  assert.strictEqual(response.status, 200, "GraphQL HTTP status must be 200");
  const payload = (await response.json()) as {
    data?: Record<string, unknown>;
    errors?: unknown[];
  };
  assert.ok(!payload.errors, `GraphQL errors: ${JSON.stringify(payload.errors)}`);
  assert.ok(payload.data, "GraphQL response must include data");
  return payload.data;
}

Before(function (this: LocalGraphqlWorld) {
  const w = getWorld(this);
  w.dataDir = undefined;
  w.port = undefined;
  w.baseUrl = undefined;
  w.child = undefined;
  w.childCommand = undefined;
  w.childEnv = undefined;
  w.itemId = undefined;
  w.accountId = undefined;
  w.itemText = undefined;
});

After(async function (this: LocalGraphqlWorld) {
  const w = getWorld(this);
  if (w.child) {
    await stopChild(w.child);
    w.child = undefined;
  }
});

Given("Plexus and Virtuus installed in the Python environment", async function () {
  const plexusRoot = requirePlexusRoot();
  const python = pythonInterpreter();

  const virtuusCheck = spawn(python, [
    "-c",
    "import virtuus; import sys; print(virtuus.__version__)",
  ]);
  const virtuusOutput = await new Promise<string>((resolve, reject) => {
    let stdout = "";
    virtuusCheck.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    virtuusCheck.on("error", reject);
    virtuusCheck.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`virtuus import failed with exit code ${code}`));
    });
  });
  assert.ok(virtuusOutput.length > 0, "virtuus must be importable");

  const proxyDir = join(
    plexusRoot,
    "services",
    "private-graphql-proxy",
  );
  const proxyCheck = spawn(python, [
    "-c",
    "from proxy.app import app; print('ok')",
  ], {
    env: {
      ...process.env,
      PYTHONPATH: proxyDir,
    },
  });
  await new Promise<void>((resolve, reject) => {
    proxyCheck.on("error", reject);
    proxyCheck.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`proxy.app import failed with exit code ${code}`));
    });
  });
});

Given("a data directory on the workspace disk", function () {
  const w = getWorld(this);
  w.dataDir = mkdtempSync(join(tmpdir(), "dataparade-local-graphql-"));
  w.port = undefined;
});

When("I start the local GraphQL process", async function () {
  const w = getWorld(this);
  w.port = await findFreePort();
  await startLocalGraphqlProcess(w);
});

Then("GraphQL answers on the local URL", async function () {
  const w = getWorld(this);
  assert.ok(w.baseUrl, "local GraphQL URL must be set");

  w.itemId = "local-graphql-item-1";
  w.accountId = "local-graphql-account-1";
  w.itemText = "answered on local URL";

  const data = await graphqlRequest(
    w.baseUrl,
    `mutation CreateItem($input: CreateItemInput!) {
      createItem(input: $input) { id accountId text }
    }`,
    {
      input: {
        id: w.itemId,
        accountId: w.accountId,
        text: w.itemText,
      },
    },
  );

  const created = data.createItem as { id: string; accountId: string; text: string };
  assert.strictEqual(created.id, w.itemId);
  assert.strictEqual(created.accountId, w.accountId);
  assert.strictEqual(created.text, w.itemText);
});

Then(
  "no Postgres, Docker, or container runtime is required",
  async function () {
    const w = getWorld(this);
    assert.ok(w.baseUrl, "local GraphQL URL must be set");
    assert.ok(w.childCommand, "child command must be recorded");
    assert.ok(w.childEnv, "child environment must be recorded");

    assert.strictEqual(
      w.childEnv.PLEXUS_PROXY_DATABASE_URL,
      undefined,
      "PLEXUS_PROXY_DATABASE_URL must be unset for the child process",
    );
    assert.ok(
      !/\bdocker\b/i.test(w.childCommand),
      `process command must not invoke docker: ${w.childCommand}`,
    );
    assert.match(
      w.childCommand,
      /start-local-graphql\.sh/,
      "process must be started via the local GraphQL startup script",
    );

    const response = await fetch(`${w.baseUrl}/readyz`);
    assert.strictEqual(response.status, 200);
    const payload = (await response.json()) as { status?: string };
    assert.strictEqual(payload.status, "ready");
  },
);

Given("Items stored through that GraphQL process", async function () {
  const w = getWorld(this);
  w.dataDir = mkdtempSync(join(tmpdir(), "dataparade-local-graphql-"));
  w.port = await findFreePort();
  await startLocalGraphqlProcess(w);

  w.itemId = "restart-item-1";
  w.accountId = "restart-account-1";
  w.itemText = "survives restart";

  await graphqlRequest(
    w.baseUrl!,
    `mutation CreateItem($input: CreateItemInput!) {
      createItem(input: $input) { id accountId text }
    }`,
    {
      input: {
        id: w.itemId,
        accountId: w.accountId,
        text: w.itemText,
      },
    },
  );
});

When("I stop and start the process", async function () {
  const w = getWorld(this);
  assert.ok(w.child, "GraphQL process must be running");
  assert.ok(w.dataDir, "data directory must be set");
  assert.ok(w.port, "port must be set");

  const child = w.child;
  await stopChild(child);
  w.child = undefined;

  await startLocalGraphqlProcess(w);
});

Then("those Items are still readable", async function () {
  const w = getWorld(this);
  assert.ok(w.baseUrl, "local GraphQL URL must be set");
  assert.ok(w.itemId, "item id must be set");

  const data = await graphqlRequest(
    w.baseUrl,
    `query GetItem($id: ID!) {
      getItem(id: $id) { id accountId text }
    }`,
    { id: w.itemId },
  );

  const item = data.getItem as { id: string; accountId: string; text: string };
  assert.strictEqual(item.id, w.itemId);
  assert.strictEqual(item.accountId, w.accountId);
  assert.strictEqual(item.text, w.itemText);
});

Then("they exist as files under the data directory", function () {
  const w = getWorld(this);
  assert.ok(w.dataDir, "data directory must be set");
  assert.ok(w.itemId, "item id must be set");

  const itemDir = join(w.dataDir, "item");
  const jsonFiles = readdirSync(itemDir).filter((name) => name.endsWith(".json"));
  assert.ok(jsonFiles.length > 0, "expected Item JSON files under the data directory");

  const matching = jsonFiles.filter((name) => {
    const document = JSON.parse(
      readFileSync(join(itemDir, name), "utf8"),
    ) as { id?: string; text?: string };
    return document.id === w.itemId;
  });

  assert.ok(
    matching.length > 0,
    `no JSON file under ${itemDir} contained item id ${w.itemId}`,
  );

  const document = JSON.parse(
    readFileSync(join(itemDir, matching[0]!), "utf8"),
  ) as { id?: string; text?: string };
  assert.strictEqual(document.id, w.itemId);
  assert.strictEqual(document.text, w.itemText);
});
