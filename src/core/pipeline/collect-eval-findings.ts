import type { SourceLocation } from "../types/file";
import { runStructuralScan } from "./structural-scan";

export interface EvalFinding {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface EvalFindingsPayload {
  findings: EvalFinding[];
  filesScanned: string[];
}

export interface CollectEvalFindingsResult extends EvalFindingsPayload {
  warnings: string[];
  errors: string[];
}

function toEvalFinding(location: SourceLocation): EvalFinding {
  return {
    filePath: location.filePath,
    startLine: location.startLine,
    endLine: location.endLine,
  };
}

function spanKey(finding: EvalFinding): string {
  return `${finding.filePath}:${finding.startLine}:${finding.endLine}`;
}

function compareEvalFindings(a: EvalFinding, b: EvalFinding): number {
  const fileCmp = a.filePath.localeCompare(b.filePath);
  if (fileCmp !== 0) return fileCmp;
  if (a.startLine !== b.startLine) return a.startLine - b.startLine;
  return a.endLine - b.endLine;
}

export async function collectEvalFindings(
  rootPath: string,
): Promise<CollectEvalFindingsResult> {
  const { findings, scanResult, files } = await runStructuralScan(rootPath);

  const spans = new Map<string, EvalFinding>();

  const addLocation = (location: SourceLocation) => {
    const entry = toEvalFinding(location);
    spans.set(spanKey(entry), entry);
  };

  for (const finding of findings) {
    addLocation(finding.location);
  }

  for (const component of scanResult.components) {
    for (const location of component.sourceLocations ?? []) {
      addLocation(location);
    }
  }

  const dedupedFindings = [...spans.values()].sort(compareEvalFindings);
  const filesScanned = [...new Set(files.map((file) => file.path))].sort();

  return {
    findings: dedupedFindings,
    filesScanned,
    warnings: scanResult.warnings ?? [],
    errors: scanResult.errors ?? [],
  };
}
