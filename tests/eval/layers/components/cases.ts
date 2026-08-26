import type { EvalCase } from "../../types";

const TYPESCRIPT_BASIC_FILES = [
  "app/route.ts",
  "db-client-import.ts",
  "db.ts",
  "external-api.ts",
  "pg-client.ts",
  "server.ts",
];

const TERRAFORM_BASIC_FILES = ["main.tf", "providers.tf", "variables.tf"];

/** Ground-truth component cases across committed fixtures (5–6 mixed outcomes). */
export const componentEvalCases: EvalCase[] = [
  {
    id: "ts-stripe-third-party",
    fixture: "typescript-basic",
    layer: "components",
    subject: { key: "third_party:stripe", name: "Stripe" },
    evidence: { file_path: "external-api.ts", start_line: 6, end_line: 6 },
    expected: { status: "positive", labels: ["third_party"] },
    rationale:
      "fetch to api.stripe.com is classified as a Stripe payment-processor third party.",
    exhaustiveScopeFiles: TYPESCRIPT_BASIC_FILES,
  },
  {
    id: "ts-pg-database",
    fixture: "typescript-basic",
    layer: "components",
    subject: { key: "asset:pg", name: "Pg" },
    evidence: { file_path: "pg-client.ts", start_line: 12, end_line: 14 },
    expected: { status: "positive", labels: ["database"] },
    rationale:
      "pool.query against a pg-style client emits a database asset from pg import heuristics.",
    exhaustiveScopeFiles: TYPESCRIPT_BASIC_FILES,
  },
  {
    id: "ts-passport-not-third-party",
    fixture: "typescript-basic",
    layer: "components",
    subject: { key: "third_party:passport", name: "Passport" },
    evidence: { file_path: "server.ts", start_line: 23, end_line: 23 },
    expected: { status: "negative", labels: [] },
    rationale:
      "passport.authenticate('jwt') is local auth middleware, not an external vendor.",
    exhaustiveScopeFiles: TYPESCRIPT_BASIC_FILES,
  },
  {
    id: "py-openai-third-party",
    fixture: "python-basic",
    layer: "components",
    subject: { key: "third_party:openai", name: "Openai" },
    evidence: { file_path: "app.py", start_line: 11, end_line: 11 },
    expected: { status: "positive", labels: ["third_party"] },
    rationale: "requests.get to api.openai.com is an OpenAI API third-party call.",
    exhaustiveScopeFiles: ["app.py"],
  },
  {
    id: "py-psycopg2-database-gap",
    fixture: "python-basic",
    layer: "components",
    subject: { key: "asset:psycopg2", name: "Psycopg2" },
    evidence: { file_path: "app.py", start_line: 7, end_line: 7 },
    expected: {
      status: "positive",
      labels: ["database"],
      documentedGap: true,
    },
    rationale:
      "psycopg2.connect with a postgres URL should surface a database asset; scanner currently infers other drivers only.",
    exhaustiveScopeFiles: ["app.py"],
  },
  {
    id: "tf-aws-pg-database",
    fixture: "terraform-basic",
    layer: "components",
    subject: { key: "asset:aws pg", name: "Aws Pg" },
    evidence: { file_path: "main.tf", start_line: 5, end_line: 10 },
    expected: { status: "positive", labels: ["database"] },
    rationale: "aws_db_instance main is a managed PostgreSQL database resource.",
    exhaustiveScopeFiles: TERRAFORM_BASIC_FILES,
  },
];
