import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { getPropertiesFromFinding } from "../shared/property-inference";
import { parseCppTranslationUnit } from "./parser";
import { detectCppPatternsFromModel } from "./patterns";

export function detectCppPatterns(file: FileInfo): RawFinding[] {
  const model = parseCppTranslationUnit(file);

  if (model.file.language !== "cpp") {
    return [];
  }

  const findings = detectCppPatternsFromModel(model);

  // Merge pattern-matched component properties (from YAML) into each finding.
  for (const finding of findings) {
    const detected = getPropertiesFromFinding(finding, file.content);
    if (Object.keys(detected).length > 0) {
      finding.properties = { ...(finding.properties ?? {}), ...detected };
    }
  }

  return findings;
}
