import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { buildCodeModel } from "./parser";
import {
  detectAuthMiddleware,
  detectConfigAndEnvUsage,
  detectDatabaseConnections,
  detectExternalApiCalls,
  detectRoutePatterns,
  detectServerlessHandlers,
} from "./typescript-detection";
import { getPropertiesFromFinding } from "../shared/property-inference";
import { detectActorsFromFile } from "./actor-detection";

export function detectPatterns(file: FileInfo): RawFinding[] {
  const model = buildCodeModel(file);

  if (model.language !== "typescript" && model.language !== "javascript") {
    return [];
  }

  const findings: RawFinding[] = [];

  findings.push(
    ...detectRoutePatterns(file, model),
    ...detectDatabaseConnections(file, model),
    ...detectExternalApiCalls(file, model),
    ...detectAuthMiddleware(file, model),
    ...detectConfigAndEnvUsage(file, model),
    ...detectServerlessHandlers(file, model),
    ...detectActorsFromFile(file, model),
  );

  // Merge pattern-matched component properties into each finding so classifier/enhancer get them
  for (const finding of findings) {
    const detected = getPropertiesFromFinding(finding, file.content);
    if (Object.keys(detected).length > 0) {
      finding.properties = { ...finding.properties, ...detected };
    }
  }

  return findings;
}

