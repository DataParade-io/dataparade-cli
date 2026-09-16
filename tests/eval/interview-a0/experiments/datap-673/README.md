# DATAP-673 — model-run interview experiment

**Ticket:** [DATAP-673](https://dataparade.atlassian.net/browse/DATAP-673)  
**Not** the hand-authored `a0-passing-simulated` case in `cases.ts`.

## What ran

Cursor coding agent conducted an A0 data-flow interview following the pinned skill:

- `fixtures/dpkb/a0-dataflow-interview/SKILL.md` @ `8175d44…`
- `fixtures/dpkb/dogfood-brief-a0.md` @ `16f2e85…`

Stakeholder-sim answers filled **brief unknowns only** (categories/purpose per `flow_*`, actor kind confirmation, system identity). System boundary was **refused** — no sibling-repo map invented.

## Artifacts

| File | Description |
|------|-------------|
| `model-run-transcript.json` | 92-action harness transcript (`datap-673-model-run-2026-09-16`) |
| `score-report.json` | Harness output on six fail-any rubric lines |

## Score

```bash
pnpm run eval:interview-a0:datap-673
```

## Durable new knowns (KB follow-up — not written into brief fixtures)

Interview answers with `provenance=interview` that could land in DPKB later:

- **system_identity:** DataParade; in_scope = customer-facing app in scan-seed repo; multi-repo boundary not confirmed
- **Actors:** `cmp_6`/`cmp_20` → `persona`; `cmp_17`/`cmp_25` → `person`
- **`sends_data_to.data_categories` + `purpose`:** recorded per `flow_*` in transcript (see JSON writes)

Fixture pins unchanged until an explicit manifest bump PR.
