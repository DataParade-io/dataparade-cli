#!/usr/bin/env node
/**
 * Run a real scanner recall evaluation against the curated corpus and
 * persist an Evaluation record in local Plexus GraphQL (Virtuus).
 *
 * Usage:
 *   PLEXUS_ROOT=/path/to/Plexus \
 *   npx ts-node scripts/run-corpus-eval.ts \
 *     --corpus-dir /path/to/tests/benchmark \
 *     --graphql-url http://127.0.0.1:8000
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import {
  importGoldAnnotations,
  shouldImportAnnotation,
} from "./import-gold-annotations";
import {
  loadAnnotations,
  loadBenchmarkManifest,
} from "../tests/benchmark/manifest";
import type { AnnotationRecord } from "../tests/benchmark/schema";

const ACCOUNT_ID = "local-eval";
const ACCOUNT_KEY = "local-eval";
const SCORECARD_NAME = "Scanner Recall";
const SCORE_NAME = "Span Overlap";
const SCORECARD_ID = "scanner-recall-scorecard";
const SECTION_ID = "scanner-recall-section";
const SCORE_ID = "scanner-recall-span-overlap";

const repoRoot = join(__dirname, "..");
const startScript = join(repoRoot, "scripts", "start-local-graphql.sh");

interface GraphQlItemRef {
  id: string;
  externalId?: string | null;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function listRepoDirs(corpusDir: string): string[] {
  const reposRoot = join(corpusDir, "repos");
  return readdirSync(reposRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(reposRoot, entry.name))
    .sort();
}

function cacheDirFor(
  corpusDir: string,
  repoKey: string,
  commit: string,
): string {
  return join(corpusDir, ".cache", "repos", `${repoKey}@${commit}`);
}

function stageScopedSources(
  corpusDir: string,
  workDir: string,
): Map<string, string> {
  const stagedByKey = new Map<string, string>();

  for (const repoDir of listRepoDirs(corpusDir)) {
    const repoKey = repoDir.split("/").pop()!;
    const manifest = loadBenchmarkManifest(repoDir);
    const cacheDir = cacheDirFor(corpusDir, repoKey, manifest.commit);
    if (!existsSync(cacheDir)) {
      throw new Error(
        `Materialized clone missing for ${repoKey} at ${cacheDir}. Run benchmark:materialize first.`,
      );
    }

    const stagedRoot = join(workDir, "sources", repoKey);
    mkdirSync(stagedRoot, { recursive: true });

    for (const includePath of manifest.scope.include) {
      const from = join(cacheDir, includePath);
      const to = join(stagedRoot, includePath);
      if (!existsSync(from)) {
        throw new Error(`Scope path missing in clone ${repoKey}: ${includePath}`);
      }
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to, { recursive: statSync(from).isDirectory() });
    }

    stagedByKey.set(repoKey, stagedRoot);
  }

  return stagedByKey;
}

function writeDatasetCsv(
  corpusDir: string,
  stagedByKey: Map<string, string>,
  datasetPath: string,
): { rows: number; skipped: number } {
  const lines = [`text,${csvEscape(SCORE_NAME)},content_id,metadata`];
  let rows = 0;
  let skipped = 0;

  for (const repoDir of listRepoDirs(corpusDir)) {
    const repoKey = repoDir.split("/").pop()!;
    const manifest = loadBenchmarkManifest(repoDir);
    const sourceRoot = stagedByKey.get(repoKey);
    if (!sourceRoot) {
      throw new Error(`No staged source root for ${repoKey}`);
    }

    for (const layer of manifest.coverage.layers) {
      const annotations = loadAnnotations(repoDir, layer);
      for (const annotation of annotations) {
        if (!shouldImportAnnotation(annotation)) {
          skipped += 1;
          continue;
        }
        const text = annotation.subject.name
          ? `${annotation.subject.name}: ${annotation.rationale}`
          : annotation.rationale;
        const metadata = {
          groundTruth: "Yes",
          repository: manifest.repository,
          commit: manifest.commit,
          filePath: annotation.evidence.file_path,
          startLine: annotation.evidence.start_line,
          endLine: annotation.evidence.end_line,
          sourceRoot,
          annotationId: annotation.id,
          repoKey,
          layer: annotation.layer,
          reviewState: annotation.provenance.review_state,
        };
        lines.push(
          [
            csvEscape(text),
            csvEscape("Yes"),
            csvEscape(annotation.id),
            csvEscape(JSON.stringify(metadata)),
          ].join(","),
        );
        rows += 1;
      }
    }
  }

  writeFileSync(datasetPath, `${lines.join("\n")}\n`, "utf8");
  return { rows, skipped };
}

function writeScorecardYaml(workDir: string): void {
  const scoreDir = join(workDir, "scorecards", SCORECARD_NAME);
  mkdirSync(scoreDir, { recursive: true });
  writeFileSync(
    join(scoreDir, `${SCORE_NAME}.yaml`),
    [
      `name: ${SCORE_NAME}`,
      `id: ${SCORE_ID}`,
      `key: span-overlap`,
      `class: SourceSpanOverlapScore`,
      "",
    ].join("\n"),
    "utf8",
  );
}

async function graphqlRequest(
  graphqlUrl: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${graphqlUrl}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (response.status !== 200) {
    throw new Error(
      `GraphQL HTTP ${response.status}: ${await response.text()}`,
    );
  }
  const payload = (await response.json()) as {
    data?: Record<string, unknown>;
    errors?: unknown[];
  };
  if (payload.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(payload.errors)}`);
  }
  if (!payload.data) {
    throw new Error("GraphQL response missing data");
  }
  return payload.data;
}

async function seedMetadata(graphqlUrl: string): Promise<void> {
  const existingAccount = await graphqlRequest(
    graphqlUrl,
    `query GetAccount($id: ID!) { getAccount(id: $id) { id key } }`,
    { id: ACCOUNT_ID },
  );
  if (!(existingAccount.getAccount as { id?: string } | null)?.id) {
    await graphqlRequest(
      graphqlUrl,
      `mutation CreateAccount($input: CreateAccountInput!) {
        createAccount(input: $input) { id key }
      }`,
      {
        input: {
          id: ACCOUNT_ID,
          key: ACCOUNT_KEY,
          name: "Scanner Recall Account",
        },
      },
    );
  }

  const existingScorecard = await graphqlRequest(
    graphqlUrl,
    `query GetScorecard($id: ID!) { getScorecard(id: $id) { id name } }`,
    { id: SCORECARD_ID },
  );
  if (!(existingScorecard.getScorecard as { id?: string } | null)?.id) {
    await graphqlRequest(
      graphqlUrl,
      `mutation CreateScorecard($input: CreateScorecardInput!) {
        createScorecard(input: $input) { id }
      }`,
      {
        input: {
          id: SCORECARD_ID,
          accountId: ACCOUNT_ID,
          name: SCORECARD_NAME,
          key: "scanner-recall",
        },
      },
    );
    await graphqlRequest(
      graphqlUrl,
      `mutation CreateSection($input: CreateScorecardSectionInput!) {
        createScorecardSection(input: $input) { id }
      }`,
      {
        input: {
          id: SECTION_ID,
          name: "Main",
          order: 1,
          scorecardId: SCORECARD_ID,
        },
      },
    );
    await graphqlRequest(
      graphqlUrl,
      `mutation CreateScore($input: CreateScoreInput!) {
        createScore(input: $input) { id }
      }`,
      {
        input: {
          id: SCORE_ID,
          accountId: ACCOUNT_ID,
          scorecardId: SCORECARD_ID,
          sectionId: SECTION_ID,
          name: SCORE_NAME,
          key: "span-overlap",
          order: 1,
          type: "classification",
          externalId: SCORE_ID,
        },
      },
    );
  }
}

async function importCorpus(corpusDir: string, graphqlUrl: string): Promise<number> {
  let imported = 0;
  for (const repoDir of listRepoDirs(corpusDir)) {
    await importGoldAnnotations(repoDir, graphqlUrl);
    const manifest = loadBenchmarkManifest(repoDir);
    for (const layer of manifest.coverage.layers) {
      imported += loadAnnotations(repoDir, layer).filter(shouldImportAnnotation)
        .length;
    }
  }
  return imported;
}

async function waitForReady(baseUrl: string, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      if (response.status === 200) {
        const payload = (await response.json()) as { status?: string };
        if (payload.status === "ready") {
          return;
        }
        lastError = JSON.stringify(payload);
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/readyz: ${lastError}`);
}

function startGraphql(plexusRoot: string, dataDir: string, port: number): ChildProcess {
  mkdirSync(dataDir, { recursive: true });
  const child = spawn("bash", [startScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PLEXUS_ROOT: plexusRoot,
      PLEXUS_DATA_DIR: dataDir,
      PLEXUS_GRAPHQL_HOST: "127.0.0.1",
      PLEXUS_GRAPHQL_PORT: String(port),
    },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  child.unref();
  return child;
}

function extractEvaluationId(output: string): string | undefined {
  return output.match(
    /Created initial Evaluation record with ID:\s*([0-9a-f-]{36})/i,
  )?.[1];
}

async function fetchEvaluation(
  graphqlUrl: string,
  evaluationId: string,
): Promise<Record<string, unknown>> {
  const query = `query GetEvaluation($id: ID!) {
      getEvaluation(id: $id) {
        id
        type
        status
        accuracy
        metrics
        totalItems
        processedItems
        confusionMatrix
        errorMessage
        scorecardId
        scoreId
      }
    }`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const data = await graphqlRequest(graphqlUrl, query, { id: evaluationId });
      const evaluation = data.getEvaluation as Record<string, unknown> | null;
      if (!evaluation) {
        throw new Error(`getEvaluation returned null for ${evaluationId}`);
      }
      return evaluation;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`getEvaluation failed for ${evaluationId}`);
}

async function countItems(graphqlUrl: string): Promise<number> {
  const data = await graphqlRequest(
    graphqlUrl,
    `query ListItems($filter: ModelItemFilterInput) {
      listItems(filter: $filter, limit: 1000) {
        items { id externalId isEvaluation }
      }
    }`,
    { filter: { accountId: { eq: ACCOUNT_ID }, isEvaluation: { eq: true } } },
  );
  const items = (data.listItems as { items?: GraphQlItemRef[] })?.items ?? [];
  return items.length;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "corpus-dir": { type: "string" },
      "graphql-url": { type: "string" },
      "work-dir": { type: "string" },
      "plexus-root": { type: "string" },
      port: { type: "string" },
      "start-graphql": { type: "boolean", default: false },
    },
  });

  const corpusDir = values["corpus-dir"]?.trim();
  if (!corpusDir) {
    throw new Error("--corpus-dir is required (tests/benchmark of the corpus checkout)");
  }

  const plexusRoot =
    values["plexus-root"]?.trim() || process.env.PLEXUS_ROOT?.trim();
  if (!plexusRoot) {
    throw new Error("PLEXUS_ROOT or --plexus-root is required");
  }

  const workDir =
    values["work-dir"]?.trim() || join(repoRoot, ".plexus-corpus-eval");
  mkdirSync(workDir, { recursive: true });

  const port = Number(values.port || process.env.PLEXUS_GRAPHQL_PORT || "8000");
  let graphqlUrl =
    values["graphql-url"]?.trim().replace(/\/$/, "") ||
    `http://127.0.0.1:${port}`;

  const dataDir = join(workDir, "virtuus");
  try {
    await waitForReady(graphqlUrl, 2_000);
  } catch {
    if (!values["start-graphql"] && !process.env.PLEXUS_ROOT) {
      throw new Error(
        `GraphQL is not reachable at ${graphqlUrl}. Start it with --start-graphql or scripts/start-local-graphql.sh`,
      );
    }
    console.log(`Starting local GraphQL on port ${port}...`);
    startGraphql(plexusRoot, dataDir, port);
    await waitForReady(graphqlUrl);
  }

  console.log(`GraphQL ready at ${graphqlUrl}`);
  console.log("Staging corpus scope into scan roots...");
  const stagedByKey = stageScopedSources(corpusDir, workDir);
  writeScorecardYaml(workDir);

  const datasetPath = join(workDir, "dataset.csv");
  const { rows, skipped } = writeDatasetCsv(corpusDir, stagedByKey, datasetPath);
  console.log(`Dataset rows (positive gold): ${rows}; omitted: ${skipped}`);

  await seedMetadata(graphqlUrl);
  const imported = await importCorpus(corpusDir, graphqlUrl);
  const itemCount = await countItems(graphqlUrl);
  console.log(`Imported gold Items: ${imported}; GraphQL evaluation Items: ${itemCount}`);

  const python = process.env.PYTHON?.trim() || "python3";
  const findingsCommand = `cd ${repoRoot} && node -r ts-node/register scripts/scan-findings.ts --root {root}`;
  const result = spawnSync(
    python,
    [
      "-m",
      "plexus",
      "evaluate",
      "accuracy",
      "--yaml",
      "--scorecard",
      SCORECARD_NAME,
      "--score",
      SCORE_NAME,
      "--dataset-file",
      datasetPath,
      "--notes",
      "Scanner recall on the curated 150-annotation corpus. Gold labels are still proposed (not human-accepted). Unread files are omitted from the recall denominator.",
    ],
    {
      cwd: workDir,
      env: {
        ...process.env,
        PYTHONPATH: plexusRoot,
        PLEXUS_API_URL: `${graphqlUrl}/graphql`,
        PLEXUS_GRAPHQL_AUTH_MODE: "api_key",
        PLEXUS_API_KEY: "local-eval-key",
        PLEXUS_ACCOUNT_ID: ACCOUNT_ID,
        PLEXUS_ACCOUNT_KEY: ACCOUNT_KEY,
        PLEXUS_SOURCE_FINDINGS_COMMAND: findingsCommand,
      },
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  writeFileSync(join(workDir, "evaluate.log"), output, "utf8");
  if (result.status !== 0) {
    throw new Error(
      `plexus evaluate accuracy failed (exit ${result.status}). See ${join(workDir, "evaluate.log")}\n${output.slice(-8000)}`,
    );
  }

  const evaluationId = extractEvaluationId(output);
  if (!evaluationId) {
    throw new Error("evaluate output did not include an Evaluation id");
  }
  writeFileSync(join(workDir, "evaluation-id.txt"), `${evaluationId}\n`, "utf8");

  const evaluation = await fetchEvaluation(graphqlUrl, evaluationId);
  writeFileSync(
    join(workDir, "evaluation.json"),
    `${JSON.stringify(evaluation, null, 2)}\n`,
    "utf8",
  );

  console.log(JSON.stringify({
    evaluationId,
    graphqlUrl,
    datasetPath,
    positiveGoldRows: rows,
    importedItems: imported,
    evaluation,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

export { shouldImportAnnotation };
export type { AnnotationRecord };
