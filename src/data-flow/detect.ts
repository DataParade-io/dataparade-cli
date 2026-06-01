import path from "node:path";

import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import type { RawFinding } from "../core/types/detection";
import type { FileInfo } from "../core/types/file";
import type { ServiceSection } from "../core/sectioning/discover-service-sections";
import {
  FRONTEND_RUNTIME_FILE_EXTENSIONS,
  FRONTEND_RUNTIME_PATH_MARKERS,
  NON_RUNTIME_METADATA_EXTENSIONS,
  NON_RUNTIME_METADATA_FILE_NAMES,
  ROUTE_HANDLER_FILE_SUFFIXES,
  ROUTE_HANDLER_PATH_MARKERS,
} from "../patterns/flow-source-patterns";
import { buildFlow, flowTypeForExternalApi } from "./flow-builder";
import {
  findSectionApiNode,
  findSourceComponent,
  getSectionIdFromComponent,
  getSectionIdFromFinding,
  isConcreteServiceSectionId,
} from "./source-resolution";
import {
  buildImportAdjacency,
  buildKnownPathsSet,
  normalizeProjectPath,
} from "./import-graph";
import { findSourceComponentForExternalApiCall } from "./source-attribution";
import {
  findMergedHttpApiSurfaceComponent,
  findTargetActorComponent,
  findTargetAssetForRoute,
  findTargetDatabaseComponent,
  findTargetThirdPartyComponent,
} from "./target-matching";
import { detectInternalFetchCalls } from "./internal-fetch";
import {
  appendTerraformDataFlows,
} from "./terraform-flows";

function isManifestOrNonRuntimeMetadataFile(normalizedPath: string): boolean {
  const fileName = path.posix.basename(normalizedPath).toLowerCase();
  if (NON_RUNTIME_METADATA_FILE_NAMES.has(fileName)) return true;
  return NON_RUNTIME_METADATA_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

function isClearlyFrontendRuntimeFile(normalizedPath: string): boolean {
  const p = normalizedPath.toLowerCase();
  if (p.includes("/app/api/")) return false;
  if (FRONTEND_RUNTIME_PATH_MARKERS.some((marker) => p.includes(marker))) return true;
  return FRONTEND_RUNTIME_FILE_EXTENSIONS.some((ext) => p.endsWith(ext));
}

function isLikelyRouteHandlerFile(normalizedPath: string): boolean {
  const p = normalizedPath.toLowerCase();
  if (ROUTE_HANDLER_PATH_MARKERS.some((marker) => p.includes(marker))) return true;
  return ROUTE_HANDLER_FILE_SUFFIXES.some((suffix) => p.endsWith(suffix));
}

function isAuthProviderThirdParty(component: DetectedComponent): boolean {
  if (component.type !== "third_party") return false;
  const serviceName = component.properties?.serviceName;
  const normalizedService =
    typeof serviceName === "string" ? serviceName.trim().toLowerCase() : "";
  const normalizedName = (component.name || "").trim().toLowerCase();
  return normalizedService.includes("auth0") || normalizedName.includes("auth0");
}

function findAuthMiddlewareTarget(
  finding: RawFinding,
  components: DetectedComponent[],
): DetectedComponent | undefined {
  const sectionId = getSectionIdFromFinding(finding);

  const authServiceInSection = components.find(
    (c) =>
      c.type === "asset" &&
      c.subType === "auth_service" &&
      (!sectionId || getSectionIdFromComponent(c) === sectionId),
  );
  if (authServiceInSection) return authServiceInSection;

  const authThirdPartyInSection = components.find(
    (c) =>
      isAuthProviderThirdParty(c) &&
      (!sectionId || getSectionIdFromComponent(c) === sectionId),
  );
  if (authThirdPartyInSection) return authThirdPartyInSection;

  // For concrete section-scoped findings, avoid cross-section fallback.
  if (isConcreteServiceSectionId(sectionId)) {
    return undefined;
  }

  return (
    components.find((c) => c.type === "asset" && c.subType === "auth_service") ??
    components.find((c) => isAuthProviderThirdParty(c))
  );
}

/**
 * Build raw data flows from findings/components/files.
 *
 * This module is intentionally orchestration-focused: heavy matching/parsing logic
 * lives in focused helpers (`source-*`, `target-matching`, `import-graph`,
 * `internal-fetch`, `flow-builder`).
 *
 * Note: structural post-processing (dedupe/rewire/ensure actor flow) is handled
 * outside this function.
 */
export function detectDataFlows(
  files: FileInfo[],
  components: DetectedComponent[],
  findings: RawFinding[],
  sections?: ServiceSection[],
): DetectedDataFlow[] {
  const defaultSource = findSourceComponent(components);
  if (!defaultSource) return [];

  const sourceBySectionId = new Map<string, DetectedComponent | undefined>();

  const getSourceForFinding = (
    finding: RawFinding,
  ): DetectedComponent => {
    const findingSectionId = getSectionIdFromFinding(finding);
    const key = findingSectionId ?? "__global__";

    if (sourceBySectionId.has(key)) {
      return sourceBySectionId.get(key) ?? defaultSource;
    }

    const resolved = findSourceComponent(components, findingSectionId);
    sourceBySectionId.set(key, resolved);
    return resolved ?? defaultSource;
  };

  const hasFiles = files.length > 0;
  const knownPaths = hasFiles ? buildKnownPathsSet(files) : new Set<string>();
  const importGraph = hasFiles
    ? buildImportAdjacency(files, knownPaths)
    : new Map<string, Set<string>>();

  const flows: DetectedDataFlow[] = [];
  let flowIndex = 0;

  for (const finding of findings) {
    const sourceComponent = getSourceForFinding(finding);
    const findingSectionId = getSectionIdFromFinding(finding);
    const sectionApiSource =
      findSectionApiNode(components, findingSectionId) ?? sourceComponent;

    if (finding.pattern === "database_connection") {
      const target = findTargetDatabaseComponent(finding, components);
      if (target) {
        const flow = buildFlow(
          sourceComponent.id,
          target.id,
          "database_query",
          finding,
          ++flowIndex,
          sourceComponent,
          target,
        );
        flows.push(flow);
      }
      continue;
    }

    if (finding.pattern === "external_api_call") {
      const target = findTargetThirdPartyComponent(finding, components);
      if (target) {
        const normalizedFindingPath = normalizeProjectPath(
          finding.location?.filePath ?? "",
        );
        if (
          normalizedFindingPath &&
          isManifestOrNonRuntimeMetadataFile(normalizedFindingPath)
        ) {
          continue;
        }

        let flowSource = findSourceComponentForExternalApiCall(
          finding,
          components,
          sourceComponent,
          files,
          importGraph,
          knownPaths,
        );
        if (sectionApiSource && sectionApiSource.id !== sourceComponent.id) {
          if (isClearlyFrontendRuntimeFile(normalizedFindingPath)) {
            flowSource = sourceComponent;
          } else if (
            isLikelyRouteHandlerFile(normalizedFindingPath) ||
            flowSource.id === sourceComponent.id
          ) {
            // Prefer API source for backend/route evidence or ambiguous
            // non-frontend sources.
            flowSource = sectionApiSource;
          }
        }

        const flowType = flowTypeForExternalApi(finding);
        const flow = buildFlow(
          flowSource.id,
          target.id,
          flowType,
          finding,
          ++flowIndex,
          flowSource,
          target,
        );
        flows.push(flow);
      }
      continue;
    }

    if (finding.pattern === "auth_middleware") {
      const target = findAuthMiddlewareTarget(finding, components);
      if (
        target &&
        sourceComponent &&
        target.id !== sourceComponent.id
      ) {
        flows.push(
          buildFlow(
            sourceComponent.id,
            target.id,
            "api_call",
            finding,
            ++flowIndex,
            sourceComponent,
            target,
          ),
        );
      }
      continue;
    }

    if (finding.pattern === "express_route") {
      let target = findTargetAssetForRoute(
        finding,
        components,
        sectionApiSource,
      );
      if (!target) {
        target = findMergedHttpApiSurfaceComponent(components, sectionApiSource);
      }
      if (target) {
        const flow = buildFlow(
          sectionApiSource.id,
          target.id,
          "api_call",
          finding,
          ++flowIndex,
          sectionApiSource,
          target,
        );
        flows.push(flow);
      }
      continue;
    }

    if (finding.pattern === "web_actor" || finding.pattern === "service_actor") {
      const target = findTargetActorComponent(finding, components);
      if (target) {
        const flow = buildFlow(
          target.id,
          sourceComponent.id,
          "api_call",
          finding,
          ++flowIndex,
          target,
          sourceComponent,
        );
        flows.push(flow);
      }
    }
  }

  const internal = detectInternalFetchCalls(files, components, defaultSource, flowIndex, sections);
  flows.push(...internal.flows);
  flowIndex = internal.nextIndex;

  const terraformAppend = appendTerraformDataFlows(components, flowIndex);
  flows.push(...terraformAppend.flows);
  flowIndex = terraformAppend.nextIndex;

  // Provider → Terraform resource edges (and managed-service topology) are
  // applied in applyDeterministicInferenceFallbacks (same pass as TS SDK).

  // Ensure section API nodes are visibly connected from the section main app.
  const existingFlowKeys = new Set(
    flows.map((f) => `${f.sourceComponentId}::${f.targetComponentId}::${f.type}`),
  );
  for (const component of components) {
    if (
      component.type !== "asset" ||
      component.subType !== "api" ||
      (component.properties?.isSectionApiNode !== true &&
        component.properties?.isSectionApiNode !== "true")
    ) {
      continue;
    }

    const sectionId = getSectionIdFromComponent(component);
    const mainApp = components.find(
      (c) =>
        c.type === "asset" &&
        getSectionIdFromComponent(c) === sectionId &&
        (c.properties?.isMainApplication === true ||
          c.properties?.isMainApplication === "true"),
    );
    if (!mainApp) continue;
    if (mainApp.id === component.id) continue;

    const key = `${mainApp.id}::${component.id}::api_call`;
    if (existingFlowKeys.has(key)) continue;
    existingFlowKeys.add(key);

    flowIndex += 1;
    flows.push({
      id: `flow_${flowIndex}`,
      sourceComponentId: mainApp.id,
      targetComponentId: component.id,
      type: "api_call",
      confidence: 1,
      targetScope: "local",
      targetScopeConfidence: "high",
      targetScopeReason: "main-to-section-api",
    });
  }

  return flows;
}

