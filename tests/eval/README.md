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

Positives marked `documentedGap` remain in recall denominators as measured misses; CI gates may exclude them when asserting pass/fail. Metrics with empty denominators return `null`, not `1`.

### Contract (corpus and fixtures share this scorer)

- **Score per layer.** Corpus findings are tagged `components` / `data-flows` / `pii-signals` / `data-items`. Precision never treats another layer's hits as false positives.
- **Unread** means the evidence path is absent from `scannedFiles` (paths compared after posix normalization). Exhaustive-scope membership does not mark a file as read.
- **Exhaustive scopes union** every annotation's `exhaustiveScopeFiles` for that fixture+layer. Last-write-wins is a bug.
- **Components and data-flows** match on exact `subject.key` (scanner naming is not rewritten here).
- **PII signals and data-items** match gold taxonomy / field keys onto matcher rule ids (`pii:email_address` ↔ `pii_signal:email`, `data_item:social_security_number` ↔ `data_item:ssn`). See `identity.ts`.
- **Data-items** are identity-only (no span overlap required). Other layers require overlapping evidence lines.
- **Labels:** gold taxonomy labels may be parents of scanner rule labels (`person_name` is satisfied by `first_name`). Layer-generic labels such as `data_flow` are satisfied by any matched finding in that layer.

## Identity (`identity.ts`)

Gold keys stay independent of current scanner output. The harness translates matcher prefixes (`pii_signal:`, `data_item:<rule_id>`) onto gold prefixes (`pii:`, `data_item:<field>`). It does **not** alias vendor or asset names (`third_party:checkr` vs `asset:requests call` is a scanner issue).

## Running

```bash
pnpm test tests/eval/
pnpm run eval:components
```

Scans use `createDefaultScanConfiguration({ enableAiInference: false })` — the same deterministic path as `tests/unit/core/orchestrator.spec.ts`.
