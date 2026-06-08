# Overview

The **dataPARADE CLI** scans a codebase and produces a **`dataflow.json`-compatible** output file that can be imported into the DataParade web app.  
It runs a structural pipeline (ingest → analyzers → classifier → data-flow detector → graph mapping) and writes a single JSON wrapper containing a `DiagramGraphJson` plus basic scan metadata.

- **Package name**: `@dataparade/cli`
- **Primary command**: `scan <path>`
- **Entry point (local)**: `dist/bin/cli.js`
- **Supported languages in P0.1**: TypeScript, JavaScript, Python, Terraform

Java and Go analyzers are planned for a future phase.

**License:** GPL-3.0-or-later — see [`LICENSE`](./LICENSE). Published source lives in [DataParade-io/dataparade-cli](https://github.com/DataParade-io/dataparade-cli) (public); this monorepo copy is for development.

For releases, see [`docs/cli/RELEASING.md`](../docs/cli/RELEASING.md).

---

## Local development in this monorepo

From the **repo root** (`dataPARADE/`):

```bash
pnpm install
```

Then build the CLI package:

```bash
cd cli
pnpm build
```

To **refresh Terraform resource coverage** from CDKTF packages (mirroring HashiCorp **`aws_*`** and **`azurerm_*`** resource names in `.tf` files), run:

```bash
cd cli
pnpm run generate:terraform-provider-hints
```

That rewrites:

- `cli/patterns/aws-terraform-catalog.snapshot.json` + `aws-terraform-service-hints.generated.json` (merged before the generic `^aws_` rule).
- `cli/patterns/azure-terraform-catalog.snapshot.json` + `azure-terraform-service-hints.generated.json` (merged before `^azurerm_`).
- `cli/patterns/kubernetes-terraform-catalog.snapshot.json` + `kubernetes-terraform-service-hints.generated.json` (merged before `^kubernetes_`).

Use `pnpm run generate:aws-terraform-hints`, `pnpm run generate:azure-terraform-hints`, or `pnpm run generate:kubernetes-terraform-hints` to regenerate one provider only. Environment variables `CDKTF_PROVIDER_TGZ` / `CDKTF_PROVIDER_AZURERM_TGZ` / `CDKTF_PROVIDER_KUBERNETES_TGZ` can point at local `.tgz` files instead of `npm pack`.

After a successful build, you can see the CLI help:

```bash
node dist/bin/cli.js --help
```

---

## Quickstart: scan a project

The easiest way to sanity-check the CLI is to run it against a small project directory.

From the **`cli/`** directory, after building:

```bash
cd cli
pnpm build
node dist/bin/cli.js scan .
```

**What to expect:**

- The CLI prints progress messages such as:
  - `[scan] starting scan for .`
  - `[scan] ingest: Ingesting files from . ...`
  - `[scan] analyze: Running analyzers on ... files...`
  - `[scan] data_flow: Detecting data flows...`
  - `[scan] output: Scan complete.`
- When the diagram graph is successfully built and written, it prints a final line similar to:
  - `[scan] dataflow.json written to /absolute/path/to/dataflow.json`
- A file named `dataflow.json` is created in the **current working directory** (unless you override the output path).

You can point the scanner at any other path:

```bash
node dist/bin/cli.js scan path/to/your/project
```

---

## Output: `dataflow.json`

By default (no `--output` flag), the CLI writes `./dataflow.json` in the current working directory.

- The file is a **wrapper** containing:
  - `schemaVersion` (currently `"1.0"`)
  - `graph`: a `DiagramGraphJson` (nodes, edges, viewport)
  - `metadata`: basic scan statistics (files scanned, duration, etc.)
- The `graph` section is compatible with the existing import flow; you can treat it like any other `DiagramGraphJson` template.

### Which properties are filled

The CLI emits **all** Engineering, Privacy, and Security property keys (from the DataParade property models) so the import UI can show every field. **Only a subset are set from code/config**; the rest are `null` or empty and are intended for the user to complete in the Preview & Edit step.

**Third-party / external API (from pattern detection):**

- Filled when we detect an external API (e.g. Auth0, Stripe): `integration_method`, `authentication_method`, `integration_status`, `vendor`, `documentation_url` (known doc URLs), `code_reference_package` (known npm package names), `api_type`, `sdk_available`, `https_enforced`.
- `service_url_api_endpoint` is set when the detector saw a request URL (e.g. `fetch('https://...')`); otherwise `null`.
- `api_version` only when the finding carries it (e.g. from code); otherwise `null`.

**Other patterns (env, config, database, auth, routes):**

- Env/config: `cloud_provider`, `region_location`, `encrypt_at_rest`, `connection_encryption`, `data_retention_period_days`, etc. when matching env or config keys.
- Database: `connection_encryption`, `backup_frequency`, `audit_logging_enabled`, etc. when patterns match.
- Auth: `mfa_required`, `authentication_method`, `sso_integration` from auth middleware patterns.
- Routes: `request_validation`, `api_type`, `https_enforced` for route patterns.
- Data flow edges (graph mapping): `engineering.protocol` is set to `rest` or `graphql` for `api_call` flows when the endpoint, method, or source code indicates HTTP REST vs GraphQL (see `infer-data-flow-protocol.ts`). Pattern rules in `property.patterns.yaml` also set `api_type` to `graphql` for `/graphql` URLs and paths.

**Terraform / IaC (`.tf` / `.tfvars`):**

- Structural resource/data/module/provider detection and **reference-based** edges between resources (see `cli/patterns/terraform.md`).
- **Provider topology** (same pass as for TypeScript): after scan, **`applyDeterministicInferenceFallbacks`** applies `provider-topology.rules.yaml` so e.g. **Amazon Web Services** connects to managed service nodes such as **Aws S3**, **Aws Lambda**, and **Aws Pg** with `managed_by_provider` / `managed_service_key` where rules match. Other resources still attach to the declared `provider` with a generic edge from that fallback pass.
- For **stable, reproducible** Terraform-only diagrams in tests or CI, set **`SCAN_AI_INFERENCE=false`** so optional AI merge does not reshape components.

**Privacy and Security:**

- Most Privacy and Security fields (e.g. `data_categories_received`, `compliance_certifications`, `risk_rating`, `last_assessment_date`) are **not** inferred from code; they stay `null` and are for manual or future AI enrichment.

See `cli/src/classifier/enhance-defaults.ts` for the full default template and `DETECTABLE_PROPERTY_KEYS`, and `cli/src/analyzers/shared/property-inference.ts` for what is set from findings.

Example usage with an explicit output path:

```bash
# Writes ./dataflow.json in the current directory
node dist/bin/cli.js scan .

# Writes ./scan-my-project-dataflow.json instead
node dist/bin/cli.js scan path/to/your/project --output scan-my-project-dataflow.json
```

---

## Configuration & flags

The CLI supports configuration via **flags**, a **project config file**, and **environment variables**.

- **Flags (scan command)**
  - `-o, --output <file>`: write the `dataflow.json` wrapper to the given file (defaults to `./dataflow.json` in the current working directory).
  - `--exclude <pattern...>`: one or more glob patterns to exclude from scanning (merged with built-in defaults; see **Default excludes** below).
  - `--minimum-confidence <number>`: minimum detection confidence between `0` and `1`.
  - `--language <language...>`: limit scanning to specific languages (e.g. `typescript`, `javascript`, `python`, `terraform`).
  - `--terraform-json <path>`: merge resource addresses from a saved `terraform show -json` file (relative to the scan root, or absolute if the resolved path stays **inside** the scan root).
  - `--terraform-plan <path>`: run `terraform show -json <path>` from the scan root and merge addresses (requires `terraform` on `PATH`; plan path is relative to scan root).
  - `--project-name <name>`: override the inferred project name used for the main application asset.
  - `--deep-analysis`: enable deeper, potentially slower, structural analysis where supported.

- **Config file (`dataparade.config.json`)**
  - Optional JSON file in the current working directory:

    ```json
    {
      "projectName": "my-service",
      "excludePaths": ["node_modules", "dist", ".git"],
      "minimumConfidence": 0.6,
      "enableAPIDetection": true,
      "enableDatabaseDetection": true,
      "enableDataFlowDetection": true
    }

    ```

  - Unknown or invalid fields cause a clear error when running the CLI.

- **Environment variables**
  - `DATAPARADE_EXCLUDES`: comma-separated exclude patterns (e.g. `node_modules,dist,.git`).
  - `DATAPARADE_MIN_CONFIDENCE`: minimum detection confidence between `0` and `1`.
  - AI inference variables (see **AI inference / enrichment** below): `SCAN_AI_INFERENCE`, `SCAN_BYOK_PROVIDER`, `SCAN_BYOK_MODEL`, `SCAN_BYOK_API_KEY`, `SCAN_AI_ENDPOINT`, token and budget controls.

**Precedence rules:**

- CLI flags override env/config.
- Environment variables override the config file for overlapping fields.
- The config file overrides built-in defaults.

**Default excludes (always applied during ingest):**

In addition to directory skips (`node_modules`, `.git`, test trees, etc.), these file globs are excluded unless you deliberately narrow excludes (they are prepended to `excludePaths`):

- `**/.env`, `**/.env.*`, `.env`, `.env.*` — secret-bearing env files are not scanned and are never embedded in AI provider prompts.
- Common test/story spec patterns (`*.spec.ts`, `*.test.ts`, `*.stories.*`, Playwright config, etc.) — see `cli/src/patterns/scan-exclusions.ts`.

**`dataparade config` command:**

Prints the effective scan configuration as JSON. Optional project path: `dataparade config [path]` (default: current working directory). When `[path]` is a file, config loads from that file’s parent directory (same as `scan`). When `SCAN_BYOK_API_KEY` or config `aiApiKey` is set, the printed value is **`<redacted>`** so keys do not leak into logs.

### Config fields reference

`dataparade.config.json` supports the following scan fields:

- `projectName` (`string`, optional): override inferred application/project label.
- `excludePaths` (`string[]`, optional): glob-like excludes.
- `minimumConfidence` (`number`, optional): confidence threshold in `[0, 1]`.
- `enableAPIDetection` (`boolean`, optional): include API-route/auth detections.
- `enableDatabaseDetection` (`boolean`, optional): include DB detections.
- `enableDataFlowDetection` (`boolean`, optional): run flow detection and rewiring.
- `languages` (`("typescript" | "javascript" | "json" | "yaml" | "env" | "python" | "terraform")[]`, optional): language allow-list. Note: `.env` files are **excluded from default ingest** even when `env` is listed; use `process.env.*` patterns in source files instead.
- `terraformJsonPath` (`string`, optional): same as `--terraform-json` (merge saved `terraform show -json` output; path must resolve under the scan root).
- `terraformPlanPath` (`string`, optional): same as `--terraform-plan` (run `terraform show -json` on the given plan file from scan root; path must resolve **under** the scan root).
- **Terraform stack sections (on by default):** when the scan root contains HCL `*.tf` files and `terraformStackSectionPathDepth` is unset, the CLI **infers** path depth `N` from `main.tf` layout and registers matching directories as service sections (Terraform findings are tagged there instead of `root`). No config or flags required for typical monorepos (e.g. Twenty `packages/twenty-docker/k8s/terraform` at depth **4**).
- **Monorepo package sections (on by default):** default workspace depth is **2** (`packages/twenty-server`, `packages/twenty-apps`, …). Override with `monorepoPackageSectionPathDepth` or `--monorepo-package-section-path-depth` (e.g. **3** for one hub per `packages/twenty-apps/<app>`). Set `autoInferMonorepoPackageSectionPathDepth: false` and omit depth to infer from layout only.
- `terraformStackSectionPathDepth` (`number`, optional): **override** inferred depth with a fixed `N` (exactly `N` POSIX path segments from scan root). Example: `terraform/deployments/my-service` → `3`; or scan from `terraform/deployments` with **`1`** for one section per child stack.
- `autoInferTerraformStackSectionPathDepth` (`boolean`, optional, default **true**): set **`false`** in config or pass **`--no-terraform-stack-section-auto`** to disable Terraform-only sections entirely.
- `deepAnalysis` (`boolean`, optional): enable deeper analyzer heuristics.
- `enableAiInference` (`boolean`, optional): enable post-scan AI inference.
- `aiProvider` (`"openai" | "anthropic" | "gemini" | "openrouter" | "local" | "mock"`, optional): model provider.
- `aiModel` (`string`, optional): model identifier sent to provider.
- `aiEndpoint` (`string`, optional): override provider endpoint URL.
- `aiTemperature` (`number`, optional): temperature in `[0, 2]`.
- `aiMaxTokens` (`number`, optional): max output tokens requested per call.
- `aiMaxModelCalls` (`number`, optional): max provider calls per planned queue.
- `aiBudgetTokens` (`number`, optional): estimated token budget per planned queue.
- `aiMaxCandidatesPerAgent` (`number`, optional): per-agent queue cap (`0` means unlimited).
- `aiProviderConcurrency` (`number`, optional): max in-flight provider calls for batched (non-`tpAgent`) enrichment queues (default **4**). Platform-billed scans (`DATAPARADE_WORKSPACE_API_KEY`) always use **1** because the hosted API HTTP gateway times out at **30s** per request.
- `aiInferenceScope` (`"default" | "third_party_only"`, optional): constrain inference scope.
- `aiVerbose` (`boolean`, optional): print per-proposal AI details (same as `--ai-verbose`).

---

## AI inference / enrichment

The CLI includes an optional **post-scan AI inference pipeline** that proposes metadata enrichments for detected components and flows.  
If not enabled, scans remain fully structural/pattern-based and make **no AI provider calls**.

### Security (open-source defaults)

- **Explicit opt-in:** AI inference runs only when you set `--ai-inference`, `SCAN_AI_INFERENCE=true`, or `"enableAiInference": true` in config. Setting provider/model/API key alone does **not** enable AI.
- **`.env` files:** Excluded from default ingest (`**/.env`, `**/.env.*`) and never embedded in provider prompts. Scanning a **single** `.env` file path is also skipped with a security warning.
- **Custom endpoints:** `SCAN_AI_ENDPOINT` / `--ai-endpoint` can point to any HTTPS URL; prompts include bounded code excerpts from scanned files—only enable AI on codebases you would share with that endpoint.
- **Terraform plan/state:** `--terraform-plan` and `--terraform-json` paths must stay under the scan root. Treat plan/state JSON as sensitive; the CLI merges resource addresses, not secret values from state.
- **LangSmith:** When tracing is enabled, uploads are **summary-only** (counts and ids); trace failures never fail the scan.
- **`dataparade config`:** Prints `aiApiKey` as `<redacted>` when configured.
- **HTTP timeouts:** Platform-billed AI uses async infer tasks (submit + poll). Default wait is **180s** per call (`SCAN_AI_HTTP_TIMEOUT_MS`). Poll interval is ~1.5s between status checks.
- **Evidence paths:** Provider proposals must cite exact repo-relative file paths present in the scan (no fuzzy suffix matching).

### How to enable

Use either flags or env/config:

- Flag: `--ai-inference`
- Env: `SCAN_AI_INFERENCE=true`
- Config file: `"enableAiInference": true`

Example:

```bash
node dist/bin/cli.js scan . --ai-inference --ai-provider openai --ai-model gpt-4o-mini
```

### Workspace scan quota (platform AI)

When you use **platform billing** instead of BYOK:

1. Set `SCAN_AI_INFERENCE=true` (or `--ai-inference`).
2. Set `DATAPARADE_WORKSPACE_API_KEY` (or `--workspace-api-key`) from **Workspace → Access keys** in the app.
3. Optionally set `DATAPARADE_API_BASE_URL` for local backend dev (default targets the deployed API).

The CLI calls **preflight** before scanning, runs LLM inference through the DataParade API (async infer tasks), then **complete** to report success or failure. Usage counts toward the workspace **scan slot** and **platform AI token** pools (see docs-site **Workspace scan quotas**).

| Mode | Quota API | LLM |
|------|-----------|-----|
| Structural only (no `SCAN_AI_INFERENCE`) | No — even if a workspace key is set | Local heuristics only |
| BYOK (`SCAN_BYOK_*`) | No | Your provider |
| Platform (`DATAPARADE_WORKSPACE_API_KEY` + AI on) | Preflight + complete; tokens per infer | DataParade API proxy |

If preflight fails, the CLI prints `[scan] workspace quota: …` (for example `No scan slots remaining in this workspace.`) and exits without scanning.

### Supported providers (presets)

`--ai-provider` selects a **preset** (same names as before). Each preset maps to an **API family** — how the CLI formats HTTP requests — not a separate TypeScript class per vendor:

| Preset | API family | Default endpoint |
|--------|------------|------------------|
| `openai` | Chat Completions | `https://api.openai.com/v1/chat/completions` |
| `openrouter` | Chat Completions (OpenAI-compatible) | `https://openrouter.ai/api/v1/chat/completions` |
| `anthropic` | Messages | `https://api.anthropic.com/v1/messages` |
| `gemini` | `generateContent` | Google Generative Language API (`…/models/<model>:generateContent`) |
| `local` | Ollama `generate` | `http://localhost:11434/api/generate` |
| `mock` | (no HTTP) | testing / structural-only |

All families return the same **proposal JSON** shape; `strictParseAndNormalizeProposals` merges patches the same way regardless of preset. Swap vendors with one flag plus `aiModel` / `SCAN_BYOK_API_KEY` — no code changes.

Preset definitions live in `cli/src/ai-enrichment/providers/presets.ts`. Adding a future vendor (e.g. another OpenAI-compatible host) is a new preset row pointing at an existing family, not a new adapter class.

Use `--ai-provider <preset>` or `SCAN_BYOK_PROVIDER`.

### Common AI options

Flags:

- `--ai-provider <provider>`
- `--ai-model <model>`
- `--ai-endpoint <url>`
- `--ai-temperature <number>`
- `--ai-max-tokens <number>`
- `--ai-max-calls <number>`
- `--ai-budget-tokens <number>`
- `--ai-max-candidates-per-agent <number>`
- `--ai-inference-scope <scope>` where scope is `default` or `third_party_only`:
  - `default`: runs the full AI enrichment flow (all supported candidate types, including third-party-related and other eligible entities/properties).
  - `third_party_only`: limits AI enrichment to third-party nodes only (skips non-third-party enrichment work).
- `--ai-verbose`: print per-proposal apply/reject details with evidence snippets

Note: API key input is environment-variable based (`SCAN_BYOK_API_KEY`) and does not currently have a CLI flag.

`--ai-verbose` can also be set in `dataparade.config.json` as `"aiVerbose": true` or via `SCAN_AI_VERBOSE=true`.

Environment variables:

- `SCAN_AI_INFERENCE` (**required** to enable inference; provider/model/key alone are not enough)
- `SCAN_BYOK_PROVIDER` (unknown values log a warning and are ignored)
- `SCAN_BYOK_MODEL`
- `SCAN_BYOK_API_KEY`
- `SCAN_AI_ENDPOINT`
- `SCAN_AI_TEMPERATURE`
- `SCAN_AI_MAX_TOKENS`
- `SCAN_AI_MAX_CALLS`
- `SCAN_AI_BUDGET_TOKENS`
- `SCAN_AI_PROVIDER_CONCURRENCY`
- `SCAN_AI_MAX_CANDIDATES_PER_AGENT`
- `SCAN_AI_INFERENCE_SCOPE`
- `SCAN_AI_TOOL_LOOP_MAX_ROUNDS`
- `SCAN_AI_TOOL_LOOP_MAX_FILES`
- `SCAN_AI_TOOL_LOOP_MAX_SEARCHES`
- `SCAN_AI_HTTP_TIMEOUT_MS` (provider HTTP timeout in milliseconds; default `120000`)
- `SCAN_AI_VERBOSE` (enable per-proposal AI logging; same as `--ai-verbose` / `"aiVerbose": true`)

### Provider endpoint defaults and overrides

`SCAN_AI_ENDPOINT` is the shared endpoint override for all AI providers.  
When unset, each provider uses a built-in default:

- `openai`: `https://api.openai.com/v1/chat/completions`
- `openrouter`: `https://openrouter.ai/api/v1/chat/completions` (use `aiModel` like `openai/gpt-4o-mini` or `anthropic/claude-sonnet-4`)
- `anthropic`: `https://api.anthropic.com/v1/messages`
- `gemini`: `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`
  - If you provide a base models URL in `SCAN_AI_ENDPOINT` (for example `.../v1beta/models`), the CLI appends `/<model>:generateContent`.
- `local`: `http://localhost:11434/api/generate` (Ollama)

Example local override:

```bash
SCAN_AI_INFERENCE=true
SCAN_BYOK_PROVIDER=local
SCAN_BYOK_MODEL="llama3.1"
SCAN_AI_ENDPOINT="http://YOUR_HOST:11434/api/generate"
```

OpenAI debugging/response-shape toggles:

- `SCAN_AI_DEBUG`
- `DATAPARADE_AI_OPENAI_JSON_SCHEMA`
- `DATAPARADE_AI_OPENAI_JSON_SCHEMA_STRICT`

### Inference scope (`SCAN_AI_INFERENCE_SCOPE`)

This controls **where AI enrichment is allowed to run** during a scan.

- `default`
  - Runs the normal/full inference scope.
  - AI can generate proposals for all supported enrichment candidates (not just third parties).
  - Use this when you want the most complete enrichment output.

- `third_party_only`
  - Restricts inference to `third_party` nodes only.
  - Skips non-third-party AI enrichment candidates.
  - Use this when you only care about third-party enrichment, or want to reduce cost/time.

Examples:

```bash
# Full/default AI scope
SCAN_AI_INFERENCE_SCOPE=default

# Only enrich third-party nodes
SCAN_AI_INFERENCE_SCOPE=third_party_only
```

### What you see at runtime

When enabled, scan progress includes `Running AI inference pipeline...`, and the CLI prints an end-of-run summary like:

```text
[scan] ai-inference summary: candidates=... proposals=... applied=... rejected=... (provider/model)
```

With `--ai-verbose`, the CLI also prints one line per proposal showing:

- whether it was `applied` or `rejected` (and reject reason),
- proposal kind and target (`component_patch`/`flow_patch`),
- confidence band, candidate type, agent, provider/model,
- top evidence reference (`file:start-end`) and reason.

If provider calls fail or proposals are rejected, warnings are emitted with troubleshooting hints (for example API key/model/network checks and `SCAN_AI_DEBUG=true`).

### Budget and call limits

- `--ai-max-calls` / `SCAN_AI_MAX_CALLS`: maximum provider calls for each planned queue.
- `--ai-budget-tokens` / `SCAN_AI_BUDGET_TOKENS`: queue token budget gate (estimated from prompt size + requested output tokens) used to stop additional provider calls when budget is exhausted.
- `SCAN_AI_PROVIDER_CONCURRENCY`: max in-flight provider calls for third-party enrichment (`tpAgent`).  
  Use this to batch calls in waves (for example, `SCAN_AI_MAX_CALLS=24` and `SCAN_AI_PROVIDER_CONCURRENCY=3` runs up to 24 total calls, with up to 3 at a time).
- `SCAN_AI_TOOL_LOOP_MAX_ROUNDS` (default `3`): max iterative provider rounds per third-party candidate in the orchestrator loop.
- `SCAN_AI_TOOL_LOOP_MAX_FILES` (default `48`): max distinct files kept in per-candidate `filesReviewed` context.
- `SCAN_AI_TOOL_LOOP_MAX_SEARCHES` (default `12`): max seeded search terms per third-party candidate before provider rounds.

### Orchestrator tool-loop controls (third-party)

These variables tune the bounded tpAgent loop (`seed_files -> search_text -> provider_infer -> expand_imports -> finalize`):

- `SCAN_AI_TOOL_LOOP_MAX_ROUNDS`
  - Higher value can improve coverage for hard nodes, but increases latency/cost.
  - Lower value (for example `1`) is useful for format/debug passes.
- `SCAN_AI_TOOL_LOOP_MAX_FILES`
  - Controls how many files can be included in candidate memory and provider prompt context.
  - Lowering reduces prompt size and cost; raising may improve evidence coverage.
- `SCAN_AI_TOOL_LOOP_MAX_SEARCHES`
  - Caps deterministic keyword searches used to discover related files.
  - Lowering reduces exploration breadth and runtime noise.

Example:

```bash
SCAN_AI_INFERENCE_SCOPE=third_party_only
SCAN_AI_MAX_CALLS=4
SCAN_AI_TOOL_LOOP_MAX_ROUNDS=2
SCAN_AI_TOOL_LOOP_MAX_FILES=32
SCAN_AI_TOOL_LOOP_MAX_SEARCHES=8
```

### Security & privacy notes

- Scan failures (structural errors, AI provider warnings, config validation, uncaught exceptions) are reported to **Sentry** from the CLI process (`scan_error_source=cli`), including **BYOK** scans that never call the workspace API. Disable with `SCAN_SENTRY_ENABLED=false` or override `SENTRY_DSN` in `cli/.env` (see `.env.example`).
- AI inference uses snippets/context from scanned files to generate enrichment proposals (never from `.env` files, including single-file `.env` scan paths).
- The CLI strips raw source snippet payloads from final `dataflow.json` graph output (file path and line ranges remain).
- `dataflow.json` still writes to your local output path; AI inference only affects which inferred properties are populated.
- When inference is enabled, the scan emits a warning that `.env` files are excluded from ingest and provider prompts.
- Cloud providers without `SCAN_BYOK_API_KEY` log a warning and return no provider proposals.
- Invalid merged configuration (for example `NaN` from bad numeric flags) fails the scan before ingest with exit code **2**.
- Only `.env` / `.env.*` are excluded by default; other credential files (for example `*.pem`, `secrets.yaml`) are **not**—exclude them with `--exclude` if needed.

---

## Additional examples

Run the scanner against the CLI package itself:

```bash
cd cli
pnpm build
node dist/bin/cli.js scan .
```

From the repo root, using the package filter:

```bash
pnpm --filter @dataparade/cli exec node dist/bin/cli.js scan .
```

Inspect the effective configuration for the current working directory (API keys redacted in output):

```bash
cd cli
node dist/bin/cli.js config
```

For a project under scan, run `config` from that directory or compare with flags/env documented above; `scan` loads `dataparade.config.json` from the **scan root**, not necessarily from where you invoke `config`.

These flows are useful for regression-testing changes to ingest, analyzers, graph mapping, and configuration.

---

## Runtime guarantees and failure behavior

### Deterministic output

The scanner stabilizes ordering and deduplication in classifier and data-flow phases so repeated scans of the same codebase produce the same logical `graph.nodes` / `graph.edges` output (assuming unchanged inputs/config).

### Output safety (no raw source leakage)

When mapping scan results to `dataflow.json`, raw snippet payloads such as `sourceLocation.code` are stripped from graph payloads. Source locations keep file path and line ranges only.

### Warning vs error semantics

- **Warnings** are non-fatal (e.g., parser diagnostics, malformed manifests, manifest budget cutoffs). The scan continues and may still write output.
- **Errors** in `scanResult.errors` indicate validation or pipeline problems and cause a non-zero CLI exit status.

### Manifest scanning performance budgets

Dependency manifest scanners apply defensive limits to avoid worst-case traversals:

- max manifest files scanned,
- max total manifest bytes scanned,
- max individual manifest file size.

When a limit is hit, scanning stops early for manifest discovery and emits warnings; this is non-fatal.

### Exit codes

`dataparade scan` returns:

- `0` when scan and output writing complete without fatal conditions.
- non-zero (currently `1`) when any fatal condition occurs, including:
  - `scanResult.errors` is non-empty,
  - graph construction fails,
  - output file writing fails.

---

## Notes & future work

- The CLI supports structural scanning and optional AI inference with OpenAI, Anthropic, Gemini, Local (Ollama), and Mock providers.
- Higher-level commands (such as `push`) are planned follow-up work.

### Running the scanner

Run the CLI against the CLI package itself:

```bash
node dist/bin/cli.js scan .
```

This will run the scanner and write a **dataflow wrapper JSON** file:

- By default (no `--output` flag), the CLI writes `./dataflow.json` in the **current working directory**.
- You can override the path with `-o, --output <file>`.

Example:

```bash
# Writes ./dataflow.json in the current directory
node dist/bin/cli.js scan .

# Writes ./scan-my-project-dataflow.json instead
node dist/bin/cli.js scan path/to/your/project --output scan-my-project-dataflow.json
```

The output file has the shape:

```json
{
  "schemaVersion": "1.0",
  "graph": {
    "nodes": [/* DiagramNode[] */],
    "edges": [/* DiagramEdge[] */],
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
  },
  "metadata": {
    "componentsCount": 0,
    "dataFlowsCount": 0,
    "filesScanned": 0,
    "scanDurationMs": 0
  }
}
```

You can load `graph` directly into the DataParade import flow as a `DiagramGraphJson`.

---

## Using from another project (npm)

Install as a dev dependency (pnpm):

```bash
pnpm add -D @dataparade/cli
```

or with npm:

```bash
npm install --save-dev @dataparade/cli
```

Then invoke it via:

```bash
npx @dataparade/cli scan .
```

or with pnpm:

```bash
pnpm dlx @dataparade/cli scan .
```

The `scan` command behavior described above reflects the current implementation.
