/**
 * Dependency extraction for Composer manifests.
 *
 * `composer.json` is the package root for a PHP service. Package names
 * (`guzzlehttp/guzzle`) are distinct from PSR namespaces (`GuzzleHttp\Client`)
 * — detectors match them via `packageNames` vs `importNamespaces`.
 */

export interface ComposerManifest {
  /** `name` field, e.g. `acme/billing`. */
  name?: string;
  /** Package names from `require` and `require-dev`, versions stripped. */
  packages: string[];
}

function isComposerPackageName(token: string): boolean {
  if (!token || token === "php" || token.startsWith("ext-")) return false;
  // Composer packages are `vendor/package`; platform reqs like `php` are skipped.
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(token);
}

export function parseComposerJson(content: string): ComposerManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { packages: [] };
  }

  if (!parsed || typeof parsed !== "object") {
    return { packages: [] };
  }

  const obj = parsed as {
    name?: unknown;
    require?: unknown;
    "require-dev"?: unknown;
  };

  const packages = new Set<string>();

  for (const section of [obj.require, obj["require-dev"]]) {
    if (!section || typeof section !== "object") continue;
    for (const key of Object.keys(section as Record<string, unknown>)) {
      if (isComposerPackageName(key)) packages.add(key);
    }
  }

  const name =
    typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : undefined;

  return { name, packages: Array.from(packages) };
}
