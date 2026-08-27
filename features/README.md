# Gherkin feature specs

Executable behavior specs for Plexus-backed evaluation. Gherkin files here are the spec source of truth.

## Commands

- `pnpm test:features` — run `.feature` files with Cucumber
- `pnpm test` — run Jest unit and eval tests (`tests/**/*.spec.ts`, `tests/eval/**/*.test.ts`)

Add new scenarios under `features/` and matching step definitions under `features/steps/`.

Local GraphQL scenarios require `PLEXUS_ROOT` (and optionally `PYTHON`) to be exported before running `npm run test:features` or `pnpm test:features`.

## Local GraphQL host process

Start Plexus GraphQL as a single uvicorn worker with Virtuus file storage (no Docker or Postgres):

```bash
PLEXUS_ROOT=/path/to/Plexus \
PLEXUS_DATA_DIR=/tmp/plexus-data \
./scripts/start-local-graphql.sh
```

Then check readiness and create an Item:

```bash
curl -sS http://127.0.0.1:8000/readyz

curl -sS http://127.0.0.1:8000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"mutation CreateItem($input: CreateItemInput!) { createItem(input: $input) { id accountId text } }","variables":{"input":{"id":"demo-item","accountId":"demo-account","text":"hello"}}}'
```
