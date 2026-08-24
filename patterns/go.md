# Go Patterns (CLI Scanner)

This document describes the Go patterns implemented by the CLI codebase
scanner.

The Go analyzer emits `RawFinding[]` using the **shared pattern IDs** from
`core/types/detection.ts`:

- `express_route`
- `database_connection`
- `external_api_call`
- `auth_middleware`
- `config_file`
- `env_variable`
- `lambda_handler`

These pattern IDs align with the TypeScript/JavaScript, Python, C++, and C#
analyzers so that the classifier and data-flow detector treat every language
consistently.

## Structure

- **YAML configuration** at `cli/patterns/go.patterns.yaml` defines pattern
  IDs, import paths, call names, route regexes, and confidences.
- **Config loader** (`cli/src/analyzers/go/go-detection-config.ts`) validates
  the YAML and compiles its regexes.
- **Parser** (`cli/src/analyzers/go/parser.ts`) produces a source-file model:
  package name, imports (with alias and blank-import flags), functions (with
  receiver types), types, and call sites.
- **Detectors** (`cli/src/patterns/detectors/go.ts`) run inside the shared
  `matchPatterns()` engine.

### Import path matching

`importPaths` values match a Go import path **exactly or as a path prefix**:

- `github.com/jackc/pgx` matches `github.com/jackc/pgx/v5/pgxpool`
- `github.com/redis/go-redis` matches `github.com/redis/go-redis/v9`

That single rule is what makes Go's module major-version suffixes (`/v5`,
`/v76`) and sub-package imports work without enumerating every variant.

### Blank imports are a first-class signal

Go registers database drivers through import side effects:

```go
import _ "github.com/lib/pq"
```

The parser records `isBlank` for these, and driver rules match on the import
path alone — a blank import is often the *only* evidence in the file that a
particular database is in use.

### Comment handling

Sources are pre-processed by `stripCommentsPreservingLayout()` with
`backtickStrings` enabled, so Go raw strings (`` `SELECT ... -- x` ``) survive
intact while comments are blanked to spaces and line numbers are preserved.
Commented-out routes produce no findings.

---

## Route / Handler Detection (`express_route`)

Route detection is regex-driven per framework and gated on the framework's
import path.

| Framework | Detected form |
| --- | --- |
| `net/http` | `mux.HandleFunc("/path", h)`, and Go 1.22+ `HandleFunc("GET /path", h)` |
| gorilla/mux | `r.HandleFunc("/path", h).Methods("POST")` |
| chi | `r.Get("/path", h)`, `r.Post(...)` |
| gin | `r.GET("/path", h)`, `r.POST(...)` |
| echo | `e.GET("/path", h)` |
| Fiber | `app.Get("/path", h)` |
| gRPC | `RegisterGreeterServer(s, &server{})` → `RPC` |

### Avoiding double-reporting

Nearly every Go HTTP file imports `net/http`, so a gorilla/mux route would
otherwise match both the gorilla rule and the generic `net/http` rule. The
`net/http` pattern carries a trailing guard that refuses lines ending in
`.Methods(...)`, yielding those to the more specific gorilla rule:

```yaml
- regex: '\bHandle(?:Func)?\s*\(\s*"(?!(?:GET|POST|…)\s)([^"]+)"(?:(?!\.Methods\().)*$'
```

Go 1.22 method-prefixed patterns are matched by a separate rule, and the
generic rule's negative lookahead keeps it from claiming them a second time.

---

## Database Connections (`database_connection`)

Detected from an import path (including blank imports) or a call site.

| Client | `databaseType` | Import path |
| --- | --- | --- |
| lib/pq | `postgres` | `github.com/lib/pq` |
| pgx | `postgres` | `github.com/jackc/pgx` |
| go-sql-driver/mysql | `mysql` | `github.com/go-sql-driver/mysql` |
| go-sqlite3 | `sqlite` | `github.com/mattn/go-sqlite3`, `modernc.org/sqlite` |
| sqlx | `sql` | `github.com/jmoiron/sqlx` |
| GORM (+ drivers) | per driver | `gorm.io/gorm`, `gorm.io/driver/*` |
| ent | `sql` | `entgo.io/ent` |
| mongo-driver | `mongodb` | `go.mongodb.org/mongo-driver` |
| go-redis / redigo | `redis` | `github.com/redis/go-redis`, `github.com/gomodule/redigo` |
| gocql | `cassandra` | `github.com/gocql/gocql` |
| DynamoDB | `dynamodb` | `github.com/aws/aws-sdk-go-v2/service/dynamodb` |

### `sql.Open` driver resolution

`database/sql` is deliberately engine-agnostic — the concrete engine appears
only as the first argument:

```go
db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
```

The `sql_open` rule reads that argument and maps it through a driver table
(`postgres`/`pgx` → postgres, `mysql` → mysql, `sqlite3` → sqlite,
`sqlserver` → mssql, …), so the graph shows a Postgres node rather than a
generic SQL one. Unknown drivers fall back to `databaseType: "sql"` and the
driver string is preserved in `properties.driver`.

---

## External API Calls (`external_api_call`)

| Client | Signals |
| --- | --- |
| `net/http` | `http.Get`, `http.Post`, `http.NewRequest`, `client.Do` |
| resty | `resty.New()`, `.SetBaseURL(...)` |
| gRPC | `grpc.Dial(...)`, `grpc.NewClient(...)` |

Call matching is **exact on the fully qualified callee** (`http.Get`), not on
the trailing segment. This matters in Go: matching a bare `Get` would make
every chi router registration (`r.Get("/items", h)`) look like an outbound HTTP
call. There is a test asserting that exact case.

When the arguments contain a literal URL, the service name is resolved from the
third-party catalog — `https://api.stripe.com/...` → `stripe`.

---

## Auth (`auth_middleware`)

| Rule | Signals | `strategy` |
| --- | --- | --- |
| golang-jwt | `github.com/golang-jwt/jwt`, `jwt.Parse`, `jwt.NewWithClaims` | `jwt` |
| OAuth2 | `golang.org/x/oauth2` | `oauth2` |
| Casbin | `github.com/casbin/casbin` | `casbin` |
| Bearer header | literal `"Authorization"` / `Header.Get("Authorization")` | `bearer_token` |

---

## Serverless Handlers (`lambda_handler`)

| Runtime | Detected when |
| --- | --- |
| AWS Lambda | `github.com/aws/aws-lambda-go/lambda` + `lambda.Start(...)` |
| GCP Cloud Functions | `functions-framework-go` + `functions.HTTP(...)` |

---

## Config and Environment (`config_file`, `env_variable`)

- `env_variable` from `os.Getenv("KEY")` and `os.LookupEnv("KEY")`; the key is
  captured into `properties.key`.
- `config_file` from configuration loaders: godotenv, Viper, envconfig.
- `config_file` for files named `config.go`, `configuration.go`, `settings.go`.

---

## Dependency Manifests

`cli/src/analyzers/go/dependency-manifests.ts` walks the repository for
`go.mod` and parses:

- the `module` declaration (the module's own path);
- both `require` forms — the parenthesised block and the single-line form;
- skipping `replace`, `exclude`, and `retract` blocks, which redirect or remove
  dependencies rather than declare them.

Go is unusually well-suited to manifest-driven detection: **a `go.mod` require
token is the same string that appears in an `import` statement**, so module
paths feed the shared third-party catalog and the database rules directly, with
no name translation. `github.com/getsentry/sentry-go` resolves to `sentry`,
`github.com/lib/pq` to a Postgres client.

`go.work` workspace members are parsed as well (`parseGoWork`).

Manifest walking is bounded by the shared budgets in
`cli/src/analyzers/shared/manifest-budgets.ts`.

---

## Sections

`go.mod` is registered as a **service section marker**: in a multi-module
repository each module directory becomes its own section, which is exactly the
Go convention for service boundaries.

---

## File Types

The ingest layer maps `.go` to the `go` language. `vendor/` is already excluded
by the default scan exclusions.
