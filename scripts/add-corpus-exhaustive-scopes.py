#!/usr/bin/env python3
"""Add exhaustive_scope_files to positive annotations in each corpus repo."""
import os
import sys
import yaml


class NoAnchorDumper(yaml.SafeDumper):
    """YAML dumper that never emits anchors/aliases."""
    def ignore_aliases(self, data):
        return True


REPOS_ROOT = os.path.join(os.path.dirname(__file__), "..", "tests", "benchmark", "repos")


def collect_evidence_files(annotations):
    files = set()
    for a in annotations:
        ev = a.get("evidence", {})
        fp = ev.get("file_path")
        if fp:
            files.add(fp)
    return sorted(files)


def add_exhaustive_scope(annotations, scope_files):
    changed = 0
    for a in annotations:
        if a.get("expected", {}).get("status") != "positive":
            continue
        expected = a.setdefault("expected", {})
        if "exhaustive_scope_files" not in expected:
            expected["exhaustive_scope_files"] = list(scope_files)
            changed += 1
    return changed


def process_repo(repo_dir):
    ann_dir = os.path.join(repo_dir, "annotations")
    if not os.path.isdir(ann_dir):
        return 0
    total = 0
    for fname in sorted(os.listdir(ann_dir)):
        if not fname.endswith((".yaml", ".yml")):
            continue
        fpath = os.path.join(ann_dir, fname)
        with open(fpath, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if not data or "annotations" not in data:
            continue
        annotations = data["annotations"]
        scope_files = collect_evidence_files(annotations)
        if not scope_files:
            continue
        changed = add_exhaustive_scope(annotations, scope_files)
        if changed:
            with open(fpath, "w", encoding="utf-8") as f:
                yaml.dump(data, f, Dumper=NoAnchorDumper, default_flow_style=False, sort_keys=False, width=100)
            print(f"  {fname}: added exhaustive_scope_files to {changed} positive annotations ({len(scope_files)} files)")
            total += changed
    return total


def main():
    if not os.path.isdir(REPOS_ROOT):
        print(f"repos root not found: {REPOS_ROOT}", file=sys.stderr)
        return 1
    grand_total = 0
    for repo in sorted(os.listdir(REPOS_ROOT)):
        repo_dir = os.path.join(REPOS_ROOT, repo)
        if not os.path.isdir(repo_dir):
            continue
        print(f"=== {repo} ===")
        grand_total += process_repo(repo_dir)
    print(f"\nTotal positive annotations updated: {grand_total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
