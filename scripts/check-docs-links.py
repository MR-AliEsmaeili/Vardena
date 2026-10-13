#!/usr/bin/env python3
"""Deterministic documentation link check for Vardena.

Documentation needs no dependency install, no database and no build, so a
documentation-only change set runs this instead of the backend/frontend jobs
(see ``docs/operations/ci-minutes-optimization.md``). It fails when a
repository-relative link in any Markdown file no longer resolves -- the real
defect a rename or a deletion leaves behind.

Deliberately out of scope: external URLs and in-page anchors (checking them
would add network flakiness and a dependency), reference-style link
definitions, and fenced/inline code spans (examples are not links).

Usage:

    scripts/check-docs-links.py            # exit 1 if any relative link is broken
    scripts/check-docs-links.py --list     # always exit 0, print every broken link
"""

from __future__ import annotations

import argparse
import posixpath
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

SKIPPED_DIRECTORIES = frozenset(
    {".git", "node_modules", "dist", "build", "out", "coverage", "__pycache__", ".venv"}
)

# [text](target) / [text](<target with spaces>)
INLINE_LINK_RE = re.compile(r"\[[^\]]*\]\(\s*(?:<(?P<angle>[^>]*)>|(?P<plain>[^)\s]*))")
INLINE_CODE_RE = re.compile(r"`+[^`]*`+")
SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")


@dataclass
class BrokenLink:
    file: str
    line: int
    target: str
    resolved: str

    def describe(self) -> str:
        return f"{self.file}:{self.line}: {self.target} -> {self.resolved or '<outside the repository>'}"


def markdown_files(root: Path) -> list[Path]:
    files = []
    for path in sorted(root.rglob("*.md")):
        relative = path.relative_to(root)
        if path.is_file() and not any(
            part in SKIPPED_DIRECTORIES for part in relative.parts[:-1]
        ):
            files.append(path)
    return files


def links_in(text: str) -> list[tuple[int, str]]:
    """Return (line, target) for inline links outside code fences and code spans."""
    links: list[tuple[int, str]] = []
    in_fence = False
    for number, raw in enumerate(text.splitlines(), start=1):
        if raw.lstrip().startswith(("```", "~~~")):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        scrubbed = INLINE_CODE_RE.sub(lambda m: " " * len(m.group(0)), raw)
        for match in INLINE_LINK_RE.finditer(scrubbed):
            target = (match.group("angle") or match.group("plain") or "").strip()
            if target:
                links.append((number, target))
    return links


def resolve(file_relative: str, target: str) -> str | None:
    """Repository-relative path, "" for a link escaping the root, None if not ours."""
    target = unquote(target.split("#", 1)[0].strip())
    if not target or SCHEME_RE.match(target) or target.startswith("//"):
        return None
    if target.startswith("/"):
        candidate = posixpath.normpath(target.lstrip("/"))
    else:
        candidate = posixpath.normpath(
            posixpath.join(posixpath.dirname(file_relative), target)
        )
    if candidate in ("", "."):
        return None
    if candidate == ".." or candidate.startswith("../"):
        return ""
    return candidate


def scan(root: Path) -> tuple[list[BrokenLink], int, int]:
    broken: list[BrokenLink] = []
    files = markdown_files(root)
    checked = 0
    for path in files:
        relative = path.relative_to(root).as_posix()
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:  # pragma: no cover - unreadable file
            print(f"::warning title=docs links::cannot read {relative}: {exc}")
            continue
        for line, target in links_in(text):
            resolved = resolve(relative, target)
            if resolved is None:
                continue
            checked += 1
            if resolved == "" or not (root / resolved).exists():
                broken.append(BrokenLink(relative, line, target, resolved))
    return broken, len(files), checked


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", default=".", help="repository root")
    parser.add_argument(
        "--list",
        action="store_true",
        help="report broken links without failing (diagnostic use)",
    )
    args = parser.parse_args(argv)

    root = Path(args.repo_root).resolve()
    broken, files, checked = scan(root)

    print("Documentation link check")
    print(f"  markdown files : {files}")
    print(f"  relative links : {checked}")
    print(f"  broken links   : {len(broken)}")
    for link in broken:
        print(f"::error title=broken documentation link::{link.describe()}")

    if broken and not args.list:
        print("Documentation link check: FAIL")
        return 1
    print("Documentation link check: PASS")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
