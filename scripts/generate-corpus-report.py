#!/usr/bin/env python3
"""Generate an HTML report of the benchmark corpus repos and annotation findings."""
import os
import sys
import yaml
import html
from pathlib import Path

REPOS_ROOT = Path(__file__).resolve().parent.parent / "tests" / "benchmark" / "repos"


def load_manifest(repo_dir):
    manifest_path = repo_dir / "manifest.yaml"
    if not manifest_path.exists():
        return None
    with open(manifest_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def count_annotations(repo_dir):
    ann_dir = repo_dir / "annotations"
    counts = {"files": 0, "annotations": 0, "positives": 0, "negatives": 0, "ambiguous": 0}
    if not ann_dir.exists():
        return counts
    for f in sorted(ann_dir.glob("*.yaml")):
        counts["files"] += 1
        with open(f, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        if not data or "annotations" not in data:
            continue
        counts["files"] += 1
        for a in data["annotations"]:
            counts["annotations"] += 1
            status = a.get("expected", {}).get("status", "?")
            if status == "positive":
                counts["positives"] += 1
            elif status == "negative":
                counts["negatives"] += 1
            else:
                counts["ambiguous"] += 1
    return counts


def main():
    repos = []
    for repo_dir in sorted(REPOS_ROOT.iterdir()):
        if not repo_dir.is_dir():
            continue
        manifest = load_manifest(repo_dir)
        if not manifest:
            continue
        ann = count_annotations(repo_dir)
        repos.append({
            "key": repo_dir.name,
            "repository": manifest.get("repository", ""),
            "commit": manifest.get("commit", "")[:12],
            "license": manifest.get("license", ""),
            "languages": manifest.get("coverage", {}).get("languages", []),
            "domains": manifest.get("coverage", {}).get("domains", []),
            "annotation_files": ann["files"],
            "total_annotations": ann["annotations"],
            "positives": ann["positives"],
            "negatives": ann["negatives"],
            "ambiguous": ann["ambiguous"],
        })

    total_annotations = sum(r["total_annotations"] for r in repos)
    total_pos = sum(r["positives"] for r in repos)
    total_neg = sum(r["negatives"] for r in repos)
    total_amb = sum(r["ambiguous"] for r in repos)

    rows = "\n".join(
        f"""<tr>
            <td><a href="https://github.com/{r['repository']}">{html.escape(r['key'])}</a></td>
            <td><code>{html.escape(r['license'])}</code></td>
            <td>{', '.join(r['languages'])}</td>
            <td>{', '.join(r['domains'])}</td>
            <td>{r['annotation_files']}</td>
            <td>{r['total_annotations']}</td>
            <td><b>{r['positives']}</b></td>
            <td>{r['negatives']}</td>
            <td>{r['ambiguous']}</td>
        </tr>"""
        for r in repos
    )

    html_out = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Benchmark Corpus Report</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 2em; background: #fafafa; color: #222; }}
        h1 {{ border-bottom: 3px solid #5e6eb; padding-bottom: .3em; }}
        table {{ border-collapse: collapse; width: 100%; margin: 1em 0; }}
        th, td {{ border: 1px solid #ddd; padding: 8px 12px; text-align: left; }}
        th {{ background: #5e6eb; color: white; }}
        tr:nth-child(even) {{ background: #f4f6fa; }}
        .pos {{ color: #2e7d32; font-weight: bold; }}
        .neg {{ color: #c0392b; }}
        .amb {{ color: #b08800; }}
        .totals {{ margin-top: 2em; padding: 1em; background: #5e6eb; color: white; border-radius: 8px; }}
        .totals span {{ margin-left: 1em; font-weight: bold; }}
    </style>
</head>
<body>
    <h1>Benchmark Corpus Report</h1>
    <p>{len(repos)} repos, {total_annotations} annotations
       ({total_pos} positive, {total_neg} negative, {total_amb} ambiguous)</p>
    <table>
        <thead><tr><th>Repo</th><th>License</th><th>Languages</th><th>Domains</th><th>Ann. files</th><th>Total</th><th>Pos</th><th>Neg</th><th>Amb</th></tr></thead>
        <tbody>{rows}</tbody>
    </table>
    <div class="totals">
        <span>{len(repos)} repos</span>
        <span>{total_annotations} annotations</span>
        <span>{total_pos} positive</span>
        <span>{total_neg} negative</span>
        <span>{total_amb} ambiguous</span>
    </div>
</body>
</html>"""

    out_path = Path(__file__).resolve().parent.parent / "tests" / "benchmark" / "corpus-report.html"
    out_path.write_text(html_out, "utf-8")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    sys.exit(main())
