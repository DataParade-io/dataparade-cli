import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import type { RawFinding } from "../core/types/detection";
import type { FileInfo, SourceLocation } from "../core/types/file";
import type { ServiceSection } from "../core/sectioning/discover-service-sections";
import { buildFlow } from "./flow-builder";
import { findSourceComponent, getSectionIdFromComponent } from "./source-resolution";

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function componentDeclaredPathsMatch(
  component: DetectedComponent,
  normalizedPath: string,
): boolean {
  const raw = component.properties?.path;
  const pathStrings: string[] = [];
  if (typeof raw === "string") {
    pathStrings.push(raw);
  } else if (Array.isArray(raw)) {
    for (const p of raw) {
      if (typeof p === "string") pathStrings.push(p);
    }
  }
  for (const pathStr of pathStrings) {
    const compPath = normalizeKey(pathStr);
    if (
      compPath &&
      (compPath === normalizedPath || normalizedPath.startsWith(compPath))
    ) {
      return true;
    }
  }
  return false;
}

function findTargetApiComponentByPath(
  pathStr: string,
  components: DetectedComponent[],
  opts?: {
    preferredSectionId?: string;
    excludeComponentId?: string;
    excludeMainApplicationTargets?: boolean;
  },
): DetectedComponent | undefined {
  const normalizedPath = normalizeKey(pathStr);
  if (!normalizedPath) return undefined;

  for (const c of components) {
    if (c.type !== "asset" || c.subType !== "api") continue;
    if (
      opts?.preferredSectionId &&
      getSectionIdFromComponent(c) !== opts.preferredSectionId
    ) {
      continue;
    }
    if (opts?.excludeComponentId && c.id === opts.excludeComponentId) {
      continue;
    }
    if (
      opts?.excludeMainApplicationTargets &&
      (c.properties?.isMainApplication === true ||
        c.properties?.isMainApplication === "true")
    ) {
      continue;
    }
    const compName = normalizeKey(c.name);

    if (componentDeclaredPathsMatch(c, normalizedPath)) {
      return c;
    }
    if (compName && (compName === normalizedPath || compName.includes(normalizedPath))) {
      return c;
    }
  }

  // Fallback: we couldn't match by path/name. Pick the main API asset within
  // the preferred section (if any), so internal calls do not create
  // cross-section edges.
  const apiCandidates = components.filter(
    (c) => c.type === "asset" && c.subType === "api",
  );
  const filtered = opts?.preferredSectionId
    ? apiCandidates.filter(
        (c) => getSectionIdFromComponent(c) === opts.preferredSectionId,
      )
    : apiCandidates;
  const filteredNoExclude =
    opts?.excludeComponentId && filtered.length > 0
      ? filtered.filter((c) => c.id !== opts.excludeComponentId)
      : filtered;
  const filteredNoMain =
    opts?.excludeMainApplicationTargets && filteredNoExclude.length > 0
      ? filteredNoExclude.filter(
          (c) =>
            c.properties?.isMainApplication !== true &&
            c.properties?.isMainApplication !== "true",
        )
      : filteredNoExclude;

  const main = filteredNoMain.find(
    (c) =>
      c.properties?.isMainApplication === true ||
      c.properties?.isMainApplication === "true",
  );

  return main ?? filteredNoMain[0];
}

export function detectInternalFetchCalls(
  files: FileInfo[],
  components: DetectedComponent[],
  sourceComponent: DetectedComponent,
  startIndex: number,
  sections?: ServiceSection[],
): { flows: DetectedDataFlow[]; nextIndex: number } {
  const flows: DetectedDataFlow[] = [];
  let index = startIndex;

  const stringFetchRegex = /fetch\(\s*(['"`])(\/[^'"`]+)\1/g;
  const templateFetchRegex = /fetch\(\s*`(\/[^`]+)`/g;
  // Matches template-string fetch calls where the backend path is appended to
  // a base URL variable, e.g. fetch(`${API_BASE_URL}/auth/login`, ...)
  const templateFetchWithBaseRegex = /fetch\(\s*`([^`]+)`/g;

  const findNearestSectionIdForFilePath = (
    filePathRelPosix: string,
  ): string => {
    if (!sections || sections.length === 0) return "root";

    let bestId: string | undefined;
    let bestLen = -1;

    for (const s of sections) {
      if (!s.sectionDir) continue; // root handled as fallback
      if (
        filePathRelPosix === s.sectionDir ||
        filePathRelPosix.startsWith(`${s.sectionDir}/`)
      ) {
        if (s.sectionDir.length > bestLen) {
          bestId = s.id;
          bestLen = s.sectionDir.length;
        }
      }
    }

    return (
      bestId ??
      sections.find((s) => s.id === "root")?.id ??
      sections[0]?.id ??
      "root"
    );
  };

  const findSectionApiNodeForSection = (
    sectionId: string,
  ): DetectedComponent | undefined =>
    components.find(
      (c) =>
        c.type === "asset" &&
        c.subType === "api" &&
        getSectionIdFromComponent(c) === sectionId &&
        (c.properties?.isSectionApiNode === true ||
          c.properties?.isSectionApiNode === "true"),
    );

  for (const file of files) {
    if (!file.content) continue;

    const fileSectionId = findNearestSectionIdForFilePath(file.path);
    const sourceForFile = findSourceComponent(components, fileSectionId) ?? sourceComponent;
    const sourceForFileApi = findSectionApiNodeForSection(fileSectionId) ?? sourceForFile;

    const lines = file.content.split(/\r?\n/);

    const scan = (regex: RegExp) => {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(file.content)) !== null) {
        const fullPath = match[2] ?? match[1];
        if (!fullPath || typeof fullPath !== "string") continue;

        const target = findTargetApiComponentByPath(fullPath, components, {
          preferredSectionId: fileSectionId,
          excludeComponentId: sourceForFileApi.id,
          excludeMainApplicationTargets:
            sourceForFileApi.properties?.isSectionApiNode === true ||
            sourceForFileApi.properties?.isSectionApiNode === "true",
        });
        if (!target) continue;

        const offset = match.index;
        const prefix = file.content.slice(0, offset);
        const line = prefix.split(/\r?\n/).length;

        const location: SourceLocation = {
          filePath: file.path,
          startLine: line,
          endLine: line,
          code: lines[line - 1],
        };

        const syntheticFinding: RawFinding = {
          pattern: "express_route",
          name: `INTERNAL_FETCH ${fullPath}`,
          confidence: 0.8,
          location,
          properties: {
            httpMethod: "GET",
            url: fullPath,
          },
        };

        const flow = buildFlow(
          sourceForFileApi.id,
          target.id,
          "api_call",
          syntheticFinding,
          ++index,
          sourceForFileApi,
          target,
        );
        flows.push(flow);
      }
    };

    scan(stringFetchRegex);
    scan(templateFetchRegex);

    // Extra pass for template strings that include a base URL expression.
    templateFetchWithBaseRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = templateFetchWithBaseRegex.exec(file.content)) !== null) {
      const templateContent = match[1];
      if (typeof templateContent !== "string") continue;

      // Attempt to extract the trailing literal path after the last `${...}`.
      // Example: "${API_BASE_URL}/auth/login" => "/auth/login"
      const lastBrace = templateContent.lastIndexOf("}");
      let fullPath: string | undefined;
      if (lastBrace !== -1) {
        const after = templateContent.slice(lastBrace + 1);
        if (after.startsWith("/")) fullPath = after;
      }
      // If it doesn't include a base URL expression, fall back to literal path.
      if (!fullPath && templateContent.startsWith("/")) fullPath = templateContent;
      if (!fullPath) continue;

      const target = findTargetApiComponentByPath(fullPath, components, {
        preferredSectionId: fileSectionId,
        excludeComponentId: sourceForFileApi.id,
        excludeMainApplicationTargets:
          sourceForFileApi.properties?.isSectionApiNode === true ||
          sourceForFileApi.properties?.isSectionApiNode === "true",
      });
      if (!target) continue;

      const offset = match.index;
      const prefix = file.content.slice(0, offset);
      const line = prefix.split(/\r?\n/).length;

      const location: SourceLocation = {
        filePath: file.path,
        startLine: line,
        endLine: line,
        code: lines[line - 1],
      };

      const syntheticFinding: RawFinding = {
        pattern: "express_route",
        name: `INTERNAL_FETCH ${fullPath}`,
        confidence: 0.8,
        location,
        properties: {
          httpMethod: "GET",
          url: fullPath,
        },
      };

      const flow = buildFlow(
        sourceForFileApi.id,
        target.id,
        "api_call",
        syntheticFinding,
        ++index,
        sourceForFileApi,
        target,
      );
      flows.push(flow);
    }
  }

  return { flows, nextIndex: index };
}

