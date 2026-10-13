#!/usr/bin/env python3
"""Deterministic tests for the CI helper scripts.

Covers the two things a change-aware pipeline can get wrong silently:

* the path classification (which jobs a change set requires), including the
  fail-safe behaviour for unclassifiable paths and unresolvable base revisions,
* the final gate (what a green ``ci-gate`` check actually asserts), including
  the "a skipped required job must fail the gate" contract.

Run locally from the repository root:

    python3 -m unittest discover -s scripts/tests -t scripts/tests -v
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parent.parent


def load(name: str):
    """Import a dashed-file-name script as a module."""
    path = SCRIPTS_DIR / name
    module_name = "ci_scripts_" + name.replace("-", "_")[:-3]
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    # dataclasses resolves type hints through sys.modules, so register first.
    sys.modules[module_name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


scope = load("ci-classify-scope.py")
gate = load("ci-gate.py")
docs = load("check-docs-links.py")
workflow_check = load("check-ci-workflow.py")
checks = load("check-required-checks.py")

REPO_ROOT = SCRIPTS_DIR.parent
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "ci.yml"


def run(func, *args, **kwargs):
    """Run an entry point, returning (exit code, stdout)."""
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
        code = func(*args, **kwargs)
    return code, buffer.getvalue()


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def git(repo: Path, *args: str) -> str:
    completed = subprocess.run(
        [
            "git",
            "-c",
            "user.email=ci@example.test",
            "-c",
            "user.name=CI test",
            "-c",
            "commit.gpgsign=false",
            *args,
        ],
        cwd=str(repo),
        capture_output=True,
        text=True,
        check=True,
    )
    return completed.stdout.strip()


# --------------------------------------------------------------------------- #
# Path classification
# --------------------------------------------------------------------------- #


class ClassifyPathsTest(unittest.TestCase):
    def decide(self, *paths: str) -> scope.Decision:
        return scope.classify_paths(list(paths))

    def assert_jobs(self, decision, expected, broad=False):
        self.assertEqual(
            sorted(decision.expected_jobs),
            sorted(expected),
            msg=f"expected {expected}, got {decision.expected_jobs}",
        )
        self.assertEqual(decision.broad, broad)

    # --- documentation ---------------------------------------------------- #

    def test_root_and_docs_markdown_is_documentation_only(self):
        decision = self.decide(
            "STATE.md",
            "README.md",
            "AGENTS.md",
            "docs/architecture.md",
            "docs/licensing/architecture.md",
            ".vardena/agent-rules.md",
            ".vardena/architecture-rules.md",
        )
        self.assert_jobs(decision, ["docs"])

    def test_docs_assets_count_as_documentation(self):
        # Nothing executable consumes docs/**, including non-Markdown assets.
        self.assert_jobs(self.decide("docs/img/flow.png", "docs/fixtures/x.json"), ["docs"])

    def test_markdown_with_spaces_and_parentheses(self):
        self.assert_jobs(self.decide("Pasted markdown(20260927-203801).md"), ["docs"])

    def test_deleted_markdown_still_requires_documentation_validation(self):
        self.assert_jobs(self.decide("./docs/removed.md"), ["docs"])

    def test_unrelated_markdown_extension_is_not_documentation(self):
        self.assertTrue(self.decide("backend/README.md").backend)
        self.assertTrue(self.decide("backend/README.md").docs)

    # --- frontend --------------------------------------------------------- #

    def test_frontend_sources_run_frontend_only(self):
        self.assert_jobs(
            self.decide(
                "frontend/src/main.tsx",
                "frontend/src/features/dashboard/Dashboard.tsx",
                "frontend/package.json",
                "frontend/package-lock.json",
                "frontend/vite.config.ts",
            ),
            ["frontend"],
        )

    def test_frontend_generated_client_runs_both(self):
        self.assert_jobs(
            self.decide("frontend/src/api/generated/vardena-api.d.ts"),
            ["frontend", "generated"],
        )

    def test_frontend_markdown_keeps_frontend_format_check_without_client_check(self):
        decision = self.decide("frontend/README.md")
        self.assert_jobs(decision, ["docs", "frontend"])

    # --- backend ---------------------------------------------------------- #

    def test_backend_code_runs_backend_and_client_drift_check(self):
        for path in (
            "backend/src/modules/licensing/api/license-import.controller.ts",
            "backend/src/modules/licensing/api/dto/license-import.dto.ts",
            "backend/test/licensing-persistence-live.e2e-spec.ts",
            "backend/prisma/schema/licensing.prisma",
            "backend/prisma/migrations/20261018000000_licensing_audit_detail_text/migration.sql",
            "backend/package.json",
            "backend/package-lock.json",
            "backend/nest-cli.json",
        ):
            with self.subTest(path=path):
                self.assert_jobs(self.decide(path), ["backend", "generated"])

    def test_backend_markdown_keeps_backend_format_check_without_client_check(self):
        self.assert_jobs(self.decide("backend/README.md"), ["docs", "backend"])

    def test_client_check_script_runs_client_check(self):
        self.assert_jobs(self.decide("scripts/check-generated-api-client.sh"), ["generated"])

    # --- broad / unclassifiable ------------------------------------------ #

    def test_workflow_root_and_unknown_paths_run_everything(self):
        for path in (
            ".github/workflows/ci.yml",
            ".github/dependabot.yml",
            "docker-compose.yml",
            ".env.example",
            ".gitignore",
            "scripts/other-tool.sh",
            "scripts/ci-gate.py",
            "new-top-level-dir/file.ts",
        ):
            with self.subTest(path=path):
                self.assert_jobs(
                    self.decide(path), ["docs", "backend", "frontend", "generated"], broad=True
                )

    def test_one_unknown_path_makes_the_whole_change_broad(self):
        decision = self.decide("docs/a.md", "backend/src/b.ts", ".github/workflows/ci.yml")
        self.assert_jobs(
            decision, ["docs", "backend", "frontend", "generated"], broad=True
        )
        self.assertEqual(decision.unclassified_paths, [".github/workflows/ci.yml"])

    def test_empty_change_set_is_broad_not_silent(self):
        decision = self.decide()
        self.assert_jobs(
            decision, ["docs", "backend", "frontend", "generated"], broad=True
        )

    # --- combinations ----------------------------------------------------- #

    def test_mixed_docs_and_backend(self):
        self.assert_jobs(
            self.decide("docs/adr/0001-a.md", "backend/src/kernel/http/configure-app.ts"),
            ["docs", "backend", "generated"],
        )

    def test_docs_plus_frontend(self):
        self.assert_jobs(
            self.decide("STATE.md", "frontend/src/lib/format.ts"), ["docs", "frontend"]
        )

    def test_classification_is_order_independent_and_deduplicated(self):
        first = self.decide("backend/src/a.ts", "docs/b.md", "backend/src/a.ts")
        second = self.decide("docs/b.md", "backend/src/a.ts")
        self.assertEqual(first.as_outputs(), second.as_outputs())

    def test_outputs_use_expectable_keys(self):
        decision = self.decide("docs/a.md")
        self.assertEqual(
            decision.as_outputs(),
            {
                "docs": "true",
                "backend": "false",
                "frontend": "false",
                "generated": "false",
                "broad": "false",
                "changed_count": "1",
            },
        )


class NameStatusParsingTest(unittest.TestCase):
    def test_plain_records(self):
        stream = "M\0a.md\0A\0b.md\0D\0c.md\0"
        self.assertEqual(scope.parse_name_status_z(stream), ["a.md", "b.md", "c.md"])

    def test_rename_records_include_both_sides(self):
        stream = "R100\0docs/old.md\0docs/new.md\0M\0backend/x.ts\0"
        self.assertEqual(
            scope.parse_name_status_z(stream), ["docs/old.md", "docs/new.md", "backend/x.ts"]
        )

    def test_paths_with_spaces_and_unicode(self):
        stream = "A\0Pasted markdown(20260927-203801).md\0"
        self.assertEqual(
            scope.parse_name_status_z(stream), ["Pasted markdown(20260927-203801).md"]
        )

    def test_truncated_stream_does_not_crash(self):
        self.assertEqual(scope.parse_name_status_z("M\0"), [])

    def test_zero_sha_detection(self):
        self.assertTrue(scope.is_unusable_sha(""))
        self.assertTrue(scope.is_unusable_sha(None))
        self.assertTrue(scope.is_unusable_sha("0" * 40))
        self.assertFalse(scope.is_unusable_sha("749b01c95c4f107b8a37a86376dad156dffb8463"))


class ClassifyGitIntegrationTest(unittest.TestCase):
    """The change detection itself, against a real (throwaway) git repository."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        git(self.repo, "init", "-q", "-b", "main")
        write(self.repo / "docs" / "a.md", "# A\n")
        write(self.repo / "backend" / "src" / "a.ts", "export const a = 1;\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "base")
        self.base = git(self.repo, "rev-parse", "HEAD")

    def tearDown(self):
        self.tmp.cleanup()

    def classify(self, *extra: str):
        return run(
            scope.main,
            [
                "--base",
                self.base,
                "--head",
                "HEAD",
                "--repo-root",
                str(self.repo),
                "--main-ref",
                "main",
                *extra,
            ],
        )

    def commit(self, message: str) -> str:
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", message)
        return git(self.repo, "rev-parse", "HEAD")

    def test_docs_only_change(self):
        write(self.repo / "docs" / "a.md", "# A\n\nmore\n")
        write(self.repo / "docs" / "b.md", "# B\n")
        self.commit("docs")
        code, out = self.classify()
        self.assertEqual(code, 0)
        self.assertIn("decision      : docs", out)

    def test_backend_only_change(self):
        write(self.repo / "backend" / "src" / "a.ts", "export const a = 2;\n")
        self.commit("backend")
        _, out = self.classify()
        self.assertIn("decision      : backend, generated", out)

    def test_path_with_spaces_is_classified(self):
        write(self.repo / "Pasted note (1).md", "# note\n")
        self.commit("doc with spaces")
        _, out = self.classify()
        self.assertIn("decision      : docs", out)

    def test_markdown_rename_is_classified(self):
        git(self.repo, "mv", "docs/a.md", "docs/renamed.md")
        self.commit("rename")
        _, out = self.classify()
        self.assertIn("decision      : docs", out)

    def test_unknown_path_runs_everything(self):
        write(self.repo / "docker-compose.yml", "services: {}\n")
        self.commit("compose")
        _, out = self.classify()
        self.assertIn("broad change  : every job runs", out)

    def test_github_output_file_is_written(self):
        write(self.repo / "docs" / "c.md", "# C\n")
        self.commit("docs again")
        output_file = self.repo / "out.txt"
        self.classify("--github-output", str(output_file))
        content = dict(
            line.split("=", 1)
            for line in output_file.read_text(encoding="utf-8").splitlines()
        )
        self.assertEqual(content["docs"], "true")
        self.assertEqual(content["backend"], "false")
        self.assertEqual(content["mode"], "changed")
        self.assertEqual(
            set(content),
            {
                "docs",
                "backend",
                "frontend",
                "generated",
                "broad",
                "changed_count",
                "mode",
                "base_sha",
                "base_source",
                "guard",
            },
        )
        self.assertEqual(content["base_sha"], self.base)
        self.assertEqual(content["guard"], "disabled")

    def test_missing_base_falls_back_to_every_job(self):
        code, out = run(
            scope.main,
            [
                "--base",
                "0" * 40,
                "--head",
                "HEAD",
                "--repo-root",
                str(self.repo),
            ],
        )
        self.assertEqual(code, 0)
        self.assertIn("broad change  : every job runs", out)
        self.assertIn("fail-safe", out)

    def test_unknown_base_revision_falls_back_to_every_job(self):
        write(self.repo / "docs" / "d.md", "# D\n")
        self.commit("docs")
        _, out = run(
            scope.main,
            [
                "--base",
                "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
                "--head",
                "HEAD",
                "--repo-root",
                str(self.repo),
            ],
        )
        self.assertIn("broad change  : every job runs", out)

    def test_base_equal_to_head_falls_back_to_every_job(self):
        head = git(self.repo, "rev-parse", "HEAD")
        _, out = run(
            scope.main,
            ["--base", head, "--head", "HEAD", "--repo-root", str(self.repo)],
        )
        self.assertIn("broad change  : every job runs", out)

    def test_base_that_is_not_reachable_from_main_is_refused(self):
        # A base that main cannot reach could hide changes (stale fork point,
        # or a pull request's own previous head): never trust it.
        git(self.repo, "checkout", "-q", "-b", "side")
        write(self.repo / "backend" / "src" / "a.ts", "export const a = 4;\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "side change")
        side = git(self.repo, "rev-parse", "HEAD")
        git(self.repo, "checkout", "-q", "main")

        code, out = run(
            scope.main,
            [
                "--base",
                side,
                "--head",
                "HEAD",
                "--repo-root",
                str(self.repo),
                "--main-ref",
                "main",
            ],
        )
        self.assertEqual(code, 0)
        self.assertIn("broad change  : every job runs", out)

    def test_unreachable_base_is_still_used_when_main_cannot_be_verified(self):
        # Without a main ref the ancestry guard cannot run; the change set is
        # still computed, and every other guarantee (gate, tests) is unchanged.
        git(self.repo, "checkout", "-q", "-b", "side2")
        write(self.repo / "backend" / "src" / "a.ts", "export const a = 5;\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "side change 2")
        first_side = git(self.repo, "rev-parse", "HEAD")
        write(self.repo / "docs" / "side-note.md", "# side\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "side docs")

        code, out = run(
            scope.main,
            [
                "--base",
                first_side,
                "--head",
                "HEAD",
                "--repo-root",
                str(self.repo),
                "--main-ref",
                "origin/does-not-exist",
            ],
        )
        self.assertEqual(code, 0)
        self.assertIn("decision      : docs", out)
        self.assertIn("base ancestry cannot be verified", out)

    def test_pull_request_merge_commit_diff_uses_merge_base(self):
        # A PR branch whose base has advanced: only the branch changes count.
        write(self.repo / "backend" / "src" / "a.ts", "export const a = 3;\n")
        git(self.repo, "checkout", "-q", "-b", "feature")
        self.commit("feature backend change")
        git(self.repo, "checkout", "-q", "main")
        write(self.repo / "docs" / "main-side.md", "# main side\n")
        self.commit("main side docs")
        git(self.repo, "checkout", "-q", "feature")
        code, out = run(
            scope.main,
            ["--base", self.base, "--head", "HEAD", "--repo-root", str(self.repo)],
        )
        self.assertEqual(code, 0)
        self.assertIn("decision      : backend, generated", out)


# --------------------------------------------------------------------------- #
# Final gate
# --------------------------------------------------------------------------- #


def needs_context(**jobs) -> dict:
    """Build a `needs` context; `classify` outputs default to a docs-only run."""
    context: dict = {
        "classify": {
            "result": "success",
            "outputs": {
                "docs": "true",
                "backend": "false",
                "frontend": "false",
                "generated": "false",
                "broad": "false",
                "changed-count": "2",
            },
        },
        "docs": {"result": "success"},
        "backend": {"result": "skipped"},
        "frontend": {"result": "skipped"},
        "generated-api-client": {"result": "skipped"},
    }
    for job, value in jobs.items():
        key = job.replace("_", "-")
        context[key] = {"result": value}
    return context


class GateTest(unittest.TestCase):
    def evaluate(self, context):
        return gate.evaluate(context)

    def assert_pass(self, report):
        self.assertEqual(report.failures, [], msg=f"unexpected failures: {report.failures}")

    def assert_fail(self, report, fragment):
        self.assertTrue(report.failures, "expected the gate to fail")
        self.assertTrue(
            any(fragment in failure for failure in report.failures),
            msg=f"expected a failure mentioning {fragment!r}, got {report.failures}",
        )

    def test_docs_only_run_passes_with_skipped_code_jobs(self):
        self.assert_pass(self.evaluate(needs_context()))

    def test_required_and_green_passes(self):
        context = needs_context()
        context["classify"]["outputs"].update(
            {"backend": "true", "generated": "true", "docs": "false"}
        )
        context["backend"] = {"result": "success"}
        context["generated-api-client"] = {"result": "success"}
        context["docs"] = {"result": "skipped"}
        self.assert_pass(self.evaluate(context))

    def test_required_job_that_was_skipped_fails_the_gate(self):
        # The critical contract: a skipped job reports success to branch
        # protection, so the gate must refuse a green result for it.
        context = needs_context()
        context["classify"]["outputs"]["backend"] = "true"
        context["backend"] = {"result": "skipped"}
        self.assert_fail(self.evaluate(context), "required job 'backend' did not succeed")

    def test_required_job_that_failed_fails_the_gate(self):
        context = needs_context()
        context["classify"]["outputs"]["backend"] = "true"
        context["backend"] = {"result": "failure"}
        self.assert_fail(self.evaluate(context), "'backend' did not succeed")

    def test_required_job_that_was_cancelled_fails_the_gate(self):
        context = needs_context()
        context["classify"]["outputs"]["docs"] = "true"
        context["docs"] = {"result": "cancelled"}
        self.assert_fail(self.evaluate(context), "'docs' did not succeed")

    def test_classifier_failure_fails_the_gate(self):
        context = needs_context()
        context["classify"] = {"result": "failure", "outputs": {}}
        self.assert_fail(self.evaluate(context), "did not succeed (result: failure)")

    def test_classifier_skipped_fails_the_gate(self):
        context = needs_context()
        context["classify"] = {"result": "skipped", "outputs": {}}
        self.assert_fail(self.evaluate(context), "classify")

    def test_missing_classify_entry_fails_the_gate(self):
        context = needs_context()
        del context["classify"]
        self.assert_fail(self.evaluate(context), "did not report a result")

    def test_missing_classifier_output_fails_closed(self):
        context = needs_context()
        del context["classify"]["outputs"]["generated"]
        self.assert_fail(self.evaluate(context), "output 'generated' is missing")

    def test_all_jobs_skipped_fails_the_gate(self):
        context = needs_context()
        context["classify"]["outputs"].update(
            {"docs": "false", "backend": "false", "frontend": "false", "generated": "false"}
        )
        context["docs"] = {"result": "skipped"}
        self.assert_fail(self.evaluate(context), "no job is applicable")

    def test_job_missing_from_needs_fails_the_gate(self):
        context = needs_context()
        del context["frontend"]
        self.assert_fail(self.evaluate(context), "missing from the gate's needs context")

    def test_unexpected_failure_of_a_non_required_job_fails_the_gate(self):
        context = needs_context()
        context["frontend"] = {"result": "failure"}
        self.assert_fail(self.evaluate(context), "does not require it")

    def test_unexpected_extra_success_is_allowed(self):
        context = needs_context()
        context["frontend"] = {"result": "success"}
        self.assert_pass(self.evaluate(context))

    def test_broad_run_requires_every_job(self):
        context = needs_context(
            docs="success", backend="success", frontend="success", generated_api_client="success"
        )
        context["classify"]["outputs"].update(
            {
                "docs": "true",
                "backend": "true",
                "frontend": "true",
                "generated": "true",
                "broad": "true",
            }
        )
        self.assert_pass(self.evaluate(context))

        context["frontend"] = {"result": "skipped"}
        self.assert_fail(self.evaluate(context), "required job 'frontend' did not succeed")

    def test_cli_exit_codes_and_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            needs_file = Path(tmp) / "needs.json"
            summary_file = Path(tmp) / "summary.md"
            needs_file.write_text(json.dumps(needs_context()), encoding="utf-8")
            code, out = run(
                gate.main,
                ["--needs-json", str(needs_file), "--summary", str(summary_file)],
            )
            self.assertEqual(code, 0, msg=out)
            self.assertIn("CI gate: PASS", out)
            summary = summary_file.read_text(encoding="utf-8")
            self.assertIn("| `docs` | yes | `success` |", summary)

            failing = needs_context()
            failing["classify"]["outputs"]["backend"] = "true"
            failing["backend"] = {"result": "failure"}
            needs_file.write_text(json.dumps(failing), encoding="utf-8")
            code, out = run(gate.main, ["--needs-json", str(needs_file)])
            self.assertEqual(code, 1)
            self.assertIn("::error title=CI gate::", out)

    def test_cli_rejects_malformed_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            broken = Path(tmp) / "needs.json"
            broken.write_text("{not json", encoding="utf-8")
            code, out = run(gate.main, ["--needs-json", str(broken)])
            self.assertEqual(code, 1)
            self.assertIn("cannot read needs context", out)


# --------------------------------------------------------------------------- #
# Documentation link check
# --------------------------------------------------------------------------- #


class DocsLinkCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        git(self.repo, "init", "-q", "-b", "main")
        write(self.repo / "README.md", "# Root\n\n[docs](docs/guide.md)\n")
        write(self.repo / "docs" / "guide.md", "# Guide\n\n[root](../README.md)\n")
        write(self.repo / "docs" / "with space.md", "# Space\n")
        write(self.repo / "docs" / "assets" / ".keep", "")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "base")
        self.base = git(self.repo, "rev-parse", "HEAD")

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, base=None):
        args = ["--repo-root", str(self.repo)]
        if base is not None:
            args += ["--base", base]
        return run(docs.main, args)

    def test_complete_tree_passes(self):
        code, out = self.check()
        self.assertEqual(code, 0, msg=out)
        self.assertIn("Documentation link check: PASS", out)

    def test_clean_change_set_introduces_nothing(self):
        write(self.repo / "docs" / "added.md", "# Added\n\n[ok](../README.md)\n")
        code, out = self.check(self.base)
        self.assertEqual(code, 0, msg=out)
        self.assertIn("introduced     : 0", out)

    def test_new_dead_link_fails(self):
        write(self.repo / "docs" / "added.md", "# Added\n\n[dead](missing.md)\n")
        code, out = self.check(self.base)
        self.assertEqual(code, 1)
        self.assertIn("introduced     : 1", out)
        self.assertIn("::error title=broken documentation link::", out)

    def test_pre_existing_dead_link_does_not_fail_and_is_not_hidden(self):
        write(self.repo / "docs" / "legacy.md", "# Legacy\n\n[dead](gone.md)\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "legacy with dead link")
        legacy_base = git(self.repo, "rev-parse", "HEAD")

        write(self.repo / "docs" / "unrelated.md", "# Unrelated\n")
        code, out = self.check(legacy_base)
        self.assertEqual(code, 0, msg=out)
        self.assertIn("introduced     : 0", out)
        self.assertIn("pre-existing   : 1", out)

    def test_removing_a_link_target_fails(self):
        write(self.repo / "docs" / "guide.md", "# Guide\n\n[gone](../README.md)\n")
        (self.repo / "README.md").unlink()
        code, out = self.check(self.base)
        self.assertEqual(code, 1)
        self.assertIn("::error title=broken documentation link::", out)

    def test_without_base_it_reports_but_does_not_fail(self):
        write(self.repo / "docs" / "added.md", "# Added\n\n[dead](missing.md)\n")
        code, out = self.check("")
        self.assertEqual(code, 0, msg=out)
        self.assertIn("report-only", out)
        self.assertIn("::warning", out)

    def test_unfetchable_base_degrades_to_report_only(self):
        write(self.repo / "docs" / "added.md", "# Added\n\n[dead](missing.md)\n")
        code, out = self.check("0" * 40)
        self.assertEqual(code, 0, msg=out)
        self.assertIn("report-only", out)

    def test_fenced_code_and_inline_code_links_are_ignored(self):
        write(
            self.repo / "docs" / "fences.md",
            "# Fences\n\n```md\n[dead](nope.md)\n```\n\nInline `[dead](also-nope.md)` too.\n",
        )
        code, out = self.check(self.base)
        self.assertEqual(code, 0, msg=out)
        self.assertIn("broken links   : 0", out)

    def test_external_anchor_and_mailto_links_are_out_of_scope(self):
        write(
            self.repo / "docs" / "external.md",
            "# External\n\n[web](https://example.com/x.md) [mail](mailto:a@example.com) "
            "[anchor](#heading) [proto](tel:+1)\n",
        )
        code, out = self.check(self.base)
        self.assertEqual(code, 0, msg=out)
        self.assertIn("relative links : ", out)
        self.assertNotIn("broken", out.split("broken links")[1].split("\n")[0])

    def test_percent_encoded_and_directory_links_resolve(self):
        write(
            self.repo / "docs" / "encoded.md",
            "# Encoded\n\n[space](with%20space.md) [dir](assets/) [root-anchored](/README.md)\n",
        )
        code, out = self.check(self.base)
        self.assertEqual(code, 0, msg=out)

    def test_link_escaping_the_repository_is_broken(self):
        write(self.repo / "docs" / "escape.md", "# Escape\n\n[out](../../../outside.md)\n")
        code, out = self.check(self.base)
        self.assertEqual(code, 1)
        self.assertIn("outside the repository", out)

    def test_node_modules_and_git_are_not_scanned(self):
        write(self.repo / "node_modules" / "pkg" / "README.md", "[dead](nope.md)\n")
        write(self.repo / ".git" / "hooks" / "README.md", "[dead](nope.md)\n")
        code, out = self.check(self.base)
        self.assertEqual(code, 0, msg=out)

    def test_summary_file_is_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            summary = Path(tmp) / "summary.md"
            write(self.repo / "docs" / "added.md", "# Added\n\n[dead](missing.md)\n")
            code, _ = run(
                docs.main,
                ["--repo-root", str(self.repo), "--base", self.base, "--summary", str(summary)],
            )
            self.assertEqual(code, 1)
            content = summary.read_text(encoding="utf-8")
            self.assertIn("### Documentation link check", content)
            self.assertIn("docs/added.md", content)

    def test_link_with_title_and_angle_brackets(self):
        write(
            self.repo / "docs" / "titles.md",
            '# Titles\n\n[titled](README.md "not a path fragment")\n'
            "[angle](<with space.md>)\n[dead](<nope file.md>)\n",
        )
        code, out = self.check(self.base)
        self.assertEqual(code, 1)
        self.assertIn("nope file.md", out)
        self.assertNotIn("not a path fragment", out)


# --------------------------------------------------------------------------- #
# Workflow wiring
# --------------------------------------------------------------------------- #


# --------------------------------------------------------------------------- #
# Self-weakening guard (union with the classifier accepted on main)
# --------------------------------------------------------------------------- #


WEAKENING = ('''def classify_path(path: str) -> set[str]:''', '''def classify_path(path: str) -> set[str]:
    return {"docs"}''')


class SelfWeakeningGuardTest(unittest.TestCase):
    """The change set must not be able to narrow its own verification.

    Without this guard, a pull request that ships a weakened classifier plus a
    backend change is classified as documentation-only by its own classifier:
    only the `docs` job runs, the `ci-gate` check is green, and the backend
    change is never built or tested. The union with the classifier revision
    already accepted on `main` removes that failure mode.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        git(self.repo, "init", "-q", "-b", "main")
        write(self.repo / "backend" / "src" / "worker.ts", "export const a = 1;\n")
        write(self.repo / "docs" / "a.md", "# A\n")
        self.install_classifier(SCRIPTS_DIR / "ci-classify-scope.py")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "main: honest classifier")
        self.base = git(self.repo, "rev-parse", "HEAD")

    def tearDown(self):
        self.tmp.cleanup()

    def install_classifier(self, source: Path, weaken: bool = False) -> None:
        target = self.repo / "scripts" / "ci-classify-scope.py"
        content = source.read_text(encoding="utf-8")
        if weaken:
            old, new = WEAKENING
            self.assertIn(old, content)
            content = content.replace(old, new, 1)
        write(target, content)

    def commit(self, message: str) -> str:
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", message)
        return git(self.repo, "rev-parse", "HEAD")

    def classify(self, *extra: str):
        return run(
            scope.main,
            [
                "--base",
                self.base,
                "--head",
                "HEAD",
                "--repo-root",
                str(self.repo),
                "--main-ref",
                "main",
                *extra,
            ],
        )

    def test_weakened_classifier_cannot_hide_a_backend_change(self):
        # The defect this test exists for: the pull request's own classifier
        # claims documentation-only while it also changes backend code.
        self.install_classifier(SCRIPTS_DIR / "ci-classify-scope.py", weaken=True)
        write(self.repo / "backend" / "src" / "worker.ts", "export const a = 2;\n")
        self.commit("PR: weakened classifier + backend change")

        _, without_guard = self.classify()
        self.assertIn("decision      : docs", without_guard)

        _, with_guard = self.classify("--also-run-rev", self.base)
        self.assertIn("previous rev  : unioned", with_guard)
        self.assertIn("decision      : docs, backend, frontend, generated", with_guard)
        self.assertIn("broad change  : every job runs", with_guard)

    def test_guard_keeps_documentation_only_changes_fast(self):
        write(self.repo / "docs" / "b.md", "# B\n")
        self.commit("docs only")
        code, out = self.classify("--also-run-rev", self.base)
        self.assertEqual(code, 0)
        self.assertIn("decision      : docs", out)
        self.assertIn("previous rev  : unioned", out)
        self.assertNotIn("broad change", out)

    def test_guard_keeps_frontend_only_changes_narrow(self):
        write(self.repo / "frontend" / "src" / "app.tsx", "export const a = 1;\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "frontend only")
        _, out = self.classify("--also-run-rev", self.base)
        self.assertIn("decision      : frontend", out)

    def test_guard_reports_a_previous_revision_without_a_classifier(self):
        # The revision that introduces the classifier has no copy of it yet.
        empty = Path(tempfile.mkdtemp())
        try:
            git(empty, "init", "-q", "-b", "main")
            write(empty / "docs" / "a.md", "# A\n")
            git(empty, "add", "-A")
            git(empty, "commit", "-q", "-m", "before the classifier")
            base = git(empty, "rev-parse", "HEAD")

            write(self.repo / "docs" / "c.md", "# C\n")
            head = self.commit("docs")
            code, out = run(
                scope.main,
                [
                    "--base",
                    base,
                    "--head",
                    head,
                    "--repo-root",
                    str(self.repo),
                    "--main-ref",
                    "main",
                    "--also-run-rev",
                    base,
                ],
            )
            self.assertEqual(code, 0)
            self.assertIn("previous rev  : missing", out)
            self.assertIn("decision      : docs", out)
        finally:
            empty.cleanup() if hasattr(empty, "cleanup") else None

    def test_guard_fails_closed_when_the_previous_classifier_cannot_run(self):
        # A file at the classifier path that carries the interface markers but
        # exits non-zero must run every job rather than be ignored.
        stub = (
            "# def classify_path(\n# --paths-from\nimport sys\nsys.exit(3)\n"
        )
        (self.repo / "scripts").mkdir(exist_ok=True)
        write(self.repo / "scripts" / "ci-classify-scope.py", stub)
        base = self.commit("main: unusable classifier")

        write(self.repo / "docs" / "d.md", "# D\n")
        self.commit("docs change")
        code, out = run(
            scope.main,
            [
                "--base",
                self.base,
                "--head",
                "HEAD",
                "--repo-root",
                str(self.repo),
                "--main-ref",
                "main",
                "--also-run-rev",
                base,
            ],
        )
        self.assertEqual(code, 0)
        self.assertIn("previous rev  : failed", out)
        self.assertIn("broad change  : every job runs", out)
        self.assertIn("::error title=CI scope::", out)

    def test_guard_fails_closed_when_the_previous_script_is_not_a_classifier(self):
        (self.repo / "scripts").mkdir(exist_ok=True)
        write(self.repo / "scripts" / "ci-classify-scope.py", "print('hello')\n")
        base = self.commit("main: unrelated script at the classifier path")

        write(self.repo / "docs" / "e.md", "# E\n")
        self.commit("docs change")
        _, out = run(
            scope.main,
            [
                "--base",
                self.base,
                "--head",
                "HEAD",
                "--repo-root",
                str(self.repo),
                "--main-ref",
                "main",
                "--also-run-rev",
                base,
            ],
        )
        self.assertIn("previous rev  : failed", out)
        self.assertIn("broad change  : every job runs", out)

    def test_guard_is_disabled_without_a_usable_revision(self):
        write(self.repo / "docs" / "f.md", "# F\n")
        self.commit("docs change")
        for rev in ("", "0" * 40):
            with self.subTest(rev=rev or "<empty>"):
                _, out = self.classify("--also-run-rev", rev)
                self.assertIn("previous rev  : disabled", out)
                self.assertIn("decision      : docs", out)

    def test_union_outputs_never_removes_jobs(self):
        decision = scope.classify_paths(["docs/a.md"])
        added = scope.union_outputs(
            decision,
            {
                "docs": "true",
                "backend": "true",
                "frontend": "true",
                "generated": "true",
                "broad": "true",
            },
        )
        self.assertEqual(sorted(added), ["backend", "frontend", "generated"])
        self.assertEqual(
            sorted(decision.expected_jobs), ["backend", "docs", "frontend", "generated"]
        )

        narrower = scope.classify_paths(["backend/src/a.ts"])
        scope.union_outputs(narrower, {"docs": "false", "backend": "false"})
        self.assertEqual(sorted(narrower.expected_jobs), ["backend", "generated"])

    def test_classifier_keeps_the_stable_paths_from_interface(self):
        # The guard replays change sets through `--paths-from`; removing that
        # contract would silently disable the guard.
        paths_file = self.repo / "paths.txt"
        paths_file.write_text("docs/a.md\n", encoding="utf-8")
        completed = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS_DIR / "ci-classify-scope.py"),
                "--paths-from",
                str(paths_file),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        self.assertIn("decision      : docs", completed.stdout)


# --------------------------------------------------------------------------- #
# Required-check enforcement verification (owner tooling)
# --------------------------------------------------------------------------- #


class RequiredCheckVerificationTest(unittest.TestCase):
    """`scripts/check-required-checks.py` must never report enforcement it did
    not read: a plan gate, a permission failure and a missing rule are three
    different answers and each must be distinguishable."""

    POLICY = ["ci-gate", "backend", "frontend", "generated-api-client", "docs"]

    def interpret(self, status, body):
        return checks.interpret_response(status, body)

    def test_plan_gated_403_is_reported_as_unavailable_not_as_missing_rule(self):
        protection = self.interpret(
            403,
            '{"message":"Upgrade to GitHub Pro or make this repository public '
            'to enable this feature."}',
        )
        self.assertEqual(protection.status, checks.PLAN_GATED)
        verdict = checks.evaluate(protection, self.POLICY)
        self.assertEqual(verdict.exit_code, 2)
        self.assertTrue(any("plan" in problem for problem in verdict.problems))

    def test_permission_denied_403_is_distinguished_from_a_plan_limit(self):
        protection = self.interpret(
            403, '{"message":"Resource not accessible by integration"}'
        )
        self.assertEqual(protection.status, checks.PERMISSION_DENIED)
        self.assertEqual(checks.evaluate(protection, self.POLICY).exit_code, 2)

    def test_404_means_the_branch_has_no_rule(self):
        protection = self.interpret(404, '{"message":"Branch not protected"}')
        self.assertEqual(protection.status, checks.NO_RULE)
        verdict = checks.evaluate(protection, self.POLICY)
        self.assertEqual(verdict.exit_code, 1)
        self.assertEqual(verdict.missing, self.POLICY)

    def test_a_rule_with_every_policy_check_is_enforced(self):
        body = json.dumps(
            {
                "required_status_checks": {
                    "strict": True,
                    "contexts": [],
                    "checks": [{"context": name} for name in self.POLICY],
                },
                "enforce_admins": {"enabled": True},
                "required_pull_request_reviews": {"required_approving_review_count": 1},
            }
        )
        verdict = checks.evaluate(self.interpret(200, body), self.POLICY)
        self.assertEqual(verdict.exit_code, 0)
        self.assertEqual(verdict.problems, [])
        self.assertEqual(verdict.warnings, [])

    def test_legacy_contexts_are_read_as_well_as_checks(self):
        body = json.dumps(
            {"required_status_checks": {"strict": False, "contexts": ["ci-gate"]}}
        )
        verdict = checks.evaluate(self.interpret(200, body), self.POLICY)
        self.assertIn("ci-gate", verdict.required)
        self.assertIn("backend", verdict.missing)

    def test_missing_ci_gate_is_not_enforced(self):
        body = json.dumps(
            {
                "required_status_checks": {
                    "strict": True,
                    "contexts": ["backend", "frontend"],
                },
                "enforce_admins": {"enabled": True},
                "required_pull_request_reviews": {},
            }
        )
        verdict = checks.evaluate(self.interpret(200, body), self.POLICY)
        self.assertEqual(verdict.exit_code, 1)
        self.assertIn("ci-gate", verdict.missing)

    def test_administrator_bypass_is_warned_about(self):
        body = json.dumps(
            {
                "required_status_checks": {
                    "strict": True,
                    "checks": [{"context": name} for name in self.POLICY],
                },
                "enforce_admins": {"enabled": False},
                "required_pull_request_reviews": {"required_approving_review_count": 1},
            }
        )
        verdict = checks.evaluate(self.interpret(200, body), self.POLICY)
        self.assertEqual(verdict.exit_code, 0)
        self.assertTrue(any("bypass" in warning for warning in verdict.warnings))

    def test_unexpected_responses_are_not_reported_as_enforced(self):
        for status, body in (
            (500, '{"message":"server error"}'),
            (200, "not json at all"),
            (200, "[1, 2, 3]"),
        ):
            with self.subTest(status=status, body=body[:12]):
                protection = self.interpret(status, body)
                self.assertIn(protection.status, (checks.API_ERROR,))
                self.assertEqual(checks.evaluate(protection, self.POLICY).exit_code, 2)

    def test_cli_exit_codes_and_fixture_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "protection.json"
            fixture.write_text(
                json.dumps(
                    {
                        "required_status_checks": {
                            "strict": True,
                            "checks": [{"context": name} for name in self.POLICY],
                        },
                        "enforce_admins": {"enabled": True},
                        "required_pull_request_reviews": {"required_approving_review_count": 1},
                    }
                ),
                encoding="utf-8",
            )
            code, out = run(
                checks.main,
                ["--protection-json", str(fixture), "--protection-status", "200"],
            )
            self.assertEqual(code, 0, msg=out)
            self.assertIn("Verdict: ENFORCED", out)

            code, out = run(
                checks.main,
                [
                    "--protection-json",
                    str(fixture),
                    "--protection-status",
                    "403",
                    "--require",
                    "ci-gate",
                ],
            )
            self.assertEqual(code, 2, msg=out)
            self.assertIn("UNKNOWN", out)

    def test_live_fetch_failure_is_reported_not_swallowed(self):
        with mock.patch.object(checks, "fetch_via_gh", return_value=None):
            code, out = run(checks.main, [])
        self.assertEqual(code, 2)
        self.assertIn("could not read branch protection", out)


class RepositoryCoverageTest(unittest.TestCase):
    """Every tracked path must map to verification (exhaustive, not sampled)."""

    def test_every_tracked_path_is_classified(self):
        completed = subprocess.run(
            ["git", "ls-files"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0 or not completed.stdout.strip():
            self.skipTest("not a git checkout")
        tracked = [line for line in completed.stdout.splitlines() if line.strip()]
        self.assertGreater(len(tracked), 100, "unexpectedly small repository tree")

        unclassified = []
        for path in tracked:
            decision = scope.classify_paths([path])
            if not decision.expected_jobs and not decision.broad:
                unclassified.append(path)
        self.assertEqual(
            unclassified,
            [],
            msg=f"paths that would run no verification at all: {unclassified[:10]}",
        )

    def test_safety_sensitive_paths_run_every_job(self):
        for path in (
            ".github/workflows/ci.yml",
            "scripts/ci-classify-scope.py",
            "scripts/ci-gate.py",
            "scripts/check-ci-workflow.py",
            "scripts/check-docs-links.py",
            "docker-compose.yml",
            ".gitignore",
            "new-top-level-dir/anything.txt",
        ):
            with self.subTest(path=path):
                decision = scope.classify_paths([path])
                self.assertEqual(
                    sorted(decision.expected_jobs),
                    ["backend", "docs", "frontend", "generated"],
                )
                self.assertTrue(decision.broad)

    def test_generated_client_script_change_runs_the_client_check(self):
        # Documented exception to "other scripts/** is broad": the only job that
        # can observe this script is the one that executes it.
        decision = scope.classify_paths(["scripts/check-generated-api-client.sh"])
        self.assertEqual(decision.expected_jobs, ["generated"])
        self.assertFalse(decision.broad)


class WorkflowWiringTest(unittest.TestCase):
    """The workflow must keep the contract the scripts assume.

    The mutation cases below are the point of this test: they prove the
    validator fails on the mistakes that would silently disable the gate,
    instead of passing because it cannot see them.
    """

    @classmethod
    def setUpClass(cls):
        cls.text = WORKFLOW_PATH.read_text(encoding="utf-8")

    def test_repository_workflow_is_valid(self):
        problems = workflow_check.check(self.text)
        self.assertEqual(problems, [], msg="workflow invariants violated: " + str(problems))

    def test_workflow_level_path_filters_are_rejected(self):
        mutated = self.text.replace(
            "  pull_request:\n    branches: [main]",
            "  pull_request:\n    paths:\n      - 'backend/**'",
        )
        self.assertNotEqual(mutated, self.text)
        self.assertTrue(
            any("path filtering" in problem for problem in workflow_check.check(mutated))
        )

    def test_gate_without_always_is_rejected(self):
        mutated = self.text.replace(
            "    timeout-minutes: 5\n    if: always()", "    timeout-minutes: 5"
        )
        self.assertNotEqual(mutated, self.text)
        self.assertTrue(
            any("if: always()" in problem for problem in workflow_check.check(mutated))
        )

    def test_job_missing_from_gate_needs_is_rejected(self):
        mutated = self.text.replace(
            "      - generated-api-client\n    steps:\n      - name: Checkout\n"
            "        uses: actions/checkout@v4\n\n      - name: Verify",
            "    steps:\n      - name: Checkout\n        uses: actions/checkout@v4\n\n"
            "      - name: Verify",
        )
        self.assertNotEqual(mutated, self.text)
        self.assertTrue(
            any(
                "not wired to" in problem and "generated-api-client" in problem
                for problem in workflow_check.check(mutated)
            )
        )

    def test_job_gated_by_the_wrong_scope_output_is_rejected(self):
        mutated = self.text.replace(
            "if: needs.classify.outputs.backend == 'true'",
            "if: needs.classify.outputs.docs == 'true'",
        )
        self.assertNotEqual(mutated, self.text)
        self.assertTrue(
            any("`backend` must be gated by" in problem for problem in workflow_check.check(mutated))
        )

    def test_job_without_needs_is_rejected(self):
        mutated = self.text.replace(
            "    needs: classify\n    if: needs.classify.outputs.frontend",
            "    if: needs.classify.outputs.frontend",
        )
        self.assertNotEqual(mutated, self.text)
        self.assertTrue(
            any("`frontend` must declare" in problem for problem in workflow_check.check(mutated))
        )

    def test_cancelling_main_runs_is_rejected(self):
        mutated = self.text.replace(
            "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}",
            "cancel-in-progress: true",
        )
        self.assertNotEqual(mutated, self.text)
        self.assertTrue(
            any("refs/heads/main" in problem for problem in workflow_check.check(mutated))
        )

    def test_removing_a_job_is_rejected(self):
        mutated = self.text.replace("  docs:\n    name: docs", "  documentation:\n    name: docs")
        self.assertNotEqual(mutated, self.text)
        self.assertTrue(
            any("missing job(s)" in problem for problem in workflow_check.check(mutated))
        )

    def test_declared_outputs_match_what_the_classifier_emits(self):
        """Cross-file drift check: workflow declarations vs script outputs."""
        with tempfile.TemporaryDirectory() as tmp:
            paths = Path(tmp) / "paths.txt"
            paths.write_text("docs/a.md\n", encoding="utf-8")
            output = Path(tmp) / "github_output.txt"
            code, _ = run(
                scope.main,
                ["--paths-from", str(paths), "--github-output", str(output)],
            )
            self.assertEqual(code, 0)
            emitted = {
                line.split("=", 1)[0]
                for line in output.read_text(encoding="utf-8").splitlines()
            }

        declared = workflow_check.sub_scalars(
            workflow_check.parse_jobs(self.text)["classify"], "outputs"
        )
        self.assertTrue(declared, "the workflow declares no classifier outputs")
        self.assertEqual(
            sorted(set(declared) - emitted),
            [],
            msg=f"declared but never emitted: {sorted(set(declared) - emitted)}",
        )
        for key in ("docs", "backend", "frontend", "generated", "broad", "base_sha"):
            self.assertIn(key, declared)

    def test_output_declaration_typo_is_rejected(self):
        mutated = self.text.replace(
            "      docs: ${{ steps.scope.outputs.docs }}",
            "      docs: ${{ steps.scope.outputs.backend }}",
        )
        self.assertNotEqual(mutated, self.text)
        self.assertTrue(
            any("steps.scope.outputs.docs" in problem for problem in workflow_check.check(mutated))
        )

    def test_dropping_the_self_weakening_guard_is_rejected(self):
        mutated = self.text.replace(
            '            --also-run-rev "$CI_BASE_SHA" \\\n', ""
        )
        self.assertNotEqual(mutated, self.text)
        self.assertTrue(
            any("--also-run-rev" in problem for problem in workflow_check.check(mutated)),
            msg="the validator must fail when the guard flag is dropped",
        )

    def test_guard_flag_is_wired_to_the_base_revision(self):
        self.assertIn('--also-run-rev "$CI_BASE_SHA"', self.text)
        self.assertIn("    if: always()", self.text)

    def test_structured_end_to_end_conditions(self):
        """Every conditional job is skipped or run by the classifier output only."""
        text = self.text
        for job, key in workflow_check.GATED_JOBS.items():
            with self.subTest(job=job):
                self.assertIn(
                    f"    if: needs.classify.outputs.{key} == 'true'", text
                )
                self.assertIn(f"    needs: classify", text)
        self.assertIn("    if: always()", text)


# --------------------------------------------------------------------------- #
# Whole-pipeline simulation (classification -> gate)
# --------------------------------------------------------------------------- #


class SimulatedPipelineTest(unittest.TestCase):
    """What the workflow would decide, and what the gate would then report.

    This is the required-check contract in miniature: for each change category,
    the jobs that do not run report ``skipped`` (which GitHub counts as
    success) and the gate must still be green; when a job that the change set
    requires does not succeed, the gate must be red -- including when it was
    skipped.
    """

    #: scope decision name -> workflow job id
    WORKFLOW_JOB = {
        "docs": "docs",
        "backend": "backend",
        "frontend": "frontend",
        "generated": "generated-api-client",
    }

    CATEGORIES = {
        "documentation-only": (
            ["STATE.md", "docs/adr/0001-a.md", ".vardena/agent-rules.md"],
            ["docs"],
        ),
        "frontend-only": (
            ["frontend/src/main.tsx", "frontend/package-lock.json"],
            ["frontend"],
        ),
        "backend-only": (
            ["backend/src/modules/licensing/application/license-import.service.ts"],
            ["backend", "generated"],
        ),
        "schema/migration": (
            ["backend/prisma/schema/licensing.prisma",
             "backend/prisma/migrations/20261018000000_x/migration.sql"],
            ["backend", "generated"],
        ),
        "generated-client": (
            ["frontend/src/api/generated/vardena-api.d.ts"],
            ["frontend", "generated"],
        ),
        "docs+backend": (
            ["docs/licensing-architecture.md", "backend/src/worker.ts"],
            ["docs", "backend", "generated"],
        ),
        "workflow change": (
            [".github/workflows/ci.yml"],
            ["docs", "backend", "frontend", "generated"],
        ),
        "unclassifiable root file": (
            ["docker-compose.yml"],
            ["docs", "backend", "frontend", "generated"],
        ),
    }

    def context_for(self, decision, results=None):
        """Build the `needs` context the workflow would produce."""
        results = results or {}
        outputs = decision.as_outputs()
        context = {
            "classify": {"result": "success", "outputs": outputs},
        }
        for job, key in gate.GATED_JOBS.items():
            expected = outputs[key] == "true"
            default = "success" if expected else "skipped"
            context[job] = {"result": results.get(job, default)}
        return context

    def test_every_category_is_gated_correctly(self):
        for label, (paths, expected_jobs) in self.CATEGORIES.items():
            with self.subTest(category=label):
                decision = scope.classify_paths(paths)
                self.assertEqual(sorted(decision.expected_jobs), sorted(expected_jobs))
                report = gate.evaluate(self.context_for(decision))
                self.assertEqual(report.failures, [], msg=f"{label}: {report.failures}")

    def test_every_category_fails_the_gate_when_a_required_job_is_skipped(self):
        for label, (paths, expected_jobs) in self.CATEGORIES.items():
            for job in expected_jobs:
                with self.subTest(category=label, job=job):
                    decision = scope.classify_paths(paths)
                    workflow_job = self.WORKFLOW_JOB[job]
                    report = gate.evaluate(
                        self.context_for(decision, {workflow_job: "skipped"})
                    )
                    self.assertTrue(
                        report.failures,
                        msg=f"{label}: gate passed although {workflow_job} was skipped",
                    )

    def test_every_category_fails_the_gate_when_a_required_job_fails(self):
        for label, (paths, expected_jobs) in self.CATEGORIES.items():
            for job in expected_jobs:
                with self.subTest(category=label, job=job):
                    decision = scope.classify_paths(paths)
                    workflow_job = self.WORKFLOW_JOB[job]
                    report = gate.evaluate(
                        self.context_for(decision, {workflow_job: "failure"})
                    )
                    self.assertTrue(
                        report.failures, msg=f"{label}/{workflow_job} was not caught"
                    )

    def test_gate_is_not_green_without_the_classifier(self):
        decision = scope.classify_paths(["docs/a.md"])
        context = self.context_for(decision)
        context["classify"] = {"result": "cancelled", "outputs": {}}
        self.assertTrue(gate.evaluate(context).failures)


if __name__ == "__main__":  # pragma: no cover
    unittest.main(verbosity=2)
