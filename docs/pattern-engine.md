# Pattern Engine (Shared YAML Matchers)

The CLI analyzers should prefer **YAML-defined patterns** + the shared `matchPatterns()` engine over custom, hard-coded detection logic. This keeps detection behavior consistent across languages and makes new pattern additions a config-only change.

## Core API

### `matchPatterns(ctx: PatternContext): RawFinding[]`

`matchPatterns` takes a normalized, language-specific *adapter* context (`PatternContext`) and returns `RawFinding[]` with fields:

- `pattern`: a `patternId` (e.g. `express_route`, `external_api_call`, `env_variable`, ...)
- `name`: a human-readable detection label (framework/service/key/etc.)
- `confidence`: number in `[0, 1]`
- `location`: `{ filePath, startLine, endLine, code? }`
- `properties`: pattern-specific properties consumed by the classifier/enhancer pipeline

Analyzers typically call `matchPatterns` and then **filter** down to the `patternId`s relevant to that analyzer (e.g. TS analyzer filters to `express_route`, `database_connection`, etc.).

## PatternContext adapter contract

### `PatternContext`

When adapting a language, populate:

- `language`: `"typescript"` | `"javascript"` | `"python"` (the engine branches on this)
- `file`: `FileInfo` (must include `path`, `content`, `language`)
- `imports?`: import-derived tokens for import-based matchers:
  - `{ module: string; names: string[] }`
- `normalizedPath?`: normalized file path used for route heuristics (Next/React, etc.)
- `functions?`: function/method entries with decorators (used by some route/auth detectors)
- `moduleLevelCalls?`: top-level call sites with `{ callee, argumentsSnippet, location }` (used by Python external API matching)

### TypeScript/JavaScript external HTTP matching opt-in

If you want the engine to detect TS/JS `external_api_call` via `third-party.patterns.yaml` `http_clients` (fetch/axios/got regex line scanning), set:

- `includeThirdPartyHttpLinePatterns: true`

Note: this is opt-in to avoid duplicate findings in code paths that already compute route/DB/auth/env patterns using other heuristics.

## YAML sources used by the engine

The shared engine loads a unified config (via `loadUnifiedPatternConfig()`) that aggregates per-domain YAML:

- Actors: `cli/patterns/actor.patterns.yaml`
- Third-party services (import-based): `cli/patterns/third-party.patterns.yaml`
- Third-party HTTP line patterns (TS/JS only, opt-in): `cli/patterns/third-party.patterns.yaml`
- TypeScript/JavaScript routes/db/auth/env/config: `cli/patterns/typescript.patterns.yaml`
- Python routes/db/auth/env/config/external APIs: `cli/patterns/python.patterns.yaml`

## Analyzer implementation pattern

Typical analyzer shape:

1. Parse/produce a `PatternContext` adapter from your language’s AST (or lightweight heuristics).
2. Call `matchPatterns(ctx)`.
3. Filter returned findings by the patternIds this analyzer owns.
4. Let property-detection (`getPropertiesFromFinding`) enrich component properties.
   (In this repo, both the TypeScript/JavaScript and Python analyzers apply this YAML-driven enrichment step.)

## Reference adapters

### TS/JS external API call adapter (HTTP line scan)

```ts
const findings = matchPatterns({
  language: model.language,
  file,
  imports: importsForEngine,
  normalizedPath: model.normalizedPath,
  includeThirdPartyHttpLinePatterns: true,
}).filter((f) => f.pattern === "external_api_call");
```

### TS/JS routes/DB/auth/env/config adapter

Route/DB/auth/env/config detectors should call the engine **without** `includeThirdPartyHttpLinePatterns` and then filter by the owning patternIds.

```ts
const findings = matchPatterns({
  language: model.language,
  file,
  imports: importsForEngine,
  normalizedPath: model.normalizedPath,
}).filter((f) => ["express_route", "database_connection", "auth_middleware", "env_variable", "config_file"].includes(f.pattern));
```

### Actors adapter

Actors patterns are language-agnostic regex rules from `actor.patterns.yaml`. Call:

```ts
const findings = matchPatterns({
  language: model.language,
  file,
  normalizedPath: model.normalizedPath,
}).filter((f) => actorPatternIds.has(f.pattern));
```

## Adding a new language

1. Implement a parser that yields the fields needed by `PatternContext` (imports, decorators/functions, module-level calls, normalizedPath).
2. Add a language adapter that builds `PatternContext`.
3. Add/extend engine matchers only when YAML-driven behavior cannot express your detection needs.

## Property inference (YAML)

Separately from `matchPatterns`, component property inference is YAML-driven via `cli/patterns/property.patterns.yaml`.
See `cli/docs/property-inference.md` for the full `inference_rules` schema (`when` + `set`) and available inputs.
