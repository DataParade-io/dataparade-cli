import type { PatternContext } from "../engine";
import type { UnifiedPatternConfig } from "../config";
import { defaultServiceNameFromLiteralPublicUrl } from "../../classifier/external-url-third-party";
import type { RawFinding } from "../../core/types/detection";
import {
  buildThirdPartyUrlHostPatterns,
  inferServiceNameFromUrl,
} from "./helpers";

/**
 * Match a Go import path against a configured path, exactly or as a path
 * prefix. The prefix rule is what makes module major versions and
 * sub-packages work: `github.com/jackc/pgx` matches
 * `github.com/jackc/pgx/v5/pgxpool`.
 */
function importMatchesPath(importPath: string, want: string): boolean {
  if (!want) return false;
  return importPath === want || importPath.startsWith(`${want}/`);
}

function hasAnyImport(ctx: PatternContext, paths: string[]): boolean {
  if (paths.length === 0) return false;
  const imports = ctx.imports ?? [];
  return imports.some((imp) =>
    paths.some((want) => importMatchesPath(imp.module, want)),
  );
}

function sourceOf(ctx: PatternContext): string {
  return ctx.strippedContent ?? ctx.file.content ?? "";
}

function callNameRegex(callNames: string[]): RegExp {
  const escaped = callNames.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`(?:^|[^A-Za-z0-9_.])(?:${escaped.join("|")})\\s*[({]`);
}

export function detectGoDatabaseConnectionsFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "go") return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const db of config.go.dbClients) {
    const hasImport = hasAnyImport(ctx, db.importPaths);
    const hasCall =
      db.callNames.length > 0 && callNameRegex(db.callNames).test(content);

    if (!hasImport && !hasCall) continue;

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

  // `database/sql` names its engine in the first argument of sql.Open.
  const sqlOpen = config.go.sqlOpen;
  if (sqlOpen) {
    const lines = content.split(/\r?\n/);
    const seenDrivers = new Set<string>();

    for (let i = 0; i < lines.length; i += 1) {
      const match = sqlOpen.regex.exec(lines[i]);
      if (!match) continue;

      const driver = (match[1] ?? "").trim();
      if (!driver || seenDrivers.has(driver)) continue;
      seenDrivers.add(driver);

      const databaseType =
        sqlOpen.drivers[driver.toLowerCase()] ?? sqlOpen.defaultDatabaseType;

      findings.push({
        pattern: sqlOpen.patternId,
        name: `${sqlOpen.name}:${driver}`,
        confidence: sqlOpen.confidence,
        location: {
          filePath: ctx.file.path,
          startLine: i + 1,
          endLine: i + 1,
          code: lines[i].trim(),
        },
        properties: {
          client: sqlOpen.name,
          databaseType,
          driver,
        },
      });
    }
  }

  return findings;
}

export function detectGoAuthFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "go") return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const lib of config.go.auth.libraries) {
    const hasImport = hasAnyImport(ctx, lib.importPaths);
    const hasCall =
      lib.callNames.length > 0 && callNameRegex(lib.callNames).test(content);
    const matchesContent =
      lib.contentRegexes.length > 0 &&
      lib.contentRegexes.some((re) => re.test(content));

    if (!hasImport && !hasCall && !matchesContent) continue;

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

export function detectGoEnvAndConfigFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "go") return [];

  const envCfg = config.go.envConfig;
  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  if (envCfg.envVariable) {
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const match = envCfg.envVariable.regex.exec(line);
      if (!match) continue;

      const key = match[1];
      findings.push({
        pattern: envCfg.envVariable.patternId,
        name: key ? `os.Getenv(${key})` : "env_variable",
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
      const hasImport = hasAnyImport(ctx, loader.importPaths);
      const hasCall =
        loader.callNames.length > 0 &&
        callNameRegex(loader.callNames).test(content);

      if (!hasImport && !hasCall) continue;

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

export function detectGoRoutesFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "go") return [];

  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (const fw of config.go.routes.frameworks) {
    const supportsFramework =
      fw.importPaths.length === 0 || hasAnyImport(ctx, fw.importPaths);
    if (!supportsFramework) continue;

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

export function detectGoServerlessHandlersFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "go") return [];

  const calls = ctx.moduleLevelCalls ?? [];
  const findings: RawFinding[] = [];

  for (const handler of config.go.serverless.handlers) {
    const hasImport = hasAnyImport(ctx, handler.importPaths);
    if (!hasImport) continue;

    for (const call of calls) {
      const callee = call.callee ?? "";
      if (!handler.callNames.some((name) => callee === name)) continue;

      findings.push({
        pattern: handler.patternId,
        name: `${handler.id} ${callee}`,
        confidence: handler.confidence,
        location: call.location,
        properties: {
          framework: handler.id,
          handler: callee,
        },
      });
    }
  }

  return findings;
}

export function detectGoExternalApisFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "go") return [];

  const calls = ctx.moduleLevelCalls ?? [];
  if (calls.length === 0) return [];

  const findings: RawFinding[] = [];
  const urlHostPatterns = buildThirdPartyUrlHostPatterns(config);

  for (const client of config.go.externalApis.httpClients) {
    const supportsClient =
      client.importPaths.length === 0 || hasAnyImport(ctx, client.importPaths);
    if (!supportsClient) continue;

    for (const call of calls) {
      const callee = call.callee ?? "";
      const matchesCallName = client.callNames.some((name) => callee === name);
      const matchesSuffix = client.callNameSuffixes.some((suffix) =>
        callee.endsWith(suffix),
      );
      if (!matchesCallName && !matchesSuffix) continue;

      const snippet = call.argumentsSnippet ?? "";
      const match = client.urlRegex.exec(snippet);
      const url = match?.[1];

      const serviceName =
        inferServiceNameFromUrl(url, urlHostPatterns) ??
        defaultServiceNameFromLiteralPublicUrl(url) ??
        client.clientName;

      findings.push({
        pattern: client.patternId,
        name: `${client.clientName}_call`,
        confidence: client.confidence,
        location: call.location,
        properties: {
          ...(url ? { url } : {}),
          ...(serviceName ? { serviceName } : {}),
        },
      });
    }
  }

  return findings;
}
