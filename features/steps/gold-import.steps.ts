import assert from "node:assert";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
import YAML from "yaml";

import {
  loadAnnotations,
  loadBenchmarkManifest,
} from "../../tests/benchmark/manifest";
import type {
  AnnotationRecord,
  BenchmarkManifest,
} from "../../tests/benchmark/schema";
import { resolveAccountId } from "../../scripts/import-gold-annotations";

setDefaultTimeout(60_000);

const repoRoot = join(__dirname, "..", "..");
const fixtureSourceDir = join(repoRoot, "features", "fixtures", "gold-import");
const primaryAnnotationId = "gold-import-fixture-api-key";
const rejectedAnnotationId = "gold-import-fixture-rejected-positive";
const startScript = join(repoRoot, "scripts", "start-local-graphql.sh");
const importScript = join(repoRoot, "scripts", "import-gold-annotations.ts");
const STDERR_CAPTURE_LIMIT = 8_000;

const PLEXUS_ROOT_ERROR =
  "PLEXUS_ROOT must be set to a Plexus checkout containing services/private-graphql-proxy";

interface ItemMetadata {
  groundTruth?: string;
  repository?: string;
  commit?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  annotationId?: string;
}

interface GraphQlItem {
  id: string;
  accountId: string;
  externalId?: string | null;
  text?: string | null;
  metadata?: ItemMetadata | string | null;
  isEvaluation?: boolean | null;
}

interface GoldImportWorld {
  fixtureDir?: string;
  dataDir?: string;
  port?: number;
  baseUrl?: string;
  child?: ChildProcess;
  manifest?: BenchmarkManifest;
  annotation?: AnnotationRecord;
  annotationLayer?: string;
  annotationFilePath?: string;
}

function getWorld(context: unknown): GoldImportWorld {
  return context as GoldImportWorld;
}

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

function copyFixtureToTempDir(): string {
  const fixtureDir = mkdtempSync(join(tmpdir(), "dataparade-gold-import-"));
  cpSync(fixtureSourceDir, fixtureDir, { recursive: true });
  return fixtureDir;
}

function loadPrimaryAnnotation(fixtureDir: string): {
  manifest: BenchmarkManifest;
  annotation: AnnotationRecord;
  layer: string;
  annotationFilePath: string;
} {
  const manifest = loadBenchmarkManifest(fixtureDir);
  const layer = manifest.coverage.layers[0];
  assert.ok(layer, "fixture manifest must declare at least one coverage layer");
  const annotations = loadAnnotations(fixtureDir, layer);
  const annotation = annotations.find((entry) => entry.id === primaryAnnotationId);
  assert.ok(annotation, `fixture must contain annotation ${primaryAnnotationId}`);
  return {
    manifest,
    annotation,
    layer,
    annotationFilePath: join(fixtureDir, "annotations", `${layer}.yaml`),
  };
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

async function startLocalGraphqlProcess(w: GoldImportWorld): Promise<void> {
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

function runImport(fixtureDir: string, baseUrl: string): void {
  const result = spawnSync(
    process.execPath,
    [
      "-r",
      "ts-node/register",
      importScript,
      "--fixture-dir",
      fixtureDir,
      "--graphql-url",
      baseUrl,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PLEXUS_ACCOUNT_ID: resolveAccountId(),
      },
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n");
    throw new Error(`gold annotation import failed:\n${details}`);
  }
}

function parseMetadata(metadata: GraphQlItem["metadata"]): ItemMetadata {
  if (!metadata) {
    return {};
  }
  if (typeof metadata === "string") {
    return JSON.parse(metadata) as ItemMetadata;
  }
  return metadata;
}

async function fetchEvaluationItemsForAccount(
  baseUrl: string,
): Promise<GraphQlItem[]> {
  const accountId = resolveAccountId();
  const data = await graphqlRequest(
    baseUrl,
    `query EvaluationItemsForAccount($accountId: String!) {
      listItemByAccountIdUpdatedAt(accountId: $accountId, limit: 10) {
        items {
          id
          accountId
          externalId
          isEvaluation
        }
      }
    }`,
    { accountId },
  );

  const items = (
    data.listItemByAccountIdUpdatedAt as { items?: GraphQlItem[] } | undefined
  )?.items;
  return items ?? [];
}

async function fetchItemByExternalId(
  baseUrl: string,
  externalId: string,
): Promise<GraphQlItem> {
  const accountId = resolveAccountId();
  const data = await graphqlRequest(
    baseUrl,
    `query ItemByExternalId($accountId: String!, $externalId: String!) {
      listItemByAccountAndExternalId(
        accountId: $accountId,
        externalId: {eq: $externalId},
        limit: 1
      ) {
        items {
          id
          accountId
          externalId
          text
          metadata
          isEvaluation
        }
      }
    }`,
    { accountId, externalId },
  );

  const items = (
    data.listItemByAccountAndExternalId as { items?: GraphQlItem[] } | undefined
  )?.items;
  assert.ok(items && items.length === 1, "expected exactly one Item by externalId");
  return items[0]!;
}

function readAnnotationFromYaml(
  annotationFilePath: string,
  annotationId: string,
): AnnotationRecord {
  const parsed = YAML.parse(readFileSync(annotationFilePath, "utf8")) as {
    annotations?: AnnotationRecord[];
  };
  const annotation = parsed.annotations?.find((entry) => entry.id === annotationId);
  assert.ok(annotation, `annotation ${annotationId} must exist in ${annotationFilePath}`);
  return annotation;
}

function writeAnnotationYaml(
  annotationFilePath: string,
  updatedAnnotation: AnnotationRecord,
): void {
  const parsed = YAML.parse(readFileSync(annotationFilePath, "utf8")) as {
    annotations?: AnnotationRecord[];
  };
  const annotations = parsed.annotations ?? [];
  const index = annotations.findIndex((entry) => entry.id === updatedAnnotation.id);
  if (index === -1) {
    annotations.push(updatedAnnotation);
  } else {
    annotations[index] = updatedAnnotation;
  }
  writeFileSync(
    annotationFilePath,
    YAML.stringify({ annotations }),
    "utf8",
  );
}

Before(function (this: GoldImportWorld) {
  const w = getWorld(this);
  w.fixtureDir = undefined;
  w.dataDir = undefined;
  w.port = undefined;
  w.baseUrl = undefined;
  w.child = undefined;
  w.manifest = undefined;
  w.annotation = undefined;
  w.annotationLayer = undefined;
  w.annotationFilePath = undefined;
});

After(async function (this: GoldImportWorld) {
  const w = getWorld(this);
  if (w.child) {
    await stopChild(w.child);
    w.child = undefined;
  }
});

Given("a canonical gold annotation in git YAML", function () {
  const w = getWorld(this);
  w.fixtureDir = copyFixtureToTempDir();
  const loaded = loadPrimaryAnnotation(w.fixtureDir);
  w.manifest = loaded.manifest;
  w.annotation = loaded.annotation;
  w.annotationLayer = loaded.layer;
  w.annotationFilePath = loaded.annotationFilePath;
});

Given("a local Plexus GraphQL server", async function () {
  const w = getWorld(this);
  w.dataDir = mkdtempSync(join(tmpdir(), "dataparade-gold-import-graphql-"));
  w.port = await findFreePort();
  await startLocalGraphqlProcess(w);
});

Given("an annotation that changes in git YAML", async function () {
  const w = getWorld(this);
  w.fixtureDir = copyFixtureToTempDir();
  const loaded = loadPrimaryAnnotation(w.fixtureDir);
  w.manifest = loaded.manifest;
  w.annotation = loaded.annotation;
  w.annotationLayer = loaded.layer;
  w.annotationFilePath = loaded.annotationFilePath;

  w.dataDir = mkdtempSync(join(tmpdir(), "dataparade-gold-import-graphql-"));
  w.port = await findFreePort();
  await startLocalGraphqlProcess(w);
  runImport(w.fixtureDir, w.baseUrl!);

  const updatedAnnotation: AnnotationRecord = {
    ...w.annotation,
    evidence: {
      ...w.annotation.evidence,
      end_line: w.annotation.evidence.end_line + 3,
    },
    rationale:
      "Configuration stores a third-party API key in plain text with expanded scope.",
  };
  writeAnnotationYaml(w.annotationFilePath, updatedAnnotation);
  w.annotation = updatedAnnotation;
});

When("I import that annotation", function () {
  const w = getWorld(this);
  assert.ok(w.fixtureDir, "fixture directory must be set");
  assert.ok(w.baseUrl, "GraphQL base URL must be set");
  runImport(w.fixtureDir, w.baseUrl);
});

When("I import again", function () {
  const w = getWorld(this);
  assert.ok(w.fixtureDir, "fixture directory must be set");
  assert.ok(w.baseUrl, "GraphQL base URL must be set");
  runImport(w.fixtureDir, w.baseUrl);
});

Then("a Plexus Item exists with ground truth Yes", async function () {
  const w = getWorld(this);
  assert.ok(w.baseUrl, "GraphQL base URL must be set");
  assert.ok(w.annotation, "annotation must be set");

  const item = await fetchItemByExternalId(w.baseUrl, w.annotation.id);
  const metadata = parseMetadata(item.metadata);

  assert.strictEqual(item.externalId, w.annotation.id);
  assert.strictEqual(item.isEvaluation, true);
  assert.strictEqual(metadata.groundTruth, "Yes");
});

Then(
  "the Item identifies the same repository, commit, file, and line span",
  async function () {
    const w = getWorld(this);
    assert.ok(w.baseUrl, "GraphQL base URL must be set");
    assert.ok(w.manifest, "manifest must be set");
    assert.ok(w.annotation, "annotation must be set");

    const item = await fetchItemByExternalId(w.baseUrl, w.annotation.id);
    const metadata = parseMetadata(item.metadata);

    assert.strictEqual(metadata.repository, w.manifest.repository);
    assert.strictEqual(metadata.commit, w.manifest.commit);
    assert.strictEqual(metadata.filePath, w.annotation.evidence.file_path);
    assert.strictEqual(metadata.startLine, w.annotation.evidence.start_line);
    assert.strictEqual(metadata.endLine, w.annotation.evidence.end_line);
    assert.strictEqual(metadata.annotationId, w.annotation.id);
    assert.strictEqual(item.externalId, w.annotation.id);
  },
);

Then(
  "only the proposed positive annotation is imported as an Item",
  async function () {
    const w = getWorld(this);
    assert.ok(w.baseUrl, "GraphQL base URL must be set");
    assert.ok(w.annotation, "annotation must be set");

    const items = await fetchEvaluationItemsForAccount(w.baseUrl);
    const evaluationItems = items.filter((item) => item.isEvaluation === true);
    const externalIds = evaluationItems.map((item) => item.externalId);

    assert.strictEqual(
      evaluationItems.length,
      1,
      `expected one evaluation Item, found: ${externalIds.join(", ")}`,
    );
    assert.strictEqual(evaluationItems[0]!.externalId, w.annotation.id);
    assert.ok(
      !externalIds.includes(rejectedAnnotationId),
      `rejected annotation ${rejectedAnnotationId} must not be imported`,
    );
  },
);

Then("the Plexus Item matches the git annotation", async function () {
  const w = getWorld(this);
  assert.ok(w.baseUrl, "GraphQL base URL must be set");
  assert.ok(w.annotation, "annotation must be set");
  assert.ok(w.annotationFilePath, "annotation file path must be set");

  const yamlAnnotation = readAnnotationFromYaml(
    w.annotationFilePath,
    w.annotation.id,
  );
  const item = await fetchItemByExternalId(w.baseUrl, w.annotation.id);
  const metadata = parseMetadata(item.metadata);

  assert.strictEqual(metadata.groundTruth, "Yes");
  assert.strictEqual(metadata.filePath, yamlAnnotation.evidence.file_path);
  assert.strictEqual(metadata.startLine, yamlAnnotation.evidence.start_line);
  assert.strictEqual(metadata.endLine, yamlAnnotation.evidence.end_line);
  assert.strictEqual(metadata.annotationId, yamlAnnotation.id);
  assert.ok(
    item.text?.includes(yamlAnnotation.rationale),
    "Item text must reflect the YAML rationale",
  );
});

Then("git YAML is still the source of truth", function () {
  const w = getWorld(this);
  assert.ok(w.annotation, "annotation must be set");
  assert.ok(w.annotationFilePath, "annotation file path must be set");

  const yamlAnnotation = readAnnotationFromYaml(
    w.annotationFilePath,
    w.annotation.id,
  );

  assert.strictEqual(
    yamlAnnotation.evidence.end_line,
    w.annotation.evidence.end_line,
    "YAML on disk must retain the updated line span",
  );
  assert.strictEqual(
    yamlAnnotation.rationale,
    w.annotation.rationale,
    "YAML on disk must retain the updated rationale",
  );
  assert.strictEqual(
    yamlAnnotation.rationale,
    "Configuration stores a third-party API key in plain text with expanded scope.",
  );
});
