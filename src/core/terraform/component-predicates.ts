import { INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT } from "../../classifier/application-injection";
import type { DetectedComponent } from "../types/component";

export const TERRAFORM_DETECTED_FROM_PATTERNS = new Set([
  "terraform_resource",
  "terraform_module",
  "terraform_provider",
]);

export const ROOT_LIKE_SECTION_IDS = new Set(["root", "global", "<unsectioned>"]);

export function trimTerraformAddress(component: DetectedComponent): string {
  const addr = component.properties?.terraform_address;
  return typeof addr === "string" ? addr.trim() : "";
}

export function hasTerraformAddress(component: DetectedComponent): boolean {
  return trimTerraformAddress(component).length > 0;
}

export function scanHasTerraformAddress(components: DetectedComponent[]): boolean {
  return components.some(hasTerraformAddress);
}

export function isTerraformProviderComponent(
  component: DetectedComponent | undefined,
): boolean {
  if (component?.type !== "third_party") return false;
  const addr = trimTerraformAddress(component);
  return addr.startsWith("provider.");
}

export function isRootLikeSectionId(sectionId: string | undefined): boolean {
  const sid = sectionId?.trim() ?? "";
  return ROOT_LIKE_SECTION_IDS.has(sid);
}

/** Non-Terraform detectedFrom patterns or non-`.tf` source paths. */
export function hasNonTerraformAppSource(component: DetectedComponent): boolean {
  if (
    component.detectedFrom?.some(
      (ref) => !TERRAFORM_DETECTED_FROM_PATTERNS.has(ref.pattern),
    )
  ) {
    return true;
  }
  return (
    component.sourceLocations?.some((loc) => {
      const fp = loc.filePath.replace(/\\/g, "/").toLowerCase();
      return !fp.endsWith(".tf");
    }) ?? false
  );
}

/** App surface signals for root-scoped assets (single-package repos). */
export function hasNonTerraformAppSignals(component: DetectedComponent): boolean {
  const props = component.properties ?? {};
  const isInjectedPlaceholder =
    props.sourceContext === INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT;

  if (props.isSectionApiNode === true || props.isSectionApiNode === "true") {
    return true;
  }
  if (hasNonTerraformAppSource(component)) {
    return true;
  }
  if (props.isMainApplication === true || props.isMainApplication === "true") {
    if (isInjectedPlaceholder) return false;
    if (component.subType === "api" || component.subType === "service") {
      return true;
    }
    return hasNonTerraformAppSource(component);
  }
  return false;
}

export function isTerraformDerivedFromPatterns(
  component: DetectedComponent,
): boolean {
  return (
    component.detectedFrom?.some((ref) =>
      TERRAFORM_DETECTED_FROM_PATTERNS.has(ref.pattern),
    ) ?? false
  );
}
