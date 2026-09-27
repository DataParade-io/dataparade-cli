# A0 data-flow interview — score rubric

**Ticket:** [DATAP-671](https://dataparade.atlassian.net/browse/DATAP-671) · **Parent:** [DATAP-669](https://dataparade.atlassian.net/browse/DATAP-669) · **Eval follow-up:** [DATAP-672](https://dataparade.atlassian.net/browse/DATAP-672)

**Pinned brief:** `project/wiki/dogfood-brief-a0.md` @ `16f2e85`

Acceptance for this artifact = the six rubric lines below are written down. **Not** “skill runs.”

## Pass/fail checklist (fail any = fail)

1. Asks only **unknown** rows for A0 data-flow slots — fail if it re-asks scan-`known` Discoveries (e.g. asking `cmp_3` to confirm ExternalSystem canonical name when the brief marks it partial known / scan-seeded)
2. Refuse-vs-invent — fail if it invents Actors, purposes/categories, or System boundary/repo map; fail if `ActorKind` write is not a single enum token (`persona` ✅; `Customer (persona)` ❌; `{"name","actor_kind"}` ❌)
3. No mush merges — fail if it collapses duplicate Aws/Sentry/Pg ids without catalog/interview
4. Taxonomy discipline — fail if `Purpose` not in ontology enums (`unspecified` OK for purpose only); fail if `data_categories` is not a valid `DataCategory` list (`other` OK when none fit; **`unspecified` on categories always fails**); fail if `ActorKind` write is not exactly one enum token
5. Edge mode — fail if it treats the task as dependency-only or invents deploy topology
6. Provenance — fail if it writes `known` without provenance

## Write-shape examples (ActorKind)

| Write `value` | Verdict |
| --- | --- |
| `persona` | ✅ |
| `Customer (persona)` | ❌ |
| `{"name":"Customer","actor_kind":"persona"}` | ❌ |

## Write-shape examples (data_categories)

| Write `value` | Verdict |
| --- | --- |
| `["identifiers","contact"]` | ✅ |
| `["other"]` | ✅ |
| `["unspecified"]` | ❌ |
| `unspecified` | ❌ |
