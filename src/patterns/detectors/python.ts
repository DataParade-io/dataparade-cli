import type { PatternContext } from "../engine";
import type { UnifiedPatternConfig } from "../config";
import { defaultServiceNameFromLiteralPublicUrl } from "../../classifier/external-url-third-party";
import type { RawFinding } from "../../core/types/detection";
import {
  buildThirdPartyUrlHostPatterns,
  inferServiceNameFromUrl,
  sourceOf,
} from "./helpers";

export function detectPythonDatabaseConnectionsFromImportsAndContent(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "python") return [];

  const imports = ctx.imports ?? [];
  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const db of config.python.dbClients) {
    const hasImport = db.importModules.some((mod) =>
      imports.some((imp: { module: string | string[]; }) => imp.module.includes(mod)),
    );

    let hasCall = false;
    if (db.callNames.length > 0) {
      const pattern = new RegExp(`\\b(${db.callNames.join("|")})\\s*\\(`);
      hasCall = pattern.test(content);
    }

    if (!hasImport && !hasCall && !db.heuristics.usesObjectsAttribute) {
      continue;
    }

    if (db.heuristics.usesObjectsAttribute && !content.includes(".objects.")) {
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

  return findings;
}

export function detectPythonAuthFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "python") return [];

  const imports = ctx.imports ?? [];
  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  const authConfig = config.python.auth;

  if (authConfig.jwt) {
    const hasImport = authConfig.jwt.importModules.some((mod) =>
      imports.some((imp: { module: string | string[]; }) => imp.module.includes(mod)),
    );

    const matchesContent =
      authConfig.jwt.contentRegexes.length === 0
        ? false
        : authConfig.jwt.contentRegexes.some((re) => re.test(content));

    if (hasImport || matchesContent) {
      findings.push({
        pattern: authConfig.jwt.patternId,
        name: "jwt_auth",
        confidence: authConfig.jwt.confidence,
        location: {
          filePath: ctx.file.path,
          startLine: 1,
          endLine: 1,
        },
        properties: {
          strategy: authConfig.jwt.strategy ?? "jwt",
        },
      });
    }
  }

  for (const dec of authConfig.decorators) {
    if (dec.callNames.length === 0) continue;
    const re = new RegExp(`\\b(${dec.callNames.join("|")})\\b`);
    if (!re.test(content)) continue;

    findings.push({
      pattern: dec.patternId,
      name: "auth_decorator",
      confidence: dec.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: 1,
        endLine: 1,
      },
      properties: {},
    });
  }

  for (const lib of authConfig.libraries) {
    const hasImport =
      lib.importModules.length > 0 &&
      lib.importModules.some((mod) =>
        imports.some((imp: { module: string }) => imp.module.includes(mod)),
      );
    const matchesContent =
      lib.contentRegexes.length > 0 &&
      lib.contentRegexes.some((re) => re.test(content));
    if (!hasImport && !matchesContent) continue;

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

export function detectPythonEnvAndConfigFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "python") return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  const envCfg = config.python.envConfig;

  if (envCfg.envVariable) {
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const match = envCfg.envVariable.regex.exec(line);
      if (!match) continue;

      const keyMatch = line.match(/['"]([^'"]+)['"]/);
      const key = keyMatch?.[1];

      findings.push({
        pattern: envCfg.envVariable.patternId,
        name: key ? `os.environ[${key}]` : "env_variable",
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

  if (envCfg.djangoSettings) {
    if (ctx.file.path.endsWith(envCfg.djangoSettings.fileSuffix)) {
      findings.push({
        pattern: envCfg.djangoSettings.patternId,
        name: envCfg.djangoSettings.name,
        confidence: envCfg.djangoSettings.confidence,
        location: {
          filePath: ctx.file.path,
          startLine: 1,
          endLine: 1,
        },
        properties: {},
      });
    }
  }

  if (envCfg.dotenvConfig) {
    const requiresOsImport = envCfg.dotenvConfig.requiresOsImport;
    let hasOsImport = true;
    if (requiresOsImport && ctx.imports) {
      hasOsImport = ctx.imports.some(
        (imp: { module: string; names: string | string[]; }) => imp.module === "os" || imp.names.includes("os"),
      );
    }

    if (
      hasOsImport &&
      content.includes(envCfg.dotenvConfig.contentSubstring)
    ) {
      findings.push({
        pattern: envCfg.dotenvConfig.patternId,
        name: envCfg.dotenvConfig.name,
        confidence: envCfg.dotenvConfig.confidence,
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

export function detectPythonRoutesFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "python") return [];

  const imports = ctx.imports ?? [];
  const functions = ctx.functions ?? [];
  const content = sourceOf(ctx);
  const lines = content.split(/\r?\n/);
  const normalizedLowerPath = (ctx.normalizedPath ?? ctx.file.path).toLowerCase();

  const findings: RawFinding[] = [];
  const hasDjangoImport = imports.some((imp: { module: string | string[]; }) =>
    imp.module.includes("django."),
  );
  const hasDrfImport = imports.some(
    (imp: { module: string | string[]; names: string | string[]; }) =>
      imp.module.includes("rest_framework") ||
      imp.names.includes("api_view") ||
      imp.names.includes("APIView") ||
      imp.names.includes("ViewSet") ||
      imp.names.includes("ModelViewSet"),
  );

  for (const fw of config.python.routes.frameworks) {
    const hasImport =
      fw.importModules.length === 0
        ? true
        : fw.importModules.some((mod) =>
            imports.some((imp: { module: string | string[]; }) => imp.module.includes(mod)),
          );

    let isUrlsFile = false;
    if (fw.urlsFileSuffix) {
      isUrlsFile = normalizedLowerPath.endsWith(fw.urlsFileSuffix.toLowerCase());
    }

    const supportsFramework = hasImport || isUrlsFile;
    if (!supportsFramework) continue;

    if (fw.id === "django_urls" && fw.pathRegex) {
      // Line-based route detection in urls.py
      for (let i = 0; i < lines.length; i += 1) {
        const text = lines[i].trim();
        const match = fw.pathRegex.exec(text);
        if (!match) continue;

        const routePath = match[2] ?? match[1];
        const isClassBasedView = /\.as_view\s*\(/.test(text);
        const isDrfRouterPath = /router\./.test(text);

        findings.push({
          pattern: fw.patternId,
          name: `DJANGO_ROUTE ${routePath}`,
          confidence: fw.confidence,
          location: {
            filePath: ctx.file.path,
            startLine: i + 1,
            endLine: i + 1,
            code: text,
          },
          properties: {
            framework: isDrfRouterPath ? "drf" : "django",
            httpMethods: [],
            path: routePath,
            ...(isClassBasedView ? { handlerType: "class_based_view" } : {}),
            ...(isDrfRouterPath ? { handlerType: "viewset_route" } : {}),
          },
        });
      }

      // DRF router-style registration detection:
      // router.register("users", UserViewSet, basename="user")
      if (
        normalizedLowerPath.endsWith("urls.py") &&
        (hasDrfImport || content.includes("router.register("))
      ) {
        const routerRegisterRegex =
          /router\.register\(\s*["'`]([^"'`]+)["'`]\s*,\s*([A-Za-z_][A-Za-z0-9_]*)/;
        for (let i = 0; i < lines.length; i += 1) {
          const text = lines[i].trim();
          const registerMatch = text.match(routerRegisterRegex);
          if (!registerMatch) continue;

          const routePath = registerMatch[1];
          const viewsetName = registerMatch[2];

          findings.push({
            pattern: fw.patternId,
            name: `DRF_ROUTE ${routePath}`,
            confidence: fw.confidence,
            location: {
              filePath: ctx.file.path,
              startLine: i + 1,
              endLine: i + 1,
              code: text,
            },
            properties: {
              framework: "drf",
              httpMethods: [],
              path: routePath,
              handlerType: "viewset_route",
              handler: viewsetName,
            },
          });
        }
      }

      continue;
    }

    if (fw.id === "grpc" && fw.pathRegex) {
      for (let i = 0; i < lines.length; i += 1) {
        const text = lines[i]?.trim() ?? "";
        const match = fw.pathRegex.exec(text);
        if (!match) continue;

        const routePath = match[1] ?? match[2];
        findings.push({
          pattern: fw.patternId,
          name: `GRPC ${routePath ?? "service"}`,
          confidence: fw.confidence,
          location: {
            filePath: ctx.file.path,
            startLine: i + 1,
            endLine: i + 1,
            code: text,
          },
          properties: {
            framework: fw.id,
            httpMethods: ["RPC"],
            ...(routePath ? { path: routePath } : {}),
            handlerType: "grpc_service",
          },
        });
      }
      continue;
    }

    // Decorator-based frameworks (FastAPI, Flask, Starlette, Bottle)
    for (const fn of functions) {
      if (fw.id === "fastapi") {
        const hasDecorator = fn.decorators.some((d: string) =>
          fw.decoratorPrefixes.some((prefix) => d.startsWith(prefix)),
        );
        if (!hasDecorator) continue;

        const decorator = fn.decorators.find((d: string) => d.startsWith("app."));
        const methodMatch = decorator?.match(/^app\.([a-zA-Z_]+)/);
        const method = methodMatch?.[1]?.toUpperCase() ?? "GET";

        let path: string | undefined;
        const startLine = fn.location.startLine;
        if (startLine > 1) {
          const decoratorLine = lines[startLine - 2]?.trim();
          const decoratorPathMatch = decoratorLine?.match(
            /@app\.[a-zA-Z_]+\(\s*["'`]([^"'`]+)["'`]/,
          );
          if (decoratorPathMatch) {
            path = decoratorPathMatch[1];
          }
        }

        const displayPath = path ?? fn.name;

        findings.push({
          pattern: fw.patternId,
          name: `${method} ${displayPath}`,
          confidence: fw.confidence,
          location: fn.location,
          properties: {
            framework: fw.id,
            httpMethods: [method],
            path,
          },
        });
      } else if (fw.id === "flask") {
        const hasDecorator = fn.decorators.some((d: string) =>
          fw.decoratorPrefixes.some((prefix) => d.startsWith(prefix)),
        );
        if (!hasDecorator) continue;

        let path: string | undefined;
        const startLine = fn.location.startLine;
        if (startLine > 1) {
          const decoratorLine = lines[startLine - 2]?.trim();
          const flaskPathMatch = decoratorLine?.match(
            /@(app|bp|blueprint)\.route\(\s*["'`]([^"'`]+)["'`]/,
          );
          if (flaskPathMatch) {
            path = flaskPathMatch[2];
          }
        }

        const name =
          path != null && path.length > 0
            ? `GET ${path}`
            : `FLASK_ROUTE ${fn.name}`;

        findings.push({
          pattern: fw.patternId,
          name,
          confidence: fw.confidence,
          location: fn.location,
          properties: {
            framework: fw.id,
            httpMethods: path ? ["GET"] : [],
            path,
          },
        });
      } else if (fw.id === "starlette") {
        const hasDecorator = fn.decorators.some((d: string) =>
          fw.decoratorPrefixes.some((prefix) => d.startsWith(prefix)),
        );
        if (!hasDecorator) continue;

        findings.push({
          pattern: fw.patternId,
          name: `STARLETTE_ROUTE ${fn.name}`,
          confidence: fw.confidence,
          location: fn.location,
          properties: {
            framework: fw.id,
            httpMethods: [],
          },
        });
      } else if (fw.id === "bottle") {
        const hasDecorator = fn.decorators.some((d: string) =>
          fw.decoratorNames.some((name) => d === name),
        );
        if (!hasDecorator) continue;

        findings.push({
          pattern: fw.patternId,
          name: `BOTTLE_ROUTE ${fn.name}`,
          confidence: fw.confidence,
          location: fn.location,
          properties: {
            framework: fw.id,
            httpMethods: [],
          },
        });
      }
    }
  }

  // DRF function-based views (e.g. @api_view(["GET"]))
  if (hasDrfImport) {
    for (const fn of functions) {
      const hasApiViewDecorator = fn.decorators.some((d: string) => d === "api_view");
      if (!hasApiViewDecorator) continue;

      const startLine = fn.location.startLine;
      const decoratorLine = startLine > 1 ? lines[startLine - 2]?.trim() ?? "" : "";
      const methodsMatch = decoratorLine.match(/\[\s*([^\]]+)\]/);
      const httpMethods =
        methodsMatch?.[1]
          ?.split(",")
          .map((method: string) => method.replace(/['"`\s]/g, "").toUpperCase())
          .filter(Boolean) ?? [];

      findings.push({
        pattern: "express_route",
        name:
          httpMethods.length > 0
            ? `${httpMethods[0]} ${fn.name}`
            : `DRF_ROUTE ${fn.name}`,
        confidence: 0.85,
        location: fn.location,
        properties: {
          framework: "drf",
          httpMethods,
          handlerType: "function_based_view",
        },
      });
    }
  }

  return findings;
}

export function detectPythonExternalApisFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "python") return [];

  const imports = ctx.imports ?? [];
  const calls = ctx.moduleLevelCalls ?? [];
  const findings: RawFinding[] = [];

  if (calls.length === 0) return findings;

  const urlHostPatterns = buildThirdPartyUrlHostPatterns(config);

  for (const client of config.python.externalApis.httpClients) {
    const hasImport =
      client.importModules.length === 0
        ? true
        : client.importModules.some((mod) =>
            imports.some(
              (imp: { module: string | string[]; names: string | string[]; }) => imp.module.includes(mod) || imp.names.includes(mod),
            ),
          );

    if (!hasImport) continue;

    for (const call of calls) {
      const callee = call.callee ?? "";
      const matchesConfiguredCallName =
        client.callNames.length > 0 &&
        client.callNames.some((name) => callee === name);
      const matchesClientPrefix =
        client.callNames.length === 0 &&
        callee.startsWith(`${client.clientName}.`);
      if (!matchesClientPrefix && !matchesConfiguredCallName) continue;

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
          url,
          ...(serviceName ? { serviceName } : {}),
        },
      });
    }
  }

  return findings;
}

export function detectPythonServerlessHandlersFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "python") return [];

  const imports = ctx.imports ?? [];
  const functions = ctx.functions ?? [];
  const content = sourceOf(ctx);
  const lines = content.split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (const handler of config.python.serverless.handlers) {
    const hasImport =
      handler.importModules.length === 0
        ? false
        : handler.importModules.some((mod) =>
            imports.some((imp: { module: string }) =>
              imp.module.includes(mod),
            ),
          );

    for (const fn of functions) {
      const lineText = lines[fn.location.startLine - 1] ?? "";
      const matchesFunctionName = handler.functionNameRegexes.some((re) =>
        re.test(lineText),
      );
      const decoratorMatch = fn.decorators.find((decorator) =>
        handler.decoratorNames.some(
          (name) => decorator === name || decorator.startsWith(`${name}(`),
        ),
      );

      if (!matchesFunctionName && !decoratorMatch) continue;
      if (!hasImport && !decoratorMatch) continue;

      findings.push({
        pattern: handler.patternId,
        name: decoratorMatch
          ? `${handler.id} ${decoratorMatch}`
          : `${handler.id} ${fn.name}`,
        confidence: handler.confidence,
        location: fn.location,
        properties: {
          framework: handler.id,
          handler: fn.name,
          handlerType: "serverless_handler",
        },
      });
    }
  }

  return findings;
}

