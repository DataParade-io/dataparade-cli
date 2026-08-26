import type { DetectedComponent } from "../../../../src/core/types/component";
import type { EvidenceRef, ReportedFinding, ScoredFileCoverage } from "../../types";

function evidenceFromSourceLocation(
  sourceLocation: {
    filePath: string;
    startLine: number;
    endLine: number;
  },
): EvidenceRef {
  return {
    filePath: sourceLocation.filePath,
    startLine: sourceLocation.startLine,
    endLine: sourceLocation.endLine,
  };
}

function collectEvidence(component: DetectedComponent): EvidenceRef[] {
  const evidence: EvidenceRef[] = [];

  for (const sourceLocation of component.sourceLocations) {
    evidence.push(evidenceFromSourceLocation(sourceLocation));
  }

  for (const detectedFrom of component.detectedFrom) {
    if (detectedFrom.sourceLocation) {
      evidence.push(evidenceFromSourceLocation(detectedFrom.sourceLocation));
    }
  }

  return evidence;
}

export function componentsToFindings(
  components: DetectedComponent[],
): ReportedFinding[] {
  return components.map((component) => {
    const labels = component.subType
      ? [component.type, component.subType]
      : [component.type];

    return {
      identity: `${component.type}:${component.name.toLowerCase()}`,
      name: component.name,
      labels,
      evidence: collectEvidence(component),
    };
  });
}

export function buildScannedFileCoverage(
  filesScanned: string[],
  allFilePaths: string[],
): ScoredFileCoverage[] {
  const scannedSet = new Set(filesScanned);
  return allFilePaths.map((filePath) => ({
    filePath,
    scanned: scannedSet.has(filePath),
  }));
}
