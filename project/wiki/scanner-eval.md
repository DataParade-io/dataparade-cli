# Scanner evaluation through local Plexus

First recorded corpus recall run (local Virtuus GraphQL, not AWS).

## Evaluation

- **Id:** `e43756be-58f1-4d9b-b1d4-7a221b3b0521`
- **Status:** COMPLETED
- **Scorecard:** Scanner Recall / Span Overlap (`SourceSpanOverlapScore`)
- **Recall:** 1.54% (1 / 65 scored)
- **Accuracy:** 1.54% (all gold labels are Yes)
- **Unread omitted:** 10 Hyperswitch `.rs` spans (scanner does not ingest Rust)
- **Confusion:** 64 false negatives, 1 true positive

The one hit is vgs-django Checkr (`app/checker_client.py`, components layer). Every scored data-item gold span was a miss.

Gold labels are still `review_state: proposed`. Precision is a separate initiative. `--baseline` is not implemented.

## Operator path

Implementation is on `develop`.

1. Start local GraphQL (Virtuus, one uvicorn worker).
2. Import positive non-rejected git YAML as Items.
3. Run `scripts/run-corpus-eval.ts` with `PLEXUS_ROOT` pointing at Plexus `develop` (Virtuus store + `SourceSpanOverlapScore`).
4. Read `getEvaluation` on local GraphQL.

## Lands on develop

dataparade-cli: PRs #6–#11. Plexus: PRs #612–#613.
