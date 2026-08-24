import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { getPropertiesFromFinding } from "../shared/property-inference";
import { parseGoSourceFile } from "./parser";
import { detectGoPatternsFromModel } from "./patterns";

export function detectGoPatterns(file: FileInfo): RawFinding[] {
  const model = parseGoSourceFile(file);

  if (model.file.language !== "go") {
    return [];
  }

  const findings = detectGoPatternsFromModel(model);

  // Merge pattern-matched component properties (from YAML) into each finding.
  for (const finding of findings) {
    const detected = getPropertiesFromFinding(finding, file.content);
    if (Object.keys(detected).length > 0) {
      finding.properties = { ...(finding.properties ?? {}), ...detected };
    }
  }

  return findings;
}
