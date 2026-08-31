# PHP Patterns (CLI Scanner)

This document describes the PHP patterns implemented by the CLI codebase
scanner.

The PHP analyzer emits `RawFinding[]` using the **shared pattern IDs** from
`core/types/detection.ts`:

- `express_route`
- `database_connection`
- `external_api_call`
- `auth_middleware`
- `config_file`
- `env_variable`
- `lambda_handler`

These pattern IDs align with the TypeScript/JavaScript, Python, Go, C++, and C#
analyzers so that the classifier and data-flow detector treat every language
consistently.

## Structure

- **YAML configuration** at `cli/patterns/php.patterns.yaml` defines pattern
  IDs, namespaces, Composer package names, call names, route regexes, and
  confidences.
- **Config loader** (`cli/src/analyzers/php/php-detection-config.ts`) validates
  the YAML and compiles its regexes.
- **Parser** (`cli/src/analyzers/php/parser.ts`) produces a source-file model:
  namespace, `use` / `require` imports, classes/interfaces/traits, functions,
  and call sites (`Class::method`, `$obj->method`, `new Class`, functions).
- **Detectors** (`cli/src/patterns/detectors/php.ts`) run inside the shared
  `matchPatterns()` engine (one call per file).

### Namespace vs Composer package matching

| Field | Shape | Example |
| --- | --- | --- |
| `importNamespaces` | PSR namespace / class (`\`) | `GuzzleHttp`, `Illuminate\Database` |
| `packageNames` | Composer package (`/`) | `guzzlehttp/guzzle`, `laravel/framework` |

The two spaces stay disjoint so a `composer.json` hit does not also match as a
`use` statement (and vice versa).

## Routes

- **Laravel** — `Route::get/post/...` (ungated; facade is usually unimported)
- **Symfony** — `#[Route(...)]` (attributes kept when stripping `#` comments) and
  `@Route(...)` (docblock annotations scanned from raw source)
- **Slim** — `$app->get/post/...` when Slim is imported

## Database

- PDO, Eloquent / Illuminate, Doctrine DBAL/ORM, mysqli, Predis, MongoDB
- `pdo_dsn` resolves `new PDO(...)` / `new \PDO(...)` to a concrete `databaseType`
- Gated clients (Predis, Eloquent, …) require a matching `use` or Composer
  package so a bare `new Client()` does not false-positive

## External APIs

- Guzzle (`->get` / `->request` with URL)
- cURL (`curl_setopt` / `curl_exec`)
- Symfony HttpClient
- AWS S3 (`Aws\S3`, `league/flysystem-aws-s3-v3`; presence-gated)

## Auth / env

- Sanctum, Passport, Socialite, league/oauth2-client, firebase/php-jwt, Symfony Security, bearer headers
- `getenv` / `env()` / `$_ENV` / `$_SERVER`

## Dependency manifests

`composer.json` `require` / `require-dev` package names feed `matchPatterns`
the same way `go.mod` does for Go. Platform requirements (`php`, `ext-*`) are
skipped. `composer.json` is also a monorepo **service-section** marker.
