export type ThirdPartyInferenceKind = "direct" | "heuristic" | "not_inferable_v1";

export interface ThirdPartyPropertyMatrixEntry {
  property: string;
  kind: ThirdPartyInferenceKind;
  notes: string;
}

/**
 * v1 matrix for third-party autofill. Keep this intentionally conservative:
 * - `direct`: can usually be read from explicit code/config/docs signals.
 * - `heuristic`: inferable from patterns but may need confidence gating.
 * - `not_inferable_v1`: generally legal/commercial/governance fields.
 */
export const THIRD_PARTY_PROPERTY_MATRIX: ThirdPartyPropertyMatrixEntry[] = [
  { property: "vendor", kind: "direct", notes: "Vendor name from package/import/domain evidence." },
  { property: "serviceName", kind: "direct", notes: "Service/vendor identity from evidence." },
  { property: "client", kind: "heuristic", notes: "Lowercase normalized vendor/client identifier." },
  { property: "integration_method", kind: "direct", notes: "API/SDK/webhook style integration markers." },
  { property: "api_type", kind: "heuristic", notes: "REST/GraphQL/webhook hints from usage and endpoints." },
  { property: "authentication_method", kind: "heuristic", notes: "Bearer/API key/OAuth/JWT/basic signals." },
  { property: "documentation_url", kind: "direct", notes: "Known vendor docs URL when vendor is high-confidence." },
  { property: "sdk_available", kind: "direct", notes: "Dependency/import evidence for vendor SDKs." },
  { property: "https_enforced", kind: "direct", notes: "All discovered endpoints use HTTPS." },
  { property: "api_endpoint", kind: "heuristic", notes: "Most representative vendor endpoint found in code/config." },
  { property: "integration_status", kind: "heuristic", notes: "Active when imports/calls indicate live usage." },
  {
    property: "technical_owner_team",
    kind: "not_inferable_v1",
    notes: "Org ownership is typically not provable from code.",
  },
  {
    property: "vendor_soc2_iso27001",
    kind: "not_inferable_v1",
    notes: "Compliance attestations are not code-evidenced reliably.",
  },
  {
    property: "data_processing_agreement_dpa",
    kind: "not_inferable_v1",
    notes: "Contractual/legal status requires non-code source of truth.",
  },
  {
    property: "dpa_expiry_date",
    kind: "not_inferable_v1",
    notes: "Contract date not reliably inferable from repository artifacts.",
  },
  {
    property: "vendor_support_contact",
    kind: "not_inferable_v1",
    notes: "Support contacts are usually contractual/ops metadata.",
  },
];

const inferabilityByProperty = new Map(
  THIRD_PARTY_PROPERTY_MATRIX.map((entry) => [entry.property, entry.kind] as const),
);

export function getThirdPartyPropertyInferability(
  property: string,
): ThirdPartyInferenceKind {
  return inferabilityByProperty.get(property) ?? "not_inferable_v1";
}

