# Human review packet: Saleor account and address models

Status: proposed; not included in evaluation denominators.

- Repository: `saleor/saleor`
- Commit: `030c1676145d63154687fa394d1a4abb224b1ac2`
- License: BSD-3-Clause
- Complete scope: `saleor/account/models.py` (481 lines)
- Source: https://github.com/saleor/saleor/blob/030c1676145d63154687fa394d1a4abb224b1ac2/saleor/account/models.py

Review source only. Recommended clear positives are postal-address fields, phone,
email, and names. Keep company name, customer note content, avatar, arbitrary JSON,
and the JWT invalidation key ambiguous pending taxonomy policy. Operational flags,
timestamps, customer type, country, and order count are proposed negatives.

Update individual records in `annotations/data_items.yaml` after human review; only
accepted records count in evaluation.
