# Extract the scanner from the CLI

Initiative: `KDATAP-4f6956`. One board. New issues use `KDATAP` keys.

## Split

- New project: `DataParade-io/dataparade-scanner`
- Package: `@dataparade/scanner`
- Public API: `createDefaultScanConfiguration`, `scan(config) -> ScanResult`

The scanner owns finding the map and scoring it.
The CLI owns running that, writing `dataflow.json`, and uploading.

## First cut (moves)

- ingest, analyzers, `patterns/` YAML, classifier, data-flow
- core structural pipeline and graph mapping
- matching unit tests
- `tests/eval`, `tests/benchmark`, Plexus-facing scanner recall

## Stays in the CLI

- commander, env/config
- write `dataflow.json`
- upload, quota, telemetry, Sentry
- AI enrichment (second cut, after the library API is stable)

## Epics

- `KDATAP-6dbc6b` package boundary
- `KDATAP-1d77fb` stand up the scanner project
- `KDATAP-3ee2c2` move eval and corpus
- `KDATAP-c5e46d` CLI becomes a consumer

Four-layer eval (`KDATAP-0dbc61`) follows the harness.
