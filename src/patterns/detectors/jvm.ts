import type { PatternContext } from "../engine";
import type { UnifiedPatternConfig } from "../config";
import { defaultServiceNameFromLiteralPublicUrl } from "../../classifier/external-url-third-party";
import type { RawFinding } from "../../core/types/detection";
import {
  buildThirdPartyUrlHostPatterns,
  inferServiceNameFromUrl,
} from "./helpers";

interface ParsedAnnotation {
  name: string;
  argumentsSnippet: string;
  /**
   * The route template: `value`/`path` when named, otherwise the first
   * positional string. Deliberately not "any quoted string" — that would read
   * `@RequestMapping(consumes = "application/json")` as a path.
   */
  firstStringArg?: string;
  /** `method = RequestMethod.GET` on a Spring `@RequestMapping`. */
  httpMethod?: string;
}

const NAMED_PATH_ARG_REGEX = /\b(?:value|path)\s*=\s*[{[]?\s*"([^"]*)"/;
const POSITIONAL_PATH_ARG_REGEX = /^\s*[{[]?\s*"([^"]*)"/;
const REQUEST_METHOD_ARG_REGEX =
  /\bmethod\s*=\s*[{[]?\s*(?:RequestMethod\.)?([A-Z]+)/;

/**
 * Parse an annotation as carried on `decorators`: `GetMapping("/{id}")`,
 * `RequestMapping(value = "/api", method = RequestMethod.GET)`, or a bare
 * `Authorize`.
 */
function parseAnnotation(raw: string): ParsedAnnotation {
  const match = raw.match(/^([A-Za-z_][\w.]*)\s*(?:\(([\s\S]*)\))?$/);
  if (!match) return { name: raw, argumentsSnippet: "" };

  const name = match[1];
  const argumentsSnippet = match[2] ?? "";
  if (!argumentsSnippet) return { name, argumentsSnippet };

  const named = argumentsSnippet.match(NAMED_PATH_ARG_REGEX);
  const positional = argumentsSnippet.match(POSITIONAL_PATH_ARG_REGEX);
  const methodArg = argumentsSnippet.match(REQUEST_METHOD_ARG_REGEX);

  return {
    name,
    argumentsSnippet,
    firstStringArg: named?.[1] ?? positional?.[1],
    httpMethod: methodArg?.[1],
  };
}

/**
 * Decorators carry each annotation twice — with and without its argument list.
 * Only the parenthesised form is parsed when both are present, so a route
 * template is never lost to the bare duplicate.
 */
function annotationsOf(decorators: string[] | undefined): ParsedAnnotation[] {
  const parsed = (decorators ?? []).map(parseAnnotation);
  const byName = new Map<string, ParsedAnnotation>();

  for (const annotation of parsed) {
    const existing = byName.get(annotation.name);
    if (!existing || (!existing.argumentsSnippet && annotation.argumentsSnippet)) {
      byName.set(annotation.name, annotation);
    }
  }

  return Array.from(byName.values());
}

function isJvm(ctx: PatternContext): boolean {
  return ctx.language === "java" || ctx.language === "kotlin";
}

/**
 * An import matches when the declared name is at or below the configured
 * package, so `org.springframework.data` covers
 * `org.springframework.data.jpa.repository.JpaRepository`.
 */
function hasImportPackage(ctx: PatternContext, packages: string[]): boolean {
  if (packages.length === 0) return false;
  const imports = ctx.imports ?? [];
  return imports.some((imp) =>
    packages.some(
      (want) => imp.module === want || imp.module.startsWith(`${want}.`),
    ),
  );
}

/**
 * Match a Maven/Gradle `groupId:artifactId` coordinate, as supplied by the
 * manifest scanner. The `:` requirement keeps the coordinate space disjoint
 * from the import space: a configured groupId prefix such as `org.mongodb`
 * must not also match the `com.mongodb...` import of a source file, or the
 * same client would be reported twice for one service.
 */
function hasPackageCoordinate(
  ctx: PatternContext,
  coordinates: string[],
): boolean {
  if (coordinates.length === 0) return false;
  const imports = ctx.imports ?? [];

  return imports.some((imp) => {
    if (!imp.module.includes(":")) return false;
    const groupId = imp.module.slice(0, imp.module.indexOf(":"));

    return coordinates.some((want) => {
      if (want.includes(":")) return imp.module === want;
      return groupId === want || groupId.startsWith(`${want}.`);
    });
  });
}

function sourceOf(ctx: PatternContext): string {
  return ctx.strippedContent ?? ctx.file.content ?? "";
}

function callNameRegex(callNames: string[]): RegExp {
  const escaped = callNames.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`(?:^|[^A-Za-z0-9_.])(?:${escaped.join("|")})\\s*[({<]`);
}

function declaredAnnotations(ctx: PatternContext): ParsedAnnotation[] {
  return [
    ...(ctx.types ?? []).flatMap((type) => annotationsOf(type.decorators)),
    ...(ctx.functions ?? []).flatMap((fn) => annotationsOf(fn.decorators)),
  ];
}

export function detectJvmDatabaseConnectionsFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (!isJvm(ctx)) return [];

  const content = sourceOf(ctx);
  const annotations = declaredAnnotations(ctx);
  const findings: RawFinding[] = [];

  for (const db of config.jvm.dbClients) {
    const hasImport = hasImportPackage(ctx, db.importPackages);
    const hasCoordinate = hasPackageCoordinate(ctx, db.packageCoordinates);
    const hasCall =
      db.callNames.length > 0 && callNameRegex(db.callNames).test(content);
    const hasAnnotation =
      db.annotationNames.length > 0 &&
      annotations.some((annotation) =>
        db.annotationNames.includes(annotation.name),
      );

    if (!hasImport && !hasCoordinate && !hasCall && !hasAnnotation) continue;

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

  findings.push(...detectJdbcUrls(ctx, config, content));

  return findings;
}

/**
 * JDBC names its engine in the URL sub-protocol. Only the driver token is
 * read: JDBC URLs routinely carry credentials in query parameters, so the
 * value itself never reaches a finding.
 */
export function detectJdbcUrls(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
  content: string,
): RawFinding[] {
  const jdbcUrl = config.jvm.jdbcUrl;
  if (!jdbcUrl) return [];

  const findings: RawFinding[] = [];
  const lines = content.split(/\r?\n/);
  const seenDrivers = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const match = jdbcUrl.regex.exec(lines[i]);
    if (!match) continue;

    const driver = (match[1] ?? "").trim().toLowerCase();
    if (!driver || seenDrivers.has(driver)) continue;
    seenDrivers.add(driver);

    const databaseType = jdbcUrl.drivers[driver] ?? jdbcUrl.defaultDatabaseType;

    findings.push({
      pattern: jdbcUrl.patternId,
      name: `${jdbcUrl.name}:${driver}`,
      confidence: jdbcUrl.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: i + 1,
        endLine: i + 1,
      },
      properties: {
        client: jdbcUrl.name,
        databaseType,
        driver,
      },
    });
  }

  return findings;
}

export function detectJvmAuthFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (!isJvm(ctx)) return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const lib of config.jvm.auth.libraries) {
    const hasImport = hasImportPackage(ctx, lib.importPackages);
    const hasCoordinate = hasPackageCoordinate(ctx, lib.packageCoordinates);
    const hasCall =
      lib.callNames.length > 0 && callNameRegex(lib.callNames).test(content);
    const matchesContent =
      lib.contentRegexes.length > 0 &&
      lib.contentRegexes.some((re) => re.test(content));

    if (!hasImport && !hasCoordinate && !hasCall && !matchesContent) continue;

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

  const annotations = declaredAnnotations(ctx);

  for (const rule of config.jvm.auth.annotations) {
    const match = annotations.find((annotation) =>
      rule.annotationNames.includes(annotation.name),
    );
    if (!match) continue;

    findings.push({
      pattern: rule.patternId,
      name: rule.id,
      confidence: rule.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: 1,
        endLine: 1,
      },
      properties: {
        ...(rule.strategy ? { strategy: rule.strategy } : {}),
        ...(match.firstStringArg ? { policy: match.firstStringArg } : {}),
      },
    });
  }

  return findings;
}

export function detectJvmEnvAndConfigFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (!isJvm(ctx)) return [];

  const envCfg = config.jvm.envConfig;
  const content = sourceOf(ctx);
  const lines = content.split(/\r?\n/);
  const findings: RawFinding[] = [];

  if (envCfg.envVariable) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const match = envCfg.envVariable.regex.exec(line);
      if (!match) continue;

      const key = match[1];
      findings.push({
        pattern: envCfg.envVariable.patternId,
        name: key ? `System.getenv(${key})` : "env_variable",
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

  if (envCfg.propertyKeys) {
    const seenKeys = new Set<string>();
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const regex of envCfg.propertyKeys.regexes) {
        const match = regex.exec(line);
        if (!match) continue;

        const key = match[1];
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);

        findings.push({
          pattern: envCfg.propertyKeys.patternId,
          name: `property(${key})`,
          confidence: envCfg.propertyKeys.confidence,
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

  if (envCfg.configLoaders) {
    for (const loader of envCfg.configLoaders.loaders) {
      const hasImport = hasImportPackage(ctx, loader.importPackages);
      const hasCoordinate = hasPackageCoordinate(ctx, loader.packageCoordinates);
      const hasCall =
        loader.callNames.length > 0 &&
        callNameRegex(loader.callNames).test(content);

      if (!hasImport && !hasCoordinate && !hasCall) continue;

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

export function detectJvmRoutesFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (!isJvm(ctx)) return [];

  const methods = ctx.functions ?? [];
  const types = ctx.types ?? [];
  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (const fw of config.jvm.routes.frameworks) {
    const gated = fw.importPackages.length > 0;
    const supportsFramework = !gated || hasImportPackage(ctx, fw.importPackages);
    if (!supportsFramework) continue;

    if (fw.annotationRoutes.length > 0) {
      // Class-level route template: @RequestMapping("/api/customers") on a
      // @RestController, @Path("/customers") on a JAX-RS resource, or
      // @Controller("/api") on a Micronaut controller.
      let routePrefix: string | undefined;
      let controllerName: string | undefined;

      for (const type of types) {
        const typeAnnotations = annotationsOf(type.decorators);
        const routeAnnotation = typeAnnotations.find((annotation) =>
          fw.controllerRouteAnnotations.includes(annotation.name),
        );
        const isController =
          typeAnnotations.some((annotation) =>
            fw.controllerAnnotations.includes(annotation.name),
          ) || Boolean(routeAnnotation);
        if (!isController) continue;

        controllerName = type.name;
        routePrefix = routeAnnotation?.firstStringArg;
        break;
      }

      for (const method of methods) {
        const methodAnnotations = annotationsOf(method.decorators);

        for (const annotationRoute of fw.annotationRoutes) {
          const match = methodAnnotations.find(
            (annotation) => annotation.name === annotationRoute.annotation,
          );
          if (!match) continue;

          // JAX-RS splits the verb from the path: @GET carries no template,
          // and the sub-path comes from a sibling @Path on the same method.
          const suffix =
            match.firstStringArg ??
            (fw.pathAnnotations.length > 0
              ? methodAnnotations.find((annotation) =>
                  fw.pathAnnotations.includes(annotation.name),
                )?.firstStringArg
              : undefined);

          const routePath = joinRouteSegments(routePrefix, suffix);
          const httpMethod =
            annotationRoute.method === "ANY"
              ? (match.httpMethod ?? "ANY")
              : annotationRoute.method;

          findings.push({
            pattern: fw.patternId,
            name: httpMethod
              ? `${httpMethod} ${routePath ?? method.name}`
              : `ROUTE ${routePath ?? method.name}`,
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
            : `${fw.id.toUpperCase()}_ROUTE ${routePath ?? ""}`.trim(),
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
            handlerType: "route_dsl",
          },
        });
      }
    }
  }

  return findings;
}

export function detectJvmServerlessHandlersFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (!isJvm(ctx)) return [];

  const methods = ctx.functions ?? [];
  const types = ctx.types ?? [];
  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const handler of config.jvm.serverless.handlers) {
    const hasImport =
      hasImportPackage(ctx, handler.importPackages) ||
      hasPackageCoordinate(ctx, handler.packageCoordinates);

    // A handler interface name on its own is too generic to stand alone
    // (`HttpFunction`, `RequestHandler`); the SDK package must be in scope.
    if (hasImport && handler.baseTypes.length > 0) {
      for (const type of types) {
        const implementsHandler = (type.baseTypes ?? []).some((base) =>
          handler.baseTypes.some(
            (want) => base === want || base.startsWith(want),
          ),
        );
        if (!implementsHandler) continue;

        findings.push({
          pattern: handler.patternId,
          name: `${handler.id} ${type.name}`,
          confidence: handler.confidence,
          location: type.location,
          properties: {
            framework: handler.id,
            handler: type.name,
          },
        });
      }
    }

    if (handler.annotationNames.length > 0) {
      for (const method of methods) {
        const match = annotationsOf(method.decorators).find((annotation) =>
          handler.annotationNames.includes(annotation.name),
        );
        if (!match) continue;

        findings.push({
          pattern: handler.patternId,
          name: match.firstStringArg
            ? `${handler.id} ${match.firstStringArg}`
            : `${handler.id} ${method.name}`,
          confidence: handler.confidence,
          location: method.location,
          properties: {
            framework: handler.id,
            handler: method.name,
            ...(match.firstStringArg
              ? { functionName: match.firstStringArg }
              : {}),
          },
        });
      }
    }

    if (
      hasImport &&
      handler.callNames.length > 0 &&
      callNameRegex(handler.callNames).test(content)
    ) {
      findings.push({
        pattern: handler.patternId,
        name: handler.id,
        confidence: handler.confidence,
        location: {
          filePath: ctx.file.path,
          startLine: 1,
          endLine: 1,
        },
        properties: { framework: handler.id },
      });
    }
  }

  return findings;
}

export function detectJvmExternalApisFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (!isJvm(ctx)) return [];

  const calls = ctx.moduleLevelCalls ?? [];
  if (calls.length === 0) return [];

  const findings: RawFinding[] = [];
  const urlHostPatterns = buildThirdPartyUrlHostPatterns(config);

  for (const client of config.jvm.externalApis.httpClients) {
    const supportsClient =
      client.importPackages.length === 0 ||
      hasImportPackage(ctx, client.importPackages);
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

      // Clients whose method names collide with a server routing DSL only
      // count when the call actually carries a URL.
      if (client.requireUrlMatch && !url) continue;

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
