import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('date_contract', Path(__file__).resolve().parents[1] / 'check-date-contract.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class DateContractTest(unittest.TestCase):
    def test_rejects_library_and_raw_primary_display_in_either_app(self):
        for workspace in ('frontend', 'owner-licensing/frontend'):
            path = Path(workspace) / 'src/features/history.tsx'
            self.assertTrue(module.violations(path, "import dayjs from 'dayjs';"))
            self.assertTrue(module.violations(path, '<span>{event.occurredAt}</span>'))
            self.assertTrue(module.violations(path, 'value.toLocaleDateString()'))
            self.assertTrue(module.violations(path, '<input type="date" />'))

    def test_rejects_any_raw_camel_case_instant_property(self):
        # The class, not one instance: the license gate shipped
        # `{license.license?.graceEndsAt}` as a raw ISO string because the
        # original guard named five fields explicitly (OQ-45 / ADR-0049).
        path = Path('frontend/src/app/layouts/license-gate.tsx')
        self.assertTrue(module.violations(path, '<span>{license.graceEndsAt}</span>'))
        self.assertTrue(module.violations(path, '<span>{state.window.expiresAt}</span>'))
        self.assertTrue(module.violations(path, '<span>{row.postingTimestamp}</span>'))
        # …and still permits the canonical formatter and title/dateTime evidence.
        self.assertEqual(
            [],
            module.violations(
                path,
                '<span title={state.expiresAt}>{formatDateTime(state.expiresAt)}</span>',
            ),
        )

    def test_permits_canonical_layer_and_secondary_evidence(self):
        path = Path('frontend/src/features/history.tsx')
        self.assertEqual([], module.violations(path, '<span title={event.occurredAt}>{formatDateTime(event.occurredAt)}</span>'))
        for root in (module.PURE, module.STAGED):
            self.assertEqual([], module.violations(root / 'dayjs.ts', "import dayjs from 'dayjs';"))
