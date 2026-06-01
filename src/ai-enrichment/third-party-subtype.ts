import { loadClassifierConfig } from "../classifier/config";
import type { DetectedComponent } from "../core/types/component";

/**
 * Canonical third-party subtypes (aligned with product thirdPartyTypes + classifier catalog).
 * `ai_provider` is accepted from the classifier and mapped in the UI to api_provider.
 */
export const THIRD_PARTY_SUBTYPE_TAXONOMY = [
  "b2b_customer",
  "saas_service",
  "payment_processor",
  "cloud_provider",
  "api_provider",
  "ai_provider",
  "data_provider",
  "government_regulator",
  "partner",
  "ad_network",
  "professional_services",
  "data_processor",
  "data_controller",
  "joint_controller",
  "vendor",
  "service_provider",
  "marketing_partner",
  "analytics_provider",
  "support_provider",
  "consultant",
  "subprocessor",
  "other",
] as const;

const SUBTYPE_ALIASES: Record<string, (typeof THIRD_PARTY_SUBTYPE_TAXONOMY)[number]> = {
  saas: "saas_service",
  saas_service: "saas_service",
  "saas service": "saas_service",
  api: "api_provider",
  api_provider: "api_provider",
  "api provider": "api_provider",
  ai: "ai_provider",
  ai_provider: "ai_provider",
  "ai provider": "ai_provider",
  llm: "ai_provider",
  payment: "payment_processor",
  payment_processor: "payment_processor",
  cloud: "cloud_provider",
  cloud_provider: "cloud_provider",
  analytics: "analytics_provider",
  analytics_provider: "analytics_provider",
  auth: "saas_service",
  identity: "saas_service",
  database: "saas_service",
  storage: "saas_service",
  cdn: "saas_service",
  email: "saas_service",
  messaging: "saas_service",
};

const NAME_HEURISTICS: Array<{ re: RegExp; subType: (typeof THIRD_PARTY_SUBTYPE_TAXONOMY)[number] }> =
  [
    { re: /\b(openai|anthropic|claude|gemini|cohere|mistral|llm|gpt)\b/i, subType: "ai_provider" },
    { re: /\b(stripe|paypal|braintree|adyen|checkout\.com)\b/i, subType: "payment_processor" },
    { re: /\b(aws|amazon web services|gcp|google cloud|azure|microsoft azure)\b/i, subType: "cloud_provider" },
    { re: /\b(auth0|okta|supabase|firebase|twilio|sendgrid|segment|sentry)\b/i, subType: "saas_service" },
    { re: /\b(google analytics|mixpanel|amplitude|heap)\b/i, subType: "analytics_provider" },
  ];

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\/\s]+/g, "_")
    .replace(/-+/g, "_");
}

export function normalizeThirdPartySubType(
  raw: string | undefined | null,
): (typeof THIRD_PARTY_SUBTYPE_TAXONOMY)[number] | undefined {
  if (!raw || !raw.trim()) return undefined;
  const normalized = normalizeToken(raw);
  if ((THIRD_PARTY_SUBTYPE_TAXONOMY as readonly string[]).includes(normalized)) {
    return normalized as (typeof THIRD_PARTY_SUBTYPE_TAXONOMY)[number];
  }
  return SUBTYPE_ALIASES[normalized];
}

function collectMatchCandidates(component: DetectedComponent): string[] {
  const props = component.properties ?? {};
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) out.push(v.toLowerCase());
  };
  push(component.name);
  push(props.client);
  push(props.serviceName);
  push(props.service_name);
  push(props.vendor);
  push(props.api_endpoint);
  return out;
}

type ThirdPartySubType = (typeof THIRD_PARTY_SUBTYPE_TAXONOMY)[number];

function inferFromClassifierCatalog(candidates: string[]): ThirdPartySubType | undefined {
  const { thirdParties } = loadClassifierConfig();
  let bestLen = 0;
  let bestSubType: ThirdPartySubType | undefined;

  for (const tp of thirdParties) {
    for (const mk of tp.matchKeys) {
      const k = mk.toLowerCase().trim();
      if (k.length < 3 || k.startsWith("@")) continue;
      for (const c of candidates) {
        if (!c.includes(k)) continue;
        if (k.length > bestLen) {
          const normalized = normalizeThirdPartySubType(tp.subType);
          if (!normalized) continue;
          bestLen = k.length;
          bestSubType = normalized;
        }
      }
    }
  }

  return bestSubType;
}

function inferFromNameHeuristics(candidates: string[]): ThirdPartySubType | undefined {
  const blob = candidates.join(" ");
  for (const { re, subType } of NAME_HEURISTICS) {
    if (re.test(blob)) return subType;
  }
  return undefined;
}

/**
 * Infer a third-party subtype from vendor/client/name signals when the classifier
 * did not match a catalog entry.
 */
export function inferThirdPartySubType(
  component: DetectedComponent,
): (typeof THIRD_PARTY_SUBTYPE_TAXONOMY)[number] {
  const existing = normalizeThirdPartySubType(component.subType);
  if (existing) return existing;

  const candidates = collectMatchCandidates(component);
  const fromCatalog = inferFromClassifierCatalog(candidates);
  const normalizedCatalog = normalizeThirdPartySubType(fromCatalog);
  if (normalizedCatalog) return normalizedCatalog;

  const fromHeuristic = inferFromNameHeuristics(candidates);
  if (fromHeuristic) return fromHeuristic;

  return "saas_service";
}

/** Fill missing subType on all third_party components (post-classify / post-AI). */
export function ensureThirdPartySubTypes(components: DetectedComponent[]): number {
  let filled = 0;
  for (const component of components) {
    if (component.type !== "third_party") continue;
    if (component.subType?.trim()) {
      const normalized = normalizeThirdPartySubType(component.subType);
      if (normalized && normalized !== component.subType) {
        component.subType = normalized;
      }
      continue;
    }
    component.subType = inferThirdPartySubType(component);
    filled += 1;
  }
  return filled;
}
