/**
 * Dependency extraction for .NET project manifests.
 *
 * Covers SDK-style project files (`<PackageReference Include="..." />`),
 * central package management (`Directory.Packages.props`), legacy
 * `packages.config`, and Paket dependency files.
 */

function normalizePackageToken(raw: string): string | null {
  const token = raw.trim();
  if (!token) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(token)) return null;
  return token;
}

/**
 * `*.csproj` / `*.fsproj` / `*.vbproj` / `Directory.Packages.props`:
 * `<PackageReference Include="Stripe.net" Version="43.0.0" />` and the
 * central-package-management `<PackageVersion Include="..." />` form.
 */
export function extractPackagesFromProjectFile(content: string): string[] {
  const packages = new Set<string>();
  const regex =
    /<(?:PackageReference|PackageVersion|GlobalPackageReference)\s[^>]*(?:Include|Update)\s*=\s*"([^"]+)"/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const token = normalizePackageToken(match[1]);
    if (token) packages.add(token);
  }

  return Array.from(packages);
}

/** Legacy `packages.config`: `<package id="Newtonsoft.Json" version="13.0.1" />`. */
export function extractPackagesFromPackagesConfig(content: string): string[] {
  const packages = new Set<string>();
  const regex = /<package\s[^>]*id\s*=\s*"([^"]+)"/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const token = normalizePackageToken(match[1]);
    if (token) packages.add(token);
  }

  return Array.from(packages);
}

/** `paket.dependencies`: `nuget Stripe.net >= 43.0`. */
export function extractPackagesFromPaketDependencies(
  content: string,
): string[] {
  const packages = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^nuget\s+([A-Za-z0-9][A-Za-z0-9_.-]*)/i);
    if (!match) continue;

    const token = normalizePackageToken(match[1]);
    if (token) packages.add(token);
  }

  return Array.from(packages);
}

export interface AppSettingsConnectionString {
  /** The key under `ConnectionStrings`, e.g. `DefaultConnection`. */
  name: string;
  databaseType: string;
}

/**
 * Infer the engine behind an ADO.NET-style connection string.
 *
 * Only the inferred engine is returned — connection strings routinely embed
 * credentials, so the raw value never leaves this function.
 */
export function inferDatabaseTypeFromConnectionString(value: string): string {
  const lower = value.toLowerCase();

  if (lower.includes("mongodb://") || lower.includes("mongodb+srv://")) {
    return "mongodb";
  }
  if (lower.includes("accountendpoint=") && lower.includes("documents.azure.com")) {
    return "cosmosdb";
  }
  if (lower.includes("abortconnect=") || /(^|[,;])\s*[^,;]*:6379\b/.test(lower)) {
    return "redis";
  }
  if (
    lower.includes("host=") ||
    lower.includes("postgres") ||
    lower.includes("port=5432")
  ) {
    return "postgres";
  }
  if (lower.includes("uid=") || lower.includes("mysql") || lower.includes("port=3306")) {
    return "mysql";
  }
  if (lower.includes(".db") || lower.includes("sqlite")) {
    return "sqlite";
  }
  if (
    lower.includes("initial catalog=") ||
    lower.includes("integrated security=") ||
    lower.includes("trustservercertificate=") ||
    lower.includes("server=")
  ) {
    return "mssql";
  }

  return "sql";
}

/**
 * `appsettings*.json` — the `ConnectionStrings` section names the databases a
 * .NET service talks to, which is often the only place they are declared.
 */
export function extractConnectionStringsFromAppSettings(
  content: string,
): AppSettingsConnectionString[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object") return [];

  const section = (parsed as { ConnectionStrings?: unknown }).ConnectionStrings;
  if (!section || typeof section !== "object") return [];

  const results: AppSettingsConnectionString[] = [];
  for (const [name, value] of Object.entries(
    section as Record<string, unknown>,
  )) {
    if (typeof value !== "string" || !value.trim()) continue;
    results.push({
      name,
      databaseType: inferDatabaseTypeFromConnectionString(value),
    });
  }

  return results;
}

