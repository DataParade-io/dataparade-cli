# Fixture evaluation harness

Deterministic evaluation against committed `tests/fixtures/*` trees. Ground truth lives beside layer adapters under `tests/eval/layers/`; shared scoring lives in `tests/eval/score.ts`.

## Layout

```text
tests/eval/
  types.ts              # Eval case and score report types
  score.ts              # Shared recall / label / precision metrics
  layers/
    components/
      adapter.ts        # scan() bridge with component identity
      cases.ts            # Ground-truth cases
      eval.test.ts        # Jest evaluation
```

Additional layers (for example `data_flows`, `pii_signals`) should follow the same pattern when ground truth exists. Do not add empty layer stubs.

## Component identity

Subject keys use `${type}:${name.toLowerCase()}`, aligned with `tests/benchmark` annotations (for example `asset:aws pg`, `third_party:stripe`).

## Metrics (`score.ts`)

| Metric | Definition |
|--------|------------|
| `recall` | Matched evaluable positives ÷ all evaluable positives |
| `labelAccuracy` | Correctly labelled matches ÷ matched positives |
| `correctLabelRecall` | Correctly labelled matches ÷ evaluable positives |
| `precision` | Accepted positive matches ÷ scoped scanner findings (exhaustive scopes only) |
| `negativeCasePassRate` | Clean explicit negatives ÷ negative cases (not precision) |
| `unreadCount` | Cases whose evidence file was not scanned |

Positives marked `documentedGap` are excluded from recall denominators until the scanner is expected to pass.

## Running

```bash
pnpm test tests/eval/
pnpm run eval:components
```

Scans use `createDefaultScanConfiguration({ enableAiInference: false })` — the same deterministic path as `tests/unit/core/orchestrator.spec.ts`.
