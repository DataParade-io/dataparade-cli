# Scanner evaluation benchmark corpus

Versioned ground-truth data for deterministic scanner evaluation. Labels are curated independently of scanner output; human review is required before annotations move from `proposed` to `accepted`.

## Layout

```text
tests/benchmark/
  schema.ts           # TypeScript types mirroring ground-truth-schema.md
  manifest.ts         # load/validate manifests and annotations
  repos/
    <repo-key>/
      manifest.yaml   # pinned commit, scope, coverage metadata
      annotations/
        components.yaml
        data_items.yaml
  scripts/
    materialize-repo.mjs   # optional local clone helper (not run in CI)
  .cache/               # materialized clones (gitignored)
```

## Current proposed repositories

| Key | Repository | Status | Focus |
|-----|------------|--------|-------|
| `hyperswitch-vault` | `juspay/hyperswitch-card-vault` | Active proposed packet | Rust card-vault data items; one complete source file |
| `vgs-django` | `vgs-samples/vgs-django-sample-id-verification` | Blocked: license decision | Django PII models + Checkr third-party API |
| `easy-school` | `ZeroCoolHacker/easy-school` | Blocked: GLWT license decision | Plain Django SSN field without vendor wrappers |

## Annotation workflow

1. Proposed annotations start in `review_state: proposed`.
2. A human reviewer inspects pinned source at the evidence location and updates `review_state` to `accepted` or `rejected`.
3. Only `accepted` annotations count toward headline evaluation denominators.

Component subject keys use the evaluator identity convention: `type:name` with a lowercase name (for example `asset:database`, `third_party:checkr`).

## Serialization alignment

These YAML files are the human-review source of truth during corpus curation. Final runtime serialization will align with `tests/eval/types.ts` once DATAP-c7dd46 lands. Until then, `schema.ts` and `manifest.ts` define the committed corpus contract.

## Eval integration

`to-eval-cases.ts` converts loaded `AnnotationRecord[]` values into `EvalCase[]` for the evaluator in `tests/eval/types.ts`.

- Maps `subject.key`, evidence line pointers, and `expected.status` / `expected.labels` directly.
- Skips `rejected` annotations; includes `accepted` by default.
- Proposed (and `needs_adjudication`) annotations are omitted unless `includeProposed: true` is passed.
- Benchmark annotations do not set `documentedGap` on eval cases.

Example:

```typescript
import { loadAnnotations } from "./manifest";
import { annotationsToEvalCases } from "./to-eval-cases";

const annotations = loadAnnotations(repoDir, "components");
const evalCases = annotationsToEvalCases(annotations, "vgs-django");
```

## Local materialization (optional)

Clone pinned repositories for local benchmark development:

```bash
pnpm run benchmark:materialize hyperswitch-vault
pnpm run benchmark:materialize --all
```

Clones land in `tests/benchmark/.cache/repos/<key>@<commit>/`. The script is idempotent and uses sparse checkout when scope paths are listed in the manifest.

## Candidate inventory

`candidates.yaml` preserves the repository research queue separately from executable
benchmark ground truth. A pinned commit and observed license do not make a candidate
accepted: each candidate still needs a manageable exhaustive scope, scanner-blind
proposed annotations, and human review before it may enter evaluation denominators.

**This script is not part of `pnpm test`.** CI validates committed YAML only; it does not clone upstream repositories.

## Adding a repository

1. Create `repos/<key>/manifest.yaml` per [ground-truth-schema.md](../../.agents/skills/curate-scanner-evaluation-corpus/references/ground-truth-schema.md).
2. Add layer annotation files under `annotations/`.
3. Extend `tests/unit/benchmark/manifest.spec.ts`.
4. Materialize locally to verify evidence pointers against the pinned commit.
