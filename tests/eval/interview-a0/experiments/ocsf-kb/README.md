# ocsf-kb — live model-run interview (gaps from OCSF store)

**Parent:** [DATAP-669](https://dataparade.atlassian.net/browse/DATAP-669) · **Harness:** `tests/eval/interview-a0/`

Unlike frozen `datap-*` experiments, unknown slots come from `gapsFromOcsfDir` on the knowledge-base OCSF discovery directory — **not** from `dogfood-brief-a0.md`.

## Defaults

| Setting | Value |
|---------|--------|
| OCSF dir | `/Users/home/Projects/knowledge-base/project/wiki/graph/dogfood/ocsf-discoveries` |
| Override | `OCSF_KB_DIR` |
| Model | `gpt-5.6-luna` (override with `OCSF_KB_MODEL`) |
| Skill fixture | `tests/eval/interview-a0/fixtures/dpkb/a0-dataflow-interview/SKILL.md` |

## Artifacts (experiment directory only)

| File | Role |
|------|------|
| `gap-report.json` | `gapsFromOcsfDir` output (`snapshot` + `gaps`) |
| `raw-model-transcript.jsonl` | Unedited OpenAI request/response log |
| `map-raw-to-actions.ts` | Mechanical `ACTION_JSON:` → harness actions |
| `mapped-transcript.json` | Mapper output (regenerated when scoring live run) |
| `score-report.json` | Harness score on six fail-any rubric lines |
| `discovery-export-bundle.json` | `exportInterviewDiscoveries` (`source=interview`, not landable) |
| `stakeholder-script.yaml` | Documents runtime stakeholder rules (gaps only) |

## Re-run

```bash
# Refresh gap-report.json only
pnpm exec tsx tests/eval/interview-a0/experiments/ocsf-kb/write-gap-report.ts

# Live model run (OPENAI_API_KEY required; zero gaps skips API)
pnpm run eval:interview-a0:run-ocsf-kb

# Score (CI-safe — skips live mapping when raw transcript absent)
pnpm run eval:interview-a0:ocsf-kb
```

**Not a living-KB land.** Export JSON stays under this experiment directory; no writes into the wiki OCSF tree.
