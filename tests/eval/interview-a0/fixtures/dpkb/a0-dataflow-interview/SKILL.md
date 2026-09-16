---
name: a0-dataflow-interview
description: >-
  Conducts A0 system-context data-flow interviews for DataParade projects.
  Asks only unknown slots from a pinned dogfood brief after scan-seeded
  Discoveries. Use when interviewing stakeholders about sends_data_to edges,
  system boundary, actors, or external systems for DATAP-669 dogfood eval.
disable-model-invocation: true
---

# A0 data-flow interview

**Ticket:** [DATAP-671](https://dataparade.atlassian.net/browse/DATAP-671) · **Parent:** [DATAP-669](https://dataparade.atlassian.net/browse/DATAP-669)

**Pinned brief:** `project/wiki/dogfood-brief-a0.md` @ `16f2e85`

This skill is a **contract artifact** for evaluatable interview behavior. It is not a diagram generator and not a KB mutator. Score against [score-rubric.md](score-rubric.md).

## Read before interviewing

1. This ticket (DATAP-671)
2. Parent [DATAP-669](https://dataparade.atlassian.net/browse/DATAP-669) — mission + out-of-scope
3. Pinned [dogfood-brief-a0.md](../../dogfood-brief-a0.md) at SHA `16f2e85`

Do **not** invent required slots or rubric lines. Do **not** re-scan or merge mush ids. Cite existing Discovery seed ids from the brief only.

## Mission

Interview stakeholders only about **unknown** slots needed for one **A0 system-context** projection in **data-flow** mode (`sends_data_to` / privacy edges), after Discoveries seed `known` with provenance. Dogfood on `DataParade-io/dataparade`.

## A0 projection

- **View:** system-context
- **Edge mode:** data-flow (`sends_data_to` only)
- **Scan seed repo:** `DataParade-io/dataparade` (provisional; see brief)

## Required slots (A0 data-flow — one System)

Must be filled (unknown until scan/interview/catalog says so):

| Slot | Brief status | Interview action |
| --- | --- | --- |
| System identity + `in_scope` | unknown | Confirm identity / in_scope via interview |
| **Repo membership / System boundary** (in vs ExternalSystem/tooling) | unknown | Seeded unknown; refuse-to-invent |
| Actors (`ActorKind`) connected to the System | partial known | Confirm/strengthen `cmp_6`, `cmp_17`, `cmp_20`, `cmp_25`; refuse inventing more |
| ExternalSystems (canonical names) | partial known | Scan-seeded third_party Discoveries — **do not re-ask** canonical names (e.g. `cmp_3` Aws); do not merge mush ids without catalog/interview |
| `sends_data_to` endpoints | known | Do **not** re-ask — see `flow_*` rows in brief |
| `sends_data_to`.`data_categories` | unknown | Ask per flow; `unspecified` allowed; omit not allowed |
| `sends_data_to`.`purpose` | unknown | Ask per flow; `unspecified` allowed; omit not allowed |

## Scan-known (do not re-ask)

These rows have `provenance=scan` in the pinned brief. **Never re-ask** them in interview questions — unless the brief explicitly marks the slot `unknown`.

This includes **ExternalSystems** / third_party components (e.g. `cmp_3` Aws, `cmp_12` Auth0): scan-seeded identity is already known; do not ask stakeholders to “confirm canonical name” or re-validate scan-`known` rows.

Skip all scan-`known` rows below.

### Components (28)

`cmp_1` (lambdas) · `cmp_2` (Pg) · `cmp_3` (Aws) · `cmp_4` (Sendgrid) · `cmp_5` (Sentry) · `cmp_6` (Customer) · `cmp_7` (backend) · `cmp_8` (Pg) · `cmp_9` (Typeorm) · `cmp_10` (Aws Lambda Handler) · `cmp_11` (Aws) · `cmp_12` (Auth0) · `cmp_13` (Sendgrid) · `cmp_14` (Sentry) · `cmp_15` (Openai) · `cmp_16` (Sentry) · `cmp_17` (User) · `cmp_18` (API) · `cmp_19` (docs-site) · `cmp_20` (Customer) · `cmp_21` (API) · `cmp_22` (frontend) · `cmp_23` (Sentry) · `cmp_24` (Auth0) · `cmp_25` (User) · `cmp_26` (API) · `cmp_27` (landing) · `cmp_28` (Dataparade.io)

### Data flows (20)

`flow_1` · `flow_10` · `flow_14` · `flow_20` · `flow_24` · `flow_61` · `flow_103` · `flow_106` · `flow_109` · `flow_111` · `flow_254` · `flow_267` · `flow_268` · `flow_269` · `flow_279` · `flow_287` · `flow_288` · `flow_289` · `flow_290` · `flow_291`

Archival scanner dump (reference only; brief is authoritative): `~/Projects/scanner/tmp-dogfood/dataparade-discovery-seed.json`

## Not A0 (do not interview yet)

- Containers/components as diagram boxes
- Deploy topology
- Landscape Scope
- Dependency-only `interacts_with`

## Refuse (never invent)

- **Actors** beyond what scan/interview/catalog establishes
- **Merging** duplicate Aws / Sentry / Pg / Auth0 / Sendgrid ids without catalog or interview provenance
- **Purpose or category** values not in ontology enums (see Taxonomy discipline)
- **Promoting** sibling repos into the System (`scanner`, `ontology`, `knowledge-base`, `dataparade-cli`)

When a slot is unknown and the stakeholder cannot answer, record `unspecified` for purpose/category — do not omit the slot and do not fabricate a value.

## Taxonomy discipline

Purpose and `data_categories` on `sends_data_to` edges must use ontology enums:

| Enum | Source |
| --- | --- |
| `DataCategory` | [ontology/taxonomy/data_category.yaml](https://github.com/DataParade-io/ontology/blob/main/taxonomy/data_category.yaml) — `personal`, `identifiers`, `contact`, `demographic`, `credentials`, `financial`, `health`, `location`, `communications`, `commercial`, `other` |
| `Purpose` | [ontology/taxonomy/purpose.yaml](https://github.com/DataParade-io/ontology/blob/main/taxonomy/purpose.yaml) — `service_provision`, `analytics`, `marketing`, `security`, `legal_obligation`, `research`, `debugging`, **`unspecified`** |
| `ActorKind` | [ontology/taxonomy/actor_kind.yaml](https://github.com/DataParade-io/ontology/blob/main/taxonomy/actor_kind.yaml) — `person`, `role`, `persona` |

`unspecified` is an explicit gap, not a silent default. Omitting purpose or category on a flow is **not** allowed.

### ActorKind write shape (strict)

When writing `ActorKind` for partial-known actors (`cmp_6`, `cmp_17`, `cmp_20`, `cmp_25`), `value` must be **exactly one** ontology enum token — nothing else.

| Write `value` | Verdict | Why |
| --- | --- | --- |
| `persona` | ✅ | Valid `ActorKind` enum token |
| `Customer (persona)` | ❌ | Combines scan display name with enum — not a token |
| `{"name":"Customer","actor_kind":"persona"}` | ❌ | Object shape — not a token |

Do not embed component display names, labels, or JSON objects in ActorKind writes.

## Provenance rules

Never mark a slot `known` without provenance. Allowed values: `scan` | `interview` | `cloud` | `doc`.

- Scan-seeded rows in the brief → `provenance=scan` (already known; do not re-ask)
- Stakeholder answers from this interview → `provenance=interview`
- Do not promote sibling-repo candidates to `known` without `provenance=interview`

See [KB hygiene](../../kb-hygiene.md) and [Discoveries](../../discoveries.md).

## Interview workflow

1. Load the pinned brief at SHA `16f2e85`.
2. For each required slot, check brief status:
   - `known` (scan) → skip; do not re-ask (includes `flow_*` endpoints and ExternalSystems like `cmp_3`)
   - `partial known` → Actors only: confirm `ActorKind` for `cmp_6`, `cmp_17`, `cmp_20`, `cmp_25`; write enum token only; ExternalSystems: use scan-seeded rows — do not re-ask
   - `unknown` → ask stakeholder; record answer with `provenance=interview` or refuse with `unspecified`
3. For each `flow_*` row, ask only for missing `data_categories` and `purpose`.
4. Stop when all unknown A0 slots are filled or explicitly marked `unspecified` — do not expand into Not A0 topics.

## Out of scope

- Mermaid / C4 render
- ScanResult ingest code
- Catalog merges
- Personal-data subject keys
- KB filler / auto-mutation
- Inventing the multi-repo map
- Simulated interview harness (see DATAP-672)

## Related wiki pages

- [Interview skill prototype](../../interview-skill-prototype.md)
- [Dogfood brief A0](../../dogfood-brief-a0.md)
- [Taxonomies](../../taxonomies.md)
- [C4 from KB](../../c4-from-kb.md)
