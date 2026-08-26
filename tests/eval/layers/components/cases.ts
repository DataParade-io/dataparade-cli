import type { ExhaustiveScope, GroundTruthCase } from "../../types";

export const COMPONENT_FIXTURE_ROOTS = [
  "typescript-basic",
  "python-basic",
  "terraform-basic",
] as const;

export const COMPONENT_GROUND_TRUTH: GroundTruthCase[] = [
  {
    id: "ts-stripe-third-party",
    layer: "components",
    scopeId: "typescript-basic",
    subject: { key: "third_party:stripe", name: "Stripe" },
    evidence: {
      filePath: "external-api.ts",
      startLine: 6,
      endLine: 6,
    },
    expected: {
      status: "positive",
      labels: ["third_party", "payment_processor"],
    },
  },
  {
    id: "ts-pg-database",
    layer: "components",
    scopeId: "typescript-basic",
    subject: { key: "asset:pg", name: "Pg" },
    evidence: {
      filePath: "db-client-import.ts",
      startLine: 1,
      endLine: 1,
    },
    expected: {
      status: "positive",
      labels: ["asset", "database"],
    },
  },
  {
    id: "ts-db-pool-query-gap",
    layer: "components",
    scopeId: "typescript-basic",
    subject: { key: "asset:postgres", name: "Postgres" },
    evidence: {
      filePath: "db.ts",
      startLine: 12,
      endLine: 12,
    },
    expected: {
      status: "positive",
      labels: ["asset", "database"],
    },
  },
  {
    id: "ts-db-query-negative",
    layer: "components",
    scopeId: "typescript-basic",
    subject: { key: "asset:none", name: "none" },
    evidence: {
      filePath: "db.ts",
      startLine: 12,
      endLine: 12,
    },
    expected: {
      status: "negative",
      labels: [],
    },
  },
  {
    id: "py-openai-third-party",
    layer: "components",
    scopeId: "python-basic",
    subject: { key: "third_party:openai", name: "Openai" },
    evidence: {
      filePath: "app.py",
      startLine: 11,
      endLine: 11,
    },
    expected: {
      status: "positive",
      labels: ["third_party", "ai_provider"],
    },
  },
  {
    id: "py-psycopg2-gap",
    layer: "components",
    scopeId: "python-basic",
    subject: { key: "asset:psycopg2", name: "Psycopg2" },
    evidence: {
      filePath: "app.py",
      startLine: 7,
      endLine: 7,
    },
    expected: {
      status: "positive",
      labels: ["asset", "database"],
    },
  },
  {
    id: "py-health-route-negative",
    layer: "components",
    scopeId: "python-basic",
    subject: { key: "third_party:none", name: "none" },
    evidence: {
      filePath: "app.py",
      startLine: 10,
      endLine: 10,
    },
    expected: {
      status: "negative",
      labels: [],
    },
  },
  {
    id: "tf-aws-pg-database",
    layer: "components",
    scopeId: "terraform-basic",
    subject: { key: "asset:aws pg", name: "Aws Pg" },
    evidence: {
      filePath: "main.tf",
      startLine: 5,
      endLine: 10,
    },
    expected: {
      status: "positive",
      labels: ["asset", "database"],
    },
  },
  {
    id: "tf-s3-storage-gap",
    layer: "components",
    scopeId: "terraform-basic",
    subject: { key: "asset:s3", name: "S3" },
    evidence: {
      filePath: "main.tf",
      startLine: 12,
      endLine: 14,
    },
    expected: {
      status: "positive",
      labels: ["asset", "file_storage"],
    },
  },
  {
    id: "tf-iam-role-negative",
    layer: "components",
    scopeId: "terraform-basic",
    subject: { key: "asset:iam", name: "none" },
    evidence: {
      filePath: "main.tf",
      startLine: 16,
      endLine: 18,
    },
    expected: {
      status: "negative",
      labels: [],
    },
  },
];

export const COMPONENT_EXHAUSTIVE_SCOPES: ExhaustiveScope[] = [
  {
    id: "ts-external-api-scope",
    filePaths: ["external-api.ts"],
  },
];
