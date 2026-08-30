#!/usr/bin/env python3
"""Create pii_signals gold from accepted positive data_items with PII labels."""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path

import yaml

PII_LABELS = {
    "email_address",
    "person_name",
    "phone_number",
    "street_address",
    "city",
    "postal_code",
    "address_region",
    "user_identifier",
    "access_token",
    "credential_secret",
    "password_verifier",
    "national_identifier",
    "date_of_birth",
    "payment_card_number",
    "cardholder_name",
    "payment_card_expiration",
    "payment_card_data",
    "compensation",
    "employment_information",
    "residence_information",
}

ROOT = Path(__file__).resolve().parent.parent / "tests" / "benchmark" / "repos"


class NoAliasDumper(yaml.SafeDumper):
    def ignore_aliases(self, data):
        return True


def main() -> int:
    created = 0
    skipped = 0
    for repo_dir in sorted(p for p in ROOT.iterdir() if p.is_dir()):
        items_path = repo_dir / "annotations" / "data_items.yaml"
        if not items_path.exists():
            continue
        items = yaml.safe_load(items_path.read_text()) or {}
        signals_path = repo_dir / "annotations" / "pii_signals.yaml"
        existing = []
        if signals_path.exists():
            existing = (yaml.safe_load(signals_path.read_text()) or {}).get("annotations") or []
        seen = {
            (
                a.get("evidence", {}).get("file_path"),
                a.get("evidence", {}).get("start_line"),
                a.get("evidence", {}).get("end_line"),
                tuple(a.get("expected", {}).get("labels") or []),
            )
            for a in existing
        }
        existing_ids = {a.get("id") for a in existing}
        new_records = []
        for item in items.get("annotations") or []:
            if item.get("expected", {}).get("status") != "positive":
                continue
            if item.get("provenance", {}).get("review_state") != "accepted":
                continue
            labels = [lab for lab in (item.get("expected", {}).get("labels") or []) if lab in PII_LABELS]
            if not labels:
                skipped += 1
                continue
            ev = item["evidence"]
            key = (ev.get("file_path"), ev.get("start_line"), ev.get("end_line"), tuple(labels))
            if key in seen:
                skipped += 1
                continue
            new_id = f"{item['id']}-pii-signal"
            if new_id in existing_ids:
                skipped += 1
                continue
            expected = {
                "status": "positive",
                "labels": labels,
            }
            scope = item.get("expected", {}).get("exhaustive_scope_files")
            if scope:
                expected["exhaustive_scope_files"] = list(scope)
            new_records.append(
                {
                    "id": new_id,
                    "layer": "pii_signals",
                    "subject": {
                        "key": f"pii:{labels[0]}",
                        "name": item.get("subject", {}).get("name"),
                    },
                    "evidence": dict(ev),
                    "expected": expected,
                    "rationale": item.get("rationale"),
                    "provenance": {
                        "proposed_by": "pii-signal-backport",
                        "proposed_at": "2026-08-30",
                        "review_state": "proposed",
                    },
                }
            )
            seen.add(key)
            existing_ids.add(new_id)
        if not new_records:
            continue
        signals_path.parent.mkdir(parents=True, exist_ok=True)
        merged = existing + new_records
        signals_path.write_text(
            yaml.dump(
                {"annotations": merged},
                Dumper=NoAliasDumper,
                sort_keys=False,
                allow_unicode=True,
                default_flow_style=False,
            )
        )
        created += len(new_records)
        print(f"{repo_dir.name}: +{len(new_records)} pii_signals")
    print(f"created={created} skipped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
