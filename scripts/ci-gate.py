#!/usr/bin/env python3
"""Vardena CI final gate -- the stable result of the workflow.

The other jobs in ``.github/workflows/ci.yml`` are conditional, because a job
that is not applicable to a change set is skipped. GitHub reports a skipped job
as **success**, so a conditional job is a poor merge contract on its own: a job
that was skipped because it was not needed and a job that was skipped by mistake
look identical.

This gate always runs (``if: always()`` in the workflow) and turns the
classification plus the job results into one explicit answer. It fails when:

* the classifier did not succeed (no scope evidence -> no green),
* a job the classifier marked applicable did not reach ``success`` -- including
  a job that was skipped, cancelled or missing from the ``needs`` context,
* a job that ran although it was not required failed,
* the classification claims that no job is applicable (a classifier regression
  must never produce an empty green gate).

It succeeds exactly when every job that should have run did run and passed, and
the jobs that were not applicable were skipped.

Usage (CI): see the ``ci-gate`` job in ``.github/workflows/ci.yml``.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

#: workflow job id -> classifier output key
GATED_JOBS: dict[str, str] = {
    "docs": "docs",
    "backend": "backend",
    "frontend": "frontend",
    "generated-api-client": "generated",
}

CLASSIFIER_JOB = "classify"

#: A job that is not applicable is skipped; GitHub reports that as success.
ACCEPTABLE_WHEN_NOT_REQUIRED = ("skipped", "success")


@dataclass
class Report:
    failures: list[str] = field(default_factory=list)
    rows: list[str] = field(default_factory=list)
    required: list[str] = field(default_factory=list)
    broad: bool = False

    @property
    def ok(self) -> bool:
        return not self.failures


def evaluate(needs: dict) -> Report:
    """Turn the workflow ``needs`` context into a gate verdict."""
    report = Report()

    classifier = needs.get(CLASSIFIER_JOB)
    if not isinstance(classifier, dict):
        report.failures.append(
            f"job '{CLASSIFIER_JOB}' did not report a result; refusing to report "
            "a passing gate without scope evidence"
        )
        return report

    classifier_result = str(classifier.get("result", "missing"))
    if classifier_result != "success":
        report.failures.append(
            f"job '{CLASSIFIER_JOB}' did not succeed (result: {classifier_result}); "
            "scope is unknown"
        )

    outputs = classifier.get("outputs") or {}
    expected: list[str] = []
    for job, key in GATED_JOBS.items():
        value = str(outputs.get(key, ""))
        if value not in ("true", "false"):
            report.failures.append(
                f"classifier output '{key}' is missing or invalid ('{value}'): "
                f"job '{job}' cannot be verified"
            )
            continue
        if value == "true":
            expected.append(job)

    if not report.failures and not expected:
        report.failures.append(
            "the classifier reported that no job is applicable to this change set; "
            "refusing to report a passing gate without evidence"
        )

    report.required = expected
    report.broad = str(outputs.get("broad", "false")) == "true"

    for job in GATED_JOBS:
        entry = needs.get(job)
        if not isinstance(entry, dict) or "result" not in entry:
            report.failures.append(
                f"job '{job}' is missing from the gate's needs context; the "
                "workflow and the gate have drifted apart"
            )
            continue
        result = str(entry["result"])
        required = job in expected
        if required and result != "success":
            report.failures.append(
                f"required job '{job}' did not succeed (result: {result})"
            )
        elif not required and result not in ACCEPTABLE_WHEN_NOT_REQUIRED:
            report.failures.append(
                f"job '{job}' ran although the change set does not require it, and "
                f"did not succeed (result: {result})"
            )
        report.rows.append(
            f"  {job:<22} required={str(required):<5} result={result}"
        )

    return report


def print_report(report: Report) -> None:
    print("CI gate")
    print(f"  required jobs : {', '.join(report.required) or 'none'}")
    print(f"  broad change  : {'yes' if report.broad else 'no'}")
    for row in report.rows:
        print(row)
    for failure in report.failures:
        print(f"::error title=CI gate::{failure}")
    print("CI gate: " + ("PASS" if report.ok else f"FAIL ({len(report.failures)} problem(s))"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--needs-json",
        default="-",
        help="JSON form of the workflow `needs` context ('-' for stdin)",
    )
    args = parser.parse_args(argv)

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
    return 0 if report.ok else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
