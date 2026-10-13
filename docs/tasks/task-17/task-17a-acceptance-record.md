# Task 17A — Review & Acceptance Record

**Status:** ACCEPTED (2026-09-25)  
**Task Title:** Task 17A — Accounting Ledger Movement Read Source  
**Pull Request:** #39 (`feat(accounting): add ledger movement read source`) — Merged into `main` (`130fab9`)  
**Authorization:** Explicit Owner Authorization & Acceptance (Effective 2026-09-25)

---

## 1. Owner Decision & Executive Summary

The Repository Owner explicitly authorizes and accepts the bounded implementation introduced by PR #39 as **Task 17A**.

This authorization applies **ONLY** to the narrow, production-grade Accounting-owned ledger movement read source:
- Read-only access to immutable posted ledger entries (`accounting.ledger_entries`).
- One versioned REST GET endpoint (`GET /api/v1/accounting/ledger-movements`).
- Organization-scoped access enforced via deployment pin and `requireUsableOrganization` (returning 404 for foreign/unknown tenant contexts).
- Permission-enforced access (`Accounting.LedgerMovement.View`).
- Parameterized allow-listed filtering (financial area, fiscal year, period, account, voucher, exact serial, inclusive business-date window).
- Bounded pagination (`DEFAULT_PAGE = 1`, `DEFAULT_PAGE_SIZE = 100`, `MAX_PAGE_SIZE = 500`).
- Allow-listed deterministic sorting (`documentDate`, `postingTimestamp`) completed by stable tie-breakers (`voucher_number`, `line_no`, `id`).
- Exact Decimal string serialization (`numeric(18,2)` formatted as decimal strings).

This authorization **DOES NOT**:
- Close **OQ-25** (Chart / Report Layouts remain OPEN).
- Close **OQ-43** (Iranian Statutory / Legal Reporting requirements remain OPEN).
- Authorize the complete **Task 17** (Task 17 remains FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS).
- Authorize a generic Reporting Foundation or Report Builder.
- Authorize Excel/CSV/PDF/Print export engines or formatting.
- Authorize Iranian Electronic Books (`دفاتر قانونی / الکترونیکی`).
- Authorize Trial Balance (`تراز آزمایشی`) implementation.
- Authorize Income Statement (`سود و زیان`) or Balance Sheet (`ترازنامه`) statements.
- Authorize aggregation or book configuration.
- Authorize any new reporting platform or frontend components.

---

## 2. Governance Reconciliation & Deviations Accepted

### 2.1 Non-Statutory, Ledger-Native Read Source
Task 17A provides a non-statutory, ledger-native read source over the existing Accounting ledger (`accounting.ledger_entries`). It does not create a second accounting truth, report tables, materialization views, or statutory book structures.

### 2.2 Rationale for Accepting the Narrow Endpoint Deviation
`docs/tasks/task-17/next-step-recommendation.md` originally recommended a source-only slice without a public endpoint to avoid dormant scaffolding. The Owner accepted the narrow `GET /api/v1/accounting/ledger-movements` endpoint because it provides immediate, production-grade utility for ledger movement inquiries without introducing dormant scaffolding or complex reporting abstractions.

### 2.3 Rationale for Accepting the New Read Permission (`Accounting.LedgerMovement.View`)
The Owner accepted registering `Accounting.LedgerMovement.View` as the 35th permission in the Accounting registry:
- `Accounting.Balance.View` governs the rebuildable turnover projection (`account_balance_projections`), a derived materialization (AC-D-31).
- `Accounting.Document.View` governs the voucher aggregate (header + lines, `draft → temporary → final`).
- `Accounting.LedgerMovement.View` specifically governs access to the immutable posted ledger entry source. Registering a dedicated code avoids silently widening existing permission scopes while maintaining explicit security boundaries.

### 2.4 Status Alignment
- **Task 17A:** ACCEPTED
- **Task 17:** NOT COMPLETE (FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS)
- **OQ-25:** OPEN
- **OQ-43:** OPEN
- **Reporting Foundation:** NOT IMPLEMENTED

---

## 3. Verification & Evidence Summary

All 10 non-negotiable domain rules and technical constraints were verified against the merged codebase on `main` (`130fab9`):

| Invariant / Requirement | Status | Verification Basis |
|---|---|---|
| Read-only ledger movement access | PASS | `GET /api/v1/accounting/ledger-movements` only; no POST/PATCH/DELETE route |
| Existing Accounting ledger as single source of truth | PASS | Queries `accounting.ledger_entries` directly; no second truth or report table |
| Posted-only behavior by construction | PASS | `ledger_entries` rows exist solely for `final` vouchers; pre-final vouchers have no rows |
| Organization isolation | PASS | Mandatory `organizationId`, deployment pin asserted, resolved via `requireUsableOrganization` (404) |
| Permission enforcement | PASS | Guarded by `@Permissions(LEDGER_MOVEMENT_PERMISSIONS.VIEW)` |
| Bounded pagination | PASS | `PageQueryDto` enforces default 100, max 500 limit |
| Allow-listed deterministic sorting | PASS | `documentDate`, `postingTimestamp` with stable tie-breakers: `voucher_number`, `line_no`, `id` |
| Exact Decimal string transport | PASS | `canonicalizeAmount` / `renderDecimal` format `numeric(18,2)` values as exact strings |
| No cross-module ownership violation | PASS | Owned entirely within Accounting module; consumes no foreign tables |
| No schema / migration / index additions | PASS | Zero DDL changes; operates on existing schema indexes |

### Executed Tests Summary
- **Unit Tests:** 19 movement-specific tests passed (`domain/ledger-movement.spec.ts`, `application/ledger-movements.service.spec.ts`); 1043 total unit tests passed (`npm test`).
- **HTTP E2E Tests:** 28 HTTP specs passed (`test/accounting-ledger-movements.e2e-spec.ts`).
- **Live PostgreSQL E2E Tests:** 13 live specs executed on `postgres:16` in CI runs `36048743757` and `36049218321` (`test/ledger-movements-live.e2e-spec.ts`).
- **Quality Gates:** `tsc --noEmit`, `prettier --check .`, `oxlint .` (0 errors), and `nest build` passed cleanly.
