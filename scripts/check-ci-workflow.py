#!/usr/bin/env python3
"""Structural invariants of the change-aware CI workflow.

The classification and gate logic is unit-tested, but the *wiring* in
``.github/workflows/ci.yml`` is what makes those scripts load-bearing. Three
mistakes there would be silent:

1. a workflow-level ``paths``/``paths-ignore`` filter (forbidden here: a
   skipped workflow leaves required checks pending forever),
2. a gate that is not ``if: always()`` (a gate skipped because a dependency
   failed reports *success* and would protect nothing),
3. a job that is not listed in the gate's ``needs`` (the gate could then
   report green while a required job was skipped, cancelled or failed).

GitHub owns the real schema, so this is not a re-implementation of it: it
checks those specific invariants plus the scope conditions of each conditional
job, on the deliberate YAML subset the workflow uses. It fails loudly when the
file is restructured rather than passing vacuously.

Usage:

    scripts/check-ci-workflow.py [.github/workflows/ci.yml]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

TOP_LEVEL_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$")
JOB_RE = re.compile(r"^  ([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$")
KEY_RE = re.compile(r"^    ([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$")
LIST_ITEM_RE = re.compile(r"^      - (.+?)\s*$")

CLASSIFIER_JOB = "classify"
GATE_JOB = "ci-gate"

#: job id -> classifier output key that decides whether the job is applicable
GATED_JOBS = {
    "docs": "docs",
    "backend": "backend",
    "frontend": "frontend",
    "generated-api-client": "generated",
}

PROHIBITED_WORKFLOW_FILTERS = ("paths", "paths-ignore")


def split_blocks(lines: list[str], pattern: re.Pattern[str], indent: str) -> dict[str, list[str]]:
    """Split lines into named blocks starting at `pattern` until the next one."""
    blocks: dict[str, list[str]] = {}
    current: str | None = None
    prefix = re.compile(rf"^{re.escape(indent)}\S")
    for line in lines:
        match = pattern.match(line)
        if match and _same_indent(line, indent):
            current = match.group(1)
            blocks[current] = [line]
            continue
        if current is None:
            continue
        # A new top-level construct at a shallower indent ends the block.
        if line.strip() and prefix.match(line) and not line.startswith(indent):
            current = None
            continue
        blocks[current].append(line)
    return blocks


def _same_indent(line: str, indent: str) -> bool:
    return line.startswith(indent) and not line.startswith(indent + " ")


def parse_jobs(text: str) -> dict[str, list[str]]:
    lines = text.splitlines()
    top = split_blocks(lines, TOP_LEVEL_RE, "")
    if "jobs" not in top:
        return {}
    return split_blocks(top["jobs"][1:], JOB_RE, "  ")


def job_scalars(block: list[str]) -> dict[str, str]:
    scalars: dict[str, str] = {}
    for line in block[1:]:
        match = KEY_RE.match(line)
        if match and _same_indent(line, "    "):
            scalars[match.group(1)] = match.group(2)
    return scalars


def job_list(block: list[str], key: str) -> list[str]:
    """Read a simple string list under `key:` at 4-space indent."""
    values: list[str] = []
    collecting = False
    for line in block[1:]:
        match = KEY_RE.match(line)
        if match and _same_indent(line, "    "):
            collecting = match.group(1) == key
            continue
        if collecting:
            item = LIST_ITEM_RE.match(line)
            if item:
                values.append(item.group(1))
            elif line.strip() and not line.startswith("      "):
                collecting = False
    return values


def job_needs(block: list[str]) -> list[str]:
    """Read `needs:` in either scalar, list or inline-list form."""
    scalar = job_scalars(block).get("needs", "").strip()
    if scalar:
        if scalar.startswith("["):
            scalar = scalar.strip("[]")
        return [item.strip().strip("'\"") for item in scalar.split(",") if item.strip()]
    return [item.strip("'\"") for item in job_list(block, "needs")]


def sub_scalars(block: list[str], key: str) -> dict[str, str]:
    """Read `key:` sub-block scalars at 6-space indent."""
    values: dict[str, str] = {}
    collecting = False
    for line in block[1:]:
        match = KEY_RE.match(line)
        if match and _same_indent(line, "    "):
            collecting = match.group(1) == key
            continue
        if collecting:
            sub = re.match(r"^      ([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$", line)
            if sub:
                values[sub.group(1)] = sub.group(2).strip()
            elif line.strip() and not line.startswith("      "):
                collecting = False
    return values


def check_on_block(text: str) -> list[str]:
    problems: list[str] = []
    lines = text.splitlines()
    top = split_blocks(lines, TOP_LEVEL_RE, "")
    trigger = top.get("on")
    if trigger is None:
        return ["workflow has no `on:` trigger block"]
    body = "\n".join(trigger)

    for prohibited in PROHIBITED_WORKFLOW_FILTERS:
        if re.search(rf"^\s*{prohibited}:", body, re.MULTILINE):
            problems.append(
                f"`on:` declares `{prohibited}:`; workflow-level path filtering "
                "leaves required checks pending forever and is forbidden here"
            )
    if not re.search(r"branches:\s*\[\s*main\s*\]|^\s*-\s*main\s*$", body, re.MULTILINE):
        problems.append("`on:` does not limit the triggers to `main`")
    if "pull_request:" not in body:
        problems.append("`on:` has no `pull_request:` trigger")
    if "push:" not in body:
        problems.append("`on:` has no `push:` trigger")
    return problems


def check(text: str) -> list[str]:
    problems: list[str] = check_on_block(text)
    jobs = parse_jobs(text)

    if not jobs:
        return problems + ["no jobs were parsed; refusing to validate vacuously"]

    expected_jobs = {CLASSIFIER_JOB, GATE_JOB, *GATED_JOBS}
    missing = sorted(expected_jobs - set(jobs))
    if missing:
        problems.append(f"missing job(s): {', '.join(missing)}")

    if CLASSIFIER_JOB in jobs:
        declared = set(
            re.findall(
                r"^      ([A-Za-z_][A-Za-z0-9_-]*):",
                "\n".join(jobs[CLASSIFIER_JOB]),
                re.MULTILINE,
            )
        )
        if not declared:
            problems.append(
                f"job `{CLASSIFIER_JOB}` declares no outputs; conditional jobs "
                "cannot be scoped"
            )
        # Declared outputs must read the matching step output, so a typo
        # cannot silently export an empty scope decision.
        declared_values = sub_scalars(jobs[CLASSIFIER_JOB], "outputs")
        required_scope_outputs = {*GATED_JOBS.values(), "broad", "base_sha"}
        for key in sorted(required_scope_outputs - set(declared_values)):
            problems.append(
                f"job `{CLASSIFIER_JOB}` does not export required output `{key}`"
            )
        for key, value in declared_values.items():
            expected = "${{ steps.scope.outputs." + key + " }}"
            if value != expected:
                problems.append(
                    f"classifier output `{key}` must be `{expected}` "
                    f"(found: {value or '<none>'})"
                )
        if not re.search(r"^\s*id: scope\s*$", "\n".join(jobs[CLASSIFIER_JOB]), re.MULTILINE):
            problems.append(
                "the classification step must carry `id: scope` so the job "
                "outputs above resolve"
            )

        for job, key in GATED_JOBS.items():
            if job not in jobs:
                continue
            if key not in declared:
                problems.append(
                    f"job `{CLASSIFIER_JOB}` does not declare output `{key}` "
                    f"required by job `{job}`"
                )
            scalars = job_scalars(jobs[job])
            condition = scalars.get("if", "")
            if condition != f"needs.{CLASSIFIER_JOB}.outputs.{key} == 'true'":
                problems.append(
                    f"job `{job}` must be gated by "
                    f"`if: needs.{CLASSIFIER_JOB}.outputs.{key} == 'true'` "
                    f"(found: {condition or '<none>'})"
                )
            needs = job_needs(jobs[job])
            if needs != [CLASSIFIER_JOB]:
                problems.append(
                    f"job `{job}` must declare `needs: {CLASSIFIER_JOB}` "
                    f"(found: {needs or '<none>'})"
                )

    if GATE_JOB in jobs:
        scalars = job_scalars(jobs[GATE_JOB])
        if scalars.get("if", "").replace(" ", "") != "always()":
            problems.append(
                f"gate job `{GATE_JOB}` must declare `if: always()`; a gate that "
                "can be skipped reports success and protects nothing"
            )
        needs = job_needs(jobs[GATE_JOB])
        unwired = sorted((set(jobs) - {GATE_JOB}) - set(needs))
        if unwired:
            problems.append(
                "gate job is not wired to: " + ", ".join(unwired)
            )
        phantom = sorted(set(needs) - set(jobs))
        if phantom:
            problems.append(
                "gate job needs unknown job(s): " + ", ".join(phantom)
            )

    concurrency = split_blocks(text.splitlines(), TOP_LEVEL_RE, "").get("concurrency", [])
    concurrency_text = "\n".join(concurrency)
    if "cancel-in-progress:" not in concurrency_text:
        problems.append("`concurrency:` does not declare `cancel-in-progress:`")
    elif "refs/heads/main" not in concurrency_text:
        problems.append(
            "`concurrency.cancel-in-progress` must keep `refs/heads/main` "
            "runs uncancelled so post-merge verification is never hidden"
        )

    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "workflow",
        nargs="?",
        default=".github/workflows/ci.yml",
        help="workflow file to validate (default: .github/workflows/ci.yml)",
    )
    args = parser.parse_args(argv)

    try:
        text = Path(args.workflow).read_text(encoding="utf-8")
    except OSError as exc:
        print(f"::error title=CI workflow::cannot read {args.workflow}: {exc}")
        return 1

    problems = check(text)
    for problem in problems:
        print(f"::error title=CI workflow::{problem}")
    if problems:
        print(f"CI workflow validation: FAIL ({len(problems)} problem(s))")
        return 1
    print(f"CI workflow validation: PASS ({args.workflow})")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
