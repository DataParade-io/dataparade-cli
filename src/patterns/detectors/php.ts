import type { PatternContext } from "../engine";
import type { UnifiedPatternConfig } from "../config";
import { defaultServiceNameFromLiteralPublicUrl } from "../../classifier/external-url-third-party";
import type { RawFinding } from "../../core/types/detection";
import {
  buildThirdPartyUrlHostPatterns,
  inferServiceNameFromUrl,
} from "./helpers";

/**
 * Match a PHP `use` namespace against a configured prefix.
 * `Illuminate\Database` matches `Illuminate\Database\Eloquent\Model`.
 */
function namespaceMatches(importPath: string, want: string): boolean {
  if (!want) return false;
  if (importPath === want) return true;
  return (
    importPath.startsWith(`${want}\\`) || importPath.endsWith(`\\${want}`)
  );
}

function hasAnyNamespace(ctx: PatternContext, namespaces: string[]): boolean {
  if (namespaces.length === 0) return false;
  const imports = ctx.imports ?? [];
  return imports.some((imp) =>
    namespaces.some((want) => namespaceMatches(imp.module, want)),
  );
}

/**
 * Composer package names use `/` (`guzzlehttp/guzzle`). That keeps them
 * disjoint from PSR namespaces (`GuzzleHttp\Client`), which use `\`.
 */
function hasAnyPackageName(ctx: PatternContext, packageNames: string[]): boolean {
  if (packageNames.length === 0) return false;
  const imports = ctx.imports ?? [];
  return imports.some((imp) => {
    if (!imp.module.includes("/")) return false;
    return packageNames.some(
      (want) => imp.module === want || imp.module.startsWith(`${want}/`),
    );
  });
}

function sourceOf(ctx: PatternContext): string {
  return ctx.strippedContent ?? ctx.file.content ?? "";
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a content-scan regex for configured call names.
 * - Strips a trailing `(` / `{` so YAML can list either `config` or `config(`.
 * - `new Class` also matches `new \Class`.
 * - Names ending in `::` match any method (`Eloquent::unguard()`).
 * - Names starting with `->` allow a receiver before the arrow (`$c->get(`).
 */
function callNameRegex(callNames: string[]): RegExp {
  const parts = callNames
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .map((raw) => {
      const name = raw.replace(/[({]+$/, "");
      if (!name) return null;

      if (name.startsWith("new ")) {
        const className = name.slice(4).replace(/^\\+/, "");
        return `new\\s+\\\\?${escapeRegexLiteral(className)}`;
      }

      if (name.endsWith("::")) {
        return `${escapeRegexLiteral(name)}\\w+`;
      }

      if (name.startsWith("->")) {
        // Allow `$client->get(` / `$client?->get(` — word char before `->`.
        return `\\??${escapeRegexLiteral(name)}`;
      }

      return escapeRegexLiteral(name);
    })
    .filter((part): part is string => part != null);

  if (parts.length === 0) return /(?!)/; // never matches

  const hasArrowOnly = parts.every((part) => part.includes("->"));
  if (hasArrowOnly) {
    return new RegExp(`(?:${parts.join("|")})\\s*[({]`);
  }

  // Mix of arrow and non-arrow: wrap arrow parts without the strict prefix.
  const alternation = parts
    .map((part) =>
      part.includes("->")
        ? part
        : `(?:^|[^A-Za-z0-9_\\\\])${part}`,
    )
    .join("|");
  return new RegExp(`(?:${alternation})\\s*[({]`);
}

/** Normalize `new \Foo` → `new Foo` so FQCN builtins match configured call names. */
function normalizeCallee(callee: string): string {
  return callee.replace(/^new\s+\\+/, "new ");
}

function calleeMatches(
  callee: string,
  callNames: string[],
  suffixes: string[],
): boolean {
  const normalized = normalizeCallee(callee);
  if (
    callNames.some(
      (name) =>
        normalized === name ||
        callee === name ||
        normalized.endsWith(name) ||
        callee.endsWith(name),
    )
  ) {
    return true;
  }
  return suffixes.some(
    (suffix) => normalized.endsWith(suffix) || callee.endsWith(suffix),
  );
}

export function detectPhpDatabaseConnectionsFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "php") return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const db of config.php.dbClients) {
    const hasImport = hasAnyNamespace(ctx, db.importNamespaces);
    const hasPackage = hasAnyPackageName(ctx, db.packageNames);
    const hasCall =
      db.callNames.length > 0 && callNameRegex(db.callNames).test(content);

    const gated =
      db.importNamespaces.length > 0 || db.packageNames.length > 0;
    if (gated) {
      // Import/package required — avoids `new Client()` matching Predis/Guzzle/etc.
      if (!hasImport && !hasPackage) continue;
    } else if (!hasCall) {
      continue;
    }

    findings.push({
      pattern: db.patternId,
      name: db.id,
      confidence: db.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: 1,
        endLine: 1,
      },
      properties: {
        client: db.id,
        databaseType: db.databaseType,
      },
    });
  }

  const pdoDsn = config.php.pdoDsn;
  if (pdoDsn) {
    const lines = content.split(/\r?\n/);
    const seenDrivers = new Set<string>();

    for (let i = 0; i < lines.length; i += 1) {
      const match = pdoDsn.regex.exec(lines[i]);
      if (!match) continue;

      const dsn = (match[1] ?? "").trim();
      const driver = dsn.split(":")[0]?.toLowerCase() ?? "";
      if (!driver || seenDrivers.has(driver)) continue;
      seenDrivers.add(driver);

      const databaseType =
        pdoDsn.drivers[driver] ?? pdoDsn.defaultDatabaseType;

      findings.push({
        pattern: pdoDsn.patternId,
        name: `${pdoDsn.name}:${driver}`,
        confidence: pdoDsn.confidence,
        location: {
          filePath: ctx.file.path,
          startLine: i + 1,
          endLine: i + 1,
          code: lines[i].trim(),
        },
        properties: {
          client: pdoDsn.name,
          databaseType,
          driver,
          dsn,
        },
      });
    }
  }

  return findings;
}

export function detectPhpAuthFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "php") return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const lib of config.php.auth.libraries) {
    const hasImport = hasAnyNamespace(ctx, lib.importNamespaces);
    const hasPackage = hasAnyPackageName(ctx, lib.packageNames);
    const hasCall =
      lib.callNames.length > 0 && callNameRegex(lib.callNames).test(content);
    const matchesContent =
      lib.contentRegexes.length > 0 &&
      lib.contentRegexes.some((re) => re.test(content));

    if (!hasImport && !hasPackage && !hasCall && !matchesContent) continue;

    findings.push({
      pattern: lib.patternId,
      name: lib.id,
      confidence: lib.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: 1,
        endLine: 1,
      },
      properties: {
        ...(lib.strategy ? { strategy: lib.strategy } : {}),
      },
    });
  }

  return findings;
}

export function detectPhpEnvAndConfigFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "php") return [];

  const envCfg = config.php.envConfig;
  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  if (envCfg.envVariable) {
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const match = envCfg.envVariable.regex.exec(line);
      if (!match) continue;

      const key = match[1] || match[2];
      findings.push({
        pattern: envCfg.envVariable.patternId,
        name: key ? `env(${key})` : "env_variable",
        confidence: envCfg.envVariable.confidence,
        location: {
          filePath: ctx.file.path,
          startLine: i + 1,
          endLine: i + 1,
          code: line.trim(),
        },
        properties: key ? { key } : {},
      });
    }
  }

  if (envCfg.configLoaders) {
    for (const loader of envCfg.configLoaders.loaders) {
      const hasImport = hasAnyNamespace(ctx, loader.importNamespaces);
      const hasPackage = hasAnyPackageName(ctx, loader.packageNames);
      const hasCall =
        loader.callNames.length > 0 &&
        callNameRegex(loader.callNames).test(content);

      if (!hasImport && !hasPackage && !hasCall) continue;

      findings.push({
        pattern: envCfg.configLoaders.patternId,
        name: loader.id,
        confidence: envCfg.configLoaders.confidence,
        location: {
          filePath: ctx.file.path,
          startLine: 1,
          endLine: 1,
        },
        properties: {},
      });
    }
  }

  if (envCfg.configFile) {
    const normalizedPath = (ctx.normalizedPath ?? ctx.file.path).toLowerCase();
    if (envCfg.configFile.fileNameRegex.test(normalizedPath)) {
      findings.push({
        pattern: envCfg.configFile.patternId,
        name: envCfg.configFile.name,
        confidence: envCfg.configFile.confidence,
        location: {
          filePath: ctx.file.path,
          startLine: 1,
          endLine: 1,
        },
        properties: {},
      });
    }
  }

  return findings;
}

export function detectPhpRoutesFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "php") return [];

  const strippedLines = sourceOf(ctx).split(/\r?\n/);
  // Symfony @Route annotations live inside docblocks, which stripping removes.
  // Scan raw source for that framework only; attributes survive hash-comment stripping.
  const rawLines = (ctx.file.content ?? "").split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (const fw of config.php.routes.frameworks) {
    const gated =
      fw.importNamespaces.length > 0 || fw.packageNames.length > 0;
    const supportsFramework =
      !gated ||
      hasAnyNamespace(ctx, fw.importNamespaces) ||
      hasAnyPackageName(ctx, fw.packageNames);
    if (!supportsFramework) continue;

    const lines = fw.id === "symfony" ? rawLines : strippedLines;

    for (const routeRegex of fw.routeRegexes) {
      for (let i = 0; i < lines.length; i += 1) {
        const text = lines[i].trim();
        if (!text) continue;

        const match = routeRegex.regex.exec(text);
        if (!match) continue;

        const rawMethod =
          routeRegex.methodGroup != null
            ? match[routeRegex.methodGroup]
            : routeRegex.defaultMethod;
        const method = rawMethod ? rawMethod.toUpperCase() : undefined;
        const routePath =
          routeRegex.pathGroup != null ? match[routeRegex.pathGroup] : undefined;

        const name = method
          ? `${method} ${routePath ?? ""}`.trim()
          : `${fw.id.toUpperCase()}_ROUTE ${routePath ?? ""}`.trim();

        findings.push({
          pattern: fw.patternId,
          name,
          confidence: fw.confidence,
          location: {
            filePath: ctx.file.path,
            startLine: i + 1,
            endLine: i + 1,
            code: text,
          },
          properties: {
            framework: fw.id,
            httpMethods: method ? [method] : [],
            ...(routePath ? { path: routePath } : {}),
          },
        });
      }
    }
  }

  return findings;
}

export function detectPhpServerlessHandlersFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "php") return [];

  const findings: RawFinding[] = [];

  for (const handler of config.php.serverless.handlers) {
    const hasImport = hasAnyNamespace(ctx, handler.importNamespaces);
    const hasPackage = hasAnyPackageName(ctx, handler.packageNames);
    if (!hasImport && !hasPackage) continue;

    findings.push({
      pattern: handler.patternId,
      name: handler.id,
      confidence: handler.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: 1,
        endLine: 1,
      },
      properties: {
        framework: handler.id,
      },
    });
  }

  return findings;
}

export function detectPhpExternalApisFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "php") return [];

  const calls = ctx.moduleLevelCalls ?? [];
  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];
  const urlHostPatterns = buildThirdPartyUrlHostPatterns(config);

  for (const client of config.php.externalApis.httpClients) {
    const gated =
      client.importNamespaces.length > 0 || client.packageNames.length > 0;
    const supportsClient =
      !gated ||
      hasAnyNamespace(ctx, client.importNamespaces) ||
      hasAnyPackageName(ctx, client.packageNames);
    if (!supportsClient) continue;

    let emitted = false;
    const seenKeys = new Set<string>();
    const clientFindings: RawFinding[] = [];

    for (const call of calls) {
      const callee = call.callee ?? "";
      if (!calleeMatches(callee, client.callNames, client.callNameSuffixes)) {
        continue;
      }

      const snippet = call.argumentsSnippet ?? "";
      const match = client.urlRegex.exec(snippet);
      const url = match?.[1];

      const serviceName =
        inferServiceNameFromUrl(url, urlHostPatterns) ??
        defaultServiceNameFromLiteralPublicUrl(url) ??
        client.clientName;

      const dedupeKey = `${client.clientName}|${url ?? ""}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      clientFindings.push({
        pattern: client.patternId,
        name: `${client.clientName}_call`,
        confidence: client.confidence,
        location: call.location,
        properties: {
          ...(url ? { url } : {}),
          ...(serviceName ? { serviceName } : {}),
        },
      });
      emitted = true;
    }

    // Prefer URL-bearing findings when both empty-URL and URL hits exist
    // (e.g. curl_init + curl_setopt with CURLOPT_URL).
    const hasUrlFinding = clientFindings.some((f) => f.properties.url);
    let kept = hasUrlFinding
      ? clientFindings.filter((f) => f.properties.url)
      : clientFindings;

    // Multiline calls often leave the URL off the callee line; pull it from content.
    if (kept.length > 0 && !kept.some((f) => f.properties.url)) {
      const urlMatch = client.urlRegex.exec(content);
      const url = urlMatch?.[1];
      if (url) {
        const serviceName =
          inferServiceNameFromUrl(url, urlHostPatterns) ??
          defaultServiceNameFromLiteralPublicUrl(url) ??
          client.clientName;
        kept = [
          {
            ...kept[0],
            properties: {
              ...kept[0].properties,
              url,
              ...(serviceName ? { serviceName } : {}),
            },
          },
        ];
      }
    }

    findings.push(...kept);

    // Fallback: import/package present and callNames appear in content
    // (covers curl_setopt where the URL is on a separate line).
    if (!emitted && client.callNames.length > 0) {
      if (callNameRegex(client.callNames).test(content)) {
        const urlMatch = client.urlRegex.exec(content);
        const url = urlMatch?.[1];
        const serviceName =
          inferServiceNameFromUrl(url, urlHostPatterns) ??
          defaultServiceNameFromLiteralPublicUrl(url) ??
          client.clientName;

        findings.push({
          pattern: client.patternId,
          name: `${client.clientName}_call`,
          confidence: client.confidence,
          location: {
            filePath: ctx.file.path,
            startLine: 1,
            endLine: 1,
          },
          properties: {
            ...(url ? { url } : {}),
            ...(serviceName ? { serviceName } : {}),
          },
        });
        emitted = true;
      }
    }

    // SDK presence (e.g. aws_s3): gated import/package alone emits when opted in.
    if (!emitted && client.emitOnPresence && gated) {
      const hasImport = hasAnyNamespace(ctx, client.importNamespaces);
      const hasPackage = hasAnyPackageName(ctx, client.packageNames);
      if (hasImport || hasPackage) {
        findings.push({
          pattern: client.patternId,
          name: `${client.clientName}_client`,
          confidence: client.confidence,
          location: {
            filePath: ctx.file.path,
            startLine: 1,
            endLine: 1,
          },
          properties: {
            serviceName: client.clientName,
            client: client.id,
          },
        });
      }
    }
  }

  return findings;
}
