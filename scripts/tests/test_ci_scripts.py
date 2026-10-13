#!/usr/bin/env python3
"""Deterministic tests for the CI helper scripts.

Covers what a change-aware pipeline can get wrong silently:

* path classification -- which jobs a change set requires, including the
  fail-safe behaviour for unclassifiable paths and unusable base revisions,
* the self-weakening guard -- a change set must not be able to narrow its own
  verification by shipping a weakened classifier,
* the final gate -- what a green `ci-gate` actually asserts (a skipped,
  cancelled or failed applicable job must fail it),
* the workflow wiring that makes the gate load-bearing,
* the documentation link check.

Run locally from the repository root:

    python3 -m unittest discover -s scripts/tests -t scripts/tests -v
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SCRIPTS_DIR.parent
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "ci.yml"


def load(name: str):
    """Import a dashed-file-name script as a module."""
    module_name = "ci_scripts_" + name.replace("-", "_")[:-3]
    spec = importlib.util.spec_from_file_location(module_name, SCRIPTS_DIR / name)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module  # dataclasses resolves hints via sys.modules
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


scope = load("ci-classify-scope.py")
gate = load("ci-gate.py")
docs = load("check-docs-links.py")


def run(func, *args, **kwargs):
    """Run an entry point, returning (exit code, captured output)."""
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


ALL_JOBS = ["backend", "docs", "frontend", "generated"]


# --------------------------------------------------------------------------- #
# Path classification
# --------------------------------------------------------------------------- #


class ClassifyPathsTest(unittest.TestCase):
    def decide(self, *paths: str):
        return scope.classify_paths(list(paths))

    def assert_jobs(self, decision, expected, broad=False):
        self.assertEqual(sorted(decision.jobs), sorted(expected))
        self.assertEqual(decision.broad, broad, msg="broad flag mismatch")

    def test_documentation_only_changes(self):
        decision = self.decide(
            "STATE.md",
            "README.md",
            "AGENTS.md",
            "docs/architecture.md",
            ".vardena/agent-rules.md",
            "Pasted markdown(20260927-203801).md",
        )
        self.assert_jobs(decision, ["docs"])

    def test_docs_assets_and_deletions_are_documentation(self):
        self.assert_jobs(self.decide("docs/img/flow.png"), ["docs"])
        self.assert_jobs(self.decide("./docs/removed.md"), ["docs"])

    def test_frontend_changes_run_frontend_only(self):
        self.assert_jobs(
            self.decide(
                "frontend/src/main.tsx",
                "frontend/package.json",
                "frontend/package-lock.json",
                "frontend/vite.config.ts",
            ),
            ["frontend"],
        )

    def test_frontend_generated_client_runs_frontend_and_client_check(self):
        self.assert_jobs(
            self.decide("frontend/src/api/generated/vardena-api.d.ts"),
            ["frontend", "generated"],
        )

    def test_backend_changes_run_backend_and_client_drift_check(self):
        for path in (
            "backend/src/modules/licensing/api/license-import.controller.ts",
            "backend/test/licensing-persistence-live.e2e-spec.ts",
            "backend/prisma/schema/licensing.prisma",
            "backend/prisma/migrations/20261018000000_x/migration.sql",
            "backend/package.json",
            "backend/package-lock.json",
        ):
            with self.subTest(path=path):
                self.assert_jobs(self.decide(path), ["backend", "generated"])

    def test_backend_markdown_keeps_backend_format_check_without_client_check(self):
        self.assert_jobs(self.decide("backend/README.md"), ["docs", "backend"])

    def test_frontend_markdown_keeps_frontend_format_check(self):
        self.assert_jobs(self.decide("frontend/README.md"), ["docs", "frontend"])

    def test_generated_client_script_runs_client_check(self):
        self.assert_jobs(self.decide("scripts/check-generated-api-client.sh"), ["generated"])

    def test_unclassifiable_paths_run_every_job(self):
        for path in (
            ".github/workflows/ci.yml",
            "docker-compose.yml",
            ".env.example",
            ".gitignore",
            "scripts/ci-classify-scope.py",
            "scripts/ci-gate.py",
            "new-top-level-dir/file.ts",
        ):
            with self.subTest(path=path):
                self.assert_jobs(self.decide(path), ALL_JOBS, broad=True)

    def test_one_unknown_path_makes_the_whole_change_broad(self):
        decision = self.decide("docs/a.md", "backend/src/b.ts", ".github/workflows/ci.yml")
        self.assert_jobs(decision, ALL_JOBS, broad=True)
        self.assertEqual(decision.unclassified, [".github/workflows/ci.yml"])

    def test_empty_change_set_is_broad_not_silent(self):
        self.assert_jobs(self.decide(), ALL_JOBS, broad=True)

    def test_mixed_change_sets_run_the_union(self):
        self.assert_jobs(
            self.decide("docs/adr/0001-a.md", "backend/src/kernel/http/configure-app.ts"),
            ["docs", "backend", "generated"],
        )
        self.assert_jobs(
            self.decide("STATE.md", "frontend/src/lib/format.ts"), ["docs", "frontend"]
        )

    def test_classification_is_order_independent_and_deduplicated(self):
        first = self.decide("backend/src/a.ts", "docs/b.md", "backend/src/a.ts")
        second = self.decide("docs/b.md", "backend/src/a.ts")
        self.assertEqual(first.as_outputs(), second.as_outputs())
        self.assertEqual(first.paths, ["backend/src/a.ts", "docs/b.md"])

    def test_outputs_are_the_stable_interface(self):
        self.assertEqual(
            self.decide("docs/a.md").as_outputs(),
            {
                "docs": "true",
                "backend": "false",
                "frontend": "false",
                "generated": "false",
                "broad": "false",
            },
        )


class NameStatusParsingTest(unittest.TestCase):
    def test_plain_records(self):
        self.assertEqual(
            scope.parse_name_status_z("M\0a.md\0A\0b.md\0D\0c.md\0"), ["a.md", "b.md", "c.md"]
        )

    def test_rename_records_include_both_sides(self):
        self.assertEqual(
            scope.parse_name_status_z("R100\0docs/old.md\0docs/new.md\0M\0backend/x.ts\0"),
            ["docs/old.md", "docs/new.md", "backend/x.ts"],
        )

    def test_paths_with_spaces(self):
        self.assertEqual(
            scope.parse_name_status_z("A\0Pasted note (1).md\0"), ["Pasted note (1).md"]
        )

    def test_truncated_stream_does_not_crash(self):
        self.assertEqual(scope.parse_name_status_z("M\0"), [])

    def test_unusable_sha_detection(self):
        self.assertTrue(scope.unusable_sha(""))
        self.assertTrue(scope.unusable_sha(None))
        self.assertTrue(scope.unusable_sha("0" * 40))
        self.assertFalse(scope.unusable_sha("749b01c95c4f107b8a37a86376dad156dffb8463"))


class ClassifyGitIntegrationTest(unittest.TestCase):
    """Change detection against a real (throwaway) git repository."""

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

    def classify(self, *extra: str, base: str | None = None):
        return run(
            scope.main,
            [
                "--base",
                self.base if base is None else base,
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

    def test_path_with_spaces(self):
        write(self.repo / "Pasted note (1).md", "# note\n")
        self.commit("spaces")
        _, out = self.classify()
        self.assertIn("decision      : docs", out)

    def test_markdown_rename(self):
        git(self.repo, "mv", "docs/a.md", "docs/renamed.md")
        self.commit("rename")
        _, out = self.classify()
        self.assertIn("decision      : docs", out)

    def test_unknown_path_runs_everything(self):
        write(self.repo / "docker-compose.yml", "services: {}\n")
        self.commit("compose")
        _, out = self.classify()
        self.assertIn("broad change  : every job runs", out)

    def test_outputs_file_and_summary(self):
        write(self.repo / "docs" / "c.md", "# C\n")
        self.commit("docs again")
        output_file = self.repo / "out.txt"
        summary_file = self.repo / "summary.md"
        self.classify(
            "--github-output",
            str(output_file),
            "--summary",
            str(summary_file),
        )
        content = dict(
            line.split("=", 1)
            for line in output_file.read_text(encoding="utf-8").splitlines()
        )
        self.assertEqual(
            content,
            {
                "docs": "true",
                "backend": "false",
                "frontend": "false",
                "generated": "false",
                "broad": "false",
            },
        )
        self.assertIn("### CI scope", summary_file.read_text(encoding="utf-8"))

    def test_missing_or_zero_base_runs_every_job(self):
        for base in ("0" * 40, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"):
            with self.subTest(base=base[:8]):
                _, out = self.classify(base=base)
                self.assertIn("broad change  : every job runs", out)

    def test_base_equal_to_head_runs_every_job(self):
        _, out = self.classify(base=git(self.repo, "rev-parse", "HEAD"))
        self.assertIn("broad change  : every job runs", out)

    def test_base_not_reachable_from_main_is_refused(self):
        git(self.repo, "checkout", "-q", "-b", "side")
        write(self.repo / "backend" / "src" / "a.ts", "export const a = 3;\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "side")
        side = git(self.repo, "rev-parse", "HEAD")
        git(self.repo, "checkout", "-q", "main")
        _, out = self.classify(base=side)
        self.assertIn("broad change  : every job runs", out)

    def test_pull_request_diff_uses_the_merge_base(self):
        write(self.repo / "backend" / "src" / "a.ts", "export const a = 4;\n")
        git(self.repo, "checkout", "-q", "-b", "feature")
        self.commit("feature")
        git(self.repo, "checkout", "-q", "main")
        write(self.repo / "docs" / "main-side.md", "# main side\n")
        self.commit("main side")
        git(self.repo, "checkout", "-q", "feature")
        _, out = self.classify()
        self.assertIn("decision      : backend, generated", out)


# --------------------------------------------------------------------------- #
# Self-weakening guard
# --------------------------------------------------------------------------- #


class SelfWeakeningGuardTest(unittest.TestCase):
    """A change set must not be able to narrow its own verification.

    Without the guard, a pull request that ships a weakened classifier plus a
    backend change is classified as documentation-only by its own classifier:
    only `docs` runs, `ci-gate` is green, and the backend change is untested.
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
        content = source.read_text(encoding="utf-8")
        if weaken:
            marker = "def classify_path(path: str) -> set[str]:"
            self.assertIn(marker, content)
            content = content.replace(marker, marker + '\n    return {"docs"}', 1)
        write(self.repo / "scripts" / "ci-classify-scope.py", content)

    def commit(self, message: str) -> str:
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", message)
        return git(self.repo, "rev-parse", "HEAD")

    def classify(self, *extra: str, base: str | None = None, head: str = "HEAD"):
        return run(
            scope.main,
            [
                "--base",
                self.base if base is None else base,
                "--head",
                head,
                "--repo-root",
                str(self.repo),
                "--main-ref",
                "main",
                *extra,
            ],
        )

    def test_weakened_classifier_cannot_hide_a_backend_change(self):
        self.install_classifier(SCRIPTS_DIR / "ci-classify-scope.py", weaken=True)
        write(self.repo / "backend" / "src" / "worker.ts", "export const a = 2;\n")
        self.commit("weakened classifier + backend change")

        _, without_guard = self.classify()
        self.assertIn("decision      : docs", without_guard)

        _, with_guard = self.classify("--also-run-rev", self.base)
        self.assertIn("previous rev  : unioned", with_guard)
        self.assertIn("decision      : docs, backend, frontend, generated", with_guard)
        self.assertIn("broad change  : every job runs", with_guard)

    def test_guard_keeps_documentation_only_changes_fast(self):
        write(self.repo / "docs" / "b.md", "# B\n")
        self.commit("docs only")
        _, out = self.classify("--also-run-rev", self.base)
        self.assertIn("decision      : docs", out)
        self.assertIn("previous rev  : unioned", out)
        self.assertNotIn("broad change", out)

    def test_guard_keeps_frontend_only_changes_narrow(self):
        write(self.repo / "frontend" / "src" / "app.tsx", "export const a = 1;\n")
        self.commit("frontend only")
        _, out = self.classify("--also-run-rev", self.base)
        self.assertIn("decision      : frontend", out)

    def test_guard_reports_a_previous_revision_without_a_classifier(self):
        empty = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: None)
        try:
            git(empty, "init", "-q", "-b", "main")
            write(empty / "docs" / "a.md", "# A\n")
            git(empty, "add", "-A")
            git(empty, "commit", "-q", "-m", "before the classifier")
            base = git(empty, "rev-parse", "HEAD")
        except subprocess.CalledProcessError:  # pragma: no cover
            self.skipTest("git unavailable")

        write(self.repo / "docs" / "c.md", "# C\n")
        self.commit("docs")
        code, out = self.classify("--also-run-rev", base)
        self.assertEqual(code, 0)
        self.assertIn("previous rev  : missing", out)
        self.assertIn("decision      : docs", out)

    def test_guard_fails_closed_when_the_previous_classifier_cannot_run(self):
        stub = "# def classify_path(\n# --paths-from\nimport sys\nsys.exit(3)\n"
        base = self.commit_with_stub(stub)
        write(self.repo / "docs" / "d.md", "# D\n")
        self.commit("docs change")
        code, out = self.classify("--also-run-rev", base)
        self.assertEqual(code, 0)
        self.assertIn("previous rev  : failed", out)
        self.assertIn("broad change  : every job runs", out)

    def commit_with_stub(self, stub: str) -> str:
        write(self.repo / "scripts" / "ci-classify-scope.py", stub)
        return self.commit("main: unusable classifier")

    def test_guard_fails_closed_when_the_previous_file_is_not_a_classifier(self):
        base = self.commit_with_stub("print('hello')\n")
        write(self.repo / "docs" / "e.md", "# E\n")
        self.commit("docs change")
        _, out = self.classify("--also-run-rev", base)
        self.assertIn("previous rev  : failed", out)
        self.assertIn("broad change  : every job runs", out)

    def test_guard_is_disabled_without_a_usable_revision(self):
        write(self.repo / "docs" / "f.md", "# F\n")
        self.commit("docs change")
        for rev in ("", "0" * 40):
            with self.subTest(rev=rev or "<empty>"):
                code, out = self.classify("--also-run-rev", rev)
                self.assertEqual(code, 0)
                self.assertIn("decision      : docs", out)
                self.assertNotIn("unioned", out)

    def test_union_only_adds_jobs(self):
        decision = scope.classify_paths(["docs/a.md"])
        added = scope.union(
            decision, {"docs": "true", "backend": "true", "broad": "true"}
        )
        self.assertEqual(sorted(added), ["backend", "frontend", "generated"])
        self.assertEqual(sorted(decision.jobs), ALL_JOBS)

        narrower = scope.classify_paths(["backend/src/a.ts"])
        scope.union(narrower, {"backend": "false", "frontend": "false"})
        self.assertEqual(sorted(narrower.jobs), ["backend", "generated"])

    def test_paths_from_is_a_stable_interface(self):
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
# Final gate
# --------------------------------------------------------------------------- #


def needs_context(**jobs) -> dict:
    """A docs-only `needs` context; override any job result by keyword."""
    context: dict = {
        "classify": {
            "result": "success",
            "outputs": {
                "docs": "true",
                "backend": "false",
                "frontend": "false",
                "generated": "false",
                "broad": "false",
            },
        },
        "docs": {"result": "success"},
        "backend": {"result": "skipped"},
        "frontend": {"result": "skipped"},
        "generated-api-client": {"result": "skipped"},
    }
    for job, value in jobs.items():
        context[job.replace("_", "-")] = {"result": value}
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

    def test_required_job_that_failed_or_was_cancelled_fails_the_gate(self):
        for result in ("failure", "cancelled"):
            with self.subTest(result=result):
                context = needs_context()
                context["classify"]["outputs"]["docs"] = "true"
                context["docs"] = {"result": result}
                self.assert_fail(self.evaluate(context), "'docs' did not succeed")

    def test_classifier_failure_or_skip_fails_the_gate(self):
        for result in ("failure", "cancelled"):
            with self.subTest(result=result):
                context = needs_context()
                context["classify"] = {"result": result, "outputs": {}}
                self.assert_fail(self.evaluate(context), "did not succeed")

    def test_missing_classify_entry_fails_the_gate(self):
        context = needs_context()
        del context["classify"]
        self.assert_fail(self.evaluate(context), "did not report a result")

    def test_missing_or_invalid_classifier_output_fails_closed(self):
        context = needs_context()
        del context["classify"]["outputs"]["generated"]
        self.assert_fail(self.evaluate(context), "output 'generated' is missing")

        context = needs_context()
        context["classify"]["outputs"]["backend"] = "maybe"
        self.assert_fail(self.evaluate(context), "output 'backend' is missing or invalid")

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

    def test_cli_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            needs_file = Path(tmp) / "needs.json"
            needs_file.write_text(json.dumps(needs_context()), encoding="utf-8")
            code, out = run(gate.main, ["--needs-json", str(needs_file)])
            self.assertEqual(code, 0, msg=out)
            self.assertIn("CI gate: PASS", out)

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


class SimulatedPipelineTest(unittest.TestCase):
    """The required-check contract in miniature, per change category."""

    #: workflow job id -> classifier output key
    JOB_OUTPUT = {
        "docs": "docs",
        "backend": "backend",
        "frontend": "frontend",
        "generated-api-client": "generated",
    }
    CATEGORIES = {
        "documentation-only": (["STATE.md", "docs/adr/0001-a.md"], ["docs"]),
        "frontend-only": (["frontend/src/main.tsx"], ["frontend"]),
        "backend-only": (["backend/src/worker.ts"], ["backend", "generated"]),
        "schema-migration": (["backend/prisma/schema/licensing.prisma"], ["backend", "generated"]),
        "generated-client": (["frontend/src/api/generated/vardena-api.d.ts"], ["frontend", "generated"]),
        "workflow-change": ([".github/workflows/ci.yml"], ALL_JOBS),
        "docs+backend": (["docs/a.md", "backend/src/worker.ts"], ["docs", "backend", "generated"]),
    }

    JOB_OUTPUT_INVERSE = {key: job for job, key in JOB_OUTPUT.items()}

    def context_for(self, decision, overrides=None):
        overrides = overrides or {}
        outputs = decision.as_outputs()
        context = {"classify": {"result": "success", "outputs": outputs}}
        for job, key in self.JOB_OUTPUT.items():
            default = "success" if outputs[key] == "true" else "skipped"
            context[job] = {"result": overrides.get(job, default)}
        return context

    def test_every_category_is_gated_correctly(self):
        for label, (paths, expected) in self.CATEGORIES.items():
            with self.subTest(category=label):
                decision = scope.classify_paths(paths)
                self.assertEqual(sorted(decision.jobs), sorted(expected))
                self.assertEqual(
                    gate.evaluate(self.context_for(decision)).failures, []
                )

    def test_a_required_job_that_is_skipped_or_fails_is_caught(self):
        for label, (paths, expected) in self.CATEGORIES.items():
            for job in expected:
                workflow_job = self.JOB_OUTPUT_INVERSE[job]
                for result in ("skipped", "failure"):
                    with self.subTest(category=label, job=workflow_job, result=result):
                        decision = scope.classify_paths(paths)
                        report = gate.evaluate(
                            self.context_for(decision, {workflow_job: result})
                        )
                        self.assertTrue(
                            report.failures,
                            msg=f"{label}/{workflow_job}={result} was not caught",
                        )

    def test_gate_is_not_green_without_the_classifier(self):
        decision = scope.classify_paths(["docs/a.md"])
        context = self.context_for(decision)
        context["classify"] = {"result": "cancelled", "outputs": {}}
        self.assertTrue(gate.evaluate(context).failures)


# --------------------------------------------------------------------------- #
# Workflow contract (the wiring that makes the scripts load-bearing)
# --------------------------------------------------------------------------- #


class WorkflowContractTest(unittest.TestCase):
    """Checks on the workflow that keep the optimization safe.

    These are the invariants that would otherwise fail silently: a workflow
    level path filter (required checks stay pending), a gate that is not
    `if: always()` (a skipped gate reports success), a job missing from the
    gate's needs, or a dropped self-weakening guard.
    """

    @classmethod
    def setUpClass(cls):
        cls.text = WORKFLOW_PATH.read_text(encoding="utf-8")

    def test_no_workflow_level_path_filters(self):
        on_block = self.text.split("\njobs:", 1)[0]
        self.assertNotRegex(on_block, r"(?m)^\s{4}paths(-ignore)?:")
        self.assertIn("branches: [main]", on_block)
        self.assertIn("pull_request:", on_block)
        self.assertIn("push:", on_block)

    def job_ids(self) -> list[str]:
        """Top-level job ids, read from the `jobs:` section only."""
        jobs_text = self.text.split("\njobs:", 1)[1]
        return [
            match.group(1)
            for match in re.finditer(r"(?m)^  ([A-Za-z0-9_-]+):\s*$", jobs_text)
        ]

    def job_block(self, job_id: str) -> str:
        """The text of one top-level job, without a backtracking regex."""
        marker = f"\n  {job_id}:\n"
        self.assertIn(marker, self.text, msg=f"job {job_id} not found")
        rest = self.text[self.text.index(marker) + len(marker) :]
        next_job = re.search(r"(?m)^  [A-Za-z0-9_-]+:\s*$", rest)
        return rest[: next_job.start()] if next_job else rest

    def test_each_job_is_gated_by_its_own_scope_output(self):
        for job, key in (
            ("docs", "docs"),
            ("backend", "backend"),
            ("frontend", "frontend"),
            ("generated-api-client", "generated"),
        ):
            with self.subTest(job=job):
                block = self.job_block(job)
                self.assertIn("    needs: classify\n", block)
                self.assertIn(
                    f"    if: needs.classify.outputs.{key} == 'true'\n", block
                )

    def test_gate_always_runs_and_needs_every_job(self):
        block = self.job_block("ci-gate")
        self.assertIn("    if: always()", block)
        needs = re.search(r"    needs:\n((?:      - \S+\n)+)", block)
        self.assertIsNotNone(needs, "ci-gate must declare its needs as a list")
        listed = [line.strip(" -") for line in needs.group(1).strip().splitlines()]
        jobs_in_workflow = [
            name for name in self.job_ids() if name != "ci-gate"
        ]
        self.assertEqual(sorted(listed), sorted(jobs_in_workflow))

    def test_self_weakening_guard_is_invoked_with_the_base_revision(self):
        block = self.text.split("  classify:", 1)[1].split("\n  docs:", 1)[0]
        invocations = [
            line
            for line in block.splitlines()
            if "--also-run-rev" in line and not line.lstrip().startswith("#")
        ]
        self.assertTrue(invocations, "--also-run-rev must be invoked, not merely mentioned")
        self.assertTrue(
            any("CI_BASE_SHA" in line for line in invocations),
            "--also-run-rev must use the base revision (CI_BASE_SHA)",
        )

    def test_classifier_outputs_match_what_the_script_emits(self):
        declared = re.findall(r"(?m)^      ([a-z_]+): \$\{\{ steps\.scope\.outputs\.", self.text)
        self.assertEqual(sorted(declared), ["backend", "broad", "docs", "frontend", "generated"])

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
        self.assertEqual(sorted(emitted), ["backend", "broad", "docs", "frontend", "generated"])
        self.assertEqual(sorted(declared), sorted(emitted))

    def test_substantive_jobs_keep_their_database_steps(self):
        """The optimization must not have removed coverage."""
        for needle in (
            "npm run prisma:validate",
            "npm run prisma:deploy",
            "npm run bootstrap:system-admin",
            "test/inventory-business-date-writes-live.e2e-spec.ts",
            "npm run test:migration-rehearsal",
            "npm run test:licensing-version-rehearsal",
            "test/licensing-persistence-live.e2e-spec.ts",
            "bash scripts/check-generated-api-client.sh",
        ):
            with self.subTest(step=needle):
                self.assertIn(needle, self.text)


class RepositoryCoverageTest(unittest.TestCase):
    def test_every_tracked_path_maps_to_verification(self):
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

        unverified = []
        for path in tracked:
            decision = scope.classify_paths([path])
            if not decision.jobs and not decision.broad:
                unverified.append(path)
        self.assertEqual(
            unverified, [], msg=f"paths that would run no verification: {unverified[:5]}"
        )

    def test_safety_sensitive_paths_run_every_job(self):
        for path in (
            ".github/workflows/ci.yml",
            "scripts/ci-classify-scope.py",
            "scripts/ci-gate.py",
            "docker-compose.yml",
            ".gitignore",
        ):
            with self.subTest(path=path):
                decision = scope.classify_paths([path])
                self.assertEqual(sorted(decision.jobs), ALL_JOBS)
                self.assertTrue(decision.broad)


# --------------------------------------------------------------------------- #
# Documentation link check
# --------------------------------------------------------------------------- #


class DocsLinkCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        write(self.repo / "README.md", "# Root\n\n[docs](docs/guide.md)\n")
        write(self.repo / "docs" / "guide.md", "# Guide\n\n[root](../README.md)\n")
        write(self.repo / "docs" / "with space.md", "# Space\n")
        write(self.repo / "docs" / "assets" / ".keep", "")
        git(self.repo, "init", "-q", "-b", "main")

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, *extra: str):
        return run(docs.main, ["--repo-root", str(self.repo), *extra])

    def test_complete_tree_passes(self):
        code, out = self.check()
        self.assertEqual(code, 0, msg=out)
        self.assertIn("broken links   : 0", out)

    def test_new_dead_link_fails(self):
        write(self.repo / "docs" / "added.md", "# Added\n\n[dead](missing.md)\n")
        code, out = self.check()
        self.assertEqual(code, 1)
        self.assertIn("::error title=broken documentation link::", out)

    def test_removing_a_link_target_fails(self):
        (self.repo / "README.md").unlink()
        code, out = self.check()
        self.assertEqual(code, 1)
        self.assertIn("docs/guide.md", out)

    def test_existing_dead_link_is_reported_and_list_mode_never_fails(self):
        write(self.repo / "docs" / "legacy.md", "# Legacy\n\n[dead](gone.md)\n")
        code, _ = self.check()
        self.assertEqual(code, 1)
        code, out = self.check("--list")
        self.assertEqual(code, 0)
        self.assertIn("broken links   : 1", out)

    def test_fences_inline_code_external_anchors_and_encodings(self):
        write(
            self.repo / "docs" / "mixed.md",
            "# Mixed\n\n```md\n[dead](nope.md)\n```\n\nInline `[dead](also-nope.md)` too.\n"
            "[web](https://example.com/x.md) [mail](mailto:a@example.com) [anchor](#h)\n"
            "[space](with%20space.md) [dir](assets/) [root](/README.md)\n"
            '[titled](<with space.md> "not a path")\n',
        )
        code, out = self.check()
        self.assertEqual(code, 0, msg=out)
        self.assertNotIn("not a path", out)

    def test_link_escaping_the_repository_is_broken(self):
        write(self.repo / "docs" / "escape.md", "# Escape\n\n[out](../../../outside.md)\n")
        code, out = self.check()
        self.assertEqual(code, 1)
        self.assertIn("outside the repository", out)

    def test_ignored_directories_are_not_scanned(self):
        write(self.repo / "node_modules" / "pkg" / "README.md", "[dead](nope.md)\n")
        write(self.repo / ".git" / "hooks" / "README.md", "[dead](nope.md)\n")
        code, out = self.check()
        self.assertEqual(code, 0, msg=out)

    def test_current_repository_tree_is_clean(self):
        code, out = run(docs.main, ["--repo-root", str(REPO_ROOT)])
        self.assertEqual(code, 0, msg=out)
        self.assertIn("broken links   : 0", out)


if __name__ == "__main__":  # pragma: no cover
    unittest.main(verbosity=2)
