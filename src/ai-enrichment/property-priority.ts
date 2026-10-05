const TIER_1_PROPERTY_KEYS = new Set([
  'data_action',
  'encrypt_at_rest',
  'encryption_at_rest',
  'authentication_method',
  'authentication_methods',
  'gdpr_role',
]);

/**
 * Keep high-value privacy and security fields at the front of bounded prompts.
 * Remaining keys retain deterministic alphabetical order.
 */
export function sortPropertyKeysByPriority(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const tierDelta =
      Number(TIER_1_PROPERTY_KEYS.has(b)) - Number(TIER_1_PROPERTY_KEYS.has(a));
    if (tierDelta !== 0) return tierDelta;
    return a.localeCompare(b);
  });
}
