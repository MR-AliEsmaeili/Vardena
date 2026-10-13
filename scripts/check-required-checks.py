#!/usr/bin/env python3
"""Verify that Vardena's stable CI checks are actually required for `main`.

A green check produced by a workflow is **not** proof that GitHub requires it:
only branch protection (or a repository ruleset) turns a check into a merge
gate. This script reads the authoritative setting and reports whether the
checks Vardena relies on are enforced, so the answer never depends on reading
a settings page by hand.

It reads (read-only, never writes):

    GET /repos/{owner}/{repo}/branches/{branch}/protection

and interprets GitHub's answers, including the two responses that look like
failures but mean something specific:

* ``404`` -- the branch has **no branch protection rule** at all, so no check
  is required.
* ``403`` with ``Upgrade to GitHub Pro`` -- protected branches are a paid
  feature for private repositories: on the current plan the repository
  **cannot** enforce required checks. (Repository rulesets are gated the same
  way; the rulesets API returns the same message.)
* ``403`` with ``Resource not accessible by integration`` -- the token is a
  GitHub App installation token without the ``Administration`` permission. The
  setting is unreadable *for this token*; it says nothing about the repository.

Usage (requires an admin-scoped token, e.g. the repository owner's own):

    scripts/check-required-checks.py
    scripts/check-required-checks.py --require ci-gate --require backend

Exit codes:

    0  every required check in policy is enforced
    1  enforced but incomplete (a policy check is missing), or no rule exists
    2  cannot be determined (permission, plan, network, or unexpected answer)
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_REPO = "MR-AliEsmaeili/Vardena"
DEFAULT_BRANCH = "main"

#: Checks a change-aware pipeline should require together (see
#: docs/operations/required-check-enforcement.md). `ci-gate` is the aggregate
#: contract; the per-job checks make a single hollowed-out script unable to
#: unlock a merge, and block a silent removal of a job.
DEFAULT_REQUIRED = (
    "ci-gate",
    "backend",
    "frontend",
    "generated-api-client",
    "docs",
)

PROTECTION_PATH = "repos/{repo}/branches/{branch}/protection"

RULE_EXISTS = "enforced"
NO_RULE = "no_protection_rule"
PLAN_GATED = "unavailable_on_plan"
PERMISSION_DENIED = "permission_denied"
API_ERROR = "api_error"


@dataclass
class Protection:
    """Interpreted branch-protection response."""

    status: str
    http_status: int
    message: str = ""
    contexts: list[str] = field(default_factory=list)
    checks: list[str] = field(default_factory=list)
    strict: bool | None = None
    enforce_admins: bool | None = None
    requires_reviews: bool | None = None
    raw: dict | None = None

    @property
    def required(self) -> list[str]:
        seen: list[str] = []
        for name in [*self.contexts, *self.checks]:
            if name not in seen:
                seen.append(name)
        return seen


@dataclass
class Verdict:
    protection: Protection
    required: list[str]
    missing: list[str]
    problems: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def exit_code(self) -> int:
        if self.protection.status in (RULE_EXISTS, NO_RULE):
            return 1 if self.missing else 0
        return 2


def interpret_response(http_status: int, body: str) -> Protection:
    """Turn an HTTP status + body into a Protection verdict."""
    text = (body or "").strip()
    lower = text.lower()

    if http_status == 404:
        return Protection(
            NO_RULE,
            404,
            "branch has no branch protection rule",
        )
    if http_status == 403:
        if "upgrade to github pro" in lower or "make this repository public" in lower:
            return Protection(
                PLAN_GATED,
                403,
                "protected branches are not included in this repository's plan",
            )
        return Protection(
            PERMISSION_DENIED,
            403,
            text[:400] or "the token may not read branch protection",
        )
    if http_status != 200:
        return Protection(API_ERROR, http_status, text[:400])

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        return Protection(API_ERROR, http_status, f"unreadable response: {exc}")

    if not isinstance(payload, dict):
        return Protection(API_ERROR, http_status, "unexpected response shape")

    status_checks = payload.get("required_status_checks") or {}
    contexts = [str(item) for item in status_checks.get("contexts") or []]
    checks = [
        str((item or {}).get("context", ""))
        for item in status_checks.get("checks") or []
        if (item or {}).get("context")
    ]
    reviews = payload.get("required_pull_request_reviews")
    return Protection(
        RULE_EXISTS,
        200,
        "",
        contexts=contexts,
        checks=checks,
        strict=status_checks.get("strict"),
        enforce_admins=(payload.get("enforce_admins") or {}).get("enabled")
        if isinstance(payload.get("enforce_admins"), dict)
        else payload.get("enforce_admins"),
        requires_reviews=bool(reviews) if reviews is not None else None,
        raw=payload,
    )


def evaluate(protection: Protection, required: list[str]) -> Verdict:
    found = protection.required
    missing = [name for name in required if name not in found]
    problems: list[str] = []
    warnings: list[str] = []

    if protection.status == NO_RULE:
        problems.append(
            "no branch protection rule exists for the branch: no status check "
            "can block a merge"
        )
    elif protection.status == PLAN_GATED:
        problems.append(
            "this repository cannot enforce required checks on its current "
            "plan (protected branches require GitHub Pro for private "
            "repositories); CI results are advisory only"
        )
    elif protection.status == PERMISSION_DENIED:
        problems.append(
            "the token cannot read branch protection (needs the Administration "
            "permission); run this script as the repository owner"
        )
    elif protection.status == API_ERROR:
        problems.append(f"could not read branch protection: {protection.message}")

    if protection.status == RULE_EXISTS and missing:
        problems.append(
            "required checks missing from the rule: " + ", ".join(missing)
        )
    if protection.status == RULE_EXISTS:
        if protection.enforce_admins is False:
            warnings.append(
                "`enforce_admins` is off: administrators bypass the rule, so "
                "the owner's own merges are not gated"
            )
        if protection.strict is False:
            warnings.append(
                "`strict` (require branches to be up to date) is off: a pull "
                "request can be verified against a stale base"
            )
        if not protection.requires_reviews:
            warnings.append("no pull request review is required before merging")

    return Verdict(protection, found, missing, problems, warnings)


# --------------------------------------------------------------------------- #
# Fetching
# --------------------------------------------------------------------------- #


def fetch_via_gh(repo: str, branch: str) -> tuple[int, str] | None:
    """Read the setting with the local `gh` credentials, if available."""
    try:
        completed = subprocess.run(
            [
                "gh",
                "api",
                "--include",
                PROTECTION_PATH.format(repo=repo, branch=branch),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None
    if completed.returncode != 0 and not completed.stdout:
        # gh reports the HTTP error on stdout with --include; a hard failure
        # (no gh, not logged in) lands here.
        return None
    text = completed.stdout
    lines = text.splitlines()
    if not lines:
        return None
    status = 0
    for line in lines[:1]:
        parts = line.split()
        if len(parts) >= 2 and parts[1].isdigit():
            status = int(parts[1])
    body = text.split("\r\n\r\n", 1)[-1] if "\r\n\r\n" in text else text
    if body is text:
        # --include uses \n\n when the response has no CRLF headers
        body = text.split("\n\n", 1)[-1]
    return status, body


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #


def print_report(verdict: Verdict, repo: str, branch: str, required: list[str]) -> None:
    protection = verdict.protection
    print(f"Required-check enforcement for {repo}@{branch}")
    print(f"  HTTP status      : {protection.http_status}")
    print(f"  interpreted as   : {protection.status}")
    print(
        "  required checks  : "
        + (", ".join(verdict.required) if verdict.required else "(none)")
    )
    print(f"  policy expects   : {', '.join(required)}")
    if verdict.missing and protection.status in (RULE_EXISTS, NO_RULE):
        print(f"  missing          : {', '.join(verdict.missing)}")
    if protection.status == RULE_EXISTS:
        print(
            f"  enforce_admins   : {protection.enforce_admins} · strict: "
            f"{protection.strict} · reviews: {protection.requires_reviews}"
        )
    for warning in verdict.warnings:
        print(f"::warning title=required checks::{warning}")
    for problem in verdict.problems:
        print(f"::error title=required checks::{problem}")

    if verdict.exit_code == 0:
        print("Verdict: ENFORCED - every check in policy is required for this branch")
    elif verdict.exit_code == 1:
        print("Verdict: NOT ENFORCED - see the problems above")
    else:
        print("Verdict: UNKNOWN - the setting could not be read")
    print(
        "See docs/operations/required-check-enforcement.md for the exact owner "
        "steps and the current verified state of this repository."
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DEFAULT_REPO, help="owner/name")
    parser.add_argument("--branch", default=DEFAULT_BRANCH)
    parser.add_argument(
        "--require",
        action="append",
        default=None,
        help="check name that must be required (repeatable; defaults to the "
        f"Vardena policy set: {', '.join(DEFAULT_REQUIRED)})",
    )
    parser.add_argument(
        "--protection-json",
        default="",
        help="read an already-fetched response ('-' for stdin) instead of "
        "calling the GitHub API; for tests and offline inspection",
    )
    parser.add_argument(
        "--protection-status",
        type=int,
        default=200,
        help="HTTP status to pair with --protection-json (default 200)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    required = args.require if args.require else list(DEFAULT_REQUIRED)

    if args.protection_json:
        raw = (
            sys.stdin.read()
            if args.protection_json == "-"
            else Path(args.protection_json).read_text(encoding="utf-8")
        )
        protection = interpret_response(args.protection_status, raw)
    else:
        fetched = fetch_via_gh(args.repo, args.branch)
        if fetched is None:
            print(
                "::error title=required checks::could not read branch "
                "protection: `gh` is unavailable or not authenticated"
            )
            print("Verdict: UNKNOWN - the setting could not be read")
            return 2
        status, body = fetched
        protection = interpret_response(status, body)

    verdict = evaluate(protection, required)
    print_report(verdict, args.repo, args.branch, required)
    return verdict.exit_code


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
