import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import type { PythonModuleModel } from "./parser";
import { parsePythonModule } from "./parser";
import { getPropertiesFromFinding } from "../shared/property-inference";
import {
  detectPythonAuthPatterns,
  detectPythonConfigAndEnvUsage,
  detectPythonDatabaseConnections,
  detectPythonExternalApiCalls,
  detectPythonRoutePatterns,
  detectPythonServerlessHandlers,
} from "./patterns";

export function detectPythonPatterns(file: FileInfo): RawFinding[] {
  const moduleModel: PythonModuleModel = parsePythonModule(file);

  if (moduleModel.file.language !== "python") {
    return [];
  }

  const findings: RawFinding[] = [];

  findings.push(
    ...detectPythonRoutePatterns(moduleModel),
    ...detectPythonDatabaseConnections(moduleModel),
    ...detectPythonExternalApiCalls(moduleModel),
    ...detectPythonAuthPatterns(moduleModel),
    ...detectPythonConfigAndEnvUsage(moduleModel),
    ...detectPythonServerlessHandlers(moduleModel),
  );

  // Merge pattern-matched component properties (from YAML) into each finding.
  for (const finding of findings) {
    const detected = getPropertiesFromFinding(finding, file.content);
    if (Object.keys(detected).length > 0) {
      finding.properties = { ...(finding.properties ?? {}), ...detected };
    }
  }

  return findings;
}

