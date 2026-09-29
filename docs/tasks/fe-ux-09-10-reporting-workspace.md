# FE-UX-09/10 Reporting Workspace

## Status

**VERIFICATION PENDING** — correction applied to PR #95; local frontend verification passes. GitHub CI must complete before review readiness is claimed.

## Implemented

- Stable-hook `useReportQueryState` architecture: router hooks are always invoked in the same order.
- Report-specific URL codecs for Account Statement and the shared ledger scope used by General Ledger and Trial Balance.
- URL-owned filters, page, page size, and sorting.
- RHF hydration from URL state on deep links, Back/Forward, refresh, and Clear.
- Apply resets page and updates only report-owned search keys.
- Page size and sorting reset page to one.
- Invalid/non-positive page and page size values use the UI-safe defaults; unsupported sort fields are filtered by the report's allow-list and do not reach the API.
- Organization remains application context and is not copied into the URL.
- Decimal values remain server-authoritative strings.

## Backend capability audit

| Report | Endpoint | Permission | Filters | Pagination | Sorting | Drill-down / limitations |
|---|---|---|---|---|---|---|
| Account Statement | `GET /api/v1/accounting/account-statements` | `Accounting.AccountStatement.View` | organizationId, accountId, fiscalYearId; optional financialAreaId, accountingPeriodId, accountHierarchyId, accountCode, accountName | Supported | Fixed legal-book order; no sort parameter | Document identity is exposed where the existing document permission/route supports it. Generic account drill-down is a CONTRACT GAP. |
| General Ledger | `GET /api/v1/accounting/general-ledger` | `Accounting.GeneralLedger.View` | organizationId, financialAreaId, fiscalYearId; optional accountingPeriodId, accountId, accountHierarchyId, accountCode, accountName, dateFrom, dateTo | Supported | Supported allow-list: documentDate, postingTimestamp, documentId, ledgerLineId, accountCode, accountName, accountId | Existing document navigation only; arbitrary drill-down is a CONTRACT GAP. |
| Trial Balance | `GET /api/v1/accounting/trial-balance` | `Accounting.TrialBalance.View` | organizationId, financialAreaId, fiscalYearId; optional accountingPeriodId, accountId, accountHierarchyId, accountCode, accountName, dateFrom, dateTo | Supported | Supported allow-list: accountCode, accountName, accountId, opening, debit, credit, periodNet, closing | Account-to-statement navigation is a CONTRACT GAP. |

Export, print, report builder, and new report types are CONTRACT GAP / FUTURE PRODUCT DECISION and are not exposed.

## URL state matrix

| Report | URL key | UI control | API parameter | Default/reset | Validation |
|---|---|---|---|---|---|
| Statement | financialAreaId, fiscalYearId, accountingPeriodId, accountId | Area, year, period, account picker | Same names | Empty; Clear removes | Backend validates identifiers and scope relationships |
| General Ledger / Trial Balance | financialAreaId, fiscalYearId, accountingPeriodId, accountId, accountCode, accountName, dateFrom, dateTo | Scope, account, text/date filters | Same names | Empty; Apply/page-size/sort reset page | Date syntax is UI validated; accounting validity remains server-authoritative |
| All paged reports | page, pageSize | Server pagination | Same names | page 1, page size 50; Clear removes | Positive numeric UI-safe normalization |
| GL / Trial Balance | sort | Table sort controls | Same value | Report default sort; changes reset page | Allow-listed fields only |
| Statement | sort | No control | Not sent | Fixed backend order | Unsupported sort is ignored and never sent |

Unrelated query parameters are preserved.

## Tests and verification

Existing focused report tests remain green:

- `src/features/accounting/shared/report-query.test.ts` — 9 tests, including router-context state transitions.
- `src/features/accounting/account-statement/account-statement-page.test.tsx` — 2 tests.
- `src/features/accounting/general-ledger/general-ledger-page.test.tsx` — 6 tests, including pagination and server sorting.
- Full frontend suite: 31 files, 208 tests passed.

Commands passed locally:

- `npm ci --ignore-scripts`
- `npm run lint`
- `npm run typecheck`
- `npm run format:check`
- `npm test`
- `npm run build`

## Remaining Contract Gaps

- No backend-supported generic report drill-down contract exists.
- Account Statement server sorting is intentionally unavailable.
- Export and print are not implemented because no backend capability was found.
- GitHub CI result is pending.
