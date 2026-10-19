import { ACTOR_KINDS, DATA_CATEGORIES, PURPOSES } from "./taxonomy";

/**
 * The interview answers that may land as Discoveries (write-back rules §3).
 * Everything else, such as scan-asserted identity, flow endpoints, merges of
 * duplicate ids or freeform prose, never lands from an interview: scan wins.
 */
export const SYSTEM_ASSERTS_URI = "dp:a0/system";

export type EligibleShape = "D2" | "D4" | "D7" | "D8";
export type InterviewSlot = "in_scope" | "actor_kind" | "data_categories" | "purpose";
export type SlotTarget = "system" | "actor" | "flow";

export const SHAPE_FOR_SLOT: Record<InterviewSlot, { shape: EligibleShape; target: SlotTarget }> = {
  in_scope: { shape: "D2", target: "system" },
  actor_kind: { shape: "D4", target: "actor" },
  data_categories: { shape: "D7", target: "flow" },
  purpose: { shape: "D8", target: "flow" },
};

export function isInterviewSlot(slot: string): slot is InterviewSlot {
  return slot in SHAPE_FOR_SLOT;
}

export class SlotValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlotValueError";
  }
}

/**
 * The value as it is stored in `asserted_value`: an enum token, a JSON-encoded
 * list of DataCategory tokens, or approved scope text. Throws on anything that
 * isn't ontology-shaped, so a model can't land an invented category.
 */
export function normalizeSlotValue(slot: InterviewSlot, raw: string): string {
  const value = raw.trim();
  switch (slot) {
    case "in_scope": {
      if (!value) throw new SlotValueError("in_scope needs the confirmed system scope text");
      return value;
    }
    case "actor_kind": {
      if (!(ACTOR_KINDS as readonly string[]).includes(value)) {
        throw new SlotValueError(`actor_kind must be exactly one of ${ACTOR_KINDS.join(", ")}; got '${raw}'`);
      }
      return value;
    }
    case "purpose": {
      if (!(PURPOSES as readonly string[]).includes(value)) {
        throw new SlotValueError(`purpose must be one of ${PURPOSES.join(", ")}; got '${raw}'`);
      }
      return value;
    }
    case "data_categories": {
      const tokens = parseCategoryList(value);
      if (tokens.length === 0) {
        throw new SlotValueError("data_categories needs at least one category (use 'other' when none fits)");
      }
      for (const token of tokens) {
        if (token === "unspecified") {
          throw new SlotValueError("data_categories has no 'unspecified'; use 'other' for a gap");
        }
        if (!(DATA_CATEGORIES as readonly string[]).includes(token)) {
          throw new SlotValueError(`unknown data category '${token}'; use one of ${DATA_CATEGORIES.join(", ")}`);
        }
      }
      return JSON.stringify(Array.from(new Set(tokens)).sort());
    }
  }
}

/** Accepts a JSON array (`["contact"]`) or a comma-separated list (`contact, identifiers`). */
function parseCategoryList(value: string): string[] {
  if (value.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new SlotValueError(`data_categories is not a valid JSON list: ${value}`);
    }
    if (!Array.isArray(parsed) || parsed.some((t) => typeof t !== "string")) {
      throw new SlotValueError("data_categories must be a list of category tokens");
    }
    return (parsed as string[]).map((t) => t.trim()).filter(Boolean);
  }
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
