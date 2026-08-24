import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { getPropertiesFromFinding } from "../shared/property-inference";
import { parseJvmSourceFile } from "./parser";
import { detectJvmPatternsFromModel } from "./patterns";

export function detectJvmPatterns(file: FileInfo): RawFinding[] {
  const model = parseJvmSourceFile(file);

  if (model.file.language !== "java" && model.file.language !== "kotlin") {
    return [];
  }

  const findings = detectJvmPatternsFromModel(model);

  // Merge pattern-matched component properties (from YAML) into each finding.
  for (const finding of findings) {
    const detected = getPropertiesFromFinding(finding, file.content);
    if (Object.keys(detected).length > 0) {
      finding.properties = { ...(finding.properties ?? {}), ...detected };
    }
  }

  return findings;
}
