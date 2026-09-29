# FE-UX-09/10 Reporting Workspace audit and implementation notes

## Status

**BLOCKED — implementation is present but URL ownership is not yet review-ready.**

The existing frontend contains three report routes and server-backed query adapters. The shared report state hook has been extended to map report filters, page, page size, and server sort to search parameters. A follow-up is required to hydrate React Hook Form controls from `urlFilters` and to retain the legacy hook's router-free unit-test mode.

## Backend capability audit

| Report | Endpoint / method | Permission | Supported query | Pagination | Sorting | Drill-down |
|---|---|---|---|---|---|---|
| Account Statement | `GET /api/v1/accounting/account-statements` | `Accounting.AccountStatement.View` | organizationId, accountId, fiscalYearId; optional financialAreaId, accountingPeriodId, accountHierarchyId, accountCode, accountName | Supported (`page`, `pageSize`) | Contract gap: fixed legal-book order; `sort` is rejected | Partial: rows expose voucher/document identity, but document navigation is only available when the existing document-view permission is present |
| General Ledger | `GET /api/v1/accounting/general-ledger` | `Accounting.GeneralLedger.View` | organizationId, financialAreaId, fiscalYearId; optional accountingPeriodId, accountId, accountHierarchyId, accountCode, accountName, dateFrom, dateTo | Supported | Supported, allow-listed documentDate, postingTimestamp, documentId, ledgerLineId, accountCode, accountName, accountId | Partial: existing document route is used only where the backend document read is authorized |
| Trial Balance | `GET /api/v1/accounting/trial-balance` | `Accounting.TrialBalance.View` | organizationId, financialAreaId, fiscalYearId; optional accountingPeriodId, accountId, accountHierarchyId, accountCode, accountName, dateFrom, dateTo | Supported | Supported, allow-listed accountCode, accountName, accountId, opening, debit, credit, periodNet, closing | CONTRACT GAP for account statement navigation; no unsupported destination is fabricated |

All report amounts are API Decimal strings. The frontend does not calculate totals or balances.

## Capability matrix

- Three report surfaces: **SUPPORTED**.
- Financial area, fiscal year, period, account and declared date filters: **SUPPORTED** per endpoint above.
- Server pagination: **SUPPORTED**.
- Server sorting: **PARTIALLY SUPPORTED** (GL/TB only; statement fixed order).
- Export, print, arbitrary report builder: **CONTRACT GAP**.
- Generic drill-down: **CONTRACT GAP** unless a concrete existing document read route and permission are available.

## Known limitations

- URL hydration must reset visible form controls after initial load and browser Back/Forward; the current query and result are URL-driven, but the form synchronization follow-up remains.
- Invalid server-facing URL values must be surfaced as contract validation errors rather than silently normalized; this needs focused tests.
- Local verification is pending because frontend dependencies are not installed in this checkout (`tsc: not found`).

No backend files, migrations, endpoints, permissions, or dependencies were added.
