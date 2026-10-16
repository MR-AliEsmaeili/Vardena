#!/usr/bin/env python3
"""Fast source guard, not proof of date correctness or whole-module compliance.

Prevents direct calendar-library/per-screen locale formatting and raw primary
Instant JSX in both UIs. Canonical title evidence and the explicit historical
input fallback remain permitted. Shared behavior tests cover conversion/ranges.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PURE = Path('frontend/src/lib/datetime')
STAGED = Path('owner-licensing/frontend/src/lib/.date-foundation')
FALLBACKS = {
    Path('frontend/src/ui/patterns/date-input.tsx'),
    Path('owner-licensing/frontend/src/ui/patterns/date-input.tsx'),
}
LIBRARY = re.compile(r"(?:from\s*|import\s*\()\s*['\"](?:dayjs|jalaali-js)(?:/[^'\"]*)?['\"]")
# Any camelCase `*At` / `*Timestamp` property rendered directly in JSX is a raw
# primary Instant: it must go through the shared formatter. The earlier list
# named five fields explicitly, which let `graceEndsAt` through in the license
# gate (OQ-45/ADR-0049) — the general shape closes that class, not one instance.
RAW = re.compile(r'\{\s*(?!t\.|o\.)[A-Za-z_$][\w$.]*\.\w*(?:At|Timestamp)\s*\}')


def violations(path: Path, text: str) -> list[str]:
    pure = path.is_relative_to(PURE) or path.is_relative_to(STAGED)
    errors = []
    for number, line in enumerate(text.splitlines(), 1):
        if not pure and LIBRARY.search(line):
            errors.append(f'{path}:{number}: date library bypasses canonical foundation')
        if not pure and re.search(r'\.toLocale(?:Date|Time)String\s*\(', line):
            errors.append(f'{path}:{number}: per-screen date/time formatting')
        if path not in FALLBACKS and re.search(r'type=["\'](?:date|datetime-local)["\']', line):
            errors.append(f'{path}:{number}: native date input outside historical fallback')
        if RAW.search(line) and not re.search(r'\b(?:title|dateTime|label)=\{', line):
            errors.append(f'{path}:{number}: raw primary Instant JSX; use date formatter')
    return errors


def main() -> int:
    errors = []
    for workspace in ('frontend', 'owner-licensing/frontend'):
        for path in sorted((ROOT / workspace / 'src').rglob('*')):
            if path.suffix not in ('.ts', '.tsx') or '.test.' in path.name or '.spec.' in path.name:
                continue
            errors.extend(violations(path.relative_to(ROOT), path.read_text()))
    for error in errors:
        print(error)
    if not errors:
        print('Date contract source guard: PASS (limited structural coverage; see audit matrix).')
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
