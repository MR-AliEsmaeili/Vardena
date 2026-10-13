#!/usr/bin/env python3
"""Deterministic documentation link check for Vardena.

The repository documents itself in Markdown (``STATE.md``, ``docs/**``,
``.vardena/**``, module READMEs). Nothing executable consumes those files, so
they need no dependency install, database or build -- but a relative link that
points at a deleted or renamed file is a real documentation defect.

This checker is intentionally small and dependency free (python3 standard
library only, the same assumption the ``backend`` job's failure inventory
already makes):

* every ``*.md`` file in the checkout is scanned,
* only *repository-relative* links are resolved (external URLs, mailto and
  in-page anchors are out of scope: checking them would add network flakiness,
  not evidence),
* fenced code blocks and inline code spans are ignored so that examples are
  not mistaken for links,
* with ``--base <rev>``, only links the change set *breaks* fail the run;
  breakage that already exists in the base revision is reported as a warning,
* without a usable base revision the script degrades to report-only mode and
  never fails, because pre-existing breakage cannot be attributed to the
  change set. The degradation is logged and annotated, never silent.

Usage:

    scripts/check-docs-links.py --base "$CI_BASE_SHA" --summary "$GITHUB_STEP_SUMMARY"
"""

from __future__ import annotations

import argparse
import posixpath
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote

MD_SUFFIX = ".md"

#: Directories that never contain hand-written documentation.
SKIPPED_DIRECTORIES = frozenset(
    {
        ".git",
        "node_modules",
        "dist",
        "build",
        "out",
        "coverage",
        ".next",
        ".vite",
        "target",
        "__pycache__",
        ".venv",
    }
)

FENCE_MARKERS = ("```", "~~~")
ZERO_SHA_RE = re.compile(r"^0+$")

# [text](target) / [text](<target with spaces>)
INLINE_LINK_RE = re.compile(r"\[[^\]]*\]\(\s*(?:<(?P<angle>[^>]*)>|(?P<plain>[^)\s]*))")
INLINE_CODE_RE = re.compile(r"`+[^`]*`+")
SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")

MAX_ANNOTATIONS = 10


@dataclass
class BrokenLink:
    file: str
    line: int
    target: str
    resolved: str

    @property
    def key(self) -> tuple[str, str]:
        return (self.file, self.target)

    def describe(self) -> str:
        shown = self.resolved or "<outside the repository>"
        return f"{self.file}:{self.line}: {self.target} -> {shown}"


@dataclass
class Scan:
    broken: list[BrokenLink] = field(default_factory=list)
    scanned_files: int = 0
    scanned_links: int = 0


@dataclass
class Result:
    scan: Scan
    introduced: list[BrokenLink]
    pre_existing: list[BrokenLink]
    degraded: bool

    @property
    def ok(self) -> bool:
        return self.degraded or not self.introduced


# --------------------------------------------------------------------------- #
# Scanning
# --------------------------------------------------------------------------- #


def iter_markdown_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in sorted(root.rglob(f"*{MD_SUFFIX}")):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part in SKIPPED_DIRECTORIES for part in relative.parts[:-1]):
            continue
        files.append(path)
    return files


def strip_inline_code(line: str) -> str:
    """Blank out inline code spans so examples are not read as links."""
    return INLINE_CODE_RE.sub(lambda match: " " * len(match.group(0)), line)


def extract_links(text: str) -> list[tuple[int, str]]:
    """Return (line number, target) for every inline link outside code fences."""
    links: list[tuple[int, str]] = []
    in_fence = False
    for number, raw_line in enumerate(text.splitlines(), start=1):
        if raw_line.lstrip().startswith(FENCE_MARKERS):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for match in INLINE_LINK_RE.finditer(strip_inline_code(raw_line)):
            target = (match.group("angle") or match.group("plain") or "").strip()
            if target:
                links.append((number, target))
    return links


def resolve_target(file_relative: str, target: str) -> str | None:
    """Resolve a repository-relative link target.

    Returns the repository-relative path, ``""`` when the target escapes the
    repository root (always a defect), or ``None`` when the target is not a
    repository-relative link at all (external URL, anchor only).
    """
    target = unquote(target.split("#", 1)[0].strip())
    if not target or SCHEME_RE.match(target) or target.startswith("//"):
        return None
    if target.startswith("/"):
        candidate = posixpath.normpath(target.lstrip("/"))
    else:
        candidate = posixpath.normpath(
            posixpath.join(posixpath.dirname(file_relative), target)
        )
    if candidate in (".", ""):
        return None
    if candidate == ".." or candidate.startswith("../"):
        return ""
    return candidate


def scan_tree(root: Path, files: list[Path]) -> Scan:
    scan = Scan(scanned_files=len(files))
    for path in files:
        relative = path.relative_to(root).as_posix()
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:  # pragma: no cover - unreadable file
            print(f"::warning title=docs links::cannot read {relative}: {exc}")
            continue
        for number, target in extract_links(text):
            resolved = resolve_target(relative, target)
            if resolved is None:
                continue
            scan.scanned_links += 1
            if resolved == "" or not (root / resolved).exists():
                scan.broken.append(BrokenLink(relative, number, target, resolved))
    return scan


# --------------------------------------------------------------------------- #
# Base revision comparison
# --------------------------------------------------------------------------- #


def git(args: list[str], root: Path) -> tuple[bool, str]:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=str(root),
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:  # pragma: no cover - git is present in CI
        print(f"::warning title=docs links::git unavailable: {exc}")
        return False, ""
    if completed.returncode != 0:
        print(
            f"::warning title=docs links::git {' '.join(args)} failed: "
            f"{completed.stderr.strip()}"
        )
        return False, ""
    return True, completed.stdout


def comparable_base(root: Path, base: str) -> str | None:
    """Resolve the revision the head worktree is compared against."""
    if not base or ZERO_SHA_RE.match(base):
        return None
    ok, _ = git(["cat-file", "-e", f"{base}^{{commit}}"], root)
    if not ok:
        return None
    ok, stdout = git(["merge-base", base, "HEAD"], root)
    if ok and stdout.strip():
        return stdout.strip().splitlines()[0]
    return base


def base_tree_paths(root: Path, base: str) -> set[str] | None:
    ok, stdout = git(["ls-tree", "-r", "-z", "--name-only", base], root)
    if not ok:
        return None
    return {path for path in stdout.split("\0") if path}


def base_contains(tree: set[str], candidate: str) -> bool:
    if candidate in tree:
        return True
    prefix = candidate.rstrip("/") + "/"
    return any(path.startswith(prefix) for path in tree)


def pre_existing_keys(root: Path, base: str, scan: Scan) -> set[tuple[str, str]]:
    """Which of the links broken at HEAD were already broken at ``base``."""
    tree = base_tree_paths(root, base)
    if tree is None:
        return set()

    wanted: dict[str, set[str]] = {}
    for link in scan.broken:
        wanted.setdefault(link.file, set()).add(link.target)

    pre_existing: set[tuple[str, str]] = set()
    for file_relative, targets in wanted.items():
        if file_relative not in tree:
            # Added by this change set: nothing about it can be pre-existing.
            continue
        ok, text = git(["show", f"{base}:{file_relative}"], root)
        if not ok:
            continue
        for _, target in extract_links(text):
            if target not in targets:
                continue
            resolved = resolve_target(file_relative, target)
            if resolved is None:
                continue
            if resolved == "" or not base_contains(tree, resolved):
                pre_existing.add((file_relative, target))
    return pre_existing


def evaluate(root: Path, base: str) -> Result:
    scan = scan_tree(root, iter_markdown_files(root))
    if not scan.broken:
        return Result(scan, [], [], degraded=False)

    revision = comparable_base(root, base)
    if revision is None:
        print(
            "no comparable base revision (missing, zero, or absent from this "
            "checkout): reporting broken links without failing"
        )
        return Result(scan, [], list(scan.broken), degraded=True)

    already_broken = pre_existing_keys(root, revision, scan)
    introduced = [link for link in scan.broken if link.key not in already_broken]
    pre_existing = [link for link in scan.broken if link.key in already_broken]
    return Result(scan, introduced, pre_existing, degraded=False)


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #


def annotate(result: Result) -> None:
    for link in result.pre_existing[:MAX_ANNOTATIONS]:
        print(
            f"::warning title=pre-existing broken documentation link::{link.describe()}"
        )
    if result.degraded and result.pre_existing:
        print(
            "::warning title=docs links::%d broken link(s) found, but no "
            "comparable base revision was available to attribute them; "
            "reported, not failed" % len(result.pre_existing)
        )
    for link in result.introduced[:MAX_ANNOTATIONS]:
        print(f"::error title=broken documentation link::{link.describe()}")
    for label, links in (
        ("pre-existing broken documentation link", result.pre_existing),
        ("broken documentation link", result.introduced),
    ):
        level = "warning" if label.startswith("pre-existing") else "error"
        if len(links) > MAX_ANNOTATIONS:
            print(
                f"::{level} title={label}::{len(links) - MAX_ANNOTATIONS} further "
                "broken link(s) omitted from the annotations; see the step log"
            )


def print_report(result: Result) -> None:
    scan = result.scan
    print("Documentation link check")
    print(f"  markdown files : {scan.scanned_files}")
    print(f"  relative links : {scan.scanned_links}")
    print(f"  broken links   : {len(scan.broken)}")
    if result.degraded:
        print("  mode           : report-only (no comparable base revision)")
    else:
        print(f"  introduced     : {len(result.introduced)}")
        print(f"  pre-existing   : {len(result.pre_existing)}")
    for link in scan.broken:
        print(f"  broken: {link.describe()}")
    if result.ok:
        print("Documentation link check: PASS")
    else:
        print("Documentation link check: FAIL")


def summary_markdown(result: Result) -> str:
    scan = result.scan
    lines = [
        "### Documentation link check",
        "",
        f"- Markdown files scanned: **{scan.scanned_files}**",
        f"- Repository-relative links resolved: **{scan.scanned_links}**",
        f"- Broken links found: **{len(scan.broken)}**",
    ]
    if result.degraded:
        lines.append(
            "- Mode: **report-only** (no comparable base revision; pre-existing "
            "breakage cannot be attributed to this change set)"
        )
    else:
        lines.append(
            f"- Introduced by this change set: **{len(result.introduced)}**"
        )
        lines.append(f"- Pre-existing: **{len(result.pre_existing)}**")
    if result.introduced:
        lines += ["", "Introduced by this change set:"]
        lines += [f"- `{link.describe()}`" for link in result.introduced]
    lines.append("")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="", help="base revision to compare against")
    parser.add_argument("--repo-root", default=".", help="repository root")
    parser.add_argument(
        "--summary",
        default="",
        help="append a Markdown summary to this file (usually $GITHUB_STEP_SUMMARY)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.repo_root).resolve()

    result = evaluate(root, args.base)
    print_report(result)
    annotate(result)

    if args.summary:
        with Path(args.summary).open("a", encoding="utf-8") as handle:
            handle.write(summary_markdown(result))

    return 0 if result.ok else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
