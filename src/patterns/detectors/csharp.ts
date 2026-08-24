import type { PatternContext } from "../engine";
import type { UnifiedPatternConfig } from "../config";
import { defaultServiceNameFromLiteralPublicUrl } from "../../classifier/external-url-third-party";
import type { RawFinding } from "../../core/types/detection";
import {
  buildThirdPartyUrlHostPatterns,
  inferServiceNameFromUrl,
} from "./helpers";

interface ParsedAttribute {
  name: string;
  firstStringArg?: string;
}

/**
 * Parse an attribute as carried on `decorators`: `HttpGet("users/{id}")`
 * or a bare `Authorize`.
 */
function parseAttribute(raw: string): ParsedAttribute {
  const match = raw.match(/^([A-Za-z_][\w.]*)\s*(?:\(\s*@?"([^"]*)")?/);
  if (!match) return { name: raw };
  return { name: match[1], firstStringArg: match[2] };
}

function attributesOf(decorators: string[] | undefined): ParsedAttribute[] {
  return (decorators ?? []).map(parseAttribute);
}

/** A `using` matches when the declared namespace is at or below the configured one. */
function hasUsingNamespace(
  ctx: PatternContext,
  namespaces: string[],
): boolean {
  if (namespaces.length === 0) return false;
  const imports = ctx.imports ?? [];
  return imports.some((imp) =>
    namespaces.some(
      (want) => imp.module === want || imp.module.startsWith(`${want}.`),
    ),
  );
}

function sourceOf(ctx: PatternContext): string {
  return ctx.strippedContent ?? ctx.file.content ?? "";
}

function callNameRegex(callNames: string[]): RegExp {
  const escaped = callNames.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`(?:^|[^A-Za-z0-9_])(?:${escaped.join("|")})\\s*[<({]`);
}

function lastSegment(callee: string): string {
  const segments = callee.split(/\.|->|::/);
  return segments[segments.length - 1] ?? callee;
}

export function detectCSharpDatabaseConnectionsFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "csharp") return [];

  const content = sourceOf(ctx);
  const types = ctx.types ?? [];
  const findings: RawFinding[] = [];

  for (const db of config.csharp.dbClients) {
    const hasUsing = hasUsingNamespace(ctx, db.usingNamespaces);
    const hasCall =
      db.callNames.length > 0 && callNameRegex(db.callNames).test(content);
    const derivesFromDbType =
      db.baseTypes.length > 0 &&
      types.some((type) =>
        (type.baseTypes ?? []).some((base) =>
          db.baseTypes.some((want) => base === want || base.startsWith(want)),
        ),
      );

    if (!hasUsing && !hasCall && !derivesFromDbType) continue;

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

export function detectCSharpAuthFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "csharp") return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const lib of config.csharp.auth.libraries) {
    const hasUsing = hasUsingNamespace(ctx, lib.usingNamespaces);
    const hasCall =
      lib.callNames.length > 0 && callNameRegex(lib.callNames).test(content);

    if (!hasUsing && !hasCall) continue;

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

  const declaredAttributes = [
    ...(ctx.types ?? []).flatMap((type) => attributesOf(type.decorators)),
    ...(ctx.functions ?? []).flatMap((fn) => attributesOf(fn.decorators)),
  ];

  for (const attrRule of config.csharp.auth.attributes) {
    const match = declaredAttributes.find((attr) =>
      attrRule.attributeNames.includes(attr.name),
    );
    if (!match) continue;

    findings.push({
      pattern: attrRule.patternId,
      name: attrRule.id,
      confidence: attrRule.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: 1,
        endLine: 1,
      },
      properties: {
        ...(attrRule.strategy ? { strategy: attrRule.strategy } : {}),
        ...(match.firstStringArg ? { policy: match.firstStringArg } : {}),
      },
    });
  }

  return findings;
}

export function detectCSharpEnvAndConfigFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "csharp") return [];

  const envCfg = config.csharp.envConfig;
  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];

  if (envCfg.envVariable) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const match = envCfg.envVariable.regex.exec(line);
      if (!match) continue;

      const key = match[1];
      findings.push({
        pattern: envCfg.envVariable.patternId,
        name: key ? `Environment[${key}]` : "env_variable",
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

  if (envCfg.configurationKeys) {
    const seenKeys = new Set<string>();
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const regex of envCfg.configurationKeys.regexes) {
        const match = regex.exec(line);
        if (!match) continue;

        const key = match[1];
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);

        findings.push({
          pattern: envCfg.configurationKeys.patternId,
          name: `Configuration[${key}]`,
          confidence: envCfg.configurationKeys.confidence,
          location: {
            filePath: ctx.file.path,
            startLine: i + 1,
            endLine: i + 1,
            code: line.trim(),
          },
          properties: { key },
        });
      }
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

/**
 * Resolve a controller-level route template, expanding the `[controller]`
 * token the way ASP.NET Core does (class name minus the `Controller` suffix).
 */
function controllerRoutePrefix(
  typeName: string,
  template: string | undefined,
): string | undefined {
  if (!template) return undefined;
  const shortName = typeName.replace(/Controller$/, "");
  return template
    .replace(/\[controller\]/gi, shortName)
    .replace(/\[action\]/gi, "");
}

function joinRouteSegments(
  prefix: string | undefined,
  suffix: string | undefined,
): string | undefined {
  const left = prefix?.replace(/\/+$/, "");
  const right = suffix?.replace(/^\/+/, "");
  if (left && right) return `${left}/${right}`;
  if (left) return left;
  return right;
}

export function detectCSharpRoutesFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "csharp") return [];

  const methods = ctx.functions ?? [];
  const types = ctx.types ?? [];
  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (const fw of config.csharp.routes.frameworks) {
    const gated = fw.usingNamespaces.length > 0;
    const supportsFramework = !gated || hasUsingNamespace(ctx, fw.usingNamespaces);
    if (!supportsFramework) continue;

    if (fw.attributeRoutes.length > 0) {
      // Controller-level route template, e.g. [Route("api/[controller]")].
      let routePrefix: string | undefined;
      let controllerName: string | undefined;

      for (const type of types) {
        const typeAttributes = attributesOf(type.decorators);
        const isController =
          typeAttributes.some((attr) =>
            fw.controllerAttributes.includes(attr.name),
          ) ||
          (type.baseTypes ?? []).some((base) =>
            fw.controllerBaseTypes.some(
              (want) => base === want || base.startsWith(want),
            ),
          );
        if (!isController) continue;

        controllerName = type.name;
        const routeAttribute = typeAttributes.find((attr) =>
          fw.controllerRouteAttributes.includes(attr.name),
        );
        routePrefix = controllerRoutePrefix(
          type.name,
          routeAttribute?.firstStringArg,
        );
        break;
      }

      for (const method of methods) {
        const methodAttributes = attributesOf(method.decorators);

        for (const attributeRoute of fw.attributeRoutes) {
          const match = methodAttributes.find(
            (attr) => attr.name === attributeRoute.attribute,
          );
          if (!match) continue;

          const routePath = joinRouteSegments(routePrefix, match.firstStringArg);
          const httpMethod = attributeRoute.method;
          const name = httpMethod
            ? `${httpMethod} ${routePath ?? method.name}`
            : `ROUTE ${routePath ?? method.name}`;

          findings.push({
            pattern: fw.patternId,
            name,
            confidence: fw.confidence,
            location: method.location,
            properties: {
              framework: fw.id,
              httpMethods: httpMethod ? [httpMethod] : [],
              ...(routePath ? { path: routePath } : {}),
              handler: method.name,
              handlerType: "controller_action",
              ...(controllerName ? { controller: controllerName } : {}),
            },
          });
        }
      }
    }

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

        findings.push({
          pattern: fw.patternId,
          name: method
            ? `${method} ${routePath ?? ""}`.trim()
            : `ROUTE ${routePath ?? ""}`.trim(),
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
            handlerType: "minimal_api",
          },
        });
      }
    }
  }

  return findings;
}

export function detectCSharpServerlessHandlersFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "csharp") return [];

  const methods = ctx.functions ?? [];
  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (const handler of config.csharp.serverless.handlers) {
    const hasUsing = hasUsingNamespace(ctx, handler.usingNamespaces);

    for (const method of methods) {
      const attributes = attributesOf(method.decorators);
      const attributeMatch = attributes.find((attr) =>
        handler.attributeNames.includes(attr.name),
      );

      const declarationLine = lines[method.location.startLine - 1] ?? "";
      const typeMatch =
        handler.typeNames.length > 0 &&
        handler.typeNames.some((typeName) =>
          declarationLine.includes(typeName),
        );

      if (!attributeMatch && !typeMatch) continue;
      // A bare type match (e.g. an `ILambdaContext` parameter) still needs the
      // SDK namespace in scope to count as a handler.
      if (!attributeMatch && !hasUsing) continue;

      findings.push({
        pattern: handler.patternId,
        name: attributeMatch?.firstStringArg
          ? `${handler.id} ${attributeMatch.firstStringArg}`
          : `${handler.id} ${method.name}`,
        confidence: handler.confidence,
        location: method.location,
        properties: {
          framework: handler.id,
          handler: method.name,
          ...(attributeMatch?.firstStringArg
            ? { functionName: attributeMatch.firstStringArg }
            : {}),
        },
      });
    }
  }

  return findings;
}

export function detectCSharpExternalApisFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "csharp") return [];

  const calls = ctx.moduleLevelCalls ?? [];
  if (calls.length === 0) return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];
  const urlHostPatterns = buildThirdPartyUrlHostPatterns(config);

  for (const client of config.csharp.externalApis.httpClients) {
    const supportsClient =
      client.usingNamespaces.length === 0 ||
      hasUsingNamespace(ctx, client.usingNamespaces) ||
      content.includes(client.clientName);
    if (!supportsClient) continue;

    for (const call of calls) {
      const callee = call.callee ?? "";
      const matchesCallName = client.callNames.some(
        (name) => callee === name || lastSegment(callee) === name,
      );
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
