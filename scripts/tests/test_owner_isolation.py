import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('owner_isolation', Path(__file__).parents[1] / 'check-owner-isolation.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OwnerIsolationTest(unittest.TestCase):
    def test_positive_gate_detects_owner_in_arbitrarily_named_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.assertTrue(module.inspect_artifact(root))
            (root / 'main.js').write_text('console.log("customer")')
            self.assertEqual(module.inspect_artifact(root), [])
            for marker in module.MARKERS:
                (root / 'renamed-chunk.js').write_bytes(marker)
                self.assertTrue(module.inspect_artifact(root))

    def test_dependency_graph_is_independent(self):
        repo = Path(__file__).parents[2]
        self.assertEqual(module.inspect_sources(repo), [])

    def test_owner_scope_runs_api_ui_and_windows_without_generated_customer_client(self):
        import runpy
        scope = runpy.run_path(str(Path(__file__).parents[1] / 'ci-classify-scope.py'))
        decision = scope['classify_paths'](['owner-licensing/backend/src/app.ts'])
        self.assertEqual(decision.jobs, ['backend', 'frontend', 'owner'])
