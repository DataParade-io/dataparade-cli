# dataPARADE CLI

The **dataPARADE CLI** (`@dataparade/cli`) scans a codebase and produces a **`dataflow.json`** file you can import into the DataParade web app. It runs a structural pipeline (ingest → analyzers → classifier → data-flow detector → graph mapping) and writes a JSON wrapper containing a `DiagramGraphJson` plus scan metadata.

- **Primary command**: `scan <path>`
- **Supported languages**: TypeScript, JavaScript, Python, Go, Java, Kotlin, C++, C#/.NET, Terraform
- **License**: GPL-3.0-or-later — see [`LICENSE`](./LICENSE). Source: [DataParade-io/dataparade-cli](https://github.com/DataParade-io/dataparade-cli)

**Full documentation:** [app.dataparade.io/docs/cli-import-and-zip](https://app.dataparade.io/docs/cli-import-and-zip)

---

## Quick start

```bash
npx @dataparade/cli scan .
```

Or with pnpm:

```bash
pnpm dlx @dataparade/cli scan .
```

**What to expect:**

- Progress messages such as `[scan] starting scan for .` and `[scan] output: Scan complete.`
- On success: `[scan] dataflow.json written to /absolute/path/to/dataflow.json`
- By default, `dataflow.json` is created in the **current working directory** (override with `-o` / `--output`).

```bash
npx @dataparade/cli scan path/to/your/project --output scan-my-project-dataflow.json
```

List commands and options: `npx @dataparade/cli --help` and `npx @dataparade/cli scan --help`.

---

## Upload to dashboard

After a scan, the CLI **auto-uploads** `dataflow.json` by default (unless you opt out). This creates an **import preview draft** in the web app — not a finished assessment.

- **With a workspace API key** (`DATAPARADE_WORKSPACE_API_KEY` from **Workspace → Access keys**): prints a dashboard link (`?importDraft=`) for that workspace.
- **Without a workspace key**: prints a sign-up link (`/preview/cli/<token>`). Create an account to open **Preview & Edit** on your dashboard.
- Opt out: `--skip-auto-upload` or `DATAPARADE_SKIP_AUTO_UPLOAD=true`
- Upload alone does **not** consume scan quota

```bash
npx @dataparade/cli upload ./dataflow.json --project-name "My service"
```

**Full guide:** [Upload to dashboard](https://app.dataparade.io/docs/cli-import-and-zip/upload)

---

## Output: `dataflow.json`

By default, the CLI writes `./dataflow.json` in the current working directory.

- **Wrapper** with `schemaVersion`, `graph` (`DiagramGraphJson`: nodes, edges, viewport), and `metadata` (files scanned, duration, etc.)
- The `graph` section is compatible with the DataParade import flow
- Most node properties are emitted with `null` defaults; only a subset are filled from code patterns — complete the rest in Preview & Edit

**Full guide:** [Output and results](https://app.dataparade.io/docs/cli-import-and-zip/output)

---

## Documentation

| Topic | Link |
|-------|------|
| CLI hub (all topics) | [CLI Run and Export](https://app.dataparade.io/docs/cli-import-and-zip) |
| Scan arguments & flags | [Scan arguments](https://app.dataparade.io/docs/cli-import-and-zip/scan-arguments) |
| `dataparade.config.json` | [Config file](https://app.dataparade.io/docs/cli-import-and-zip/config-file) |
| Environment variables | [Environment variables](https://app.dataparade.io/docs/cli-import-and-zip/environment-variables) |
| AI inference | [AI inference](https://app.dataparade.io/docs/cli-import-and-zip/ai-inference) |
| Scan patterns (YAML) | [Scan patterns](https://app.dataparade.io/docs/cli-import-and-zip/scan-patterns) |

---

## License

GPL-3.0-or-later · Source: [github.com/DataParade-io/dataparade-cli](https://github.com/DataParade-io/dataparade-cli)
