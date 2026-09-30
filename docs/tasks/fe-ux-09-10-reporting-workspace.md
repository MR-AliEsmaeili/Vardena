# FE-UX-09/10 Reporting Workspace — Final Correction

## Status

**VERIFICATION PENDING** — local verification passes; GitHub CI must pass before the PR can be declared ready.

## Implemented

- Stable unconditional Router hook execution in `use-report-query-state.ts`.
- Explicit report URL codecs with allowed keys, required scope, and primitive date validation.
- Account Statement requires fiscal year and account before execution.
- General Ledger and Trial Balance require financial area and fiscal year before execution.
- Incomplete or invalid URL filter state hydrates visible controls but does not become an executable TanStack Query state.
- URL-owned filters, page, page size, and server sorting.
- RHF reset from URL state on deep link, navigation, refresh/remount, and Clear.
- Apply, pagination, page-size, sorting, and Clear preserve unrelated URL parameters.
- GL/TB sorting is constrained to backend allow-lists; Account Statement does not send sorting.
- Organization remains runtime context and is not serialized.

## Backend capability audit

| Report            | Endpoint                                    | Permission                         | Filters                                                                                                                                               | Pagination | Sorting                          | Drill-down                                                                  |
| ----------------- | ------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------- | --------------------------------------------------------------------------- |
| Account Statement | `GET /api/v1/accounting/account-statements` | `Accounting.AccountStatement.View` | organizationId, accountId, fiscalYearId; optional financialAreaId, accountingPeriodId, accountHierarchyId, accountCode, accountName                   | Supported  | Fixed legal-book order           | Generic drill-down is CONTRACT GAP; existing document identity is retained. |
| General Ledger    | `GET /api/v1/accounting/general-ledger`     | `Accounting.GeneralLedger.View`    | organizationId, financialAreaId, fiscalYearId; optional accountingPeriodId, accountId, accountHierarchyId, accountCode, accountName, dateFrom, dateTo | Supported  | Allow-listed backend fields only | Generic drill-down is CONTRACT GAP.                                         |
| Trial Balance     | `GET /api/v1/accounting/trial-balance`      | `Accounting.TrialBalance.View`     | organizationId, financialAreaId, fiscalYearId; optional accountingPeriodId, accountId, accountHierarchyId, accountCode, accountName, dateFrom, dateTo | Supported  | Allow-listed backend fields only | Account-to-statement navigation is CONTRACT GAP.                            |

Export, print, report builder, and new report types remain CONTRACT GAP/FUTURE.

## URL state contract

| Surface           | Required keys                 | Optional keys                                                             | Invalid state behavior                                                                                      |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Account Statement | fiscalYearId, accountId       | financialAreaId, accountingPeriodId                                       | visible values may hydrate, but no API query until required keys exist and values pass primitive validation |
| General Ledger    | financialAreaId, fiscalYearId | accountingPeriodId, accountId, accountCode, accountName, dateFrom, dateTo | incomplete scope is non-executable; malformed dates are non-executable                                      |
| Trial Balance     | financialAreaId, fiscalYearId | accountingPeriodId, accountId, accountCode, accountName, dateFrom, dateTo | same as General Ledger                                                                                      |
| All paged reports | —                             | page, pageSize                                                            | non-positive/non-numeric values normalize to UI-safe defaults                                               |
| GL/TB sorting     | —                             | sort                                                                      | unsupported fields/directions are not sent; default sort remains active                                     |

`organizationId` is never serialized. Unrelated search parameters are preserved. Backend remains authoritative for entity existence, ownership, permissions, and accounting validity.

## Test evidence

- `frontend/src/features/accounting/shared/report-query.test.ts`: 12 tests, including Router-backed state transitions, incomplete scope, statement required scope, malformed dates, and report-specific codecs.
- `frontend/src/features/accounting/account-statement/account-statement-page.test.tsx`: 2 tests, including required-scope no-call behavior and server result rendering.
- `frontend/src/features/accounting/general-ledger/general-ledger-page.test.tsx`: 6 tests, including initial non-execution, empty/error states, server pagination, and allow-listed sorting.
- `frontend/src/features/accounting/trial-balance/trial-balance-page.test.tsx`: 1 test covering initial non-execution, required-scope gating, and exact server query mapping.

## Verification

- `npm ci --ignore-scripts`: passed
- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm run format:check`: passed
- `npm test`: passed — 32 files, 212 tests
- `npm run build`: passed
- GitHub CI: pending

## Remaining blockers

1. CI result is pending.
2. CI result is pending; broader Back/Forward/permission matrix coverage remains constrained by the existing page-test harness.

No Backend, Prisma, dependency, global-state, financial-calculation, permission, organization-isolation, Treasury, Sales, Purchasing, Tax, export, print, or report-builder changes were made.
