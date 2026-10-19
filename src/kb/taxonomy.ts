/**
 * Ontology controlled vocabularies used by interview write-back.
 * Source: DataParade-io/ontology v0.3.0 (taxonomy/data_category.yaml,
 * purpose.yaml, actor_kind.yaml). Update together with PINNED_ONTOLOGY_*.
 */
export const DATA_CATEGORIES = [
  "personal",
  "identifiers",
  "contact",
  "demographic",
  "credentials",
  "financial",
  "health",
  "location",
  "communications",
  "commercial",
  "other",
] as const;

/** `unspecified` is a Purpose only; DataCategory uses `other` for a gap. */
export const PURPOSES = [
  "service_provision",
  "analytics",
  "marketing",
  "security",
  "legal_obligation",
  "research",
  "debugging",
  "unspecified",
] as const;

export const ACTOR_KINDS = ["person", "role", "persona"] as const;

export type DataCategory = (typeof DATA_CATEGORIES)[number];
export type Purpose = (typeof PURPOSES)[number];
export type ActorKind = (typeof ACTOR_KINDS)[number];
