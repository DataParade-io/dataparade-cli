# A0 diagram projector (DATAP-699)

Projects a **scanner discovery seed** plus optional **OCSF Discoveries** overlay into a **discoveries document** and a separate **diagram projection** (interview or filled).

```
Scanner discovery seed JSON (+ optional OCSF overlay)
        │
        ├──────────────────────────────┐
        ▼                              ▼
  buildA0DiscoveriesDocument    projectA0DiagramGraph (mode: interview | filled)
        │                              │
        ▼                              ▼
  dataflow.json                 diagram.json (schemaVersion + graph + metadata)
  (components, dataFlows,              │
   dataItems, mentions,                ├──────────────────┬─────────────────────┐
   system.in_scope)                    ▼                  ▼                     ▼
                                 .d2 source        inline SVG (demo)    React Flow wrapper
                                 (D2 renderer)     (this ticket)        (eval / manual import)
```

## Artifacts

| File | Role |
| --- | --- |
| `{basename}.dataflow.json` | **Discoveries document** from the vendored scanner seed (`fixtures/dataparade-discovery-seed.json`) plus matching OCSF slot values: `components`, `dataFlows`, `dataItems`, `mentions`, and optional `system.in_scope`. Not a diagram. **Not** the app-import wrapper. |
| `{basename}.diagram.json` | **A0 projection** in the existing React Flow wrapper (`dataflowWrapperSchema`: `schemaVersion`, `graph`, `metadata`). Modes `interview` \| `filled`. |
| `{basename}.d2`, `{basename}.svg` | Rendered from the **diagram** graph, not from `dataflow.json`. |

The **scan CLI** `dataflow.json` produced by `dataparade scan` (app import via `src/output/json.ts` / `dataflowWrapperSchema`) is a **different file** and is **unchanged** by this eval projector.

## Modes

| Mode | Default | Behavior |
| --- | --- | --- |
| `interview` | yes | Known + unknown/partial slots visible (question map) |
| `filled` | no | Known slots only — omits `unknown` nodes/edges; partial items show known fields without `?` placeholders |

Unknown flow privacy slots mean the seed/OCSF record has no value for that field. System boundary gaps still come from the pinned brief interview snapshot when projecting diagrams.

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

`--seed` defaults to `fixtures/dataparade-discovery-seed.json`. `--discoveries` is optional (OCSF overlay only). `--brief` is optional and only affects diagram interview hints, not `dataflow.json` graph rows.

Writes `{basename}.dataflow.json`, `{basename}.diagram.json`, `{basename}.d2`, `{basename}.svg`.

## Diagram wrapper schema

For `{basename}.diagram.json`:

- Wrapper: `dataflowWrapperSchema` (`schemaVersion`, `graph`, `metadata`)
- Graph: `diagramGraphJsonSchema` (`nodes`, `edges`, optional `viewport`)
- App export: `exportDiagram` (PNG/PDF) — **do not** add Playwright/headless RF in this ticket.

Discoveries document validation: `a0-discoveries-document.schema.ts` (do not reuse `diagramGraphJsonSchema` or scan `dataflowWrapperSchema`).

## Pins

- Brief @ `16f2e857a47d54bfea6ca5d7f23a6c4f2732da29` (eval fixture / `loadDefaultBriefSnapshot`) — diagram interview hints only
- OCSF records must carry matching `dataparade.brief_sha`
