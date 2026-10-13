#!/usr/bin/env python3
"""Change-aware CI scope classification for Vardena.

Decides which CI jobs are relevant to a change set so that unrelated jobs are
not executed for documentation-only, frontend-only or backend-only changes.

Design constraints (see ``docs/operations/ci-minutes-optimization.md``):

* Standard library only -- no third-party dependency is added for this.
* Deterministic: the same path list always yields the same decision.
* Fail-safe: a path whose impact cannot be classified confidently marks the
  change as broad, which runs every job. The workflow therefore never uses
  job/workflow level ``paths`` filters: the workflow always starts, every job
  reports a conclusion (skipped jobs report success), and a stable final gate
  (``scripts/ci-gate.py``) turns the decisions into a single explicit result.
* Not self-weakening: with ``--also-run-rev <rev>`` the decision of the
  classifier version stored in ``<rev>`` (the authoritative revision on
  ``main``) is unioned with this one. A change set can therefore never narrow
  verification by shipping a weakened classifier, because the revision that is
  already accepted on ``main`` still has to agree that nothing else is needed.

STABLE INTERFACES (do not remove; the guard depends on them):

* ``--paths-from <file>`` -- classify an explicit path list (no git needed).
  This is the contract ``--also-run-rev`` uses to replay a change set through a
  previous revision's classifier.
* ``--github-output <file>`` -- emit ``docs``/``backend``/``frontend``/
  ``generated``/``broad``/``changed_count``/``mode``/``base_sha``/
  ``base_source`` as ``key=value`` lines.

Usage (CI):

    scripts/ci-classify-scope.py --base "$CI_BASE_SHA" --head HEAD \
        --also-run-rev "$CI_BASE_SHA" \
        --github-output "$GITHUB_OUTPUT" --summary "$GITHUB_STEP_SUMMARY"

Usage (tests / local inspection):

    scripts/ci-classify-scope.py --paths-from paths.txt
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------- #
# Path families
# --------------------------------------------------------------------------- #

#: Files that are documentation only. `docs/**` is documentation even when a
#: non-Markdown asset (image, fixture) lives there, because nothing executable
#: consumes `docs/**` anywhere in the repository.
DOCS_FILE_SUFFIXES = (".md",)

BACKEND_PREFIX = "backend/"
FRONTEND_PREFIX = "frontend/"
VARDENA_PREFIX = ".vardena/"
DOCS_PREFIX = "docs/"

#: The generated-client drift check exists to keep the committed TypeScript
#: client in step with the OpenAPI document produced by the backend checkout.
GENERATED_CLIENT_SCRIPT = "scripts/check-generated-api-client.sh"
FRONTEND_API_PREFIX = "frontend/src/api/"

#: This script's path inside the repository; the self-weakening guard extracts
#: the previous revision's copy from here.
CLASSIFIER_PATH = "scripts/ci-classify-scope.py"

JOB_ORDER = ("docs", "backend", "frontend", "generated")

#: Paths that are known *not* to be documentation and not to belong to the
#: backend/frontend workspaces are unclassifiable, which is the safe default:
#: `.github/**`, `scripts/**`, root manifests and any future top-level
#: directory all run every job.

@dataclass
class Decision:
    """The set of jobs the change set requires."""

    docs: bool = False
    backend: bool = False
    frontend: bool = False
    generated: bool = False
    #: True when at least one path could not be classified confidently.
    broad: bool = False
    #: Paths that forced the broad decision (first few, for the log).
    unclassified_paths: list[str] = field(default_factory=list)
    #: Human readable explanation of how the decision was reached.
    reasons: list[str] = field(default_factory=list)
    #: Number of changed paths inspected.
    changed_count: int = 0
    #: Normalised, de-duplicated changed paths the decision was made from.
    paths: list[str] = field(default_factory=list)

    def as_outputs(self) -> dict[str, str]:
        return {
            "docs": _bool(self.docs),
            "backend": _bool(self.backend),
            "frontend": _bool(self.frontend),
            "generated": _bool(self.generated),
            "broad": _bool(self.broad),
            "changed_count": str(self.changed_count),
        }

    @property
    def expected_jobs(self) -> list[str]:
        return [job for job in JOB_ORDER if getattr(self, job)]


def _bool(value: bool) -> str:
    return "true" if value else "false"


def normalise_path(path: str) -> str:
    """Normalise a repository-relative path as produced by git."""
    path = path.strip()
    while path.startswith("./"):
        path = path[2:]
    return path.replace("\\", "/")


def classify_path(path: str) -> set[str]:
    """Return the path families a single path belongs to.

    Families are not exclusive: ``backend/README.md`` is documentation *and*
    backend content, so the backend job keeps validating it (its
    ``format:check`` covers Markdown) while the generated-client job - which
    can only ever depend on ``backend/src``/Prisma input - stays out.
    """
    path = normalise_path(path)
    families: set[str] = set()

    if path.endswith(DOCS_FILE_SUFFIXES) or path.startswith(DOCS_PREFIX):
        families.add("docs")
    if path.startswith(VARDENA_PREFIX) and path.endswith(DOCS_FILE_SUFFIXES):
        families.add("docs")

    if path.startswith(BACKEND_PREFIX):
        families.add("backend")
        # Only non-documentation backend input can change the OpenAPI document:
        # DTOs, controllers, modules, the Prisma schema, manifests, migrations.
        if not path.endswith(DOCS_FILE_SUFFIXES):
            families.add("generated")

    if path.startswith(FRONTEND_PREFIX):
        families.add("frontend")

    if path == GENERATED_CLIENT_SCRIPT or path.startswith(FRONTEND_API_PREFIX):
        families.add("generated")

    return families


def classify_paths(paths: list[str]) -> Decision:
    """Classify a complete change set."""
    decision = Decision()
    seen: set[str] = set()

    for raw in paths:
        path = normalise_path(raw)
        if not path or path in seen:
            continue
        seen.add(path)

        families = classify_path(path)
        if not families:
            decision.broad = True
            if len(decision.unclassified_paths) < 8:
                decision.unclassified_paths.append(path)
            continue

        for family in families:
            setattr(decision, family, True)

    decision.changed_count = len(seen)
    decision.paths = sorted(seen)

    if decision.broad:
        # A path we cannot reason about may affect anything -> run everything.
        decision.docs = True
        decision.backend = True
        decision.frontend = True
        decision.generated = True

    if not paths:
        # An empty change set is never expected in CI (a push or pull request
        # always carries changes). Treat it as unknown rather than as "nothing
        # to verify", so a broken base resolution can never silence CI.
        decision.broad = True
        decision.docs = True
        decision.backend = True
        decision.frontend = True
        decision.generated = True
        decision.reasons.append(
            "empty change set: no path evidence, running every job"
        )

    return decision


# --------------------------------------------------------------------------- #
# Self-weakening guard (union with the authoritative classifier on `main`)
# --------------------------------------------------------------------------- #


@dataclass
class GuardResult:
    """Outcome of replaying the change set through the previous classifier."""

    #: "unioned" | "missing" | "unsupported" | "failed" | "disabled"
    status: str
    detail: str = ""
    outputs: dict[str, str] = field(default_factory=dict)

    @property
    def fail_closed(self) -> bool:
        """True when the guard could not execute a classifier that exists."""
        return self.status == "failed"


def extract_previous_classifier(rev: str, repo_root: Path) -> tuple[str, str]:
    """Return ("ok"/"missing"/"error", content) for ``rev:CLASSIFIER_PATH``."""
    if is_unusable_sha(rev):
        return "missing", ""
    ok, _ = run_git(["cat-file", "-e", f"{rev}^{{commit}}"], repo_root, quiet=True)
    if not ok:
        return "missing", ""
    ok, _ = run_git(["cat-file", "-e", f"{rev}:{CLASSIFIER_PATH}"], repo_root, quiet=True)
    if not ok:
        return "missing", ""
    ok, content = run_git(["show", f"{rev}:{CLASSIFIER_PATH}"], repo_root, quiet=True)
    if not ok or not content.strip():
        return "error", ""
    # A file at that path that is not this classifier cannot be replayed
    # safely; the caller reports it instead of trusting it.
    if "def classify_path(" not in content or "--paths-from" not in content:
        return "error", ""
    return "ok", content


def parse_key_values(text: str) -> dict[str, str]:
    outputs: dict[str, str] = {}
    for line in text.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            outputs[key.strip()] = value.strip()
    return outputs


def union_outputs(decision: Decision, outputs: dict[str, str]) -> list[str]:
    """Union a previous classifier's decision into ``decision`` (never narrows).

    Returns the jobs the previous revision added to the decision.
    """
    added: list[str] = []
    for job in JOB_ORDER:
        if outputs.get(job) == "true" and not getattr(decision, job):
            setattr(decision, job, True)
            added.append(job)
    if outputs.get("broad") == "true":
        decision.broad = True
    if decision.broad:
        # A broad decision always means every job (same invariant as
        # classify_paths applies to its own decision).
        decision.docs = True
        decision.backend = True
        decision.frontend = True
        decision.generated = True
    return added


def apply_previous_revision_guard(
    decision: Decision, rev: str, repo_root: Path
) -> GuardResult:
    """Replay the change set through the classifier stored in ``rev``.

    The decision of the revision that is already accepted on ``main`` is
    unioned with this one. A change set can therefore not narrow its own
    verification by shipping a weakened classifier, and a classifier that
    exists but cannot be executed fails closed (every job runs).
    """
    if is_unusable_sha(rev):
        return GuardResult("disabled", "no base revision to read a classifier from")

    status, content = extract_previous_classifier(rev, repo_root)
    if status == "missing":
        return GuardResult(
            "missing",
            f"{rev[:12]} does not contain {CLASSIFIER_PATH} yet "
            "(first revision introducing it): the head decision applies",
        )
    if status == "error":
        return GuardResult(
            "failed",
            f"{rev[:12]}:{CLASSIFIER_PATH} exists but is not a usable classifier",
        )

    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "previous-ci-classify-scope.py"
        script.write_text(content, encoding="utf-8")
        paths_file = Path(tmp) / "paths.txt"
        paths_file.write_text("\n".join(decision.paths) + "\n", encoding="utf-8")
        output_file = Path(tmp) / "outputs.txt"
        # The replay uses the documented stable interface (--paths-from) so it
        # works against any revision that keeps that contract.
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
            return GuardResult(
                "failed",
                f"{rev[:12]} classifier exited {completed.returncode}: "
                f"{completed.stderr.strip()[:400]}",
            )
        try:
            outputs = parse_key_values(output_file.read_text(encoding="utf-8"))
        except OSError:
            outputs = parse_key_values(completed.stdout)

    if not outputs:
        return GuardResult(
            "failed", f"{rev[:12]} classifier produced no decision outputs"
        )

    added = union_outputs(decision, outputs)
    detail = (
        f"{rev[:12]} decision unioned (added: {', '.join(added) or 'nothing'})"
    )
    return GuardResult("unioned", detail, outputs)


# --------------------------------------------------------------------------- #
# Git plumbing
# --------------------------------------------------------------------------- #



def run_git(args: list[str], cwd: Path, quiet: bool = False) -> tuple[bool, str]:
    """Run git, returning (ok, stdout). Failures are logged unless ``quiet``."""
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            check=False,
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


def is_unusable_sha(sha: str | None) -> bool:
    """True for an absent or all-zero revision (new branch / forced push)."""
    if sha is None:
        return True
    sha = sha.strip()
    return sha == "" or set(sha) == {"0"}


def parse_name_status_z(stdout: str) -> list[str]:
    """Parse ``git diff --name-status -z`` output into the involved paths.

    Rename/copy records carry both the source and the destination path; both
    are returned, because a rename can break documentation links on the source
    side and can introduce backend/frontend content on the destination side.
    """
    tokens = [token for token in stdout.split("\0") if token != ""]
    paths: list[str] = []
    index = 0
    while index < len(tokens):
        status = tokens[index]
        index += 1
        if status[:1] in ("R", "C"):
            # R100\0old\0new\0
            if index + 1 >= len(tokens):
                break
            paths.append(tokens[index])
            paths.append(tokens[index + 1])
            index += 2
        else:
            if index >= len(tokens):
                break
            paths.append(tokens[index])
            index += 1
    return paths


def resolve_base(base: str | None, head: str, cwd: Path, main_ref: str) -> tuple[str, str]:
    """Resolve the revision the change set is computed against.

    Returns ``(revision, source)``; ``source`` is ``""`` when no usable base
    exists, which makes the caller fall back to running every job.

    The base is required to be reachable from "main" whenever that ref is
    available: a base that is not (a stale fork point after a force push, or a
    pull request's own previous head) could hide changes and is never trusted.
    """
    if is_unusable_sha(base):
        return "", ""

    ok, _ = run_git(["cat-file", "-e", f"{base}^{{commit}}"], cwd)
    if not ok:
        print(
            f"base revision {base} is not present in this checkout "
            "(shallow clone or force push); running every job",
            file=sys.stderr,
        )
        return "", ""

    ok, stdout = run_git(["rev-parse", "--verify", "--quiet", main_ref], cwd)
    if ok and stdout.strip():
        ok, _ = run_git(["merge-base", "--is-ancestor", base, main_ref], cwd)
        if not ok:
            print(
                f"base revision {base} is not reachable from {main_ref}: "
                "refusing to compute a change set from it; running every job",
                file=sys.stderr,
            )
            return "", ""
    else:
        print(
            f"{main_ref} is not available in this checkout; base ancestry "
            "cannot be verified",
            file=sys.stderr,
        )

    # The merge base is the change set's true fork point: it excludes base
    # branch commits that the PR has not touched.
    ok, stdout = run_git(["merge-base", base, head], cwd)
    if ok and stdout.strip():
        merge_base = stdout.strip().splitlines()[0]
        if merge_base != _rev_parse(head, cwd):
            return merge_base, "merge-base"
        print(
            "merge base equals the checked out revision: no diff to inspect; "
            "running every job",
            file=sys.stderr,
        )
        return "", ""

    ok, _ = run_git(["cat-file", "-e", f"{base}^{{commit}}"], cwd)
    if ok:
        return base, "base-revision"
    return "", ""


def _rev_parse(rev: str, cwd: Path) -> str:
    ok, stdout = run_git(["rev-parse", rev], cwd)
    return stdout.strip() if ok else ""


def changed_paths(base_ref: str, head: str, cwd: Path) -> list[str]:
    ok, stdout = run_git(
        [
            "diff",
            "--name-status",
            "-z",
            "--find-renames",
            base_ref,
            head,
            "--",
        ],
        cwd,
    )
    if not ok:
        return []
    return parse_name_status_z(stdout)


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #


def print_summary(
    decision: Decision,
    base_source: str,
    base_ref: str,
    guard: GuardResult | None = None,
) -> None:
    print("CI scope classification")
    print(f"  changed paths : {decision.changed_count}")
    print(f"  base          : {base_ref or '<none>'} ({base_source or 'unavailable'})")
    if guard is not None:
        print(f"  previous rev  : {guard.status} - {guard.detail}")
        if guard.outputs:
            print(
                "    previous decision: "
                + ", ".join(
                    f"{job}={'true' if guard.outputs.get(job) == 'true' else 'false'}"
                    for job in JOB_ORDER
                )
            )
    print(
        "  decision      : "
        + (", ".join(decision.expected_jobs) if decision.expected_jobs else "none")
    )
    if decision.broad:
        print("  broad change  : every job runs")
        for path in decision.unclassified_paths:
            print(f"    unclassified: {path}")
    for reason in decision.reasons:
        print(f"  reason        : {reason}")


def summary_markdown(
    decision: Decision,
    base_source: str,
    base_ref: str,
    guard: GuardResult | None = None,
) -> str:
    rows = [
        ("docs", decision.docs, "Markdown / docs/ / .vardena/** docs link validation"),
        (
            "backend",
            decision.backend,
            "Prisma, lint, typecheck, format, unit, build, migrations, E2E",
        ),
        ("frontend", decision.frontend, "lint, typecheck, format, tests, build"),
        (
            "generated",
            decision.generated,
            "generated API client drift (OpenAPI dump vs committed client)",
        ),
    ]
    lines = [
        "### Change-aware CI scope",
        "",
        f"- Changed paths: **{decision.changed_count}**",
        f"- Base revision: `{base_ref or 'none'}`"
        f" ({base_source or 'unavailable - every job runs'})",
        f"- Broad (unclassified) change: **{'yes' if decision.broad else 'no'}**",
        "",
        "| Job | Decision | Verification |",
        "| --- | --- | --- |",
    ]
    for job, enabled, description in rows:
        lines.append(
            f"| `{job}` | {'run' if enabled else 'skipped (not applicable)'} | {description} |"
        )
    if guard is not None:
        lines += [
            "",
            f"Previous revision classifier (`{base_ref or 'none'}`): "
            f"**{guard.status}** - {guard.detail}",
        ]
        if guard.outputs:
            lines.append(
                "It reported: "
                + ", ".join(
                    f"`{job}={guard.outputs.get(job, 'false')}`" for job in JOB_ORDER
                )
            )
    if decision.unclassified_paths:
        lines += ["", "Unclassified paths that forced a full run:"]
        lines += [f"- `{path}`" for path in decision.unclassified_paths]
    lines.append("")
    return "\n".join(lines)


def write_outputs(path: Path, outputs: dict[str, str]) -> None:
    with path.open("a", encoding="utf-8") as handle:
        for key, value in outputs.items():
            handle.write(f"{key}={value}\n")


def pin_github_annotations(decision: Decision, guard: GuardResult | None = None) -> None:
    if guard is not None:
        if guard.status == "failed":
            print(
                "::error title=CI scope::the previous revision's classifier could "
                f"not be executed ({guard.detail}); running every job"
            )
        elif guard.status == "missing":
            print(
                "::notice title=CI scope::no previous-revision classifier to "
                f"compare against ({guard.detail})"
            )
        elif guard.status == "unioned":
            print(
                f"::notice title=CI scope::previous-revision classifier unioned "
                f"({guard.detail})"
            )
    if decision.broad:
        shown = ", ".join(decision.unclassified_paths[:4]) or "none"
        print(
            "::notice title=CI scope::broad change detected - running every job "
            f"(unclassified paths: {shown})"
        )
    else:
        print(
            "::notice title=CI scope::change-aware run - jobs: "
            f"{', '.join(decision.expected_jobs) or 'none'}"
        )


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base",
        default="",
        help="revision to compare against (github.event.pull_request.base.sha "
        "for pull requests, github.event.before for pushes)",
    )
    parser.add_argument("--head", default="HEAD", help="revision to inspect")
    parser.add_argument(
        "--main-ref",
        default="origin/main",
        help="ref a trusted base revision must be reachable from",
    )
    parser.add_argument(
        "--paths-from",
        default="",
        help="read change-set paths from this file ('-' for stdin) instead of "
        "computing a git diff; stable interface (used by the guard and tests)",
    )
    parser.add_argument(
        "--also-run-rev",
        default=None,
        help="revision whose copy of this script must agree with the decision "
        "(self-weakening guard); normally the pull request base tip / "
        "pre-push head that is already accepted on main",
    )
    parser.add_argument(
        "--github-output",
        default="",
        help="append key=value results to this file (usually $GITHUB_OUTPUT)",
    )
    parser.add_argument(
        "--summary",
        default="",
        help="append a Markdown summary to this file "
        "(usually $GITHUB_STEP_SUMMARY)",
    )
    parser.add_argument(
        "--repo-root",
        default=".",
        help="repository root used for git commands (default: current directory)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.repo_root).resolve()

    base_source = ""
    base_ref = ""
    paths: list[str]

    if args.paths_from:
        if args.paths_from == "-":
            raw = sys.stdin.read()
        else:
            raw = Path(args.paths_from).read_text(encoding="utf-8")
        paths = [line for line in raw.splitlines() if line.strip() != ""]
        base_source = "paths-file"
    else:
        base_ref, base_source = resolve_base(
            args.base, args.head, root, args.main_ref
        )
        if not base_source:
            paths = []
        else:
            paths = changed_paths(base_ref, args.head, root)

    decision = classify_paths(paths)
    if base_source == "" and not args.paths_from:
        decision.reasons.append(
            "no comparable base revision: running every job (fail-safe)"
        )

    # Self-weakening guard: the classifier of the revision already accepted on
    # `main` re-evaluates the same change set, and its decision is unioned in.
    guard: GuardResult | None = None
    if args.also_run_rev is not None:
        guard = apply_previous_revision_guard(decision, args.also_run_rev, root)
        if guard.fail_closed:
            decision.broad = True
            decision.docs = True
            decision.backend = True
            decision.frontend = True
            decision.generated = True
            decision.reasons.append(
                "previous-revision classifier could not be executed: "
                "running every job (fail-closed)"
            )
        elif guard.status == "unioned":
            decision.reasons.append(
                "previous-revision classifier unioned: " + guard.detail
            )

    print_summary(decision, base_source, base_ref, guard)
    pin_github_annotations(decision, guard)

    if args.github_output:
        write_outputs(
            Path(args.github_output),
            {
                **decision.as_outputs(),
                "mode": "broad" if decision.broad else "changed",
                "base_sha": base_ref,
                "base_source": base_source,
                "guard": guard.status if guard is not None else "disabled",
            },
        )
    if args.summary:
        with Path(args.summary).open("a", encoding="utf-8") as handle:
            handle.write(summary_markdown(decision, base_source, base_ref, guard))

    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
