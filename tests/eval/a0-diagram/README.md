# A0 diagram projector (DATAP-699)

Projects **scan OCSF Architecture Discovery** records (plus optional **interview** overlays) into a **discoveries document** (`dataparade.json`) and a separate **diagram projection** (interview or filled).

```
Scanner discovery seed JSON  ──land──►  scan OCSF records (in-memory or ocsf-discoveries/)
                                              │
Optional interview OCSF overlay ──────────────┤
Scanner mentions/dataItems (PII layer) ───────┘
                                              │
                                              ▼
                              projectOcsfToDiscoveriesDocument
                                              │
                                              ▼
                              dataparade.json (components, dataFlows, dataItems, mentions, system.in_scope)
                                              │
                                              ▼
                              projectA0DiagramGraph (mode: interview | filled)
                                              │
                                              ▼
                              diagram.json (schemaVersion + graph + metadata)
                                              │
                                              ├──────────────────┬─────────────────────┐
                                              ▼                  ▼                     ▼
                                         .d2 source        inline SVG (demo)    React Flow wrapper
                                         (D2 renderer)     (this ticket)        (eval / manual import)
```

The vendored `fixtures/dataparade-discovery-seed.json` is **scan input to the lander only** — `dataparade.json` is not built by copying the seed. Flow `sourceLocation` / `sourceLocations` on the seed are **not** projected to mentions; personal-data mentions and data items come from the scanner PII inventory layer passed through `scanResultToDiscoveryInput`.

## Artifacts

| File | Role |
| --- | --- |
| `{basename}.dataparade.json` | **Discoveries document** projected from scan OCSF (+ interview overlays): `components`, `dataFlows`, `dataItems`, `mentions`, optional `system.in_scope`. Not a diagram. |
| `{basename}.diagram.json` | **A0 projection** in the existing React Flow wrapper (`dataflowWrapperSchema`: `schemaVersion`, `graph`, `metadata`). Modes `interview` \| `filled`. |
| `{basename}.d2`, `{basename}.svg` | Rendered from the **diagram** graph, not from `dataparade.json`. |

The **scan CLI** `dataflow.json` produced by `dataparade scan` (app import via `src/output/json.ts` / `dataflowWrapperSchema`) is a **different file** and is **unchanged** by this eval projector.

## Modes

| Mode | Default | Behavior |
| --- | --- | --- |
| `interview` | yes | Known + unknown/partial slots visible (question map) |
| `filled` | no | Known slots only — omits `unknown` nodes/edges; partial items show known fields without `?` placeholders |

Unknown flow privacy slots mean the scan/interview OCSF record has no value for that field. System boundary gaps still come from the pinned brief interview snapshot when projecting diagrams.

## Privacy / status fields

On `diagram.json` → `graph.nodes[].data.privacy` and `graph.edges[].data.privacy`:

- `slotStatus`: `known` | `unknown` | `partial`
- `openSlots`: e.g. `["data_categories","purpose"]`

D2/SVG visual language: unknown = dashed amber + `?` labels; partial = badge; known = solid labels.

## CLI

```bash
cd dataparade-cli
pnpm exec tsc -p tsconfig.json
node tests/eval/a0-diagram/bin/project-a0-diagram.mjs \
  --mode interview \
  --discoveries ../knowledge-base/project/wiki/graph/dogfood/ocsf-discoveries \
  --output-dir ../knowledge-base/project/wiki/graph/dogfood/diagrams \
  --basename a0-interview
```

`--seed` defaults to `fixtures/dataparade-discovery-seed.json` (lander input). `--discoveries` is optional interview OCSF overlay. `--brief` is optional and only affects diagram interview hints, not `dataparade.json` rows.

Writes `{basename}.dataparade.json`, `{basename}.diagram.json`, `{basename}.d2`, `{basename}.svg`.

## Diagram wrapper schema

For `{basename}.diagram.json`:

- Wrapper: `dataflowWrapperSchema` (`schemaVersion`, `graph`, `metadata`)
- Graph: `diagramGraphJsonSchema` (`nodes`, `edges`, optional `viewport`)
- App export: `exportDiagram` (PNG/PDF) — **do not** add Playwright/headless RF in this ticket.

Discoveries document validation: `a0-discoveries-document.schema.ts` (do not reuse `diagramGraphJsonSchema` or scan `dataflowWrapperSchema`).

## Pins

- Brief @ `16f2e857a47d54bfea6ca5d7f23a6c4f2732da29` (eval fixture / `loadDefaultBriefSnapshot`) — diagram interview hints only
- Interview OCSF records must carry matching `dataparade.brief_sha`
