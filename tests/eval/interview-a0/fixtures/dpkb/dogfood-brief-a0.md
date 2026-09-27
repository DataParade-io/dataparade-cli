# Dogfood brief — A0 data-flow (DATAP-669)

Pinned known|unknown|provenance brief for the evaluatable interview skill. **No row may be `known` without provenance.** Interview bot must refuse inventing unknowns.

See [Interview skill prototype](interview-skill-prototype.md) and [KB hygiene](kb-hygiene.md).

Skill contract stub (DFI, 2026-09-15): required slots below. Seed file: `scanner/tmp-dogfood/dataparade-discovery-seed.json` (28 components, 20 dataFlows). Personal-data subject keys **not** in this dump.

## Scope

| Field | Value | Status | Provenance |
| --- | --- | --- | --- |
| System name (diagram) | DataParade | provisional | doc |
| A0 projection | system-context, **data-flow** (`sends_data_to`) | known | doc (DATAP-669) |
| Scan seed repo | `DataParade-io/dataparade` | provisional | doc + scan |
| Personal-data / subject keys | — | not seeded | — |

## Required slots (A0 data-flow)

| Slot | Status | Value | Provenance | Notes |
| --- | --- | --- | --- | --- |
| System identity + `in_scope` | unknown | DataParade (name provisional only) | — | Confirm identity / in_scope via interview |
| Repo membership / System boundary | unknown | — | — | Sibling candidates: `scanner`, `ontology`, `knowledge-base`, `dataparade-cli` — refuse inventing map |
| Actors (`ActorKind`) connected to System | partial known | see `cmp_6`, `cmp_17`, `cmp_20`, `cmp_25` (Customer/User, weak) | scan | Confirm/strengthen; refuse inventing more |
| ExternalSystems (canonical names) | partial known | third_party Discoveries below; **do not merge** duplicate Aws/Sentry/Pg/Auth0/Sendgrid ids without catalog/interview | scan | |
| `sends_data_to` endpoints | known | see flow_* rows | scan | |
| `sends_data_to`.`data_categories` | unknown | — | — | `unspecified` allowed; omit not allowed |
| `sends_data_to`.`purpose` | unknown | — | — | `unspecified` allowed; omit not allowed |

## Not A0 (do not interview yet)

Containers/components as diagram boxes, deploy topology, landscape Scope, dependency-only `interacts_with`.

## Refuse

Inventing Actors; merging mush ids; asserting purpose/category not in taxonomy; promoting sibling repos into the System.

## Known from Discoveries (provenance=`scan`)

### Components

| Subject / id | Kind | Value | Provenance |
| --- | --- | --- | --- |
| `cmp_12` | component (third_party/saas_service) | Auth0 | scan |
| `cmp_11` | component (third_party/cloud_provider) | Aws | scan |
| `cmp_10` | component (asset/function) | Aws Lambda Handler | scan |
| `cmp_7` | component (asset/api) | backend | scan |
| `cmp_6` | component (actor/customer) | Customer | scan |
| `cmp_8` | component (asset/database) | Pg | scan |
| `cmp_13` | component (third_party/saas_service) | Sendgrid | scan |
| `cmp_14` | component (third_party/saas_service) | Sentry | scan |
| `cmp_9` | component (asset/database) | Typeorm | scan |
| `cmp_3` | component (third_party/cloud_provider) | Aws | scan |
| `cmp_1` | component (asset/api) | lambdas | scan |
| `cmp_2` | component (asset/database) | Pg | scan |
| `cmp_4` | component (third_party/saas_service) | Sendgrid | scan |
| `cmp_5` | component (third_party/saas_service) | Sentry | scan |
| `cmp_15` | component (third_party/ai_provider) | Openai | scan |
| `cmp_16` | component (third_party/saas_service) | Sentry | scan |
| `cmp_18` | component (asset/api) | API | scan |
| `cmp_19` | component (asset/api) | docs-site | scan |
| `cmp_17` | component (actor/customer) | User | scan |
| `cmp_21` | component (asset/api) | API | scan |
| `cmp_24` | component (third_party/saas_service) | Auth0 | scan |
| `cmp_20` | component (actor/customer) | Customer | scan |
| `cmp_22` | component (asset/api) | frontend | scan |
| `cmp_23` | component (third_party/saas_service) | Sentry | scan |
| `cmp_26` | component (asset/api) | API | scan |
| `cmp_28` | component (third_party/saas_service) | Dataparade.io | scan |
| `cmp_27` | component (asset/api) | landing | scan |
| `cmp_25` | component (actor/customer) | User | scan |

### Data flows

| Subject / id | Kind | Value | Provenance |
| --- | --- | --- | --- |
| `flow_289` | dataFlow (api_call) | `cmp_19` (docs-site) → `cmp_18` (API) | scan |
| `flow_109` | dataFlow (api_call) | `cmp_7` (backend) → `cmp_13` (Sendgrid) | scan |
| `flow_106` | dataFlow (api_call) | `cmp_7` (backend) → `cmp_14` (Sentry) | scan |
| `flow_254` | dataFlow (api_call) | `cmp_7` (backend) → `cmp_12` (Auth0) | scan |
| `flow_111` | dataFlow (api_call) | `cmp_7` (backend) → `cmp_11` (Aws) | scan |
| `flow_103` | dataFlow (api_call) | `cmp_6` (Customer) → `cmp_7` (backend) | scan |
| `flow_10` | dataFlow (api_call) | `cmp_1` (lambdas) → `cmp_3` (Aws) | scan |
| `flow_14` | dataFlow (api_call) | `cmp_1` (lambdas) → `cmp_4` (Sendgrid) | scan |
| `flow_20` | dataFlow (api_call) | `cmp_1` (lambdas) → `cmp_5` (Sentry) | scan |
| `flow_267` | dataFlow (api_call) | `cmp_22` (frontend) → `cmp_24` (Auth0) | scan |
| `flow_268` | dataFlow (api_call) | `cmp_22` (frontend) → `cmp_23` (Sentry) | scan |
| `flow_287` | dataFlow (api_call) | `cmp_22` (frontend) → `cmp_21` (API) | scan |
| `flow_269` | dataFlow (api_call) | `cmp_20` (Customer) → `cmp_22` (frontend) | scan |
| `flow_279` | dataFlow (api_call) | `cmp_27` (landing) → `cmp_28` (Dataparade.io) | scan |
| `flow_288` | dataFlow (api_call) | `cmp_27` (landing) → `cmp_26` (API) | scan |
| `flow_290` | dataFlow (api_call) | `cmp_17` (User) → `cmp_19` (docs-site) | scan |
| `flow_291` | dataFlow (api_call) | `cmp_25` (User) → `cmp_27` (landing) | scan |
| `flow_24` | dataFlow (database_query) | `cmp_7` (backend) → `cmp_8` (Pg) | scan |
| `flow_61` | dataFlow (database_query) | `cmp_7` (backend) → `cmp_9` (Typeorm) | scan |
| `flow_1` | dataFlow (database_query) | `cmp_1` (lambdas) → `cmp_2` (Pg) | scan |

## Rules for the interview bot

1. Answer only from this brief.
2. If status is `unknown`, say so — do not invent Actors, purposes, categories, deploy topology, or repo membership.
3. Do not merge duplicate component ids without provenance=`interview` or catalog.
4. Do not promote sibling-repo candidates to `known` without provenance=`interview`.
