import * as path from "path";
import type { FileInfo, SourceLocation } from "../../core/types/file";
import type { TerraformPatternConfig } from "./terraform-detection-config";

export type TerraformBlockKind = "resource" | "data" | "module" | "provider";

export interface ParsedTerraformBlock {
  kind: TerraformBlockKind;
  /** First quoted label for resource/data (e.g. aws_lambda_function); provider name for provider; omitted for module. */
  resourceType?: string;
  /** Second quoted label for resource/data; module name for module. */
  blockName: string;
  address: string;
  startLine: number;
  endLine: number;
  bodyText: string;
}

export interface ParseTerraformFileResult {
  blocks: ParsedTerraformBlock[];
  warnings: string[];
}

export function lineBeforeHashComment(raw: string): string {
  const idx = raw.indexOf("#");
  if (idx === -1) return raw;
  return raw.slice(0, idx);
}

/**
 * Net `{` minus `}` on a line, ignoring braces inside double-quoted strings
 * and treating `#` as line comment start (best-effort; heredocs not modeled).
 */
export function lineBraceDelta(line: string): number {
  let delta = 0;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inDouble) {
      if (ch === "\\" && i + 1 < line.length) {
        i += 1;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "#") break;
    if (ch === "{") delta += 1;
    if (ch === "}") delta -= 1;
  }
  return delta;
}

function matchBlockLine(
  trimmed: string,
  config: TerraformPatternConfig,
):
  | {
      kind: TerraformBlockKind;
      resourceType?: string;
      blockName: string;
    }
  | undefined {
  for (const bp of config.syntax.blockPatterns) {
    const m = bp.regex.exec(trimmed);
    if (!m) continue;
    const blockName = m[bp.blockNameGroup]?.trim();
    if (!blockName) continue;
    let resourceType: string | undefined;
    if (typeof bp.resourceTypeGroup === "number") {
      resourceType = m[bp.resourceTypeGroup]?.trim();
      if (!resourceType) continue;
    }
    return { kind: bp.kind, resourceType, blockName };
  }
  return undefined;
}

function applyTemplate(template: string, m: RegExpMatchArray): string {
  return template.replace(/\$(\d+)/g, (_, idx: string) => {
    const n = Number(idx);
    const v = m[n];
    return typeof v === "string" ? v : "";
  });
}

function computeAddress(
  kind: TerraformBlockKind,
  resourceType: string | undefined,
  blockName: string,
): string {
  if (kind === "module") return `module.${blockName}`;
  if (kind === "provider") return `provider.${blockName}`;
  if (kind === "data" && resourceType)
    return `data.${resourceType}.${blockName}`;
  if (kind === "resource" && resourceType)
    return `${resourceType}.${blockName}`;
  return blockName;
}

export function parseTerraformFile(
  file: FileInfo,
  config: TerraformPatternConfig,
): ParseTerraformFileResult {
  const warnings: string[] = [];
  const blocks: ParsedTerraformBlock[] = [];

  if (file.language !== "terraform") {
    warnings.push(
      `parseTerraformFile called for non-terraform file '${file.path}'.`,
    );
    return { blocks, warnings };
  }

  const lines = file.content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lineBeforeHashComment(lines[i]).trim();
    if (!trimmed || !config.syntax.blockLineProbe.test(trimmed)) continue;

    const startLine = i + 1;
    const matched = matchBlockLine(trimmed, config);
    if (!matched) continue;

    const { kind, resourceType, blockName } = matched;

    let depth = lineBraceDelta(lines[i]);
    if (depth <= 0) {
      warnings.push(
        `Terraform block at ${file.path}:${startLine} has no opening brace depth; skipping.`,
      );
      continue;
    }

    const bodyStartIdx = i + 1;
    let j = bodyStartIdx;
    while (j < lines.length && depth > 0) {
      depth += lineBraceDelta(lines[j]);
      j += 1;
    }

    if (depth !== 0) {
      warnings.push(
        `Unbalanced braces for Terraform block starting at ${file.path}:${startLine}.`,
      );
      break;
    }

    const endLine = j;
    const bodyLines = lines.slice(i, j);
    const bodyText = bodyLines.join("\n");
    const address = computeAddress(kind, resourceType, blockName);

    blocks.push({
      kind,
      resourceType,
      blockName,
      address,
      startLine,
      endLine,
      bodyText,
    });

    i = j - 1;
  }

  return { blocks, warnings };
}

export function extractTerraformReferences(
  bodyText: string,
  config: TerraformPatternConfig,
): string[] {
  const refs = new Set<string>();

  for (const rp of config.referencePatterns) {
    for (const m of bodyText.matchAll(rp.regex)) {
      if (rp.skipWhenFirstTokenReserved) {
        const first = m[1]?.toLowerCase();
        if (first && config.reservedReferencePrefixes.has(first)) continue;
      }
      const addr = applyTemplate(rp.template, m).trim();
      if (addr) refs.add(addr);
    }
  }

  return Array.from(refs).sort((a, b) => a.localeCompare(b));
}

export function sectionIdFromFilePath(filePath: string): string {
  const dir = path.posix.dirname(filePath.replace(/\\/g, "/"));
  return dir === "." ? "root" : dir;
}

export function sectionLabelFromFilePath(filePath: string): string {
  const posix = filePath.replace(/\\/g, "/");
  const dir = path.posix.dirname(posix);
  if (dir === ".") {
    const base = path.posix.basename(posix);
    return base.replace(/\.(tf|tfvars)$/i, "") || "terraform";
  }
  const leaf = path.posix.basename(dir);
  return leaf || "terraform";
}

export function blockSourceLocation(
  filePath: string,
  startLine: number,
  endLine: number,
): SourceLocation {
  return {
    filePath,
    startLine,
    endLine,
  };
}
