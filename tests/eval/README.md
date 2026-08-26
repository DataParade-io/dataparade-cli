# Scanner evaluation harness

Shared contracts and scoring for measuring structural scanner output against committed ground truth. Layer adapters translate scan results into normalized findings; the scoring engine computes separate metrics without averaging them.

## Running component eval

```bash
pnpm eval:components
```

Or the full eval test tree:

```bash
pnpm test tests/eval/
```

Fixtures live under `tests/fixtures/`. Component cases are defined in `tests/eval/layers/components/cases.ts` and run with AI inference disabled.

## Metrics

Each metric is reported independently. Do not average them into a single score.

| Metric | Definition |
| --- | --- |
| **Recall** | Matched positive cases / evaluable positive cases. Ambiguous cases are excluded from the denominator. |
| **Label accuracy** | Among matched positives, how many have labels that exactly match expected labels. Null when no positives were matched. |
| **Correct-label recall** | Matched positives with correct labels / evaluable positives. |
| **Negative-case pass rate** | Negative cases with no overlapping scanner finding / total negative cases. This is not precision. |
| **Precision** | Only computed within declared exhaustive scopes: true positives / (true positives + false positives) for findings in scoped files. Null when no scope is declared or the denominator is zero. |
| **Unread** | Ground truth cases whose evidence file was not scanned (`scanned: false` in file coverage). |

**Recall vs precision:** Recall measures coverage of known positives. Precision (when exhaustive scopes exist) measures false positives within fully reviewed files. Negative-case pass rate measures whether explicitly negative evidence lines stay clean.

## Relationship to benchmark corpus

Committed fixtures here are a smoke subset for CI. The broader evaluation corpus (pinned repos, exhaustive scopes, human-reviewed annotations) follows the ground-truth schema in `.agents/skills/curate-scanner-evaluation-corpus/references/ground-truth-schema.md`. Cases in `cases.ts` use the same record shape (`subject.key`, evidence pointers, expected status/labels) so they can migrate into the full corpus without schema changes.
