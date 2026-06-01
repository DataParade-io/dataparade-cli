import type { DetectedComponent } from "../core/types/component";
import { INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT } from "../classifier/application-injection";
import { findTerraformPrimaryProviderHub } from "../classifier/terraform-provider-hub";
import { isConcreteServiceSectionId } from "../core/sectioning/section-runtime";

/**
 * PaaS "application" resources (e.g. `heroku_app`) are Terraform hosting shells,
 * not the user-facing codebase. Prefer a real app/API main when one exists so
 * actor rewiring does not land on infra nodes.
 */
function isTerraformPaaSApplicationResource(component: DetectedComponent): boolean {
  if (component.type !== "asset") return false;
  const rt = component.properties?.resource_type;
  if (typeof rt !== "string" || !rt.trim()) return false;
  return rt === "heroku_app";
}

function isPreferredMainApplicationAsset(component: DetectedComponent): boolean {
  if (component.type !== "asset") return false;
  const main =
    component.properties?.isMainApplication === true ||
    component.properties?.isMainApplication === "true";
  if (!main) return false;
  return !isTerraformPaaSApplicationResource(component);
}

function isAnyMainApplicationAsset(component: DetectedComponent): boolean {
  if (component.type !== "asset") return false;
  return (
    component.properties?.isMainApplication === true ||
    component.properties?.isMainApplication === "true"
  );
}

/**
 * Resolves the "application hub" used for actor→hub flows and actor→infra
 * rewiring. Prefers explicit main apps, then api/service assets, then a
 * Terraform cloud provider node when the scan is infrastructure-only.
 */
export function findApplicationHubForFlows(
  components: DetectedComponent[],
  sectionId?: string,
): DetectedComponent | undefined {
  const concreteSection = isConcreteServiceSectionId(sectionId);
  const scoped =
    sectionId && sectionId.trim().length > 0
      ? components.filter(
          (c) => String(c.properties?.section_id ?? "") === sectionId,
        )
      : components;

  const injectedMainInScoped = scoped.find(
    (c) =>
      c.type === "asset" &&
      (c.properties?.isMainApplication === true ||
        c.properties?.isMainApplication === "true") &&
      c.properties?.sourceContext === INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
  );
  if (injectedMainInScoped) return injectedMainInScoped;

  const mainPreferredScoped = scoped.find(isPreferredMainApplicationAsset);
  if (mainPreferredScoped) return mainPreferredScoped;

  const apiOrServiceInScoped = scoped.find(
    (c) =>
      c.type === "asset" &&
      (c.subType === "api" || c.subType === "service"),
  );
  if (apiOrServiceInScoped) return apiOrServiceInScoped;

  if (!concreteSection) {
    const globalMainPreferred = components.find(isPreferredMainApplicationAsset);
    if (globalMainPreferred) return globalMainPreferred;
  }

  const mainScopedAny = scoped.find(isAnyMainApplicationAsset);
  if (mainScopedAny) return mainScopedAny;

  const tfScoped = findTerraformPrimaryProviderHub(components, sectionId);
  if (tfScoped) return tfScoped;

  if (!concreteSection) {
    const globalInjectedMain = components.find(
      (c) =>
        c.type === "asset" &&
        (c.properties?.isMainApplication === true ||
          c.properties?.isMainApplication === "true") &&
        c.properties?.sourceContext === INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
    );
    if (globalInjectedMain) return globalInjectedMain;

    const globalMainAny = components.find(isAnyMainApplicationAsset);
    if (globalMainAny) return globalMainAny;

    const globalApiOrService = components.find(
      (c) =>
        c.type === "asset" && (c.subType === "api" || c.subType === "service"),
    );
    if (globalApiOrService) return globalApiOrService;

    const tfGlobal = findTerraformPrimaryProviderHub(components);
    if (tfGlobal) return tfGlobal;

    return components.find((c) => c.type === "asset") ?? undefined;
  }

  return undefined;
}
