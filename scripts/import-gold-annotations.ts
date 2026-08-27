#!/usr/bin/env node
/**
 * Import positive gold YAML annotations as Plexus Items via local GraphQL.
 *
 * Usage:
 *   npx ts-node scripts/import-gold-annotations.ts \
 *     --fixture-dir features/fixtures/gold-import \
 *     --graphql-url http://127.0.0.1:8000
 */

import { parseArgs } from "node:util";

import {
  loadAnnotations,
  loadBenchmarkManifest,
} from "../tests/benchmark/manifest";
import type {
  AnnotationRecord,
  BenchmarkManifest,
} from "../tests/benchmark/schema";

const DEFAULT_ACCOUNT_ID = "local-eval";

interface GoldItemMetadata {
  groundTruth: "Yes";
  repository: string;
  commit: string;
  filePath: string;
  startLine: number;
  endLine: number;
  annotationId: string;
}

interface GraphQlItemRef {
  id: string;
  externalId?: string | null;
}

function resolveAccountId(): string {
  return process.env.PLEXUS_ACCOUNT_ID?.trim() || DEFAULT_ACCOUNT_ID;
}

function buildItemText(annotation: AnnotationRecord): string {
  const name = annotation.subject.name?.trim();
  if (name) {
    return `${name}: ${annotation.rationale}`;
  }
  return annotation.rationale;
}

function buildMetadata(
  manifest: BenchmarkManifest,
  annotation: AnnotationRecord,
): GoldItemMetadata {
  return {
    groundTruth: "Yes",
    repository: manifest.repository,
    commit: manifest.commit,
    filePath: annotation.evidence.file_path,
    startLine: annotation.evidence.start_line,
    endLine: annotation.evidence.end_line,
    annotationId: annotation.id,
  };
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
    const body = await response.text();
    throw new Error(
      `GraphQL HTTP ${response.status} from ${graphqlUrl}/graphql: ${body}`,
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

async function findExistingItem(
  graphqlUrl: string,
  accountId: string,
  externalId: string,
): Promise<GraphQlItemRef | null> {
  const byExternalId = await graphqlRequest(
    graphqlUrl,
    `query ItemByExternalId($accountId: String!, $externalId: String!) {
      listItemByAccountAndExternalId(
        accountId: $accountId,
        externalId: {eq: $externalId},
        limit: 1
      ) {
        items { id externalId }
      }
    }`,
    { accountId, externalId },
  );

  const externalIdItems = (
    byExternalId.listItemByAccountAndExternalId as
      | { items?: GraphQlItemRef[] }
      | undefined
  )?.items;
  if (externalIdItems && externalIdItems.length > 0) {
    return externalIdItems[0]!;
  }

  const byFilter = await graphqlRequest(
    graphqlUrl,
    `query ItemsByExternalId($filter: ModelItemFilterInput) {
      listItems(filter: $filter, limit: 1) {
        items { id externalId accountId }
      }
    }`,
    {
      filter: {
        accountId: { eq: accountId },
        externalId: { eq: externalId },
      },
    },
  );

  const filterItems = (
    byFilter.listItems as { items?: GraphQlItemRef[] } | undefined
  )?.items;
  if (filterItems && filterItems.length > 0) {
    return filterItems[0]!;
  }

  return null;
}

async function createItem(
  graphqlUrl: string,
  input: {
    accountId: string;
    externalId: string;
    isEvaluation: boolean;
    text: string;
    metadata: GoldItemMetadata;
  },
): Promise<GraphQlItemRef> {
  const data = await graphqlRequest(
    graphqlUrl,
    `mutation CreateItem($input: CreateItemInput!) {
      createItem(input: $input) { id externalId accountId text metadata isEvaluation }
    }`,
    { input },
  );

  const created = data.createItem as GraphQlItemRef | null | undefined;
  if (!created?.id) {
    throw new Error(`createItem returned no item: ${JSON.stringify(data)}`);
  }
  return created;
}

async function updateItem(
  graphqlUrl: string,
  itemId: string,
  input: {
    accountId: string;
    externalId: string;
    isEvaluation: boolean;
    text: string;
    metadata: GoldItemMetadata;
  },
): Promise<GraphQlItemRef> {
  const data = await graphqlRequest(
    graphqlUrl,
    `mutation UpdateItem($input: UpdateItemInput!) {
      updateItem(input: $input) { id externalId accountId text metadata isEvaluation }
    }`,
    { input: { id: itemId, ...input } },
  );

  const updated = data.updateItem as GraphQlItemRef | null | undefined;
  if (!updated?.id) {
    throw new Error(`updateItem returned no item: ${JSON.stringify(data)}`);
  }
  return updated;
}

function shouldImportAnnotation(annotation: AnnotationRecord): boolean {
  if (annotation.expected.status !== "positive") {
    return false;
  }
  if (annotation.provenance.review_state === "rejected") {
    return false;
  }
  return true;
}

async function importPositiveAnnotation(
  graphqlUrl: string,
  manifest: BenchmarkManifest,
  annotation: AnnotationRecord,
): Promise<void> {
  if (!shouldImportAnnotation(annotation)) {
    return;
  }

  const accountId = resolveAccountId();
  const input = {
    accountId,
    externalId: annotation.id,
    isEvaluation: true,
    text: buildItemText(annotation),
    metadata: buildMetadata(manifest, annotation),
  };

  const existing = await findExistingItem(graphqlUrl, accountId, annotation.id);
  if (existing) {
    await updateItem(graphqlUrl, existing.id, input);
    return;
  }

  await createItem(graphqlUrl, input);
}

async function importGoldAnnotations(
  fixtureDir: string,
  graphqlUrl: string,
): Promise<void> {
  const manifest = loadBenchmarkManifest(fixtureDir);

  for (const layer of manifest.coverage.layers) {
    const annotations = loadAnnotations(fixtureDir, layer);
    for (const annotation of annotations) {
      await importPositiveAnnotation(graphqlUrl, manifest, annotation);
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "fixture-dir": { type: "string" },
      "graphql-url": { type: "string" },
    },
  });

  const fixtureDir = values["fixture-dir"]?.trim();
  const graphqlUrl = values["graphql-url"]?.trim().replace(/\/$/, "");

  if (!fixtureDir) {
    throw new Error("--fixture-dir is required");
  }
  if (!graphqlUrl) {
    throw new Error("--graphql-url is required");
  }

  await importGoldAnnotations(fixtureDir, graphqlUrl);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

export {
  buildItemText,
  buildMetadata,
  importGoldAnnotations,
  resolveAccountId,
  shouldImportAnnotation,
};
