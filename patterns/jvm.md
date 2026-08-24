# JVM Patterns — Java and Kotlin (CLI Scanner)

This document describes the JVM patterns implemented by the CLI codebase
scanner. One analyzer serves both Java and Kotlin.

The JVM analyzer emits `RawFinding[]` using the **shared pattern IDs** from
`core/types/detection.ts`:

- `express_route`
- `database_connection`
- `external_api_call`
- `auth_middleware`
- `config_file`
- `env_variable`
- `lambda_handler`

These pattern IDs align with the TypeScript/JavaScript, Python, Go, C++, and
C# analyzers so that the classifier and data-flow detector treat every
language consistently.

## Why one analyzer for two languages

Java and Kotlin are separate `FileLanguage` values (`java`, `kotlin`) mapped to
the same analyzer, the way TypeScript and JavaScript already are. They share
everything the rules key off:

- the same package namespace (`org.springframework.web.bind.annotation`)
- the same Maven/Gradle coordinate space (`org.postgresql:postgresql`)
- the same Spring and Jakarta annotation vocabulary
- the same JDBC URLs and drivers

They differ only in declaration grammar, which is confined to the parser, and
in a few framework-specific rules (Ktor, Exposed) that are gated by import
package like any other framework.

## Structure

- **YAML configuration** at `cli/patterns/jvm.patterns.yaml` defines pattern
  IDs, import packages, Maven coordinates, annotations, call names, route
  regexes, and confidences.
- **Config loader** (`cli/src/analyzers/jvm/jvm-detection-config.ts`) validates
  the YAML and compiles its regexes.
- **Parser** (`cli/src/analyzers/jvm/parser.ts`) produces a source-file model:
  package name, imports (with static/wildcard/alias flags), annotated types
  (with supertypes), methods, and call sites.
- **Detectors** (`cli/src/patterns/detectors/jvm.ts`) run inside the shared
  `matchPatterns()` engine.
- **Manifests** (`cli/src/analyzers/jvm/manifest-parsers.ts`) read Maven,
  Gradle, version catalogs, and Spring datasource configuration.

## Two token spaces: imports vs. coordinates

Unlike Go — where a `go.mod` require line is the exact string that appears in
an `import` — the JVM has two unrelated vocabularies for the same library:

| | Token | Example |
| --- | --- | --- |
| `importPackages` | what appears in an `import` | `org.springframework.data.jpa.repository` |
| `packageCoordinates` | Maven `groupId:artifactId` | `org.springframework.boot:spring-boot-starter-data-jpa` |

Rules therefore carry both. `importPackages` matches exactly or as a package
prefix, so one entry covers a whole subtree. `packageCoordinates` matches the
full coordinate, or by `groupId` prefix when the configured entry has no `:`.

Coordinate matching additionally **requires the candidate to contain a `:`**.
Without that guard, a configured groupId prefix such as `org.mongodb` would
also match the `com.mongodb…` import of a source file, and the same client
would be reported twice for one service.

## Route composition

Spring and Micronaut put a template on the class and a suffix on the method;
the detector joins them, exactly as the C# analyzer does for `[Route]` +
`[HttpGet]`:

```java
@RestController
@RequestMapping("/api/customers")
public class CustomersController {
    @GetMapping("/{id}")
    public Customer byId(@PathVariable Long id) { … }   // GET /api/customers/{id}
}
```

Two JVM-specific wrinkles:

**Named annotation arguments.** A route template may be positional
(`@GetMapping("/x")`), named (`@RequestMapping(value = "/x")`), or an array
(`@RequestMapping({"/x", "/y"})`), and the HTTP verb may itself be an argument
(`method = RequestMethod.DELETE`). The detector reads `value`/`path` and
`method` by name, falling back to the first positional string. It deliberately
does **not** fall back to "any quoted string", which would read
`@RequestMapping(consumes = "application/json")` as a path.

**JAX-RS splits the verb from the path.** `@GET` carries no template; the
sub-path lives in a sibling `@Path("/{id}")` on the same method. Frameworks
declare a `pathAnnotations` list so the detector knows where to look when the
route annotation has no template of its own.

## JDBC URLs name the engine

JDBC is engine-agnostic at the API level. The concrete database appears only in
the URL sub-protocol, so without reading it every JDBC database collapses into
one generic SQL node:

```
jdbc:postgresql://db.internal:5432/billing   →   databaseType: postgres
jdbc:acmedb://host/db                        →   databaseType: sql (driver preserved)
```

This is the JVM analogue of Go's `sql.Open` driver argument. The same table
also resolves the plain URI schemes Spring uses for non-relational stores
(`mongodb://`, `redis://`), because those arrive through the same code path.

**Only the driver token is ever recorded.** JDBC URLs and Spring datasource
properties routinely carry credentials; the value itself never reaches a
finding. There is a test asserting a fixture password does not survive.

## Spring configuration is a first-class source

`application.properties` / `application.yml` is frequently the only place a
Spring service names the databases it talks to — the analogue of .NET's
`appsettings.json` `ConnectionStrings`. The manifest scanner reads datasource
URIs out of both formats, including the multi-document YAML that Spring uses
for per-profile configuration.

## Build manifests

| Manifest | Parsed for |
| --- | --- |
| `pom.xml` | `<dependency>` and `<parent>` coordinates; `<scope>test</scope>` skipped |
| `build.gradle`, `build.gradle.kts` | Groovy and Kotlin DSL, string and map notation, `platform(…)` wrappers |
| `gradle/libs.versions.toml` | `[libraries]` `module` or `group`+`name` |

Test dependencies are excluded from Gradle by construction rather than by a
filter: the configurations that ship code are spelled `implementation`,
`runtimeOnly`, and so on, while test variants carry a capitalised infix
(`testImplementation`), so the `\b`-anchored lowercase names cannot match them.

## Section discovery

`pom.xml`, `build.gradle`, and `build.gradle.kts` are service-boundary markers.
Unlike `CMakeLists.txt` — deliberately excluded because C++ projects put one in
nearly every subdirectory — a JVM build file sits at a module root, and on the
JVM the module *is* the deployable unit.

`settings.gradle`/`settings.gradle.kts` is **not** a marker: it declares the
root of a multi-project build rather than a module of its own.

## Known limitations

- **Call arguments are read per line.** A call whose arguments wrap onto the
  following line yields no URL, so an external API call spanning lines is
  detected as a call but not attributed to a service. This is inherited from
  the shared C-family call extractor and applies equally to Go, C++, and C#.
- **`bearer_token_header` is broad.** It fires on any file containing the
  literal `"Authorization"` at 0.7 confidence — the same trade-off as the Go
  and C++ equivalents.
- **gRPC service registration** is emitted as an `express_route` with method
  `RPC`, matching the Go analyzer's treatment.
