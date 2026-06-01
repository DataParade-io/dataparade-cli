import {
  defaultServiceNameFromLiteralPublicUrl,
  shouldIgnoreExternalHttpUrl,
} from "../../classifier/external-url-third-party";
import type { PatternContext } from "../../patterns/engine";
import type { UnifiedPatternConfig } from "../config";
import type { RawFinding } from "../../core/types/detection";
import {
  buildThirdPartyUrlHostPatterns,
  createLocationFromLine,
  findLineMatches,
  inferServiceNameFromUrl,
} from "./helpers";

export function detectTypeScriptJavaScriptExternalApisFromHttpClients(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (
    (ctx.language !== "typescript" && ctx.language !== "javascript") ||
    !ctx.includeThirdPartyHttpLinePatterns
  ) {
    return [];
  }

  const content = ctx.file.content ?? "";
  const findings: RawFinding[] = [];
  const urlHostPatterns = buildThirdPartyUrlHostPatterns(config);

  for (const client of config.thirdParty.httpClients) {
    for (const regex of client.callRegexes) {
      const httpMatches = findLineMatches(content, regex);
      for (const { line, match } of httpMatches) {
        const [, clientName, methodMaybe, url] = match;
        if (shouldIgnoreExternalHttpUrl(url)) {
          continue;
        }
        const method =
          typeof methodMaybe === "string"
            ? methodMaybe.toUpperCase()
            : undefined;

        const serviceName =
          inferServiceNameFromUrl(url, urlHostPatterns) ??
          defaultServiceNameFromLiteralPublicUrl(url);

        findings.push({
          pattern: client.patternId,
          name: url,
          confidence: client.confidence,
          location: createLocationFromLine(ctx.file, line, match[0]),
          properties: {
            client: clientName,
            url,
            httpMethod: method,
            ...(serviceName ? { serviceName } : {}),
          },
        });
      }
    }
  }

  return findings;
}

export function detectTypeScriptRoutesFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (
    (ctx.language !== "typescript" && ctx.language !== "javascript") ||
    !ctx.normalizedPath
  ) {
    return [];
  }

  const content = ctx.file.content ?? "";
  const findings: RawFinding[] = [];
  const tsCfg = config.typescript;

  for (const fw of tsCfg.routes.frameworks) {
    const hasFrameworkImport =
      fw.imports.length === 0
        ? false
        : fw.imports.some((mod) =>
            (ctx.imports ?? []).some(
              (imp) =>
                imp.module === mod ||
                imp.module.includes(mod) ||
                imp.names.some((name) => name === mod || name.includes(mod)),
            ),
          );

    if (!hasFrameworkImport) continue;

    if (fw.id === "express") {
      for (const regex of fw.routeCallRegexes) {
        const matches = findLineMatches(content, regex);
        for (const { line, match } of matches) {
          const [, , method, path] = match;
          const upperMethod =
            typeof method === "string" && method.toUpperCase
              ? method.toUpperCase()
              : "GET";

          findings.push({
            pattern: fw.patternId,
            name: `${upperMethod} ${path}`,
            confidence: fw.confidence,
            location: createLocationFromLine(ctx.file, line, match[0]),
            properties: {
              framework: "express",
              httpMethods: [upperMethod],
              path,
            },
          });
        }
      }
    } else if (fw.id === "nest") {
      for (const regex of fw.controllerDecoratorRegexes) {
        const controllerMatches = findLineMatches(content, regex);
        for (const { line, match } of controllerMatches) {
          const [, basePath] = match;
          findings.push({
            pattern: fw.patternId,
            name: `NEST_CONTROLLER ${basePath || "/"}`,
            confidence: fw.confidence,
            location: createLocationFromLine(ctx.file, line, match[0]),
            properties: {
              framework: "nest",
              httpMethods: [],
              path: basePath || "/",
            },
          });
        }
      }

      for (const regex of fw.routeDecoratorRegexes) {
        const decoratorMatches = findLineMatches(content, regex);
        for (const { line, match } of decoratorMatches) {
          const [, method, routePath] = match;
          const upperMethod =
            typeof method === "string" && method.toUpperCase
              ? method.toUpperCase()
              : "GET";

          findings.push({
            pattern: fw.patternId,
            name: `${upperMethod} ${routePath || "/"}`,
            confidence: fw.confidence,
            location: createLocationFromLine(ctx.file, line, match[0]),
            properties: {
              framework: "nest",
              httpMethods: [upperMethod],
              path: routePath || "/",
            },
          });
        }
      }
    }
  }

  const normalizedPath = ctx.normalizedPath.toLowerCase();
  if (
    normalizedPath.includes("pages/api/") ||
    normalizedPath.includes("/app/") ||
    normalizedPath.endsWith("route.ts") ||
    normalizedPath.endsWith("route.js")
  ) {
    const { regex, confidence } = tsCfg.heuristics.nextRouteHandler;
    const handlerMatches = findLineMatches(content, regex);

    for (const { line, match } of handlerMatches) {
      findings.push({
        pattern: "express_route",
        name: "Route handler",
        confidence,
        location: createLocationFromLine(ctx.file, line, match[0]),
        properties: {
          framework: "next_or_react_route",
          httpMethods: [],
          path: undefined,
        },
      });
    }
  }

  return findings;
}

export function detectTypeScriptDatabaseFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (
    (ctx.language !== "typescript" && ctx.language !== "javascript") ||
    !ctx.normalizedPath
  ) {
    return [];
  }

  const content = ctx.file.content ?? "";
  const findings: RawFinding[] = [];
  const tsCfg = config.typescript;

  for (const client of tsCfg.dbClients) {
    const hasImport = client.importModules.some((mod) =>
      (ctx.imports ?? []).some(
        (imp) =>
          imp.module === mod ||
          imp.module.includes(mod) ||
          imp.names.some((name) => name === mod || name.includes(mod)),
      ),
    );

    for (const regex of client.creationRegexes) {
      const matches = findLineMatches(content, regex);
      for (const { line, match } of matches) {
        const matchedSnippet = String(match[0] ?? "").toLowerCase();
        const hasClientHintInSnippet =
          matchedSnippet.includes(client.id.toLowerCase()) ||
          matchedSnippet.includes(client.databaseType.toLowerCase());
        if (!hasImport && !hasClientHintInSnippet) {
          continue;
        }
        findings.push({
          pattern: client.patternId,
          name: client.id,
          confidence: client.confidence,
          location: createLocationFromLine(ctx.file, line, match[0]),
          properties: {
            client: client.id,
            databaseType: client.databaseType,
          },
        });
      }
    }

    if (hasImport) {
      findings.push({
        pattern: client.patternId,
        name: client.id,
        confidence: Math.max(0.5, client.confidence - 0.2),
        location: createLocationFromLine(ctx.file, 1),
        properties: {
          client: client.id,
          databaseType: client.databaseType,
        },
      });
    }
  }

  const hasAnyDbClientImport = tsCfg.dbClients.some((client) =>
    client.importModules.some((mod) =>
      (ctx.imports ?? []).some(
        (imp) =>
          imp.module === mod ||
          imp.module.includes(mod) ||
          imp.names.some((name) => name === mod || name.includes(mod)),
      ),
    ),
  );

  if (
    hasAnyDbClientImport &&
    tsCfg.heuristics.sqlKeyword.regex.test(content)
  ) {
    findings.push({
      pattern: tsCfg.heuristics.sqlKeyword.patternId,
      name: "sql_query_detected",
      confidence: tsCfg.heuristics.sqlKeyword.confidence,
      location: createLocationFromLine(ctx.file, 1),
      properties: { hint: "raw_sql_keyword" },
    });
  }

  return findings;
}

export function detectTypeScriptAuthFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (
    (ctx.language !== "typescript" && ctx.language !== "javascript") ||
    !ctx.normalizedPath
  ) {
    return [];
  }

  const content = ctx.file.content ?? "";
  const findings: RawFinding[] = [];
  const tsCfg = config.typescript;

  for (const lib of tsCfg.auth.libraries) {
    const hasLibraryImport = lib.importFragments.some((frag) =>
      (ctx.imports ?? []).some(
        (imp) =>
          imp.module === frag ||
          imp.module.includes(frag) ||
          imp.names.some((name) => name === frag || name.includes(frag)),
      ),
    );

    if (!hasLibraryImport) continue;

    if (lib.id === "passport") {
      let emittedSpecific = false;

      for (const regex of lib.callRegexes) {
        const passportMatches = findLineMatches(content, regex);
        for (const { line, match } of passportMatches) {
          const [, strategy] = match;
          emittedSpecific = true;
          findings.push({
            pattern: lib.patternId,
            name: `passport:${strategy}`,
            confidence: lib.confidence,
            location: createLocationFromLine(ctx.file, line, match[0]),
            properties: {
              library: "passport",
              strategy,
            },
          });
        }
      }

      if (!emittedSpecific) {
        findings.push({
          pattern: lib.patternId,
          name: "passport",
          confidence: lib.confidence - 0.15,
          location: createLocationFromLine(ctx.file, 1),
          properties: {
            library: "passport",
          },
        });
      }
    } else if (lib.id === "jsonwebtoken") {
      if (content.includes("jwt.sign(") || content.includes("jwt.verify(")) {
        findings.push({
          pattern: lib.patternId,
          name: "jwt",
          confidence: lib.confidence,
          location: createLocationFromLine(ctx.file, 1),
          properties: {
            library: "jsonwebtoken",
          },
        });
      }
    } else if (lib.id === "nest_auth") {
      if (content.includes("UseGuards(")) {
        findings.push({
          pattern: lib.patternId,
          name: "nest_auth_guard",
          confidence: lib.confidence,
          location: createLocationFromLine(ctx.file, 1),
          properties: {
            library: "nestjs_auth",
          },
        });
      }
    }
  }

  return findings;
}

export function detectTypeScriptEnvAndConfigFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (
    (ctx.language !== "typescript" && ctx.language !== "javascript") ||
    !ctx.normalizedPath
  ) {
    return [];
  }

  const content = ctx.file.content ?? "";
  const findings: RawFinding[] = [];
  const tsCfg = config.typescript;

  const { regex: envRegex, confidence: envConfidence } =
    tsCfg.heuristics.processEnv;
  const envMatches = findLineMatches(content, envRegex);

  for (const { line, match } of envMatches) {
    const [, key] = match;
    findings.push({
      pattern: "env_variable",
      name: `process.env.${key}`,
      confidence: envConfidence,
      location: createLocationFromLine(ctx.file, line, match[0]),
      properties: {
        key,
      },
    });
  }

  const knownKeys = new Set(tsCfg.configKeys.keys.map((k) => k.name));
  if (knownKeys.size > 0) {
    const configRegex = tsCfg.heuristics.configKeyAccess.regex;
    const configMatches = findLineMatches(content, configRegex);

    for (const { line, match } of configMatches) {
      const [, key] = match;
      if (!knownKeys.has(key)) continue;
      const keyConfig = tsCfg.configKeys.keys.find((k) => k.name === key);
      const confidence = keyConfig?.confidence ?? 0.8;

      findings.push({
        pattern: keyConfig?.patternId ?? "config_file",
        name: `config.${key}`,
        confidence,
        location: createLocationFromLine(ctx.file, line, match[0]),
        properties: {
          key,
        },
      });
    }
  }

  return findings;
}

