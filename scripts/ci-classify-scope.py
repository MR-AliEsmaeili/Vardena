#!/usr/bin/env python3
"""Change-aware CI scope classification for Vardena.

Decides which CI jobs a change set requires so that a documentation-only or
frontend-only change does not pay for PostgreSQL, migrations and E2E. See
``docs/operations/ci-minutes-optimization.md`` for the path-to-job matrix.

Properties that matter:

* **Standard library only** -- no dependency is added for this.
* **Deterministic** -- the same path list always yields the same decision.
* **Fail-safe** -- a path whose impact is not confidently known marks the change
  as broad, which runs every job. The workflow therefore never uses workflow or
  job level ``paths`` filters (a skipped workflow leaves required checks
  pending); every job reports a conclusion and ``scripts/ci-gate.py`` turns
  them into one explicit result.
* **Not self-weakening** -- with ``--also-run-rev <rev>`` the classifier stored
  in ``<rev>`` (the revision already accepted on ``main``) re-evaluates the same
  change set and its decision is unioned in, so a change set cannot narrow its
  own verification by shipping a weakened classifier.

Stable interfaces (the guard replays through them):

* ``--paths-from <file>`` -- classify an explicit path list, no git required.
* ``--github-output <file>`` -- emit ``docs``/``backend``/``frontend``/
  ``generated``/``broad`` as ``key=value`` lines.

Usage (CI):

    scripts/ci-classify-scope.py --base "$CI_BASE_SHA" --head HEAD \
        --also-run-rev "$CI_BASE_SHA" \
        --github-output "$GITHUB_OUTPUT" --summary "$GITHUB_STEP_SUMMARY"

Usage (local inspection):

    scripts/ci-classify-scope.py --paths-from paths.txt
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

DOCS_SUFFIXES = (".md",)
BACKEND_PREFIX = "backend/"
FRONTEND_PREFIX = "frontend/"
VARDENA_PREFIX = ".vardena/"
DOCS_PREFIX = "docs/"
GENERATED_CLIENT_SCRIPT = "scripts/check-generated-api-client.sh"
FRONTEND_API_PREFIX = "frontend/src/api/"
CLASSIFIER_PATH = "scripts/ci-classify-scope.py"

JOB_ORDER = ("docs", "backend", "frontend", "generated")


@dataclass
class Decision:
    """The set of jobs a change set requires."""

    docs: bool = False
    backend: bool = False
    frontend: bool = False
    generated: bool = False
    #: True when at least one path could not be classified confidently.
    broad: bool = False
    unclassified: list[str] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)
    paths: list[str] = field(default_factory=list)

    def as_outputs(self) -> dict[str, str]:
        return {
            "docs": _bool(self.docs),
            "backend": _bool(self.backend),
            "frontend": _bool(self.frontend),
            "generated": _bool(self.generated),
            "broad": _bool(self.broad),
        }

    @property
    def jobs(self) -> list[str]:
        return [job for job in JOB_ORDER if getattr(self, job)]

    def run_everything(self) -> "Decision":
        self.broad = True
        self.docs = self.backend = self.frontend = self.generated = True
        return self


def _bool(value: bool) -> str:
    return "true" if value else "false"


def normalise(path: str) -> str:
    path = path.strip()
    while path.startswith("./"):
        path = path[2:]
    return path.replace("\\", "/")


def classify_path(path: str) -> set[str]:
    """Path families a single path belongs to (families are not exclusive).

    ``backend/README.md`` is documentation *and* backend content, so the backend
    job keeps validating it (its ``format:check`` covers Markdown) while the
    generated-client job -- which can only depend on backend sources, the Prisma
    schema and the backend manifests -- stays out.
    """
    path = normalise(path)
    families: set[str] = set()

    if path.endswith(DOCS_SUFFIXES) or path.startswith(DOCS_PREFIX):
        families.add("docs")
    if path.startswith(VARDENA_PREFIX) and path.endswith(DOCS_SUFFIXES):
        families.add("docs")

    if path.startswith(BACKEND_PREFIX):
        families.add("backend")
    if path.startswith("owner-licensing/"):
        # Owner API/UI contracts and isolation checks travel together.
        families.update(("backend", "frontend"))
    if path.startswith(BACKEND_PREFIX) and not path.endswith(DOCS_SUFFIXES):
        families.add("generated")

    if path.startswith(FRONTEND_PREFIX):
        families.add("frontend")

    if path == GENERATED_CLIENT_SCRIPT or path.startswith(FRONTEND_API_PREFIX):
        families.add("generated")

    return families


def classify_paths(paths: list[str]) -> Decision:
    """Classify a complete change set (order independent, de-duplicated)."""
    decision = Decision()
    seen: set[str] = set()

    for raw in paths:
        path = normalise(raw)
        if not path or path in seen:
            continue
        seen.add(path)
        families = classify_path(path)
        if not families:
            # Unclassifiable (`.github/**`, other `scripts/**`, root files, or a
            # directory nobody has taught the classifier about): run everything.
            decision.broad = True
            if len(decision.unclassified) < 5:
                decision.unclassified.append(path)
            continue
        for family in families:
            setattr(decision, family, True)

    decision.paths = sorted(seen)
    if decision.broad:
        decision.run_everything()
    if not decision.paths:
        # Never expected in CI (a push or pull request always carries changes);
        # treated as unknown so a broken base resolution cannot silence CI.
        decision.reasons.append("empty change set: running every job")
        decision.run_everything()
    return decision


# --------------------------------------------------------------------------- #
# Git plumbing
# --------------------------------------------------------------------------- #


def run_git(args: list[str], cwd: Path, quiet: bool = False) -> tuple[bool, str]:
    try:
        completed = subprocess.run(
            ["git", *args], cwd=str(cwd), capture_output=True, text=True, check=False
        )
    except OSError as exc:  # pragma: no cover - git is present in CI
        print(f"git {' '.join(args)}: {exc}", file=sys.stderr)
        return False, ""
    if completed.returncode != 0:
        if not quiet:
            print(
                f"git {' '.join(args)} failed ({completed.returncode}): "
                f"{completed.stderr.strip()}",
                file=sys.stderr,
            )
        return False, ""
    return True, completed.stdout


def unusable_sha(sha: str | None) -> bool:
    """True for an absent or all-zero revision (new branch / forced push)."""
    if sha is None:
        return True
    sha = sha.strip()
    return sha == "" or set(sha) == {"0"}


def parse_name_status_z(stdout: str) -> list[str]:
    """Paths from ``git diff --name-status -z`` (both sides of a rename)."""
    tokens = [token for token in stdout.split("\0") if token != ""]
    paths: list[str] = []
    index = 0
    while index < len(tokens):
        status = tokens[index]
        index += 1
        take = 2 if status[:1] in ("R", "C") else 1
        if index + take - 1 >= len(tokens):
            break
        paths.extend(tokens[index : index + take])
        index += take
    return paths


def resolve_base(base: str | None, head: str, cwd: Path, main_ref: str) -> tuple[str, str]:
    """Revision the change set is compared against, or ("", "") when unusable.

    A base that is not reachable from ``main`` (stale fork point after a force
    push, or a pull request's own previous head) could hide changes and is never
    trusted; an unusable base makes the caller run every job.
    """
    if unusable_sha(base):
        return "", ""

    ok, _ = run_git(["cat-file", "-e", f"{base}^{{commit}}"], cwd)
    if not ok:
        print(f"base {base} is not in this checkout; running every job", file=sys.stderr)
        return "", ""

    ok, stdout = run_git(["rev-parse", "--verify", "--quiet", main_ref], cwd)
    if ok and stdout.strip():
        ok, _ = run_git(["merge-base", "--is-ancestor", base, main_ref], cwd)
        if not ok:
            print(
                f"base {base} is not reachable from {main_ref}: refusing to compute "
                "a change set from it; running every job",
                file=sys.stderr,
            )
            return "", ""

    ok, stdout = run_git(["merge-base", base, head], cwd)
    if ok and stdout.strip():
        merge_base = stdout.strip().splitlines()[0]
        ok, head_sha = run_git(["rev-parse", head], cwd)
        if not (ok and head_sha.strip() == merge_base):
            return merge_base, "merge-base"
        print("no diff to inspect; running every job", file=sys.stderr)
        return "", ""
    return base, "base-revision"


def changed_paths(base_ref: str, head: str, cwd: Path) -> list[str]:
    ok, stdout = run_git(
        ["diff", "--name-status", "-z", "--find-renames", base_ref, head, "--"], cwd
    )
    return parse_name_status_z(stdout) if ok else []


# --------------------------------------------------------------------------- #
# Self-weakening guard
# --------------------------------------------------------------------------- #


@dataclass
class Guard:
    """Outcome of replaying the change set through the previous classifier."""

    status: str = "disabled"  # unioned | missing | failed | disabled
    detail: str = ""
    outputs: dict[str, str] = field(default_factory=dict)

    @property
    def fails_closed(self) -> bool:
        return self.status == "failed"


def previous_classifier(rev: str, repo_root: Path) -> tuple[str, str]:
    """Return ("ok"|"missing"|"error", source) for ``rev:CLASSIFIER_PATH``."""
    if unusable_sha(rev):
        return "missing", ""
    ok, _ = run_git(["cat-file", "-e", f"{rev}^{{commit}}"], repo_root, quiet=True)
    if not ok:
        return "missing", ""
    ok, _ = run_git(["cat-file", "-e", f"{rev}:{CLASSIFIER_PATH}"], repo_root, quiet=True)
    if not ok:
        return "missing", ""
    ok, content = run_git(["show", f"{rev}:{CLASSIFIER_PATH}"], repo_root, quiet=True)
    if not ok or "--paths-from" not in content or "def classify_path(" not in content:
        return "error", ""  # something else lives at that path: do not trust it
    return "ok", content


def union(decision: Decision, outputs: dict[str, str]) -> list[str]:
    """Union a previous classifier's decision in (never narrows)."""
    before = {job: getattr(decision, job) for job in JOB_ORDER}
    if outputs.get("broad") == "true":
        decision.run_everything()
    for job in JOB_ORDER:
        if outputs.get(job) == "true":
            setattr(decision, job, True)
    return [job for job in JOB_ORDER if getattr(decision, job) and not before[job]]


def apply_guard(decision: Decision, rev: str, repo_root: Path) -> Guard:
    """Replay the change set through ``rev``'s classifier and union the result."""
    if unusable_sha(rev):
        return Guard("disabled", "no base revision to read a classifier from")

    status, content = previous_classifier(rev, repo_root)
    if status == "missing":
        return Guard(
            "missing",
            f"{rev[:12]} has no {CLASSIFIER_PATH} yet (the revision that introduces it)",
        )
    if status == "error":
        return Guard("failed", f"{rev[:12]}:{CLASSIFIER_PATH} is not a usable classifier")

    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "previous-classifier.py"
        script.write_text(content, encoding="utf-8")
        paths_file = Path(tmp) / "paths.txt"
        paths_file.write_text("\n".join(decision.paths) + "\n", encoding="utf-8")
        output_file = Path(tmp) / "outputs.txt"
        completed = subprocess.run(
            [
                sys.executable,
                str(script),
                "--paths-from",
                str(paths_file),
                "--github-output",
                str(output_file),
            ],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            return Guard(
                "failed",
                f"{rev[:12]} classifier exited {completed.returncode}: "
                f"{completed.stderr.strip()[:300]}",
            )
        outputs = {}
        if output_file.exists():
            for line in output_file.read_text(encoding="utf-8").splitlines():
                if "=" in line:
                    key, value = line.split("=", 1)
                    outputs[key.strip()] = value.strip()

    if not outputs:
        return Guard("failed", f"{rev[:12]} classifier produced no decision outputs")
    added = union(decision, outputs)
    return Guard("unioned", f"{rev[:12]} unioned (added: {', '.join(added) or 'nothing'})")


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #


def print_report(decision: Decision, base_ref: str, base_source: str, guard: Guard) -> None:
    print("CI scope classification")
    print(f"  changed paths : {len(decision.paths)}")
    print(f"  base          : {base_ref or '<none>'} ({base_source or 'unavailable'})")
    if guard.status != "disabled":
        print(f"  previous rev  : {guard.status} - {guard.detail}")
    print(f"  decision      : {', '.join(decision.jobs) or 'none'}")
    if decision.broad:
        print("  broad change  : every job runs")
        for path in decision.unclassified:
            print(f"    unclassified: {path}")
    for reason in decision.reasons:
        print(f"  reason        : {reason}")

    if decision.broad:
        print(
            "::notice title=CI scope::running every job"
            + (f" (unclassified: {', '.join(decision.unclassified)})" if decision.unclassified else "")
        )
    else:
        print(f"::notice title=CI scope::jobs: {', '.join(decision.jobs) or 'none'}")
    if guard.status == "unioned":
        print(f"::notice title=CI scope::previous-revision classifier unioned ({guard.detail})")
    elif guard.status == "missing":
        print(f"::notice title=CI scope::no previous classifier to compare against ({guard.detail})")


def write_summary(path: str, decision: Decision, base_ref: str, base_source: str, guard: Guard) -> None:
    lines = [
        "### CI scope",
        "",
        f"- Changed paths: **{len(decision.paths)}**",
        f"- Base: `{base_ref or 'none'}` ({base_source or 'unavailable - running every job'})",
        f"- Decision: **{', '.join(decision.jobs) or 'none'}**"
        + (" (broad change: every job runs)" if decision.broad else ""),
    ]
    if guard.status != "disabled":
        lines.append(f"- Previous-revision classifier: **{guard.status}** - {guard.detail}")
    if decision.unclassified:
        lines += ["", "Unclassified paths that forced a full run:"]
        lines += [f"- `{path}`" for path in decision.unclassified]
    if decision.reasons:
        lines += [f"- {reason}" for reason in decision.reasons]
    lines.append("")
    with Path(path).open("a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base",
        default="",
        help="revision to compare against (pull_request.base.sha / push event.before)",
    )
    parser.add_argument("--head", default="HEAD", help="revision to inspect")
    parser.add_argument(
        "--main-ref",
        default="origin/main",
        help="ref a trusted base revision must be reachable from",
    )
    parser.add_argument(
        "--also-run-rev",
        default=None,
        help="revision whose classifier must agree with this decision (self-weakening guard)",
    )
    parser.add_argument(
        "--paths-from",
        default="",
        help="read the change-set paths from this file ('-' for stdin) instead of "
        "a git diff; stable interface, used by the guard and the tests",
    )
    parser.add_argument(
        "--github-output",
        default="",
        help="append key=value results to this file (usually $GITHUB_OUTPUT)",
    )
    parser.add_argument(
        "--summary", default="", help="append a Markdown summary to this file"
    )
    parser.add_argument("--repo-root", default=".", help="repository root")
    args = parser.parse_args(argv)

    root = Path(args.repo_root).resolve()
    base_ref = base_source = ""

    if args.paths_from:
        raw = sys.stdin.read() if args.paths_from == "-" else Path(args.paths_from).read_text(
            encoding="utf-8"
        )
        paths = [line for line in raw.splitlines() if line.strip()]
        base_source = "paths-file"
    else:
        base_ref, base_source = resolve_base(args.base, args.head, root, args.main_ref)
        paths = changed_paths(base_ref, args.head, root) if base_source else []

    decision = classify_paths(paths)
    if not base_source and not args.paths_from:
        decision.reasons.append("no comparable base revision: running every job")
        decision.run_everything()

    guard = Guard()
    if args.also_run_rev is not None:
        guard = apply_guard(decision, args.also_run_rev, root)
        if guard.fails_closed:
            decision.reasons.append(
                "previous-revision classifier could not be executed: running every job"
            )
            decision.run_everything()

    print_report(decision, base_ref, base_source, guard)
    if args.github_output:
        with Path(args.github_output).open("a", encoding="utf-8") as handle:
            for key, value in decision.as_outputs().items():
                handle.write(f"{key}={value}\n")
    if args.summary:
        write_summary(args.summary, decision, base_ref, base_source, guard)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
