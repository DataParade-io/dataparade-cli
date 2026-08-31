import type { EvalCase, EvalLayer, LayerFinding } from "./types";

const PII_KEY_PREFIXES = new Set(["pii", "pii_signal", "mention", "raw_hit"]);
const DATA_ITEM_KEY_PREFIXES = new Set(["data_item"]);

const IDENTITY_ONLY_LAYERS: ReadonlySet<EvalLayer> = new Set(["data-items"]);

/** Tokens that gold and scanner vocabularies treat as the same concept. */
const EQUIVALENCE_GROUPS: readonly (readonly string[])[] = [
  ["email", "email_address", "user_email", "mail"],
  ["password", "user_password", "passwd", "pwd"],
  [
    "username",
    "user_name",
    "user_identifier",
    "userid",
    "user_id",
    "login",
    "login_id",
  ],
  ["first_name", "firstname", "given_name", "forename"],
  ["last_name", "lastname", "surname", "family_name"],
  ["full_name", "fullname", "display_name", "person_name", "legal_name"],
  [
    "ssn",
    "social_security_number",
    "national_identifier",
    "national_id",
    "nin",
  ],
  [
    "drivers_license",
    "driver_license_number",
    "drivers_license_number",
    "driving_license",
  ],
  ["passport", "passport_number"],
  ["tax_id", "tax_identifier", "tin", "ein"],
  ["phone", "phone_number", "telephone", "mobile"],
  [
    "address",
    "street_address",
    "mailing_address",
    "postal_address",
    "zipcode",
    "zip_code",
    "postal_code",
    "postcode",
  ],
  ["date_of_birth", "dob", "birth_date", "birthdate"],
  ["access_token", "accesskey", "access_key"],
  ["account_number", "acct_number", "iban"],
  ["card_number", "payment_card"],
];

const LAYER_GENERIC_LABELS: Record<EvalLayer, ReadonlySet<string>> = {
  components: new Set(["component"]),
  "data-flows": new Set(["data_flow", "dataflow"]),
  "pii-signals": new Set(["pii", "pii_signal"]),
  "data-items": new Set(["data_item", "dataitem"]),
};

function buildEquivalenceIndex(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const group of EQUIVALENCE_GROUPS) {
    const normalized = group.map(normalizeToken);
    const set = new Set(normalized);
    for (const token of normalized) {
      const existing = index.get(token);
      if (existing) {
        for (const member of set) {
          existing.add(member);
        }
      } else {
        index.set(token, new Set(set));
      }
    }
  }
  return index;
}

const EQUIVALENCE_INDEX = buildEquivalenceIndex();

export function normalizeEvalPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

export function normalizeToken(token: string): string {
  return token.trim().toLowerCase().replace(/-/g, "_").replace(/['’]/g, "");
}

export function parseIdentityKey(key: string): { prefix: string; rest: string } {
  const trimmed = key.trim();
  const separator = trimmed.indexOf(":");
  if (separator === -1) {
    return { prefix: "", rest: normalizeToken(trimmed) };
  }
  return {
    prefix: normalizeToken(trimmed.slice(0, separator)),
    rest: normalizeToken(trimmed.slice(separator + 1)),
  };
}

export function tokensCompatible(a: string, b: string): boolean {
  const left = normalizeToken(a);
  const right = normalizeToken(b);
  if (left === right) {
    return true;
  }
  const group = EQUIVALENCE_INDEX.get(left);
  return group !== undefined && group.has(right);
}

const PARENT_TO_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  person_name: [
    "first_name",
    "firstname",
    "last_name",
    "lastname",
    "full_name",
    "fullname",
    "display_name",
    "name",
  ],
  national_identifier: [
    "ssn",
    "social_security_number",
    "national_id",
    "nin",
    "drivers_license",
    "driver_license_number",
    "drivers_license_number",
    "passport",
    "passport_number",
    "tax_id",
    "tax_identifier",
  ],
  user_identifier: ["username", "user_name", "userid", "user_id", "login"],
  street_address: [
    "address",
    "mailing_address",
    "postal_address",
    "zipcode",
    "zip_code",
    "postal_code",
  ],
  employment_information: ["profession"],
  credential_secret: ["secret", "encrypted_key", "encryptedkey"],
  password_verifier: ["password_hash", "password_salt", "key_hash"],
};

export function tokenSatisfiesExpected(expected: string, actual: string): boolean {
  if (tokensCompatible(expected, actual)) {
    return true;
  }
  const children = PARENT_TO_CHILDREN[normalizeToken(expected)];
  if (!children) {
    return false;
  }
  return children.some((child) => tokensCompatible(child, actual));
}

function prefixesCompatible(layer: EvalLayer, findingPrefix: string, casePrefix: string): boolean {
  if (findingPrefix === casePrefix) {
    return true;
  }
  if (layer === "pii-signals") {
    return PII_KEY_PREFIXES.has(findingPrefix) && PII_KEY_PREFIXES.has(casePrefix);
  }
  if (layer === "data-items") {
    return DATA_ITEM_KEY_PREFIXES.has(findingPrefix) && DATA_ITEM_KEY_PREFIXES.has(casePrefix);
  }
  return false;
}

function conceptTokensForCase(caseRecord: EvalCase): string[] {
  const tokens = [parseIdentityKey(caseRecord.subject.key).rest];
  if (caseRecord.subject.name) {
    tokens.push(normalizeToken(caseRecord.subject.name));
  }
  return tokens.filter(Boolean);
}

function conceptTokensForFinding(finding: LayerFinding): string[] {
  const tokens = [parseIdentityKey(finding.key).rest];
  for (const label of finding.labels) {
    tokens.push(normalizeToken(label));
  }
  return tokens.filter(Boolean);
}

/**
 * Components and data-flows require exact subject keys (scanner naming is
 * out of scope for the harness). PII and data-item gold uses taxonomy /
 * field names while the matcher emits rule ids — those layers match when
 * concept tokens are equivalent.
 */
export function identitiesMatch(finding: LayerFinding, caseRecord: EvalCase): boolean {
  if (finding.key === caseRecord.subject.key) {
    return true;
  }

  if (caseRecord.layer === "components" || caseRecord.layer === "data-flows") {
    return false;
  }

  const findingId = parseIdentityKey(finding.key);
  const caseId = parseIdentityKey(caseRecord.subject.key);
  if (!prefixesCompatible(caseRecord.layer, findingId.prefix, caseId.prefix)) {
    return false;
  }

  const caseTokens = conceptTokensForCase(caseRecord);
  const findingTokens = conceptTokensForFinding(finding);
  return caseTokens.some((caseToken) =>
    findingTokens.some((findingToken) => tokensCompatible(caseToken, findingToken)),
  );
}

export function isIdentityOnlyLayer(layer: EvalLayer): boolean {
  return IDENTITY_ONLY_LAYERS.has(layer);
}

function findingTypePrefix(finding: LayerFinding): string {
  return parseIdentityKey(finding.key).prefix;
}

export function labelsMatch(finding: LayerFinding, caseRecord: EvalCase): boolean {
  const expectedLabels = caseRecord.expected.labels;
  if (expectedLabels.length === 0) {
    return true;
  }

  return expectedLabels.every((expected) => labelSatisfied(expected, finding, caseRecord));
}

function labelSatisfied(
  expected: string,
  finding: LayerFinding,
  caseRecord: EvalCase,
): boolean {
  const expectedToken = normalizeToken(expected);
  if (LAYER_GENERIC_LABELS[caseRecord.layer].has(expectedToken)) {
    return true;
  }

  if (finding.labels.some((label) => tokenSatisfiesExpected(expected, label))) {
    return true;
  }

  if (tokenSatisfiesExpected(expected, findingTypePrefix(finding))) {
    return true;
  }

  if (caseRecord.layer === "components") {
    const type = findingTypePrefix(finding);
    if (expectedToken === "database" && type === "asset") {
      return true;
    }
    if (
      (expectedToken === "customer" || expectedToken === "user") &&
      type === "actor"
    ) {
      return true;
    }
  }

  if (tokenSatisfiesExpected(expected, parseIdentityKey(finding.key).rest)) {
    return true;
  }

  return false;
}

export function findingsForCaseLayer(
  findings: LayerFinding[],
  layer: EvalLayer,
): LayerFinding[] {
  return findings.filter((finding) => finding.layer === undefined || finding.layer === layer);
}
