/**
 * Scorer-side aliases for data_items eval only. Corpus privacy taxonomy and
 * scanner emitted labels stay unchanged; this module bridges them at score time.
 */

/** Corpus privacy-taxonomy label -> acceptable scanner rule labels */
export const DATA_ITEMS_LABEL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  email_address: ["user_email"],
  person_name: ["first_name", "last_name", "full_name"],
  national_identifier: ["social_security_number", "national_id"],
  phone_number: ["phone_number"],
  date_of_birth: ["date_of_birth"],
  street_address: ["address"],
  postal_code: ["address"],
  address_region: ["address"],
};

/** Field-name slug <-> PII rule-id slug when subject keys differ */
export const DATA_ITEM_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  phone: ["phone_number"],
  phone_number: ["phone"],
  ssn: ["social_security_number"],
  social_security_number: ["ssn"],
  birthday: ["date_of_birth"],
  date_of_birth: ["birthday"],
  staff_email: ["email"],
  pending_email: ["email"],
};

export function extractDataItemSlug(key: string): string {
  const prefix = "data_item:";
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export function dataItemKeysAlign(caseKey: string, findingKey: string): boolean {
  if (caseKey === findingKey) {
    return true;
  }

  const caseSlug = extractDataItemSlug(caseKey);
  const findingSlug = extractDataItemSlug(findingKey);
  if (caseSlug === findingSlug) {
    return true;
  }

  const caseAliases = DATA_ITEM_KEY_ALIASES[caseSlug] ?? [];
  if (caseAliases.includes(findingSlug)) {
    return true;
  }

  const findingAliases = DATA_ITEM_KEY_ALIASES[findingSlug] ?? [];
  return findingAliases.includes(caseSlug);
}

export function dataItemsLabelsMatch(
  findingLabels: string[],
  expectedLabels: string[],
): boolean {
  if (expectedLabels.length === 0) {
    return true;
  }

  const tags = new Set(findingLabels);
  return expectedLabels.every((expected) => {
    if (tags.has(expected)) {
      return true;
    }
    const aliases = DATA_ITEMS_LABEL_ALIASES[expected] ?? [];
    return aliases.some((alias) => tags.has(alias));
  });
}
