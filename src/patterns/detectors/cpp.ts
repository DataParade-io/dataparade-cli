import type { PatternContext } from "../engine";
import type { UnifiedPatternConfig } from "../config";
import { defaultServiceNameFromLiteralPublicUrl } from "../../classifier/external-url-third-party";
import type { RawFinding } from "../../core/types/detection";
import {
  buildThirdPartyUrlHostPatterns,
  inferServiceNameFromUrl,
} from "./helpers";

/**
 * Match an `#include` path against a configured header.
 *
 * A configured value containing "/" is matched as a substring
 * (`curl/curl.h` matches `<curl/curl.h>`); a bare value must match a whole
 * path segment, so `sql.h` does not match `<mysql/mysql.h>`.
 */
function includeMatchesHeader(includePath: string, want: string): boolean {
  if (!want) return false;
  const header = includePath.toLowerCase();
  if (want.includes("/")) return header.includes(want);
  return header === want || header.split("/").includes(want);
}

function hasAnyHeader(
  ctx: PatternContext,
  headers: string[],
): boolean {
  if (headers.length === 0) return false;
  const imports = ctx.imports ?? [];
  return imports.some((imp) =>
    headers.some((want) => includeMatchesHeader(imp.module, want)),
  );
}

/**
 * Match dependency-manifest entries (vcpkg/Conan/CMake package names), which
 * are supplied as imports by the manifest scanner. Package names rarely equal
 * header paths, so this is a distinct signal from `includeHeaders`.
 */
function hasAnyPackage(ctx: PatternContext, packageNames: string[]): boolean {
  if (packageNames.length === 0) return false;
  const imports = ctx.imports ?? [];
  return imports.some((imp) =>
    packageNames.includes(imp.module.toLowerCase()),
  );
}

function sourceOf(ctx: PatternContext): string {
  return ctx.strippedContent ?? ctx.file.content ?? "";
}

function callNameRegex(callNames: string[]): RegExp {
  const escaped = callNames.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`(?:^|[^A-Za-z0-9_])(?:${escaped.join("|")})\\s*[({]`);
}

export function detectCppDatabaseConnectionsFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "cpp") return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const db of config.cpp.dbClients) {
    const hasInclude = hasAnyHeader(ctx, db.includeHeaders);
    const hasPackage = hasAnyPackage(ctx, db.packageNames);

    let hasCall = false;
    if (db.callNames.length > 0) {
      hasCall = callNameRegex(db.callNames).test(content);
    }
    if (!hasCall && db.callNamePrefixes.length > 0) {
      hasCall = db.callNamePrefixes.some((prefix) => content.includes(prefix));
    }

    const matchesContent =
      db.contentRegexes.length > 0 &&
      db.contentRegexes.some((re) => re.test(content));

    if (!hasInclude && !hasPackage && !hasCall && !matchesContent) continue;

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

  return findings;
}

export function detectCppAuthFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "cpp") return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const lib of config.cpp.auth.libraries) {
    const hasInclude = hasAnyHeader(ctx, lib.includeHeaders);
    const hasPackage = hasAnyPackage(ctx, lib.packageNames);
    const hasCall =
      lib.callNames.length > 0 && callNameRegex(lib.callNames).test(content);
    const matchesContent =
      lib.contentRegexes.length > 0 &&
      lib.contentRegexes.some((re) => re.test(content));

    if (!hasInclude && !hasPackage && !hasCall && !matchesContent) continue;

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

export function detectCppEnvAndConfigFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "cpp") return [];

  const envCfg = config.cpp.envConfig;
  const findings: RawFinding[] = [];

  if (envCfg.envVariable) {
    const lines = sourceOf(ctx).split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const match = envCfg.envVariable.regex.exec(line);
      if (!match) continue;

      const key = match[1];

      findings.push({
        pattern: envCfg.envVariable.patternId,
        name: key ? `getenv(${key})` : "env_variable",
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

export function detectCppRoutesFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "cpp") return [];

  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (const fw of config.cpp.routes.frameworks) {
    const supportsFramework =
      fw.includeHeaders.length === 0 || hasAnyHeader(ctx, fw.includeHeaders);
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

export function detectCppExternalApisFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "cpp") return [];

  const calls = ctx.moduleLevelCalls ?? [];
  if (calls.length === 0) return [];

  const findings: RawFinding[] = [];
  const urlHostPatterns = buildThirdPartyUrlHostPatterns(config);

  for (const client of config.cpp.externalApis.httpClients) {
    const supportsClient =
      client.includeHeaders.length === 0 ||
      hasAnyHeader(ctx, client.includeHeaders);
    if (!supportsClient) continue;

    for (const call of calls) {
      const callee = call.callee ?? "";
      const matchesCallName = client.callNames.some((name) => callee === name);
      const matchesPrefix = client.callNamePrefixes.some((prefix) =>
        callee.startsWith(prefix),
      );
      if (!matchesCallName && !matchesPrefix) continue;

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
