# C# / .NET Patterns (CLI Scanner)

This document describes the C#/.NET patterns implemented by the CLI codebase
scanner.

The C# analyzer emits `RawFinding[]` using the **shared pattern IDs** from
`core/types/detection.ts`:

- `express_route`
- `database_connection`
- `external_api_call`
- `auth_middleware`
- `config_file`
- `env_variable`
- `lambda_handler`

These pattern IDs align with the TypeScript/JavaScript, Python, and C++
analyzers so that the classifier and data-flow detector treat every language
consistently.

## Structure

- **YAML configuration** at `cli/patterns/csharp.patterns.yaml` defines pattern
  IDs, namespaces, attributes, call names, route regexes, and confidences.
- **Config loader** (`cli/src/analyzers/csharp/csharp-detection-config.ts`)
  validates the YAML and compiles its regexes.
- **Parser** (`cli/src/analyzers/csharp/parser.ts`) produces a compilation-unit
  model: usings, namespace, types (with base types and attributes), methods
  (with attributes), and call sites.
- **Detectors** (`cli/src/patterns/detectors/csharp.ts`) run inside the shared
  `matchPatterns()` engine.

### Attributes are the C# analogue of decorators

The parser attaches `[Attribute(...)]` groups to the type or method that
follows them, including attributes written on the same line as their member.
They are carried through the shared `PatternContext` on `functions[].decorators`
and `types[].decorators`, mirroring how Python decorators are handled. Bracket
nesting is counted and string literals skipped, so `[Route("api/[controller]")]`
parses correctly.

### Namespace gating

`usingNamespaces` matches a `using` declaration at or below the configured
namespace: `Microsoft.EntityFrameworkCore` matches a using of
`Microsoft.EntityFrameworkCore.SqlServer`. Rules that must also fire under .NET
6+ **implicit global usings** (where the `using` line is absent) leave
`usingNamespaces` empty and rely on a distinctive call shape instead — this is
how minimal APIs are detected.

### Comment handling

Sources are pre-processed by `stripCommentsPreservingLayout()` with
`verbatimStrings` enabled, so `@"C:\path"` literals survive and commented-out
routes produce no findings. Line numbers are preserved.

---

## Route / Handler Detection (`express_route`)

### ASP.NET Core MVC / Web API (attribute routing)

- **Detected when:** the file uses `Microsoft.AspNetCore.Mvc` and a method
  carries `[HttpGet]`, `[HttpPost]`, `[HttpPut]`, `[HttpDelete]`, `[HttpPatch]`,
  `[HttpHead]`, `[HttpOptions]`, or `[Route]`.
- **Controller prefix:** a type-level `[Route("api/[controller]")]` on a type
  marked `[ApiController]` or deriving from `ControllerBase` / `Controller` is
  expanded the way ASP.NET Core does — `[controller]` becomes the class name
  minus its `Controller` suffix — and joined with the action template.

```csharp
[ApiController]
[Route("api/[controller]")]
public class CustomersController : ControllerBase
{
    [HttpGet("{id}")]
    public IActionResult GetCustomer(int id) => Ok();
}
```

→ `express_route` named `GET api/Customers/{id}` with `properties`:
`framework: "aspnet_core_mvc"`, `httpMethods: ["GET"]`,
`path: "api/Customers/{id}"`, `handler: "GetCustomer"`,
`handlerType: "controller_action"`, `controller: "CustomersController"`.

### Minimal APIs

`app.MapGet("/health", ...)`, `MapPost`, `MapPut`, `MapDelete`, `MapPatch`, and
`MapMethods("/path", ...)`. Emitted with `handlerType: "minimal_api"`. Not
gated on a `using`, because .NET 6+ projects rely on implicit global usings.

### gRPC

`app.MapGrpcService<GreeterService>()` emits an `express_route` with
`defaultMethod: "RPC"`.

---

## Serverless Handlers (`lambda_handler`)

| Runtime | Detected when |
| --- | --- |
| Azure Functions | `[Function("Name")]` or `[FunctionName("Name")]` on a method |
| AWS Lambda (.NET) | `Amazon.Lambda.*` in scope and an `ILambdaContext` parameter, or a `[LambdaSerializer]` / `[LambdaFunction]` attribute |

**Emitted properties:** `framework`, `handler`, and `functionName` when the
attribute names the function.

---

## Database Connections (`database_connection`)

Detected from a `using`, a base type, or a call site.

| Client | `databaseType` | Signals |
| --- | --- | --- |
| EF Core | `sql` | `Microsoft.EntityFrameworkCore`, `DbContext` base type, `UseNpgsql` / `UseSqlServer` / `UseSqlite` / `UseMySql` / `UseCosmos` |
| SqlClient | `mssql` | `Microsoft.Data.SqlClient`, `SqlConnection` |
| Npgsql | `postgres` | `Npgsql`, `NpgsqlConnection` |
| MySqlConnector | `mysql` | `MySqlConnector`, `MySqlConnection` |
| Microsoft.Data.Sqlite | `sqlite` | `SqliteConnection` |
| Dapper | `sql` | `Dapper`, `QueryAsync` / `ExecuteAsync` |
| MongoDB.Driver | `mongodb` | `MongoClient` |
| StackExchange.Redis | `redis` | `ConnectionMultiplexer.Connect` |
| Azure Cosmos | `cosmosdb` | `Microsoft.Azure.Cosmos`, `CosmosClient` |
| Cassandra | `cassandra` | `Cluster.Builder` |

**Emitted properties:** `client`, `databaseType`.

---

## External API Calls (`external_api_call`)

Matched on call sites, gated on the client's namespace or a mention of the
client type. A literal URL in the arguments resolves the service name from the
third-party catalog.

| Client | Signals |
| --- | --- |
| HttpClient | `GetAsync` / `PostAsync` / `SendAsync` / `GetFromJsonAsync` / … |
| IHttpClientFactory | `AddHttpClient("name", c => c.BaseAddress = ...)` |
| RestSharp | `new RestClient("https://...")` |
| Flurl | `.GetJsonAsync()`, `.PostJsonAsync()` |
| Refit | `RestService.For<IApi>("https://...")` |

```csharp
await _client.PostAsync("https://api.stripe.com/v1/charges", null);
```

→ `external_api_call` with `properties.serviceName = "stripe"`.

NuGet package names also map to services: `Stripe.net` → `stripe`,
`Sentry.AspNetCore` → `sentry`, `AWSSDK.S3` → `aws`.

---

## Auth (`auth_middleware`)

| Rule | Signals | `strategy` |
| --- | --- | --- |
| ASP.NET Core authentication | `AddAuthentication`, `UseAuthorization`, … | `aspnet_core` |
| JWT bearer | `Microsoft.AspNetCore.Authentication.JwtBearer`, `AddJwtBearer`, `JwtSecurityTokenHandler` | `jwt` |
| ASP.NET Core Identity | `AddIdentity`, `AddDefaultIdentity` | `aspnet_identity` |
| `[Authorize]` attribute | on any type or method | `authorize_attribute` |

An `[Authorize("PolicyName")]` argument is recorded as `properties.policy`.

---

## Config and Environment (`config_file`, `env_variable`)

- `env_variable` from `Environment.GetEnvironmentVariable("KEY")`.
- `env_variable` from configuration access: `Configuration["Key"]`,
  `GetConnectionString("Name")`, `GetValue<T>("Key")`, `GetSection("Key")`.
  Keys are de-duplicated per file.
- `config_file` for `Startup.cs`, `Program.cs`, `*Settings.cs`, `*Options.cs`.

---

## Dependency Manifests and `appsettings.json`

`cli/src/analyzers/csharp/dependency-manifests.ts` walks the repository for:

- `*.csproj`, `*.fsproj`, `*.vbproj` — `<PackageReference Include="..." />`
- `Directory.Packages.props`, `Directory.Build.props` — `<PackageVersion ... />`
- `packages.config` — `<package id="..." />`
- `paket.dependencies` — `nuget <Name>`

Package names are matched against both the third-party catalog and the
`usingNamespaces` of the database and auth rules, since NuGet IDs and .NET
namespaces usually coincide (`Npgsql`, `MongoDB.Driver`, `StackExchange.Redis`).

`appsettings*.json` files are also collected. Each yields a `config_file`
finding, and every entry under `ConnectionStrings` yields a
`database_connection` finding with the engine inferred from the connection
string (`Host=`/`Port=5432` → postgres, `mongodb://` → mongodb,
`abortConnect=` → redis, `Initial Catalog=` → mssql, …).

**The raw connection string is never recorded** — connection strings routinely
embed credentials, so only the key name and the inferred `databaseType` are
emitted.

---

## File Types

The ingest layer maps `.cs`, `.cshtml`, and `.razor` to the `csharp` language.
Generated sources (`*.Designer.cs`, `*.g.cs`, `*.g.i.cs`, `*.AssemblyInfo.cs`)
and the `obj/` build directory are excluded by default. `bin/` is deliberately
**not** excluded — it is a common source directory outside .NET, and
`.gitignore` already covers it in .NET repositories.
