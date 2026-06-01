import type { DetectedDataFlow } from "../core/types/data-flow";
import type { SourceLocation } from "../core/types/file";

function makeKey(flow: DetectedDataFlow): string {
  return `${flow.sourceComponentId}\t${flow.targetComponentId}\t${flow.type}`;
}

function locationsEqual(a: SourceLocation, b: SourceLocation): boolean {
  return (
    a.filePath === b.filePath &&
    a.startLine === b.startLine &&
    a.endLine === b.endLine
  );
}

function compareSourceLocations(a: SourceLocation, b: SourceLocation): number {
  const fileCmp = a.filePath.localeCompare(b.filePath);
  if (fileCmp !== 0) return fileCmp;
  if (a.startLine !== b.startLine) return a.startLine - b.startLine;
  if (a.endLine !== b.endLine) return a.endLine - b.endLine;
  return 0;
}

function collectUniqueSourceLocations(flows: DetectedDataFlow[]): SourceLocation[] {
  const all: SourceLocation[] = [];
  const seen = new Set<string>();

  const locKey = (loc: SourceLocation) =>
    `${loc.filePath}:${loc.startLine}:${loc.endLine}`;

  for (const flow of flows) {
    if (flow.sourceLocation) {
      const key = locKey(flow.sourceLocation);
      if (!seen.has(key)) {
        seen.add(key);
        all.push(flow.sourceLocation);
      }
    }

    if (flow.sourceLocations) {
      for (const loc of flow.sourceLocations) {
        const key = locKey(loc);
        if (!seen.has(key)) {
          seen.add(key);
          all.push(loc);
        }
      }
    }
  }

  return all;
}

/**
 * Deduplicate DetectedDataFlow[] by (sourceComponentId, targetComponentId, type).
 * Preserves the base flow's id and metadata, uses the highest confidence,
 * and unions all contributing source locations.
 */
export function dedupeDataFlows(flows: DetectedDataFlow[]): DetectedDataFlow[] {
  const groups = new Map<string, DetectedDataFlow[]>();

  for (const flow of flows) {
    const key = makeKey(flow);
    const existing = groups.get(key);
    if (existing) {
      existing.push(flow);
    } else {
      groups.set(key, [flow]);
    }
  }

  const result: DetectedDataFlow[] = [];

  const groupEntries = Array.from(groups.entries()).sort(([aKey], [bKey]) =>
    aKey.localeCompare(bKey),
  );

  for (const [, group] of groupEntries) {
    const maxConfidence = group.reduce(
      (max, flow) => (flow.confidence > max ? flow.confidence : max),
      group[0]?.confidence ?? 0,
    );

    const base = [...group].sort((a, b) => {
      // Deterministic base selection:
      // - highest confidence
      // - tie-break by stable id
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return a.id.localeCompare(b.id);
    })[0]!;

    const allLocations = collectUniqueSourceLocations(group).sort(
      compareSourceLocations,
    );
    const primary = allLocations[0];

    result.push({
      ...base,
      confidence: maxConfidence,
      sourceLocation: primary ?? base.sourceLocation,
      sourceLocations:
        allLocations.length > 0 ? allLocations : base.sourceLocations,
    });
  }

  return result.sort((a, b) => {
    const keyA = makeKey(a);
    const keyB = makeKey(b);
    const cmp = keyA.localeCompare(keyB);
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  });
}

