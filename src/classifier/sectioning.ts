import type { DetectedComponent } from "../core/types/component";

export function getSectionIdFromProperties(
  properties: Record<string, unknown> | undefined,
): string {
  const raw = properties?.section_id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "<unsectioned>";
}

export function pickDefaultSectionId(
  components: DetectedComponent[],
): string {
  const counts = new Map<string, number>();
  for (const c of components) {
    const sid = getSectionIdFromProperties(c.properties);
    counts.set(sid, (counts.get(sid) ?? 0) + 1);
  }

  if (counts.size === 0) return "<unsectioned>";

  // Prefer a concrete section over the synthetic "<unsectioned>" bucket.
  const globalCount = counts.get("global") ?? 0;
  let bestSectionId: string = "<unsectioned>";
  let bestCount = -1;
  for (const [sid, count] of counts.entries()) {
    if (sid === "<unsectioned>") continue;
    // When we have a shared/global bucket, don't pick it for the injected
    // Application/User nodes unless it's the only available section.
    if (sid === "global") continue;
    if (count > bestCount) {
      bestCount = count;
      bestSectionId = sid;
    }
  }

  if (bestCount >= 0) return bestSectionId;
  if (globalCount > 0) return "global";
  return "<unsectioned>";
}

export function pickSectionRoleForSectionId(
  components: DetectedComponent[],
  sectionId: string,
): string {
  // Prefer an existing role from components that already carry section metadata.
  for (const c of components) {
    if (getSectionIdFromProperties(c.properties) !== sectionId) continue;
    const rawRole = c.properties?.section_role;
    if (typeof rawRole === "string" && rawRole.trim()) return rawRole.trim();
  }

  // Fall back to the convention used by the sectioning layer and tests.
  return sectionId === "root" ? "root" : "service";
}

export function getSectionLabelFromProperties(
  properties: Record<string, unknown> | undefined,
): string | undefined {
  const raw = properties?.section_label;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return undefined;
}

