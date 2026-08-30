#!/usr/bin/env python3
"""Accept the 74 Composer-approved positive annotations and remove the one reject."""
import os
import sys
import yaml

REPOS_ROOT = os.path.join(os.path.dirname(__file__), "..", "tests", "benchmark", "repos")

# Composer 2.5 swarm rejected this one: it labels a @ManyToOne entity
# relationship as a data_item, not a scalar field.
REJECTED_IDS = {"keycloak-credential-user"}


class NoAnchorDumper(yaml.SafeDumper):
    def ignore_aliases(self, data):
        return True


def main():
    accepted = 0
    removed = 0
    for repo in sorted(os.listdir(REPOS_ROOT)):
        repo_dir = os.path.join(REPOS_ROOT, repo)
        ann_dir = os.path.join(repo_dir, "annotations")
        if not os.path.isdir(ann_dir):
            continue
        for fname in sorted(os.listdir(ann_dir)):
            if not fname.endswith((".yaml", ".yml")):
                continue
            fpath = os.path.join(ann_dir, fname)
            with open(fpath, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            if not data or "annotations" not in data:
                continue
            kept = []
            for a in data["annotations"]:
                if a.get("id") in REJECTED_IDS:
                    removed += 1
                    continue
                if a.get("expected", {}).get("status") == "positive":
                    prov = a.setdefault("provenance", {})
                    if prov.get("review_state") != "accepted":
                        prov["review_state"] = "accepted"
                        accepted += 1
                kept.append(a)
            data["annotations"] = kept
            with open(fpath, "w", encoding="utf-8") as f:
                yaml.dump(data, f, Dumper=NoAnchorDumper, default_flow_style=False, sort_keys=False, width=100)
    print(f"Accepted: {accepted} positive annotations")
    print(f"Removed: {removed} rejected annotations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
