#!/usr/bin/env python3
"""Tally corpus annotations by layer, subject key, and labels."""
import os
import sys
import yaml
from collections import Counter

REPOS_ROOT = os.path.join(os.path.dirname(__file__), "..", "tests", "benchmark", "repos")


def main():
    by_layer = Counter()
    by_subject = Counter()
    by_label = Counter()
    by_repo_layer = Counter()
    by_status = Counter()
    total = 0

    for repo in sorted(os.listdir(REPOS_ROOT)):
        repo_dir = os.path.join(REPOS_ROOT, repo)
        ann_dir = os.path.join(repo_dir, "annotations")
        if not os.path.isdir(ann_dir):
            continue
        for fname in sorted(os.listdir(ann_dir)):
            if not fname.endswith((".yaml", ".yml")):
                continue
            with open(os.path.join(ann_dir, fname), "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            for a in (data or {}).get("annotations", []):
                total += 1
                layer = a.get("layer", "?")
                key = a.get("subject", {}).get("key", "?")
                labels = a.get("expected", {}).get("labels", [])
                status = a.get("expected", {}).get("status", "?")
                by_layer[layer] += 1
                by_subject[key] += 1
                by_label.update(labels)
                by_repo_layer[f"{repo}/{layer}"] += 1
                by_status[status] += 1

    print(f"Total annotations: {total}")
    print(f"\nBy status: {dict(by_status)}")
    print(f"\nBy layer: {dict(by_layer)}")
    print(f"\nBy subject key (top 30):")
    for key, count in by_subject.most_common(30):
        print(f"  {key}: {count}")
    print(f"\nBy label: {dict(by_label)}")
    print(f"\nBy repo/layer: {dict(by_repo_layer)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
