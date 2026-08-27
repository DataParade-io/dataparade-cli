# Gherkin feature specs

Executable behavior specs for Plexus-backed evaluation. Gherkin files here are the spec source of truth.

## Commands

- `pnpm test:features` — run `.feature` files with Cucumber
- `pnpm test` — run Jest unit and eval tests (`tests/**/*.spec.ts`, `tests/eval/**/*.test.ts`)

Add new scenarios under `features/` and matching step definitions under `features/steps/`.
