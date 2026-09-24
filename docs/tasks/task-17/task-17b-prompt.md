# Task 17B — Accounting Account Statement Read Surface (received implementation prompt)

- **Task title:** Task 17B — Accounting Account Statement Read Surface
- **Type:** IMPLEMENTATION PROMPT (received handoff, saved verbatim per prompt §27)
- **Received:** 2026-09-25 (repository UTC+03:30 date convention)
- **Implementing session:** branch `arena/01a0d5a0-vardena`, base `4b1489d` (merge of PR #42)
- **Companions:** [`task-17b-investigation.md`](./task-17b-investigation.md),
  [`task-17b-brief.md`](./task-17b-brief.md),
  [`task-17b-owner-decision-pack.md`](./task-17b-owner-decision-pack.md),
  [`task-17b-implementation-gate.md`](./task-17b-implementation-gate.md)

> **What this file is.** The authorizing implementation handoff for the
> bounded, read-only **Account Statement** slice, received from the Repository
> Owner together with the Owner decisions D1–D7 (§4 below). It is saved before
> implementation, unchanged in substance, as the repository record of the
> authorization and of the decisions it carries. It resolves no registered
> Open Question: **OQ-25 and OQ-43 remain OPEN**; the D1–D7 selections are the
> bounded interim posture for exactly this slice (gate prerequisites P-01/P-02,
> P-03, P-05, P-10 of `task-17b-implementation-gate.md`).
>
> The implementation outcome, evidence and limitations are recorded in
> [`task-17b-implementation-report.md`](./task-17b-implementation-report.md).

---

# Task 17B — Accounting Account Statement Read Surface

## ROLE

Implementation agent for the Vardena ERP repository, acting as Senior Backend
Engineer / Accounting Domain Engineer / PostgreSQL + Prisma Engineer /
Security Engineer / Code Reviewer / Test Engineer / governance-aware
implementation agent. The Repository is the only source of truth.

## 1. TASK STATUS

A bounded implementation slice following Task 17A (Accounting Ledger Movement
Read Source), the Task 17B investigation / contract work, and Owner decisions
D1–D7. The goal is a **read-only Account Statement surface** on top of the
existing Accounting ledger.

Explicitly NOT authorized: a generic Reporting platform, all Accounting
reports, statutory/legal books, Treasury reporting.

## 2. MANDATORY PREFLIGHT

Inspect current `main` before changing any file: `STATE.md`;
`docs/accounting/task-index.md`; `docs/accounting/domain-contract.md`;
`docs/reporting-strategy.md`; `docs/tasks/task-17/brief.md` and `prompt.md`;
the Task 17B investigation/brief files; the Task 17A acceptance record and
implementation report; Task 12/13/14 implementation/acceptance/evidence;
`docs/open-questions.md`; `docs/modules.md`; ADR-0009/0026/0031/0032; the
current Accounting source tree; the Prisma schema/migrations relevant to
Accounting; the permissions registry; the organization/financial-area
authorization mechanisms; the existing ledger movement
endpoint/service/repository; the existing balance projection
service/repository/view. Verify every dependency against current `main`; do
not copy historical status from the prompt.

## 3. STOP CONDITIONS

STOP BEFORE PRODUCTION CHANGES if repository evidence contradicts D1–D7; if
Task 17B has been superseded/blocked by a newer accepted decision; if
OQ-25/OQ-43 introduce a necessary requirement with no approved bounded
interim posture; if the implementation requires cross-year carry-forward,
classification beyond Debit/Credit/Net, multi-currency/FX, unapproved
dimensions, per-user financial-area grants that do not exist, a generic
Reporting module/platform, a Report Builder, Treasury/Sales/Inventory/Party
tables as Accounting calculation sources, a new accounting source of truth,
arbitrary or user-defined SQL; if a required dependency is `READY FOR REVIEW`
rather than accepted; if a necessary schema/index change cannot be justified
by the bounded workload; or if the exact semantics cannot be implemented
without inventing an unresolved business rule. If stopped: no production
changes, document the evidence, identify the blocking decision, report
`BLOCKED — OWNER DECISION REQUIRED`, invent no temporary business rule.

## 4. OWNER DECISIONS — AUTHORITATIVE FOR THIS SLICE

The Owner has explicitly selected:

**D1 — Account Statement Scope: A** — «گردش یک حساب مشخص در یک سال مالی، با
Period اختیاری»: one specific account + one fiscal year + optional accounting
period. No multi-account consolidated statements in this task.

**D2 — Opening Balance Boundary: A** — «Opening فقط داخل همان Fiscal Year»:
opening derived only within the requested fiscal year per the accepted
Accounting balance semantics. No carry-forward from previous fiscal years; no
prior-year closing / brought-forward / opening-voucher / cross-year cumulative
invention. Cross-year carry-forward stays outside this task.

**D3 — Account Classification: A** — «فقط Debit / Credit / Net»: the statement
may expose Debit, Credit and Net only. No `account_type`, temporary/permanent
classification, nature classification beyond what is already authoritative,
statutory classification, or custom categories.

**D4 — Financial Area / Organization: A** — «Financial Area مشخص +
organization-level access limitations»: every read stays organization-scoped;
financial area is part of the bounded statement scope where required by the
existing Accounting contract. No new financial-area authorization system; no
assumed per-user financial-area grants; an arbitrary foreign financial-area
identifier is never treated as accessible.

**D5 — Fiscal Period Status: A** — «Open / Closed / Sealed are all readable»:
the statement is read-only and may inspect OPEN, CLOSED and SEALED periods.
Report execution never mutates or reopens/closes/seals anything.

**D6 — Permission:** an independent backend-enforced permission
`Accounting.AccountStatement.View`. No unrelated permission reuse, no wildcard
authorization, no frontend-only authorization.

**D7 — First Implementation Slice: A** — a bounded read-only Account
Statement. It remains a bounded Accounting read surface.

## 5. BUSINESS DEFINITION

The Account Statement answers «این حساب چه گردشی داشته است؟» and must at
minimum expose Opening, Debit movement, Credit movement, Net movement, Running
balance and Closing. Read-only; the ledger stays immutable. Incorrect
accounting is corrected through the authorized Accounting document lifecycle
(counter-document/reversal where required) — never by updating
`ledger_entries`, never by a report-side correction mechanism.

## 6. IMPORTANT DOMAIN BOUNDARY

The Account Statement is NOT a renamed Ledger Movement endpoint
(`GET /api/v1/accounting/ledger-movements`, Task 17A). It builds the bounded
statement semantics on top of the accepted Accounting sources:

```text
Opening + Debit/Credit movements = Net movement; Net movement + Opening =
Running / Closing balance
```

Accepted Decimal semantics; no second ledger; no persisted report-specific
accounting balances unless an already-approved Accounting projection is
explicitly the correct source.

## 7. SOURCE OF TRUTH

Existing Accounting sources only. Primary immutable source:
`accounting.ledger_entries`. Accepted derived source:
`accounting.account_balance_projections` and its accepted derived
view/semantics where applicable. Follow ADR-0031 and the current Task 12
implementation exactly. The statement must remain reconcilable to immutable
ledger facts. No Sales/Inventory/Treasury/Purchasing/CRM reads; no duplicate
accounting calculations outside Accounting.

## 8. ACCOUNT STATEMENT SEMANTICS

For a request (organization, financial area, fiscal year, account, optional
accounting period) return a bounded read model containing:

- **Header / scope:** organization scope, financial area, fiscal year, account
  identity, optional period identity, account code/name where already
  available, fiscal year / period labels where already available.
- **Opening:** the derived balance at the beginning of the requested statement
  scope per the accepted intra-fiscal-year semantics. For the first period of
  a fiscal year, respect the accepted Task 12 behavior. Never cross the
  fiscal-year boundary.
- **Movement rows:** for each applicable immutable ledger movement — where
  available and already supported — document date, posting timestamp,
  voucher/document number, line number, description/reference metadata,
  debit, credit, net, running balance, and the source document identifier for
  traceability where safely available. Invent no source metadata.
- **Totals:** opening, total debit, total credit, net movement, closing. All
  monetary values preserve exact Decimal semantics.

## 9. NET SEMANTANTICS

No JavaScript floating point. Use the repository's established
Decimal/numeric conventions. For a debit-positive presentation
`net = debit − credit` and `closing = opening + net` — only if consistent with
the accepted Task 17B contract and current repository conventions. No
inferred sign convention from arbitrary account classification, no rounding,
no binary floats; transport money as the repository's exact Decimal string
representation.

## 10. PERIOD FILTER

Accounting period is optional. Omitted: the statement covers the selected
fiscal year within the accepted intra-year boundary. Supplied: restrict
movements to the selected period; calculate opening per the accepted
period-sequence semantics; never include movements outside the requested
fiscal year; never silently use another fiscal year to construct opening.
Validate the period belongs to the requested organization / financial area
where applicable / fiscal year. Foreign identifiers must not bypass
organization scope.

## 11. DATE / ORDER SEMANTICS

Use stored Accounting facts; invent no new accounting date. Respect the
`document_date` / `posting_timestamp` / fiscal year / accounting period
distinction. Deterministic statement ordering; stable when multiple ledger
rows share a business date; reuse the existing deterministic ledger ordering
conventions where possible; no arbitrary client-controlled SQL ordering.

## 12. FILTERING

Definition-whitelisted filters only, limited to the approved Account Statement
contract and current source — at minimum: account, fiscal year, optional
period, financial area, and a document/business date range only if explicitly
supported by the accepted contract. No generic filter engine; no arbitrary
field names, SQL expressions, joins, WHERE fragments or user SQL. All values
parameterized.

## 13. PAGINATION

Movement rows must be bounded; use the repository's existing pagination
conventions; no unbounded `SELECT *` style report endpoint. Totals must be
independent of page size: calculated with the same exact scope predicate, not
from the current page only. The page query and the total/summary query use
consistent organization/account/year/period predicates.

## 14. PERFORMANCE

Before adding an index: inspect existing indexes, the actual query shape,
whether current indexes suffice, and expected dataset size/selectivity; only
introduce a migration/index if evidence demonstrates necessity for the
bounded slice. No speculative indexes, no ledger schema redesign, no
reporting database, no Redis, no generic materialized reporting layer. If a
required index needs a separate architectural/performance decision: STOP and
report instead of silently expanding scope.

## 15. SECURITY

Backend authorization must enforce Permission + Organization Scope +
Financial Area Scope + Fiscal Year / Period Scope + Account Scope as
applicable. A foreign organization / account / fiscal year / period /
financial-area identifier must never leak data. Follow the repository's
established 404/403 posture exactly; no new authorization philosophy; never
trust frontend-provided organization context.

## 16. SOURCE DOCUMENT TRACEABILITY

Expose source-document traceability where the existing Accounting domain
already supports it. The report must NOT edit source documents or ledger
entries, reverse anything automatically, create correction documents, or
create accounting entries. If no safe source-document navigation contract
exists, invent no cross-module navigation framework — expose only the existing
safe identifier/reference needed for future UI navigation.

## 17. TREASURY BOUNDARY

No Treasury reports: no Cash Book / دفتر صندوق, cash or bank operational
reports, receipts/payments/cheque reports, bank reconciliation, Treasury
dashboards. No Treasury tables queried or created.

## 18. REPORTING BOUNDARY

No generic Reporting module, Report Builder, custom/user-defined reports,
arbitrary query builder, dashboard engine, Excel/CSV/PDF/print engines, legal
or electronic books (دفاتر قانونی), Iranian statutory report engine, Trial
Balance, Income Statement, Balance Sheet, Cash Flow Statement, budget,
Treasury, Sales, Inventory or Party/AR/AP operational reports. The output
pipeline is a later shared capability and is not duplicated here.

## 19. NO DUPLICATE REPORT ENGINES

Account Statement is the canonical Accounting account-movement inquiry.
Future presentation variants (Account Performance/Activity reports) must
consume the same underlying Accounting read semantics; no multiple
calculations of the same account movement.

## 20. "ACCOUNT OVERVIEW / مرور حساب"

No separate accounting calculation named "Account Overview" in this task. The
future «مرور حساب» presentation must consume the same approved Accounting read
sources and must never become a second accounting truth.

## 21. ACCOUNTING MASTER DATA BOUNDARY

No duplicate customer/supplier/party/bank/employee/inventory master inside
Accounting. Use the existing Accounting account references; party enrichment
belongs to the owning domain and a later approved contract.

## 22. API DESIGN

Follow the existing Accounting REST conventions. Preferred bounded surface:
`GET /api/v1/accounting/account-statements` (or the established equivalent).
No multiple aliases; no POST report-generation endpoint; read-only; typed
response contract documented in OpenAPI.

## 23. PERMISSION

Register and enforce `Accounting.AccountStatement.View` using the existing
permission registry conventions. Do not modify unrelated permission
synchronization semantics; no wildcard permissions; add focused authorization
tests.

## 24. TEST REQUIREMENTS

Focused tests for: domain/calculation (opening, debit, credit, net, running
balance, closing, exact Decimal, zero movement, debit movement, credit
movement, mixed debit/credit movement); fiscal-year boundary (first period
opening, middle period opening, final period, no cross-year carry-forward);
period filter (none, explicit, foreign period rejected, period from another
fiscal year rejected); organization isolation (valid organization, foreign
organization, foreign account, foreign fiscal year, foreign period, foreign
financial area); permission (granted, denied); period status (OPEN, CLOSED,
SEALED readable; execution does not mutate status); pagination (first page,
subsequent page, max page size, bounded results, deterministic ordering);
totals (`opening + net = closing` for representative fixtures; totals
independent from page size); and regression (Account Statement does not
mutate ledger entries, vouchers, accounts, periods, balance projections).

## 25. LIVE POSTGRESQL

Where the repository already provides live PostgreSQL test infrastructure,
use it for the applicable Account Statement behavior. Do not claim
PostgreSQL concurrency safety from PGlite alone. If a required PostgreSQL
execution cannot be performed locally: document the limitation, rely on CI
where available, never relabel unavailable execution as passed. Do not delete
or skip required tests to make CI green.

## 26. QUALITY GATES

Run applicable `npm run format:check`, `npm run lint`, `npx tsc --noEmit`,
`npm test`, `npm run build`, `npx prisma validate`, and the relevant
Accounting E2E / live PostgreSQL E2E / migration rehearsal / focused Account
Statement tests, with appropriate timeouts. If a suite hangs: capture the
command and timeout behavior, isolate the affected suite, run focused tests,
report the limitation honestly. Do not remove tests.

## 27. DOCUMENTATION

Save this prompt under the established Task 17 documentation structure before
implementation (this file). After implementation, produce the implementation
report under `docs/tasks/task-17/` following the repository's established
naming conventions, stating: approved scope, implemented endpoints,
permission, source of truth, opening semantics, period semantics,
organization isolation, financial-area handling, Decimal semantics,
pagination, tests actually executed, CI evidence, known limitations,
intentionally deferred capabilities. Do not claim OQ-25 or OQ-43 resolved; do
not promote ADR status; do not change unrelated task statuses.

## 28. STATE / TASK INDEX

Update `STATE.md` and `docs/accounting/task-index.md` only with
evidence-backed facts. Do not mark Task 17B `ACCEPTED`; the correct status
after successful implementation is `READY FOR REVIEW`. Only the
Owner/Reviewer can produce `ACCEPTED`. Do not self-accept.

## 29. GIT DISCIPLINE

Work on a dedicated branch; never modify `main` directly; keep the diff
narrow; no drive-by refactors, reformatting, renames, dependency upgrades or
unrelated migration changes. Commit with a clear message such as
`feat(accounting): add account statement read surface`. Push the branch and
open/update the appropriate PR.

## 30–32. CHECKLIST, REVIEW REPORT FORMAT, MOST IMPORTANT RULE

The implementation checklist (governance / domain / security / data integrity
/ performance / scope / tests / documentation) and the final review report
format (Status `READY FOR REVIEW`, Branch, Commit, PR, Implemented, API,
Permission, Source of Truth, Semantics, Security, Tests table, Deferred, Known
limitations, Governance statements for Task 17B / OQ-25 / OQ-43 / no generic
Reporting Foundation / no Treasury reporting, then a review request) are as
received; the report follows them. The most important rule: optimize for
Accounting correctness, data integrity, organization isolation, security,
exact Decimal semantics, deterministic behavior, architectural boundaries, a
small reviewable diff, evidence-backed documentation and no scope creep. If
any requirement cannot be implemented without inventing a business rule,
STOP and report it. **Never silently invent an accounting rule.**

---

## Version record

- 2026-09-25 — saved before implementation (Task 17B Account Statement slice
  on `arena/01a0d5a0-vardena`). Documentation only; authorizes exactly the
  bounded slice described above with Owner decisions D1–D7. No Open Question
  is resolved or reclassified by this file.
