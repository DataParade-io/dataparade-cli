import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import { findApplicationHubForFlows } from "./application-hub";

const MANIFEST_FILE_NAMES = new Set([
  "package.json",
  "pyproject.toml",
  "pipfile",
  "requirements.txt",
]);

function isManifestMetadataPath(filePath: string | undefined): boolean {
  if (!filePath?.trim()) return false;
  const base = filePath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  return MANIFEST_FILE_NAMES.has(base);
}

/**
 * Third parties inferred only from dependency manifests (e.g. `package.json`
 * imports), not from runtime call sites.
 */
export function isManifestOnlyThirdPartyComponent(
  component: DetectedComponent,
): boolean {
  if (component.type !== "third_party") return false;

  if (component.properties?.sourceContext === "dependency_manifest") {
    return true;
  }

  const refs = component.detectedFrom ?? [];
  if (refs.length === 0) return false;

  return refs.every((ref) => {
    if (ref.pattern !== "external_api_call") return false;
    const fp = ref.sourceLocation?.filePath;
    return isManifestMetadataPath(fp);
  });
}

/**
 * Connects each workspace package hub to third parties declared in its manifest.
 * Runtime call sites still produce their own flows; this only fills gaps for
 * manifest-only vendors (e.g. Anthropic listed in `package.json` but called via
 * OpenRouter at runtime).
 */
export function ensureManifestDeclaredThirdPartyFlows(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): DetectedDataFlow[] {
  const manifestThirdParties = components.filter(isManifestOnlyThirdPartyComponent);
  if (manifestThirdParties.length === 0) return flows;

  const existingKeys = new Set(
    flows.map((f) => `${f.sourceComponentId}\t${f.targetComponentId}\t${f.type}`),
  );

  let maxFlowNum = flows.reduce((max, f) => {
    const m = /^flow_(\d+)$/.exec(f.id);
    return m ? Math.max(max, Number.parseInt(m[1], 10)) : max;
  }, 0);

  const synthetic: DetectedDataFlow[] = [];

  const sortedThirdParties = [...manifestThirdParties].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  for (const thirdParty of sortedThirdParties) {
    const sectionId = String(thirdParty.properties?.section_id ?? "").trim();
    const hub = findApplicationHubForFlows(components, sectionId || undefined);
    if (!hub || hub.id === thirdParty.id) continue;

    const key = `${hub.id}\t${thirdParty.id}\tapi_call`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);

    maxFlowNum += 1;
    synthetic.push({
      id: `flow_${maxFlowNum}`,
      sourceComponentId: hub.id,
      targetComponentId: thirdParty.id,
      type: "api_call",
      confidence: 0.65,
      description: "Declared dependency (package.json)",
      enrichmentNotes: "declared_dependency",
    });
  }

  return synthetic.length > 0 ? [...flows, ...synthetic] : flows;
}
