# ACC-03 — Accounting period administration (2026-10-26)

## Scope and evidence

- Extended the existing period create form instead of replacing it. Added a separately gated `/app/accounting/periods/new` route, year-bound validation, an editable sequence suggestion from the latest sequence, and a closed-year guard. `DateInput` holds canonical Gregorian BusinessDates; the existing `toBusinessDateInput` boundary declares Jalali when supported. No `Date`/instant conversion was added.
- Added period detail/transition API calls, organization-keyed cache entries and invalidation, exact `Close`/`Reopen`/`Seal` permission codes, per-status row actions, reason-required confirmation, and stable-code error copy. No period PATCH, deletion or `periodKind` write was added.
- Kept the inline form for existing users while adding the standalone route; both share the same form and mutation hook.
- Backend contract verified against `AccountingPeriodsController`, DTOs, `AccountingPeriodsService`, `planAccountingPeriodTransition` and `AccountingPeriodsRepository.transitionChecked`. Per the Owner decision, **backend behavior overrides the archived UI matrix**: `open → closed` via `close`; `closed → open` and `sealed → open` via `reopen`; `closed → sealed` via `seal`. Only `close` and `reopen` are blocked while the fiscal year is `sealed`; `seal` is allowed even for a sealed year. A `closed` or inactive year is **not** an independent transition guard. When the year reference cannot be read, the UI offers the period-status actions and leaves final validation to the server. Creation remains restricted to active, open years by the *different* createChecked rule. The coverage row is COMPLETE for the confirmed backend contract.
- The archive's `accounting.period.*` error family does **not** exist in the current backend: the kernel emits `Conflict`, `BusinessRuleViolation`, etc., so the UI maps actual codes rather than inventing new ones.
- The initial checkout did not contain ACC-02 lifecycle UI. While this PR was opened, ACC-02 (#211) landed on `main`; it is now integrated on this branch and the coverage row for fiscal years is COMPLETE. The initial absence was a base-revision discrepancy, not a remaining ACC-02 defect.
- A principal with `AccountingPeriod.Open` but without `FiscalYear.View` can enter the independently gated new route and supply the year ULID manually; there is no unauthorized year-list request. Known years use the select and client-side range/status hints. For a year not visible to that principal, the backend validates organization ownership, active/open status, overlap, and range; the UI never guesses those facts. This removes an accidental frontend-only permission dependency.

## TEST EXECUTION MATRIX

| Gate | Environment | Status |
| --- | --- | --- |
| Focused ACC-03 and existing master-data unit tests | Local FAST-LOCAL | Passed |
| Frontend typecheck, lint, format:check, unit tests, build | Local FAST-LOCAL | Passed locally: typecheck, lint, format:check, 739 unit tests, build (existing jsdom/Vite warnings; no new warnings evidenced) |
| Playwright browser E2E and any live DB/migration suites | CI only | Pending PR checks |

No heavy E2E/live-DB test was executed locally unless explicitly authorized.

## Remaining archive work

ACC-04…ACC-12, DOC-01…03, INV-01…09, WF-01…04, ORG-01 and XC-01 are **not implemented by this report**. The archive specifies one PR per task, but this Arena session is bound to a single fixed branch; do not mark the remaining work complete or claim a final all-task green CI based on this ACC-03 slice.
