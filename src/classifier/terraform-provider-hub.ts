import type { DetectedComponent } from "../core/types/component";

const PRIMARY_PROVIDER_LOCAL_NAMES = [
  "aws",
  "azurerm",
  "google",
  "google-beta",
] as const;

/**
 * Picks a single Terraform `provider.*` third_party node to act as the cloud
 * control-plane hub (User → provider → resources) when there is no app asset.
 */
export function findTerraformPrimaryProviderHub(
  components: DetectedComponent[],
  sectionId?: string,
): DetectedComponent | undefined {
  let pool = components.filter(
    (c) =>
      c.type === "third_party" &&
      typeof c.properties?.terraform_address === "string" &&
      c.properties.terraform_address.startsWith("provider."),
  );
  if (sectionId && sectionId.trim()) {
    pool = pool.filter(
      (c) => String(c.properties?.section_id ?? "") === sectionId,
    );
    if (pool.length === 0) return undefined;
  }
  if (pool.length === 0) return undefined;

  const byLocal = new Map<string, DetectedComponent>();
  for (const p of pool) {
    const addr = String(p.properties?.terraform_address ?? "");
    const local = addr.replace(/^provider\./, "").trim();
    if (local) byLocal.set(local, p);
  }

  for (const name of PRIMARY_PROVIDER_LOCAL_NAMES) {
    const hit = byLocal.get(name);
    if (hit) return hit;
  }

  return [...pool].sort((a, b) =>
    String(a.properties?.terraform_address ?? "").localeCompare(
      String(b.properties?.terraform_address ?? ""),
    ),
  )[0];
}
