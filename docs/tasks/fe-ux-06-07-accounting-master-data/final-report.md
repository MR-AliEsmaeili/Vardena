# FE-UX-06/07 — Accounting Information Architecture & Master Data

## FE-UX-06/07 STATUS

READY FOR REVIEW

## 1. Information Architecture

Accounting now exposes only implemented surfaces:

- Accounting overview
- Master data: Financial Areas, Fiscal Years, Accounting Periods, Chart of Accounts, Accounts
- Reports: Account Statement, General Ledger, Trial Balance

Documents are not presented as a standalone module because no document workspace was implemented. Treasury and other future modules are absent. All routes and navigation entries use actual endpoint permissions.

## 2. Financial Areas

**Classification: SUPPORTED (read flow); PARTIALLY SUPPORTED (administration).** A server-paged, server-filtered list shows code, title, default designation and active status for the selected organization. Loading, success, empty, normalized error, retry and route-level permission states are implemented. The UI does not call the default area an “active selection.”

## 3. Fiscal Years

**Classification: SUPPORTED (read flow); PARTIALLY SUPPORTED (administration).** The list supports backend search, financial-area scope, lifecycle status, server paging and the exact `open`, `closed`, `sealed` vocabulary rendered as باز، بسته، مهروموم‌شده. Dates remain contract-defined ISO date-only values. The page explains Financial Area → Fiscal Year → Period. Backend create/edit/close/reopen/seal/unseal operations exist but are not exposed in this read-focused UI.

## 4. Accounting Periods

**Classification: SUPPORTED (read flow); PARTIALLY SUPPORTED (administration).** Periods show sequence, title, dates, status, fiscal year and financial area using API fields/reference responses. Filtering uses actual `fiscalYearId` and `status` parameters and server paging. Backend open/close/reopen/seal operations exist; no lifecycle control was fabricated where the frontend confirmation/reason workflow has not been implemented.

## 5. Chart of Accounts

**Classification: PARTIALLY SUPPORTED.** The existing read-only chart projection renders the backend `parentId` hierarchy, arbitrary numeric depth, expand/collapse, account code/title/level/nature/postability/activity, loading, empty and error states. It never parses account codes or assumes a fixed Detail depth. Loading is bounded to ten backend pages (500 rows each); truncation is disclosed. The API has no child/subtree cursor contract, so the current bounded flat projection cannot provide true node-by-node lazy loading.

## 6. Accounts

**Classification: SUPPORTED (list/detail reads).** The account list is server-paged and uses only backend-supported `search`, `level`, `isPostable`, `page`, `pageSize`, and fixed allowed sorting. User-visible list state is stored in URL search parameters. Account detail displays API-owned code, title, level, parent identity, nature, account type, postability and activity. Postable accounts offer a transition to Account Statement with the account preselected.

Account create/edit/enable/disable/unlink is **PARTIALLY SUPPORTED**: backend APIs exist, but this implementation does not expose administration controls. No fake CRUD or success state was added.

## 7. Account Statement

**Classification: SUPPORTED.** Account Detail links to the existing backend-computed Account Statement. The linked account is prefilled; fiscal year remains an explicit required user selection. Existing statement totals and running balances remain backend-owned; React performs no accounting aggregation.

## 8. Permissions

Actual identifiers used:

- `Accounting.FinancialArea.View`
- `Accounting.FiscalYear.View`
- `Accounting.AccountingPeriod.View`
- `Accounting.Account.View`
- `Accounting.AccountStatement.View`
- `Accounting.GeneralLedger.View`
- `Accounting.TrialBalance.View`
- `Accounting.Document.View` (existing dashboard)
- `Organization.Organization.View` (existing organization resolution)

Frontend checks are route/navigation UX gates only; backend authorization remains authoritative.

## 9. Organization Isolation

Every new query key starts with `['accounting', organizationId, ...]`, and every API request carries the selected `organizationId`. Existing organization switching evicts queries belonging to the previous organization. New pages render behind `OrganizationGate`, so unresolved scope cannot initiate master-data reads.

## 10. UX / Persian Feedback

Visible copy comes from the central dictionary. Domain terminology distinguishes حوزه مالی، سال مالی and دوره مالی. Lifecycle enums are mapped to Persian rather than exposed raw. Master-data errors use operation-specific Persian copy and retry, never backend exception text. ISO dates and canonical account codes retain LTR direction. Existing loading, empty, error, page-header, table, badges and pagination primitives are reused.

## 11. Contract Gaps

- **CONTRACT GAP:** No backend concept/endpoint for selecting a session-wide “active financial area.” `isDefault` is displayed only as the organization default.
- **CONTRACT GAP:** Chart Tree has a bounded flat paginated projection but no parent/children cursor or subtree endpoint for scalable lazy expansion. The UI discloses truncation and does not fetch unbounded data.
- **CONTRACT GAP:** No account-level all-years turnover endpoint. Account Statement requires one backend-defined fiscal year; the UI does not aggregate years locally.
- **CONTRACT GAP (OpenAPI annotation):** Existing generated types require documented frontend refinements for paginated schema name collisions, nullable fields and Account Statement inline schemas; runtime contracts exist.
- **PARTIALLY SUPPORTED:** Financial Area, Fiscal Year, Accounting Period and Account administration mutations exist in the backend but are not exposed by this read-focused implementation. Their forms and audited confirmation/reason UX remain frontend work, not contract gaps.
- **FUTURE PRODUCT DECISION:** Persian calendar presentation remains unresolved; API dates stay ISO.

## 12. Tests

New:

- `frontend/src/app/accounting-navigation.test.ts`
  - supported Accounting master-data navigation and actual view permissions
  - exclusion of Treasury, Sales and Purchasing
- `frontend/src/features/accounting/master-data/master-data-pages.test.tsx`
  - organization-scoped Financial Area success
  - explicit empty state
  - semantic error copy, raw backend-message suppression and retry

Existing relevant coverage retained:

- `frontend/src/app/layouts/app-shell.test.tsx` — navigation gating and organization switching/cache eviction
- `frontend/src/app/routes/protected-routing.test.tsx` — protected/permission routes
- `frontend/src/features/accounting/chart-tree/build-chart-tree.test.ts` — hierarchy, missing parent, arbitrary depth, empty
- `frontend/src/features/accounting/chart-tree/chart-tree-node-row.test.tsx` — rendered account semantics
- `frontend/src/features/accounting/account-statement/account-statement-page.test.tsx` — required scope and server-computed output
- `frontend/src/features/accounting/shared/report-query.test.ts` — exact query contracts and organization ownership

Local full suite result after the final navigation coverage: 25 files, 141 tests passed.

## 13. CI

No CI run was started from this workspace. Local verification is recorded in the final response and this report; expensive E2E was not run.

## 14. Documentation

- `docs/tasks/fe-ux-06-07-accounting-master-data/final-report.md`

No ADR was created; the discovered product choices remain explicitly classified.

## 15. Scope Confirmation

- No backend changes
- No Prisma changes
- No migrations
- No fake API
- No mock accounting data in production
- No Redux/Zustand/MobX introduction
- No Treasury
- No unrelated refactor

FE-UX-06/07 STATUS: READY FOR REVIEW
