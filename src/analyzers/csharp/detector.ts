import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { getPropertiesFromFinding } from "../shared/property-inference";
import { parseCSharpCompilationUnit } from "./parser";
import { detectCSharpPatternsFromModel } from "./patterns";

export function detectCSharpPatterns(file: FileInfo): RawFinding[] {
  const model = parseCSharpCompilationUnit(file);

  if (model.file.language !== "csharp") {
    return [];
  }

  const findings = detectCSharpPatternsFromModel(model);

  // Merge pattern-matched component properties (from YAML) into each finding.
  for (const finding of findings) {
    const detected = getPropertiesFromFinding(finding, file.content);
    if (Object.keys(detected).length > 0) {
      finding.properties = { ...(finding.properties ?? {}), ...detected };
    }
  }

  return findings;
}
