import path from "path";

import {
  detectDotnetPatternsFromManifests,
  parseDotnetDependencyManifests,
} from "../../../../src/analyzers/csharp/dependency-manifests";
import {
  extractConnectionStringsFromAppSettings,
  extractPackagesFromPackagesConfig,
  extractPackagesFromPaketDependencies,
  extractPackagesFromProjectFile,
  inferDatabaseTypeFromConnectionString,
} from "../../../../src/analyzers/csharp/manifest-parsers";

const FIXTURE_ROOT = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "dotnet-manifests-basic",
);

describe(".NET manifest parsers", () => {
  it("extracts PackageReference and PackageVersion entries", () => {
    const content = [
      "<Project>",
      "  <ItemGroup>",
      '    <PackageReference Include="Stripe.net" Version="43.20.0" />',
      '    <PackageVersion Include="Serilog" Version="3.1.1" />',
      '    <ProjectReference Include="..\\Core\\Core.csproj" />',
      "  </ItemGroup>",
      "</Project>",
    ].join("\n");

    expect(extractPackagesFromProjectFile(content).sort()).toEqual([
      "Serilog",
      "Stripe.net",
    ]);
  });

  it("extracts legacy packages.config and paket dependencies", () => {
    expect(
      extractPackagesFromPackagesConfig(
        '<packages><package id="Newtonsoft.Json" version="13.0.1" /></packages>',
      ),
    ).toEqual(["Newtonsoft.Json"]);

    expect(
      extractPackagesFromPaketDependencies(
        ["source https://api.nuget.org/v3/index.json", "nuget Stripe.net >= 43.0"].join(
          "\n",
        ),
      ),
    ).toEqual(["Stripe.net"]);
  });

  it("infers the database engine from connection strings", () => {
    expect(
      inferDatabaseTypeFromConnectionString("Host=localhost;Port=5432;Database=app"),
    ).toBe("postgres");
    expect(
      inferDatabaseTypeFromConnectionString("mongodb://localhost:27017/app"),
    ).toBe("mongodb");
    expect(
      inferDatabaseTypeFromConnectionString("localhost:6379,abortConnect=false"),
    ).toBe("redis");
    expect(
      inferDatabaseTypeFromConnectionString(
        "Server=tcp:db;Initial Catalog=app;Integrated Security=true",
      ),
    ).toBe("mssql");
  });

  it("reads ConnectionStrings without exposing the raw value", () => {
    const content = JSON.stringify({
      ConnectionStrings: {
        DefaultConnection: "Host=db;Username=app;Password=secret",
      },
    });

    const connections = extractConnectionStringsFromAppSettings(content);

    expect(connections).toEqual([
      { name: "DefaultConnection", databaseType: "postgres" },
    ]);
    expect(JSON.stringify(connections)).not.toContain("secret");
  });
});

describe(".NET manifest scanning", () => {
  it("collects NuGet packages from project files", async () => {
    const manifests = await parseDotnetDependencyManifests(FIXTURE_ROOT);

    expect(manifests.length).toBe(1);
    expect(manifests[0].manifestRelativePath).toBe("src/Api/Api.csproj");
    expect(manifests[0].packages).toEqual(
      expect.arrayContaining([
        "Stripe.net",
        "Sentry.AspNetCore",
        "AWSSDK.S3",
        "Npgsql.EntityFrameworkCore.PostgreSQL",
      ]),
    );
  });

  it("maps packages to third-party services and appsettings to config and databases", async () => {
    const findings = await detectDotnetPatternsFromManifests(FIXTURE_ROOT);

    const serviceNames = findings
      .filter((f) => f.pattern === "external_api_call")
      .map((f) => f.properties.serviceName);
    expect(serviceNames).toEqual(
      expect.arrayContaining(["stripe", "sentry", "aws"]),
    );

    const configFiles = findings.filter((f) => f.pattern === "config_file");
    expect(configFiles.map((f) => f.name)).toContain("appsettings.json");

    const connectionFindings = findings.filter(
      (f) => f.properties.client === "appsettings_connection_string",
    );
    expect(
      connectionFindings.map((f) => [f.name, f.properties.databaseType]),
    ).toEqual(
      expect.arrayContaining([
        ["DefaultConnection", "postgres"],
        ["Cache", "redis"],
      ]),
    );
  });
});
