# A0 diagram projector (DATAP-699)

Projects **OCSF Discoveries** + pinned **dogfood brief A0** into the same **`DiagramGraphJson` / `dataflow.json`** contract the app already imports — one projector, two renderers.

```
OCSF Discoveries + A0 brief
        │
        ▼
  projectA0DiagramGraph (mode: interview | filled)
        │
        ▼
  dataflow.json (schemaVersion + graph.nodes + graph.edges)
        │
        ├──────────────────┬─────────────────────┐
        ▼                  ▼                     ▼
   .d2 source        inline SVG (demo)    React Flow import
   (D2 renderer)     (this ticket)        (product — use existing
                                         exportDiagram / app import;
                                         not implemented here)
```

## Modes

| Mode | Default | Behavior |
| --- | --- | --- |
| `interview` | yes | Known + unknown/partial slots visible (question map) |
| `filled` | no | Known slots only — omits `unknown` nodes/edges; partial items show known fields without `?` placeholders |

Unknowns come from the **brief** merged with landed Discoveries — the projector does not invent gaps.

## Privacy / status fields

On `graph.nodes[].data.privacy` and `graph.edges[].data.privacy`:

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

Writes `{basename}.dataflow.json`, `{basename}.d2`, `{basename}.svg`.

## React Flow path (later)

Import the generated `dataflow.json` through the existing CLI/app pipeline:

- Wrapper: `dataflowWrapperSchema` (`schemaVersion`, `graph`, `metadata`)
- Graph: `diagramGraphJsonSchema` (`nodes`, `edges`, optional `viewport`)
- App export: `exportDiagram` (PNG/PDF) — **do not** add Playwright/headless RF in this ticket.

## Pins

- Brief @ `16f2e857a47d54bfea6ca5d7f23a6c4f2732da29` (eval fixture / `loadDefaultBriefSnapshot`)
- OCSF records must carry matching `dataparade.brief_sha`
