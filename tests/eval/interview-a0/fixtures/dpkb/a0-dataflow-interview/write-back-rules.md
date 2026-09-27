# Interview → KB write-back rules (A0 data-flow)

**Design:** [DATAP-678](https://dataparade.atlassian.net/browse/DATAP-678) (accepted) · **Wiki mirror:** [DATAP-679](https://dataparade.atlassian.net/browse/DATAP-679) · **Remap:** [DATAP-683](https://dataparade.atlassian.net/browse/DATAP-683) · **Parent:** [DATAP-669](https://dataparade.atlassian.net/browse/DATAP-669)

**Related:** [SKILL.md](SKILL.md) · [score-rubric.md](score-rubric.md) · [dogfood-brief-a0.md](../../dogfood-brief-a0.md) · [Glossary](../../glossary.md) · [Discoveries](../../discoveries.md)

**Ontology pin:** [DataParade-io/ontology](https://github.com/DataParade-io/ontology) **`v0.2.0`** @ `0656c5d9a6ce0d31440c63327ce597ce8df4414f` ([DATAP-684](https://dataparade.atlassian.net/browse/DATAP-684))

This page defines when (if ever) interview answers may become living graph facts — as **`Discovery` records with `source=interview`** — **without** turning a passing eval into mutating the answer key.

**Rules prose only.** This ticket does **not** authorize landing interview knowns, editing the dogfood brief, or changing CLI fixtures.

---

## 0. Discovery model (ontology 0.2.0)

Per [DATAP-681](https://dataparade.atlassian.net/browse/DATAP-681) / [DATAP-684](https://dataparade.atlassian.net/browse/DATAP-684):

| Concept | Rule |
| --- | --- |
| **Discovery** | **Sourced assertion of a graph fact** — a learning record in the same ontology graph |
| **Entities** | `System`, `Actor`, `ExternalSystem`, `SendsDataTo`, … **stay entities** — not subclasses of Discovery |
| **`Discovery.source`** | Required, **immutable** after create: `scan` \| `cloud` \| `interview` |
| **Link** | Graph facts cite supporting Discoveries via `asserted_by` on the `Evidenced` mixin |
| **Finding** | OCSF-ish security-event — **distinct** from Discovery (do not collapse) |

**Interview write-back** = create `Discovery` instances with **`source=interview`**, never `source=scan` from conversation. Corrections use a new Discovery with `supersedes`, not source retcon.

### Historical note (DATAP-669 eval freeze)

Through DATAP-672–677, the dogfood eval used **brief `provenance=scan`** language for scanner-seeded rows and treated Discovery informally as **scanner-only** output. That freeze stands for those experiment artifacts. From ontology **0.2.0** onward, wiki and land rules use the sourced-assertion model above; eval folders remain non-landable regardless.

---

## 1. Eval ≠ production

**Eval artifacts are not landable.**

Anything produced under a **scripted stakeholder** is exam evidence only:

- `dataparade-cli` experiment folders (`experiments/datap-673/`, `datap-674/`, `datap-676/`, …)
- Raw model logs (`raw-model-transcript.jsonl`), mechanical mapper output (`mapped-transcript.json`), `score-report.json`
- `stakeholder-script.yaml` `write_value`s and experiment README “candidate knowns”
- Passing all six fail-any rubric lines (including DATAP-676 overall pass after DATAP-677 re-score)

**Never auto-promote** from eval artifacts into DPKB, the dogfood brief, CLI fixtures, or living **`Discovery`** rows.

### What counts as real-interview evidence

A **production land** requires:

1. A **real** stakeholder interview — human answers, **not** a YAML script or model playing both sides
2. Conducted under the **pinned skill + brief** at the time of interview (`skill_sha`, `brief_sha`)
3. **Unedited** primary evidence (transcript, notes, recording pointer) — not mapper-only JSON
4. **Human review** and approval per §2 and §7 below
5. Land as **`Discovery` with `source=interview`** per ontology 0.2.0 — not brief prose alone

Passing the scorer is **necessary but not sufficient** to land.

---

## 2. Provenance grammar → Discovery record

Every landed interview fact must be a **`Discovery`** instance with these fields (ontology 0.2.0 / [DATAP-681](https://dataparade.atlassian.net/browse/DATAP-681)):

| Field | Required | Notes |
| --- | --- | --- |
| `source` | yes | **`interview`** — immutable after create; never mint `scan` from conversation |
| `asserted_at` | yes | When the assertion was made / observed |
| `asserts` | yes | URI of the graph entity or association instance (e.g. Actor, `SendsDataTo`) |
| `asserted_slot` | when applicable | e.g. `actor_kind`, `data_categories`, `purpose`, `in_scope` |
| `asserted_value` | when `asserted_slot` set | Ontology-shaped value only (see §3) |
| `raw_evidence_ref` | yes for interview land | Unedited transcript / notes — **not** mapper-only JSON |
| `reviewer` | yes for interview land | **Human** who approved (see §7) |
| `reviewed_at` | with reviewer | Timestamp |
| `brief_sha` | yes for interview | Full SHA of the brief the unknowns were asked against |
| `skill_sha` | yes for interview | Full SHA of the skill contract used |
| `supersedes` | no | Prior Discovery this replaces (audit; no silent overwrite) |
| `location` | no | File/span/resource locator when useful |

Brief gap-list columns (`known` \| `unknown` \| `provenance`) remain the **interview contract** for A0 eval; **living KB land** is expressed as **`Discovery` + `asserted_by`**, not wiki folklore or brief edits alone.

**Rules:**

- No land without this grammar on a `Discovery` record.
- Re-landing the same slot requires a new `Discovery` + review (use `supersedes`; do not retcon `source`).
- Mapper output alone is **not** `raw_evidence_ref`.

---

## 3. Eligible slots vs refuse

Eligibility is **brief-driven** at `brief_sha` (see §5). The lists below describe slot *types*; which discovery rows qualify is read from the brief at pin time.

### May land (after real interview + human review)

Land as **`Discovery` (`source=interview`)** with ontology-shaped `asserted_value`:

| Slot type | Shape | Brief gate |
| --- | --- | --- |
| `ActorKind` | Single enum token: `person` \| `role` \| `persona` | Brief marks actor row **partial known**; interview action is confirm/strengthen only |
| `sends_data_to.data_categories` | `DataCategory` enum list (or `unspecified`) | Brief marks categories **unknown** for that `flow_*` |
| `sends_data_to.purpose` | `Purpose` enum token (or `unspecified`) | Brief marks purpose **unknown** for that `flow_*` |
| System identity + `in_scope` | Approved text | Brief marks row **unknown**; human reviewer explicitly approves wording |

**Invalid write shapes are not landable** even if a human liked the prose — normalize in review or reject:

- `Customer (persona)` ❌
- `{"name":"Customer","actor_kind":"persona"}` ❌
- Comma-joined strings for multi-category ❌

### Must not land from interview alone

Refuse / separate human-override ticket required:

| Refuse | Why |
| --- | --- |
| `system_boundary` / sibling-repo map | Do not promote `scanner`, `ontology`, `knowledge-base`, `dataparade-cli` into the System from interview |
| Mush merges | Collapsing duplicate ExternalSystems (Aws/Sentry/Pg/Auth0/Sendgrid ids) without catalog or explicit human merge decision + its own provenance |
| Scan-`known` identity | ExternalSystem names, flow endpoints, other **`source=scan`** Discovery-backed identity — see §6 |
| Out-of-A0 scope | Dependency-only `interacts_with`, deploy topology, containers/components as diagram boxes |
| Freeform wiki prose | Without `Discovery` record + ontology-shaped `asserted_value` |

---

## 4. Pin discipline

Landing Discoveries **changes the exam**. Any brief edit that flips `unknown` / `partial known` → `known` (or changes seeded rows) requires:

1. Explicit DPKB commit
2. **New brief SHA**
3. CLI fixture re-pin + `brief.manifest.yaml` / `PINNED_BRIEF_SHA` bump on a **dedicated** ticket
4. No quiet edit of fixtures without the new pin

Skill/rubric changes stay on their own pin path (as DATAP-675). Ontology schema pins (e.g. **0.2.0**) are independent — cite `0656c5d…` when documenting land rules.

Eval re-runs after a brief bump are a **new** experiment folder — never overwrite frozen `datap-673/` / `datap-674/` / `datap-676/` artifacts.

---

## 5. Eligibility is brief-driven (not frozen discovery ids)

Do **not** freeze specific `cmp_*` or `flow_*` ids in these rules forever.

Land only slots that the **brief at `brief_sha`** marks:

- `unknown` → interview may fill (as `Discovery` with `source=interview`), or
- `partial known` → only the interview action that status allows (e.g. confirm ActorKind, not re-ask scan-known identity)

Today’s dogfood partial-known actors (`cmp_6`, `cmp_17`, `cmp_20`, `cmp_25`) are **examples**, not a permanent whitelist. A future brief pin may add, remove, or reclassify rows.

---

## 6. Scan wins conflicts

If an interview answer would **rewrite** identity already asserted by **`source=scan`** Discoveries:

- ExternalSystem canonical name (e.g. `cmp_3` Aws)
- `sends_data_to` flow endpoint (`flow_*` rows)
- Any other scan-seeded graph identity

**Do not land.** Escalate to a human override ticket. Interview Discoveries do **not** override scan-sourced assertions. Same escalate rule applies to **cloud vs scan** identity conflicts until a later cutover ticket says otherwise.

---

## 7. Reviewer is a human

`reviewer` on an interview-sourced `Discovery` must be a **person**.

Not:

- The interview model
- The coding agent
- “The room”
- An automated pass of the six rubric lines

---

## Explicit non-goals

- DATAP-676 overall pass does **not** authorize write-back
- Softening the scorer or mapper object-unwrap to make lands easier is forbidden
- No diagram projection, Discovery→brief automation, or merge of eval PRs as part of write-back
- A future **land** ticket (if any) must cite this page, ontology **0.2.0**, and name the human reviewer — separate Doing item

---

## Hard bans (standing)

- Do **not** edit [dogfood-brief-a0.md](../../dogfood-brief-a0.md) slot content as part of write-back
- Do **not** flip brief rows to `known` or land interview Discoveries without a dedicated land ticket
- Do **not** mint `source=scan` Discoveries from interview or eval artifacts
