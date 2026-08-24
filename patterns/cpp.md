# C++ Patterns (CLI Scanner)

This document describes the C++ patterns implemented by the CLI codebase
scanner.

The C++ analyzer emits `RawFinding[]` using the **shared pattern IDs** from
`core/types/detection.ts`:

- `express_route`
- `database_connection`
- `external_api_call`
- `auth_middleware`
- `config_file`
- `env_variable`

These pattern IDs align with the TypeScript/JavaScript, Python, and C#
analyzers so that the classifier and data-flow detector treat every language
consistently.

## Structure

- **YAML configuration** at `cli/patterns/cpp.patterns.yaml` defines pattern
  IDs, headers, package names, call names, route regexes, and confidences.
- **Config loader** (`cli/src/analyzers/cpp/cpp-detection-config.ts`) validates
  the YAML and compiles its regexes.
- **Parser** (`cli/src/analyzers/cpp/parser.ts`) produces a lightweight
  translation-unit model: includes, functions, types, namespaces, and call
  sites.
- **Detectors** (`cli/src/patterns/detectors/cpp.ts`) run inside the shared
  `matchPatterns()` engine.

### Comment handling

C++ sources are pre-processed by `stripCommentsPreservingLayout()`
(`cli/src/analyzers/shared/strip-comments.ts`) before any line-based rule runs.
Comments are replaced with spaces so line numbers stay accurate, and string
literals are preserved — a URL like `"https://api.example.com"` must not be
truncated at its `//`. Commented-out routes therefore produce no findings.

### Header matching

`includeHeaders` values are matched against `#include` paths:

- A value **without** a `/` must match a whole path segment. `hiredis` matches
  `<hiredis/hiredis.h>`; `sql.h` does **not** match `<mysql/mysql.h>`.
- A value **with** a `/` is matched as a substring, e.g. `curl/curl.h`.

---

## Route / Handler Detection (`express_route`)

Route detection is regex-driven per framework and gated on the framework's
headers. Each rule declares a `regex` plus optional `methodGroup` /
`pathGroup` / `defaultMethod`.

| Framework | Detected form |
| --- | --- |
| Crow | `CROW_ROUTE(app, "/users")`, `CROW_BP_ROUTE(...)` |
| cpp-httplib | `svr.Get("/health", ...)`, `svr.Post(...)` |
| Drogon | `registerHandler("/users", ...)`, `ADD_METHOD_TO(...)`, `METHOD_ADD(...)` |
| Pistache | `Routes::Get(router, "/users", ...)` |
| oatpp | `ENDPOINT("GET", "/users", name)` |

**Example:**

```cpp
#include <crow.h>

int main() {
  crow::SimpleApp app;
  CROW_ROUTE(app, "/customers")([]() { return crow::response(200); });
  app.port(8080).run();
}
```

**Emitted finding:**

- `pattern`: `express_route`
- `name`: `"<METHOD> <path>"` when the framework encodes a method, otherwise
  `"<FRAMEWORK>_ROUTE <path>"`
- `properties`: `framework`, `httpMethods`, `path`

---

## Database Connections (`database_connection`)

Detected from a header include, a package-manifest entry, or a call site.

| Client | `databaseType` | Signals |
| --- | --- | --- |
| libpq | `postgres` | `<libpq-fe.h>`, `PQconnectdb` |
| libpqxx | `postgres` | `<pqxx/pqxx>`, `pqxx::connection` |
| SQLite3 | `sqlite` | `<sqlite3.h>`, `sqlite3_open` |
| MySQL Connector/C++ | `mysql` | `<mysql/mysql.h>`, `mysql_real_connect` |
| mongocxx | `mongodb` | `<mongocxx/client.hpp>`, `mongocxx::client` |
| hiredis | `redis` | `<hiredis/hiredis.h>`, `redisConnect` |
| redis-plus-plus | `redis` | `<sw/redis++/redis++.h>` |
| SOCI | `sql` | `<soci/soci.h>`, `soci::session` |
| nanodbc | `sql` | `<nanodbc/nanodbc.h>` |
| DataStax C++ driver | `cassandra` | `<cassandra.h>`, `cass_session_connect` |

**Emitted properties:** `client`, `databaseType`.

---

## External API Calls (`external_api_call`)

Matched on call sites whose callee is a configured `callNames` entry or starts
with a configured `callNamePrefixes` entry, gated on the client's headers. When
the call arguments contain a literal URL, the service name is resolved from the
third-party catalog (`third-party.patterns.yaml`).

| Client | Signals |
| --- | --- |
| libcurl | `<curl/curl.h>`, `curl_easy_setopt(..., CURLOPT_URL, "https://...")` |
| cpr | `<cpr/cpr.h>`, any `cpr::` call |
| cpp-httplib client | `httplib::Client("https://...")` |
| POCO | `Poco::Net::HTTPSClientSession`, `Poco::URI` |
| Boost.Beast | `<boost/beast/http.hpp>` |

**Example:**

```cpp
#include <curl/curl.h>

CURL* curl = curl_easy_init();
curl_easy_setopt(curl, CURLOPT_URL, "https://api.stripe.com/v1/charges");
```

→ `external_api_call` with `properties.serviceName = "stripe"`.

---

## Auth (`auth_middleware`)

- **jwt-cpp** — `<jwt-cpp/jwt.h>` or `jwt::decode` / `jwt::verify` /
  `jwt::create`; emits `properties.strategy = "jwt"`.
- **Bearer token headers** — a literal `"Authorization"` header or a
  `Authorization: Bearer` construction; lower confidence (`0.7`), emits
  `properties.strategy = "bearer_token"`.

---

## Config and Environment (`config_file`, `env_variable`)

- `env_variable`: `getenv("KEY")` / `std::getenv("KEY")`; the key is captured
  into `properties.key`.
- `config_file`: files named `config`, `configuration`, or `settings` with a
  C++ extension (`.h`, `.hpp`, `.hxx`, `.cpp`, `.cc`, `.cxx`).

---

## Dependency Manifests

`cli/src/analyzers/cpp/dependency-manifests.ts` walks the repository for:

- `vcpkg.json` — `dependencies` (string and object forms)
- `conanfile.txt` — `[requires]` / `[tool_requires]`
- `conanfile.py` — `requires = "..."`, `self.requires("...")`
- `CMakeLists.txt` — `find_package()`, `FetchContent_Declare()`, `CPMAddPackage()`

Versions are stripped (`fmt/10.2.1` → `fmt`). Package names feed the shared
third-party service catalog and the `packageNames` field of the database and
auth rules, so a `libpqxx` dependency is reported as a Postgres client even
when no source file was scanned.

Manifest walking is bounded by the shared budgets in
`cli/src/analyzers/shared/manifest-budgets.ts`.

---

## File Types

The ingest layer maps `.cpp`, `.cc`, `.cxx`, `.c++`, `.hpp`, `.hh`, `.hxx`,
`.ipp`, `.inl`, and `.h` to the `cpp` language. `cmake-build-debug/` and
`cmake-build-release/` are excluded by default.
