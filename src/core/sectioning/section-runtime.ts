import type { DetectedComponent } from "../types/component";
import type { ServiceSection } from "./discover-service-sections";
import { getSectionIdFromProperties } from "../../classifier/sectioning";

const MANIFEST_ONLY_PATH_SUFFIXES = [
  "package.json",
  "pyproject.toml",
  "pipfile",
  "requirements.txt",
] as const;

/** True when this section discovered a `package.json` under `sectionDir`. */
export function sectionHasPackageJsonManifest(
  section: Pick<ServiceSection, "manifestPaths">,
): boolean {
  return section.manifestPaths.some(
    (p) => p.replace(/\\/g, "/").split("/").pop()?.toLowerCase() === "package.json",
  );
}

const GENERATOR_TEMPLATE_DIR_SEGMENTS = new Set([
  "template",
  "templates",
  "scaffold",
  "boilerplate",
]);

function sectionPathHasGeneratorTemplateLayout(sectionDir: string): boolean {
  const parts = sectionDir.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.some((p) => GENERATOR_TEMPLATE_DIR_SEGMENTS.has(p.toLowerCase()));
}

/**
 * Placeholder `package.json` names are often SHOUTING_CASE with multiple segments
 */
function packageNameLooksLikePlaceholderToken(packageName: string): boolean {
  const raw = packageName.trim();
  if (!raw) return false;
  const base = raw.includes("/") ? (raw.split("/").pop() ?? raw) : raw;
  const unscoped = base.replace(/^@[^/]+\//, "").replace(/^@/, "");
  if (/[a-z]/.test(unscoped)) return false;
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(unscoped)) return false;
  return unscoped.split(/[-_]/).filter((p) => p.length > 0).length >= 2;
}

/** Generator templates / placeholder manifests (not deployable workspace apps). */
export function isScaffoldOrTemplatePackageSection(
  section: Pick<ServiceSection, "id" | "packageName" | "sectionDir">,
): boolean {
  const dir = section.sectionDir || section.id;
  if (sectionPathHasGeneratorTemplateLayout(dir)) return true;
  const pkg = section.packageName?.trim() ?? "";
  return pkg.length > 0 && packageNameLooksLikePlaceholderToken(pkg);
}

/** At least one classified component is scoped to this section. */
export function sectionHasClassifiedComponents(
  components: DetectedComponent[],
  sectionId: string,
): boolean {
  for (const component of components) {
    if (getSectionIdFromProperties(component.properties) === sectionId) {
      return true;
    }
  }
  return false;
}

export function isConcreteServiceSectionId(sectionId: string | undefined): boolean {
  if (!sectionId?.trim()) return false;
  const id = sectionId.trim();
  return id !== "root" && id !== "global" && id !== "<unsectioned>";
}

export {
  TERRAFORM_DETECTED_FROM_PATTERNS,
} from "../terraform/component-predicates";
import {
  hasTerraformAddress,
  isTerraformDerivedFromPatterns,
} from "../terraform/component-predicates";

/** Classified from Terraform analysis (HCL or show-json), not application source code. */
export function isTerraformDerivedComponent(component: DetectedComponent): boolean {
  if (hasTerraformAddress(component)) return true;
  return isTerraformDerivedFromPatterns(component);
}

/** Section created for a Terraform stack root or module directory. */
export function isTerraformStackSection(
  section: Pick<ServiceSection, "id" | "sectionDir" | "isTerraformStack">,
): boolean {
  if (section.isTerraformStack === true) return true;
  const dir = (section.sectionDir || section.id).replace(/\\/g, "/").toLowerCase();
  if (!dir || dir === "root") return false;
  return (
    dir === "terraform" ||
    dir.startsWith("terraform/") ||
    dir.includes("/terraform/") ||
    dir.endsWith("/terraform")
  );
}

export function sectionHasRuntimeCodeComponents(
  components: DetectedComponent[],
  sectionId: string,
): boolean {
  for (const component of components) {
    if (getSectionIdFromProperties(component.properties) !== sectionId) continue;
    if (isTerraformDerivedComponent(component)) continue;

    if (component.subType === "database") return true;

    if (
      component.detectedFrom?.some((ref) => ref.pattern === "express_route")
    ) {
      return true;
    }

    const locations = component.sourceLocations ?? [];
    if (
      locations.some((loc) => {
        const fp = loc.filePath.replace(/\\/g, "/").toLowerCase();
        return !MANIFEST_ONLY_PATH_SUFFIXES.some((suffix) => fp.endsWith(suffix));
      })
    ) {
      if (component.type === "asset" || component.type === "actor") {
        return true;
      }
    }
  }
  return false;
}

/**
 * Whether a workspace section should receive a synthetic application hub and
 * default User actor (tooling-only packages like cli/docs/utils are skipped).
 */
export function sectionQualifiesForSyntheticApplication(
  section: ServiceSection,
  components: DetectedComponent[],
): boolean {
  if (section.role !== "service") return false;
  if (isTerraformStackSection(section)) return false;
  if (isScaffoldOrTemplatePackageSection(section)) return false;
  if (sectionHasRuntimeCodeComponents(components, section.id)) return true;
  if (
    sectionHasPackageJsonManifest(section) &&
    sectionHasClassifiedComponents(components, section.id)
  ) {
    return true;
  }
  return false;
}

export function shouldInjectUserActorForMainApp(
  mainApp: DetectedComponent,
  components: DetectedComponent[],
): boolean {
  const sectionId = getSectionIdFromProperties(mainApp.properties);
  if (mainApp.properties?.sourceContext !== "injected_project_placeholder") {
    return true;
  }
  if (!isConcreteServiceSectionId(sectionId)) return true;
  if (isTerraformStackSection({ id: sectionId, sectionDir: sectionId })) {
    return false;
  }
  if (sectionHasRuntimeCodeComponents(components, sectionId)) return true;
  return mainApp.properties?.is_primary_monorepo_package === true;
}
