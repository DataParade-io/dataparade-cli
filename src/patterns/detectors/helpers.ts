import type { FileInfo, SourceLocation } from "../../core/types/file";
import type { PatternContext } from "../engine";
import type { UnifiedPatternConfig } from "../config";

/** Prefer comment-stripped source when the analyzer supplies it. */
export function sourceOf(ctx: PatternContext): string {
  return ctx.strippedContent ?? ctx.file.content ?? "";
}

export function createLocationFromLine(
  file: FileInfo,
  line: number,
  code?: string,
): SourceLocation {
  return {
    filePath: file.path,
    startLine: line,
    endLine: line,
    code,
  };
}

export function findLineMatches(
  content: string,
  regex: RegExp,
): { line: number; match: RegExpMatchArray }[] {
  const results: { line: number; match: RegExpMatchArray }[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    const trimmed = lineText.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*")
    ) {
      continue;
    }
    const match = lineText.match(regex);
    if (match) {
      results.push({
        line: i + 1,
        match,
      });
    }
  }

  return results;
}

export function findFirstLineMatch(
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

export function buildThirdPartyUrlHostPatterns(
  config: UnifiedPatternConfig,
): {
  pattern: string;
  serviceName: string;
}[] {
  const urlHostPatterns: { pattern: string; serviceName: string }[] = [];
  for (const svc of config.thirdParty.services) {
    for (const pattern of svc.urlHostPatterns) {
      urlHostPatterns.push({ pattern, serviceName: svc.serviceName });
    }
  }
  return urlHostPatterns;
}

export function inferServiceNameFromUrl(
  url: string | undefined,
  urlHostPatterns: { pattern: string; serviceName: string }[],
): string | undefined {
  if (!url || urlHostPatterns.length === 0) return undefined;
  const lower = url.toLowerCase();

  for (const { pattern, serviceName } of urlHostPatterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return serviceName;
    }
  }
  return undefined;
}

