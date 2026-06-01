import { isOutboundExternalHttpApiAsset } from "../classifier/main-application-selection";
import type { DetectedComponent } from "../core/types/component";
import type { RawFinding } from "../core/types/detection";
import type { FileInfo } from "../core/types/file";
import {
  normalizeProjectPath,
  parseStaticImportBindings,
  shortestImportDistance,
} from "./import-graph";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getFileContent(files: FileInfo[], filePath: string): string | undefined {
  const n = normalizeProjectPath(filePath);
  const hit = files.find((f) => normalizeProjectPath(f.path) === n);
  return hit?.content;
}

function getRouteRegistrationAnchor(
  route: DetectedComponent,
): { file: string; line: number } | undefined {
  if (route.sourceLocations.length === 0) return undefined;
  const byFile = new Map<string, number[]>();
  for (const sl of route.sourceLocations) {
    const f = normalizeProjectPath(sl.filePath);
    const arr = byFile.get(f) ?? [];
    arr.push(sl.startLine);
    byFile.set(f, arr);
  }
  const sortedFiles = [...byFile.keys()].sort((a, b) => a.localeCompare(b));
  const file = sortedFiles[0];
  const lines = byFile.get(file);
  if (!lines?.length) return undefined;
  return { file, line: Math.min(...lines) };
}

function routeRegistrationReferencesCallFile(
  route: DetectedComponent,
  callFile: string,
  files: FileInfo[],
  knownPaths: Set<string>,
): boolean {
  const anchor = getRouteRegistrationAnchor(route);
  if (!anchor) return false;
  const content = getFileContent(files, anchor.file);
  if (!content) return false;
  const bindings = parseStaticImportBindings(anchor.file, content, knownPaths);
  const normCall = normalizeProjectPath(callFile);
  const lines = content.split(/\r?\n/);
  const startIdx = Math.max(0, anchor.line - 1);
  const block = lines.slice(startIdx, startIdx + 30).join("\n");

  for (const [local, resolved] of bindings) {
    if (normalizeProjectPath(resolved) !== normCall) continue;
    const re = new RegExp(`\\b${escapeRegExp(local)}\\s*\\(`);
    if (re.test(block)) return true;
  }
  return false;
}

function findRouteContainingCallLine(
  callFile: string,
  callLine: number,
  apiRouteAssets: DetectedComponent[],
): DetectedComponent | undefined {
  const nCall = normalizeProjectPath(callFile);
  const candidates: { route: DetectedComponent; regLine: number }[] = [];

  for (const route of apiRouteAssets) {
    const inFileLocs = route.sourceLocations.filter(
      (l) => normalizeProjectPath(l.filePath) === nCall,
    );
    if (inFileLocs.length === 0) continue;
    const regLine = Math.min(...inFileLocs.map((l) => l.startLine));
    candidates.push({ route, regLine });
  }

  candidates.sort((a, b) => b.regLine - a.regLine);
  for (const c of candidates) {
    if (c.regLine <= callLine) return c.route;
  }
  return undefined;
}

function listApiRouteAssets(
  components: DetectedComponent[],
  defaultSource: DetectedComponent,
): DetectedComponent[] {
  return components.filter((c) => {
    if (c.type !== "asset" || c.subType !== "api") return false;
    if (c.id === defaultSource.id) return false;
    if (
      c.properties?.isMainApplication === true ||
      c.properties?.isMainApplication === "true"
    ) {
      return false;
    }
    // Outbound fetch/SDK calls to vendor URLs are not in-app route surfaces; if we
    // treat them like Express routes, other calls in the same file get mis-attributed.
    if (isOutboundExternalHttpApiAsset(c)) {
      return false;
    }
    return true;
  });
}

/**
 * Prefer the API route asset that owns an external call
 * (same file, import chain, or handler binding).
 */
export function findSourceComponentForExternalApiCall(
  finding: RawFinding,
  components: DetectedComponent[],
  defaultSource: DetectedComponent,
  files: FileInfo[],
  importGraph: Map<string, Set<string>>,
  knownPaths: Set<string>,
): DetectedComponent {
  const loc = finding.location;
  if (!loc?.filePath || files.length === 0) return defaultSource;

  const callFile = normalizeProjectPath(loc.filePath);
  const callLine = typeof loc.startLine === "number" ? loc.startLine : 1;
  const apiRouteAssets = listApiRouteAssets(components, defaultSource);

  if (apiRouteAssets.length === 0) return defaultSource;

  const containing = findRouteContainingCallLine(callFile, callLine, apiRouteAssets);
  if (containing) return containing;

  type Scored = { route: DetectedComponent; distance: number };
  const scored: Scored[] = [];

  for (const route of apiRouteAssets) {
    const regFiles = [
      ...new Set(route.sourceLocations.map((sl) => normalizeProjectPath(sl.filePath))),
    ];
    if (regFiles.length === 0) continue;

    let best: number | undefined;
    for (const reg of regFiles) {
      const d = shortestImportDistance(importGraph, reg, callFile);
      if (d === undefined) continue;
      best = best === undefined ? d : Math.min(best, d);
    }
    if (best !== undefined) {
      scored.push({ route, distance: best });
    }
  }

  if (scored.length === 0) return defaultSource;

  const minD = Math.min(...scored.map((s) => s.distance));
  const atMin = scored.filter((s) => s.distance === minD);
  if (atMin.length === 1) return atMin[0].route;

  const referenced = atMin.filter((s) =>
    routeRegistrationReferencesCallFile(s.route, callFile, files, knownPaths),
  );
  if (referenced.length === 1) return referenced[0].route;

  return defaultSource;
}

