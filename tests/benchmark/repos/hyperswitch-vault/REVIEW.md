# Human review packet: Hyperswitch Card Vault data items

Status: proposed; not yet included in evaluation denominators.

## Source and scope

- Repository: `juspay/hyperswitch-card-vault`
- Commit: `abfca8e078039582460335be73341699ee826615`
- License: Apache-2.0
- Complete annotation scope: `src/routes/data/types.rs` (206 lines)
- Source: https://github.com/juspay/hyperswitch-card-vault/blob/abfca8e078039582460335be73341699ee826615/src/routes/data/types.rs

Review this source without consulting scanner output. `annotations/data_items.yaml` is
the proposed, line-level record. The proposed labels are based on field names and
types, not on what the scanner detects.

## Recommended grouped decisions

1. Accept as payment-card data: card number (line 14), cardholder name (15),
   expiration month/year (16–17), and encrypted/card-data values and containers
   (61–62, 134–135, 163–164).
2. Accept as non-data-items: card brand (18), issuer identifier (19), deduplication
   hashes (39–40), merchant identifiers (48, 120, 140), and TTL (55).
3. Keep ambiguous pending taxonomy policy: user nickname (20), card references
   (25, 50, 123, 142), merchant-customer identifiers (49, 121, 141), and
   fingerprint data/key/ID (152–153, 158). They might become positive labels only
   if the taxonomy explicitly covers tokens, customer IDs, or secrets.

## Acceptance record

When a reviewer approves or rejects a record, update its `provenance` fields in
`annotations/data_items.yaml` with reviewer, date, and rationale. Preserve rejected
records; only `accepted` records feed the normal scorer.
