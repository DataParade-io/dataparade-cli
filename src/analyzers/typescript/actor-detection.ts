import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import type { ParserResult } from "./parser";
import { matchPatterns } from "../../patterns/engine";
import { loadUnifiedPatternConfig } from "../../patterns/config";

export function detectActorsFromFile(
  file: FileInfo,
  model: ParserResult,
): RawFinding[] {
  const unified = loadUnifiedPatternConfig();
  const actorPatternIds = new Set(unified.actors.rules.map((r) => r.patternId));

  const findings = matchPatterns({
    language: model.language,
    file,
    normalizedPath: model.normalizedPath,
  });

  return findings.filter((f) => actorPatternIds.has(f.pattern));
}

