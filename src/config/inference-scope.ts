import type { AiInferenceScope } from "../ai-enrichment/types";

export function parseAiInferenceScope(
  raw: string | undefined,
): AiInferenceScope | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const normalized = raw.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "default") {
    return "default";
  }
  if (normalized === "third_party_only" || normalized === "thirdpartyonly") {
    return "third_party_only";
  }
  return undefined;
}
