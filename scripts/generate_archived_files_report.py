#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
from collections import Counter, defaultdict
from pathlib import Path


DEFAULT_EXCLUDED_PREFIXES = ("node_modules/",)


def git(repo_root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def list_refs(repo_root: Path, scope: str) -> list[str]:
    output = git(repo_root, "for-each-ref", "--format=%(refname:short)", scope)
    refs = [line.strip() for line in output.splitlines() if line.strip()]
    return [ref for ref in refs if ref != "origin"]


def list_files(repo_root: Path, ref: str) -> list[str]:
    output = git(repo_root, "ls-tree", "-r", "--name-only", ref)
    return [line.strip() for line in output.splitlines() if line.strip()]


def filter_paths(paths: list[str], excluded_prefixes: tuple[str, ...]) -> list[str]:
    return [
        path
        for path in paths
        if not any(path.startswith(prefix) for prefix in excluded_prefixes)
    ]


def top_level_dir(path: str) -> str:
    parts = path.split("/", 1)
    return parts[0]


def build_report(
    baseline_ref: str,
    scanned_refs: list[str],
    archived_by_path: dict[str, list[str]],
    excluded_prefixes: tuple[str, ...],
) -> str:
    archived_paths = sorted(archived_by_path)
    summary = Counter(top_level_dir(path) for path in archived_paths)

    lines = [
        "# Archived Files Report",
        "",
        "A file is treated as archived when it exists in at least one scanned git ref",
        f"but is absent from the baseline ref `{baseline_ref}`.",
        "",
        f"- Baseline ref: `{baseline_ref}`",
        f"- Scanned refs: {', '.join(f'`{ref}`' for ref in scanned_refs)}",
        f"- Excluded prefixes: {', '.join(f'`{prefix}`' for prefix in excluded_prefixes)}",
        f"- Archived file count: **{len(archived_paths)}**",
        "",
        "## Summary by top-level directory",
        "",
        "| Directory | Files |",
        "| --- | ---: |",
    ]

    for directory, count in sorted(summary.items()):
        lines.append(f"| `{directory}` | {count} |")

    lines.extend(
        [
            "",
            "## Archived files",
            "",
            "| File | Present in refs |",
            "| --- | --- |",
        ]
    )

    for path in archived_paths:
        refs = ", ".join(f"`{ref}`" for ref in archived_by_path[path])
        lines.append(f"| `{path}` | {refs} |")

    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate a markdown report for files archived from the main tree."
    )
    parser.add_argument(
        "--baseline",
        default="origin/main",
        help="Git ref used as the active baseline. Default: origin/main",
    )
    parser.add_argument(
        "--scope",
        default="refs/remotes/origin",
        help="Git ref namespace to scan. Default: refs/remotes/origin",
    )
    parser.add_argument(
        "--output",
        default="ARCHIVED_FILES.md",
        help="Output markdown path, relative to the repository root.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    output_path = repo_root / args.output

    excluded_prefixes = DEFAULT_EXCLUDED_PREFIXES
    scanned_refs = [
        ref for ref in list_refs(repo_root, args.scope) if ref != args.baseline
    ]
    baseline_files = set(filter_paths(list_files(repo_root, args.baseline), excluded_prefixes))

    archived_by_path: dict[str, list[str]] = defaultdict(list)
    for ref in scanned_refs:
        for path in filter_paths(list_files(repo_root, ref), excluded_prefixes):
            if path not in baseline_files:
                archived_by_path[path].append(ref)

    report = build_report(
        baseline_ref=args.baseline,
        scanned_refs=scanned_refs,
        archived_by_path=dict(archived_by_path),
        excluded_prefixes=excluded_prefixes,
    )
    output_path.write_text(report, encoding="utf-8")
    print(f"Wrote {len(archived_by_path)} archived file entries to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
