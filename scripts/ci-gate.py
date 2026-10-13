#!/usr/bin/env python3
"""Vardena CI final gate.

Every other job in ``.github/workflows/ci.yml`` is conditional, because a job
that is not applicable to a change set is skipped (GitHub reports a skipped
job as successful). That makes a conditional job a poor *merge contract* on
its own: if a job is skipped because it was not needed, or skipped by mistake,
the check is green either way.

This gate is the stable, always-running contract. It:

* fails when the scope classifier did not succeed (no evidence -> no green),
* fails when a job that the classifier marked as required did not succeed --
  including when that job was skipped, cancelled or missing entirely,
* fails when a job that ran outside the classification did not succeed,
* succeeds only for jobs that are explicitly not applicable (skipped),
* fails when the classification itself claims that no job is applicable, so a
  classifier regression can never produce an empty green gate.

Usage (CI): see the ``ci-gate`` job in ``.github/workflows/ci.yml``.

    scripts/ci-gate.py --needs-json needs.json

Local use: pass the JSON form of the workflow ``needs`` context.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

#: workflow job id -> classifier output key
GATED_JOBS: dict[str, str] = {
    "docs": "docs",
    "backend": "backend",
    "frontend": "frontend",
    "generated-api-client": "generated",
}

CLASSIFIER_JOB = "classify"

#: Results that must not be reported as a passing gate for a job that ran.
ACCEPTABLE_SKIPPED = ("skipped", "success")


@dataclass
class Verdict:
    job: str
    expected: bool
    result: str
    note: str = ""

    @property
    def failure(self) -> str:
        if self.job not in GATED_JOBS:
            return ""
        if self.expected and self.result != "success":
            return (
                f"required job '{self.job}' did not succeed "
                f"(result: {self.result})"
            )
        if not self.expected and self.result not in ACCEPTABLE_SKIPPED:
            return (
                f"job '{self.job}' ran although the change set does not "
                f"require it, and did not succeed (result: {self.result})"
            )
        return ""


@dataclass
class Report:
    failures: list[str]
    verdicts: list[Verdict]
    expected: list[str]
    broad: bool = False


def evaluate(needs: dict) -> Report:
    """Turn the workflow ``needs`` context into a gate verdict."""
    failures: list[str] = []
    verdicts: list[Verdict] = []

    classifier = needs.get(CLASSIFIER_JOB)
    if not isinstance(classifier, dict):
        failures.append(
            f"job '{CLASSIFIER_JOB}' did not report a result; refusing to "
            "report a passing gate without scope evidence"
        )
        return Report(failures, verdicts, [])

    classifier_result = classifier.get("result", "missing")
    if classifier_result != "success":
        failures.append(
            f"job '{CLASSIFIER_JOB}' did not succeed "
            f"(result: {classifier_result}); scope is unknown"
        )

    outputs = classifier.get("outputs") or {}
    expected: list[str] = []
    for job, key in GATED_JOBS.items():
        value = outputs.get(key)
        if value is None:
            failures.append(
                f"classifier output '{key}' is missing: job '{job}' cannot be "
                "verified"
            )
            continue
        if str(value) not in ("true", "false"):
            failures.append(
                f"classifier output '{key}' has unexpected value "
                f"'{value}' (expected true/false)"
            )
            continue
        if str(value) == "true":
            expected.append(job)

    if not failures and not expected:
        failures.append(
            "the classifier reported that no job is applicable to this change "
            "set; refusing to report a passing gate without evidence"
        )

    for job in GATED_JOBS:
        entry = needs.get(job)
        if not isinstance(entry, dict) or "result" not in entry:
            verdicts.append(
                Verdict(
                    job=job,
                    expected=job in expected,
                    result="missing",
                    note="job is not wired into the gate (needs:)",
                )
            )
            failures.append(
                f"job '{job}' is missing from the gate's needs context; the "
                "workflow and the gate have drifted apart"
            )
            continue
        result = str(entry.get("result", "missing"))
        note = ""
        if job in expected and result == "success":
            note = "required and green"
        elif job not in expected and result == "skipped":
            note = "not applicable to this change set"
        elif job not in expected and result == "success":
            note = "ran with extra coverage"
        verdicts.append(Verdict(job=job, expected=job in expected, result=result, note=note))
        failure = verdicts[-1].failure
        if failure:
            failures.append(failure)

    broad = str(outputs.get("broad", "false")) == "true"
    return Report(failures, verdicts, expected, broad=broad)


def print_report(report: Report) -> None:
    print("CI gate")
    print(f"  required jobs : {', '.join(report.expected) or 'none'}")
    print(f"  broad change  : {'yes' if report.broad else 'no'}")
    print("  +-------------------------+----------+-----------+-----------------------------+")
    print("  | job                     | required | result    | note                        |")
    print("  +-------------------------+----------+-----------+-----------------------------+")
    for verdict in report.verdicts:
        print(
            f"  | {verdict.job:<23} | {('yes' if verdict.expected else 'no'):<8} | "
            f"{verdict.result:<9} | {verdict.note:<27} |"
        )
    print("  +-------------------------+----------+-----------+-----------------------------+")
    for failure in report.failures:
        print(f"::error title=CI gate::{failure}")
    if report.failures:
        print(f"CI gate: FAIL ({len(report.failures)} problem(s))")
    else:
        print("CI gate: PASS")


def summary_markdown(report: Report) -> str:
    lines = [
        "### CI gate",
        "",
        f"- Required jobs: **{', '.join(report.expected) or 'none'}**",
        f"- Broad (unclassified) change: **{'yes' if report.broad else 'no'}**",
        f"- Result: **{'FAIL' if report.failures else 'PASS'}**",
        "",
        "| Job | Required | Result | Note |",
        "| --- | --- | --- | --- |",
    ]
    for verdict in report.verdicts:
        lines.append(
            f"| `{verdict.job}` | {'yes' if verdict.expected else 'no'} | "
            f"`{verdict.result}` | {verdict.note or '-'} |"
        )
    if report.failures:
        lines += ["", "Failures:"]
        lines += [f"- {failure}" for failure in report.failures]
    lines.append("")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--needs-json",
        default="-",
        help="JSON form of the workflow `needs` context ('-' for stdin)",
    )
    parser.add_argument(
        "--summary",
        default="",
        help="append a Markdown summary to this file "
        "(usually $GITHUB_STEP_SUMMARY)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        raw = sys.stdin.read() if args.needs_json == "-" else Path(args.needs_json).read_text(
            encoding="utf-8"
        )
        needs = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"::error title=CI gate::cannot read needs context: {exc}")
        return 1

    if not isinstance(needs, dict):
        print("::error title=CI gate::needs context is not an object")
        return 1

    report = evaluate(needs)
    print_report(report)
    if args.summary:
        with Path(args.summary).open("a", encoding="utf-8") as handle:
            handle.write(summary_markdown(report))
    return 1 if report.failures else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
