import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { getPropertiesFromFinding } from "../shared/property-inference";
import { parsePhpSourceFile } from "./parser";
import { detectPhpPatternsFromModel } from "./patterns";

export function detectPhpPatterns(file: FileInfo): RawFinding[] {
  const model = parsePhpSourceFile(file);

  if (model.file.language !== "php") {
    return [];
  }

  const findings = detectPhpPatternsFromModel(model);

  for (const finding of findings) {
    const detected = getPropertiesFromFinding(finding, file.content);
    if (Object.keys(detected).length > 0) {
      finding.properties = { ...(finding.properties ?? {}), ...detected };
    }
  }

  return findings;
}
