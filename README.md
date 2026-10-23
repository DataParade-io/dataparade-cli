# dataPARADE CLI

The **dataPARADE CLI** (`@dataparade/cli`) scans a codebase and produces a **`dataflow.json`** file you can import into the DataParade web app. It runs a structural pipeline (ingest → analyzers → classifier → data-flow detector → graph mapping) and writes a JSON wrapper containing a `DiagramGraphJson` plus scan metadata.

- **Primary command**: `scan <path>`
- **Supported languages**: TypeScript, JavaScript, Python, Go, Java, Kotlin, C++, C#/.NET, Terraform
- **License**: Apache-2.0 — see [`LICENSE`](./LICENSE). Source: [DataParade-io/dataparade-cli](https://github.com/DataParade-io/dataparade-cli)

**Full documentation:** [app.dataparade.io/docs/cli-import-and-zip](https://app.dataparade.io/docs/cli-import-and-zip)

---

## Quick start

Install the CLI and check that it runs:

```bash
npm install -g @dataparade/cli
dataparade --help
```

Then scan your project from its root folder:

```bash
dataparade scan .
```

A scan reads the source and config files under the folder (skipping dependencies, build output and anything in `.gitignore`) and uploads the result to the dataPARADE web app unless you pass `--skip-auto-upload`.

**What to expect:**

- In a TTY: brand header, staged progress (spinner → checkmarks), a short **What we found** summary (routes, databases, outbound services), and a clear next-step note.
- In CI / non-TTY (or with `NO_COLOR`): the same content as plain logs — no spinners or ANSI.
- On success: `[scan] dataflow.json written to /absolute/path/to/dataflow.json` (always printed for scripts/tests).
- If AI enrichment cannot start (no network, anonymous per-IP limit, server error), the CLI prints `AI enrichment unavailable (<reason>); continuing with a structural scan.` and still writes the output. Use `--no-ai-inference` to skip AI.
- When auto-upload runs: `[scan] Preview ready: <URL>` (plus a friendly next-step note with the same URL).
- By default, the output goes to a **`.dataparade/`** folder in the current working directory (override the path of `dataflow.json` with `-o` / `--output`; the other files sit next to it).

```bash
dataparade scan path/to/your/project --output scan-my-project-dataflow.json
```

List commands and options: `dataparade --help` and `dataparade scan --help`.

---

## Upload to dashboard

After a scan, the CLI **auto-uploads** `dataflow.json` and the Facts next to it by default (unless you opt out). This creates an **import preview draft** in the web app — not a finished assessment.

- **With a workspace API key** (`DATAPARADE_WORKSPACE_API_KEY` from **Workspace → Access keys**): prints a dashboard link (`?importDraft=`) for that workspace.
- **Without a workspace key**: prints a sign-up link (`/preview/cli/<token>`). Create an account to open **Preview & Edit** on your dashboard.
- Opt out: `--skip-auto-upload` or `DATAPARADE_SKIP_AUTO_UPLOAD=true`
- With a workspace API key, an upload does **not** use scan quota.
- Without a key, uploads count toward a small per-IP limit on anonymous scans. A default scan (AI on) counts once, when its AI session starts, and its auto-upload does not count again. A scan with `--no-ai-inference`, or a separate `dataparade upload`, counts once when it uploads. When the limit is reached, the scan still writes `.dataparade/`; set `DATAPARADE_WORKSPACE_API_KEY` and run `dataparade upload .dataparade/dataflow.json`.
- If the upload fails, the scan output stays on disk and the CLI prints the `dataparade upload` command to retry.

```bash
npx @dataparade/cli upload .dataparade/dataflow.json --project-name "My service"
```

**Full guide:** [Upload to dashboard](https://app.dataparade.io/docs/cli-import-and-zip/upload)

---

## Output: `.dataparade/`

By default, a scan writes these files to `./.dataparade/`:

| File | What it is |
| --- | --- |
| `dataflow.json` | The diagram the web app imports: a wrapper with `schemaVersion`, `graph` (`DiagramGraphJson`: nodes, edges, viewport) and `metadata` (files scanned, duration, C4 `hierarchy`, etc.). |
| `facts.json` | What the latest scan found: components, data flows, data items (with groups) and the links between them. Replaced on every scan. |
| `data-items/<name>.json` | One file per data item, with every place it occurs in the code. |
| `graphify.json` | The code-structure graph from [Graphify](https://github.com/Graphify-Labs/graphify), when it is installed. |
| `answers.json` | People's decisions (interview answers, reviews). A scan never writes or changes it. |

`-o` / `--output` is the path of `dataflow.json`; the other files go in the same folder. Scans skip this folder, so rescanning does not read old output. Commit `answers.json` with your code; the rest can be regenerated.

Graphify's cache lives outside the output, in `~/.cache/dataparade/graphify/` (set `DATAPARADE_CACHE_DIR` to move it).

Interview and review commands work on this folder:

```bash
npx @dataparade/cli kb brief                 # open interview questions
npx @dataparade/cli kb land ...              # save a confirmed answer to answers.json
npx @dataparade/cli kb migrate               # import answers from an old ocsf-discoveries/ folder
npx @dataparade/cli export ocsf --out ocsf   # write OCSF records from facts + answers
```

Formats, and how answers apply: [docs/cli/scan-output.md](../docs/cli/scan-output.md).

- The `graph` section of `dataflow.json` is compatible with the DataParade import flow
- Most node properties are emitted with `null` defaults; only a subset are filled from code patterns — complete the rest in Preview & Edit

**Full guide:** [Output and results](https://app.dataparade.io/docs/cli-import-and-zip/output)

---

## Troubleshooting

**The scan stops with `FATAL ERROR: ... JavaScript heap out of memory`.** Node ran out of memory on a very large tree. At the start of each scan the CLI prints how many files it will read and, for a large tree, names the biggest folders. Skip folders that hold no application code, and if needed give Node more memory:

```bash
dataparade scan . --exclude 'public/**' 'generated/**'
NODE_OPTIONS=--max-old-space-size=8192 dataparade scan .
```

Dependencies, build output and anything in `.gitignore` are skipped already.

---

## Documentation

| Topic                    | Link                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| CLI hub (all topics)     | [CLI Run and Export](https://app.dataparade.io/docs/cli-import-and-zip)                          |
| Scan arguments & flags   | [Scan arguments](https://app.dataparade.io/docs/cli-import-and-zip/scan-arguments)               |
| `dataparade.config.json` | [Config file](https://app.dataparade.io/docs/cli-import-and-zip/config-file)                     |
| Environment variables    | [Environment variables](https://app.dataparade.io/docs/cli-import-and-zip/environment-variables) |
| AI inference             | [AI inference](https://app.dataparade.io/docs/cli-import-and-zip/ai-inference)                   |
| Scan patterns (YAML)     | [Scan patterns](https://app.dataparade.io/docs/cli-import-and-zip/scan-patterns)                 |

---

## License

Apache-2.0 · Source: [github.com/DataParade-io/dataparade-cli](https://github.com/DataParade-io/dataparade-cli)
