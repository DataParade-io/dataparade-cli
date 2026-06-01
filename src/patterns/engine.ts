import type { FileInfo, SourceLocation } from "../core/types/file";
import type { RawFinding } from "../core/types/detection";
import { loadUnifiedPatternConfig, type UnifiedPatternConfig } from "./config";
import {
  detectPythonDatabaseConnectionsFromImportsAndContent as detectPythonDatabaseConnectionsFromImportsAndContentAdapter,
  detectPythonAuthFromConfig as detectPythonAuthFromConfigAdapter,
  detectPythonEnvAndConfigFromConfig as detectPythonEnvAndConfigFromConfigAdapter,
  detectPythonExternalApisFromConfig as detectPythonExternalApisFromConfigAdapter,
  detectPythonRoutesFromConfig as detectPythonRoutesFromConfigAdapter,
} from "./detectors/python";
import {
  detectTypeScriptJavaScriptExternalApisFromHttpClients as detectTypeScriptJavaScriptExternalApisFromHttpClientsAdapter,
  detectTypeScriptRoutesFromConfig as detectTypeScriptRoutesFromConfigAdapter,
  detectTypeScriptDatabaseFromConfig as detectTypeScriptDatabaseFromConfigAdapter,
  detectTypeScriptAuthFromConfig as detectTypeScriptAuthFromConfigAdapter,
  detectTypeScriptEnvAndConfigFromConfig as detectTypeScriptEnvAndConfigFromConfigAdapter,
} from "./detectors/typescript";

export interface ImportLike {
  module: string;
  names: string[];
}

export interface PatternContext {
  language: string;
  file: FileInfo;
  /**
   * When true for TypeScript/JavaScript, scan file lines using
   * `third-party.patterns.yaml` `http_clients` regexes (fetch/axios/got, etc.).
   * Kept opt-in so other `matchPatterns` callers (routes/DB/auth/env) that pass
   * `normalizedPath` do not duplicate the same external-API line findings.
   */
  includeThirdPartyHttpLinePatterns?: boolean;
  imports?: ImportLike[];
  moduleLevelCalls?: {
    callee: string;
    argumentsSnippet: string;
    location: SourceLocation;
  }[];
  functions?: {
    name: string;
    decorators: string[];
    location: SourceLocation;
  }[];
  normalizedPath?: string;
}

function findFirstLineMatch(
  content: string,
  regex: RegExp | undefined,
): { line: number; code: string } | undefined {
  if (!regex) return undefined;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    if (regex.test(lineText)) {
      return { line: i + 1, code: lineText };
    }
  }
  return undefined;
}

function detectThirdPartyServicesFromImportsWithConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  const imports = ctx.imports ?? [];
  if (imports.length === 0) return [];

  const findings: RawFinding[] = [];

  for (const svc of config.thirdParty.services) {
    const hasImport = svc.importFragments.some((frag) =>
      imports.some(
        (imp) =>
          imp.module.includes(frag) || imp.names.some((name) => name.includes(frag)),
      ),
    );

    if (!hasImport) continue;

    findings.push({
      pattern: svc.patternId,
      name: svc.serviceName,
      confidence: svc.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: 1,
        endLine: 1,
      },
      properties: {
        client: svc.serviceName,
        serviceName: svc.serviceName,
      },
    });
  }

  return findings;
}

/**
 * Detect known third-party services (catalog-backed `external_api_call`)
 * from a language-agnostic `imports` list.
 *
 * This intentionally does not run other detectors (routes/DB/auth/env/etc).
 */
export function detectThirdPartyServicesFromImports(
  ctx: PatternContext,
): RawFinding[] {
  const config = loadUnifiedPatternConfig();
  return detectThirdPartyServicesFromImportsWithConfig(ctx, config);
}

function detectActorsFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  const rules = config.actors.rules;
  if (rules.length === 0) return [];

  const findings: RawFinding[] = [];

  const normalizedPath = (ctx.normalizedPath ?? ctx.file.path).toLowerCase();
  const content = ctx.file.content ?? "";
  const lines = content.split(/\r?\n/);
  const firstLine = lines[0] ?? "";

  for (const rule of rules) {
    let lineMatch: { line: number; code: string } | undefined;

    if (rule.filePathRegex && rule.filePathRegex.test(normalizedPath)) {
      lineMatch = { line: 1, code: firstLine };
    } else if (rule.contentRegex) {
      lineMatch = findFirstLineMatch(content, rule.contentRegex);
    }

    if (!lineMatch) continue;

    findings.push({
      pattern: rule.patternId,
      name: rule.name,
      confidence: rule.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: lineMatch.line,
        endLine: lineMatch.line,
        code: lineMatch.code,
      },
      properties: {
        ...rule.properties,
      },
    });
  }

  return findings;
}

/**
 * Shared entry point for YAML-driven pattern detection across languages.
 */
export function matchPatterns(ctx: PatternContext): RawFinding[] {
  const config = loadUnifiedPatternConfig();

  const findings: RawFinding[] = [];

  findings.push(
    ...detectThirdPartyServicesFromImportsWithConfig(ctx, config),
  );
  findings.push(
    ...detectTypeScriptJavaScriptExternalApisFromHttpClientsAdapter(
      ctx,
      config,
    ),
  );
  findings.push(...detectActorsFromConfig(ctx, config));

  findings.push(
    ...detectPythonDatabaseConnectionsFromImportsAndContentAdapter(ctx, config),
  );
  findings.push(...detectPythonAuthFromConfigAdapter(ctx, config));
  findings.push(...detectPythonEnvAndConfigFromConfigAdapter(ctx, config));
  findings.push(...detectPythonExternalApisFromConfigAdapter(ctx, config));
  findings.push(...detectPythonRoutesFromConfigAdapter(ctx, config));

  findings.push(...detectTypeScriptRoutesFromConfigAdapter(ctx, config));
  findings.push(...detectTypeScriptDatabaseFromConfigAdapter(ctx, config));
  findings.push(...detectTypeScriptAuthFromConfigAdapter(ctx, config));
  findings.push(...detectTypeScriptEnvAndConfigFromConfigAdapter(ctx, config));

  return findings;
}

