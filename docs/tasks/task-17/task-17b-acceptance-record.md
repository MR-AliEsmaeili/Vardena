# Task 17B — Review & Acceptance Record

**VERDICT: ACCEPTED**

**Status:** ACCEPTED (2026-09-25)  
**Task Title:** Task 17B — Accounting Account Statement Read Surface  
**Pull Request:** #43 (`feat(accounting): add account statement read surface (Task 17B)`) — Merged into `main` (`b10e007`)  
**Merged head:** `1ec996e` (implementation commit `9ee46f7`; documentation `8335556`; live-fixture calendar fix `c57a1a1`; CI-evidence documentation `1ec996e`)  
**Acceptance authority:** Repository Owner / Reviewer (`MR-AliEsmaeili`) — the same authority that reviewed and merged PR #43  
**Authorization basis:** Owner decisions **D1–D7** recorded in `docs/tasks/task-17/task-17b-prompt.md` (saved before implementation); implementation gate P-10 authorized the `Accounting.AccountStatement.View` vocabulary addition

---

## 1. Owner Decision & Executive Summary

The Repository Owner/Reviewer reviewed PR #43 **before merge** and accepts the bounded
implementation it introduced as **Task 17B — Accounting Account Statement Read Surface**.
PR #43 is **MERGED** into `main` in merge commit `b10e007`; the implementation is now the
accepted state of `main`.

This acceptance applies **ONLY** to the narrow, read-only Accounting-owned account
statement slice:

- The canonical account-movement calculation over the immutable posted ledger
  (`accounting.ledger_entries`): opening, debit/credit/net movement rows with running
  balances, and closing — derived per request, never persisted.
- One versioned REST GET endpoint (`GET /api/v1/accounting/account-statements`) and no
  other HTTP method.
- **D1** — scope is ONE account + ONE fiscal year + optional accounting period;
  non-postable accounts answer 422; no multi-account or consolidated statement.
- **D2** — opening balance is **intra-fiscal-year and sequence-based** (a whole-year
  window opens at `0`; a period opens at Σ(debit − credit) of the lower-`sequence`
  periods of the same fiscal year). **No cross-year carry-forward was introduced.**
- **D3** — **Debit / Credit / Net only**, debit-positive, exact Decimal strings
  (`net = debit − credit`, `closing = opening + net`). **No account classification,
  account nature, temporary/permanent category or statutory column set is presented.**
- **D4** — organization-scoped and financial-area-scoped (the fiscal year's area,
  one area per request). **No new per-user financial-area authorization system was
  introduced**; the OQ-40 posture is unchanged.
- **D5** — OPEN / CLOSED / SEALED periods and years all remain readable; status is
  echoed in the scope and is never a read filter. **The read surface does not mutate
  period or fiscal-year state.**
- **D6** — the independent permission `Accounting.AccountStatement.View` (36th
  Accounting code), enforced route-level **and** at the service entry (ADR-0016 double
  enforcement); deliberately not satisfied by `Accounting.LedgerMovement.View` or
  `Accounting.Balance.View`.
- **D7** — a bounded read-only Account Statement: bounded pagination
  (`page` default 1, `pageSize` default 100, hard max 500), window-wide
  page-independent totals, running balance continuous across pages, fixed statement
  order `documentDate,voucherNumber,lineNo,id`, and ONE `REPEATABLE READ` read-only
  transaction per request.

This acceptance **DOES NOT**:

- Close **OQ-25** (Chart of Accounts / Report Layouts remain **OPEN**).
- Close **OQ-43** (Iranian Statutory / Legal Reporting requirements remain **OPEN**).
- Complete **Task 17** — Task 17 remains **FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN
  QUESTIONS (OQ-25, OQ-43)** and is **NOT complete**.
- Authorize or record acceptance of any future Task 17 slice (including Task 17C or any
  Reporting implementation).
- Authorize a generic Reporting Foundation, Reporting module, Report Builder, report
  registry or aggregation platform (ADR-0009 / `docs/reporting-strategy.md` preserved).
- Authorize Excel/CSV/XLSX/PDF/Print export engines, formatting or templates.
- Authorize Iranian Electronic / Legal Books (`دفاتر قانونی / الکترونیکی`).
- Authorize Trial Balance (`تراز آزمایشی`), General Ledger reports, Income Statement
  (`سود و زیان`), Balance Sheet (`ترازنامه`) or Cash Flow statements.
- Authorize Treasury reporting, or reading Treasury/Sales/Inventory/Party tables as an
  Accounting calculation source.
- Introduce cross-year carry-forward / brought-forward balances / opening vouchers as a
  class, account-nature or classification presentation, hierarchy/rollup statements,
  multi-account or comparative statements, date-window statements, or per-user
  financial-area grants.
- Promote any ADR status: ADR-0031 and ADR-0032 remain **Proposed**; ADR-0009, ADR-0025
  and ADR-0026 are unchanged.
- Change any schema, migration, index, permission beyond the accepted D6 code, API
  behavior or Account Statement semantics.

---

## 2. Review Basis & Governance Reconciliation

### 2.1 Reviewed before merge

PR #43 was reviewed against `docs/tasks/task-17/task-17b-prompt.md` (Owner decisions
D1–D7), `docs/tasks/task-17/task-17b-implementation-gate.md`, and the Accounting domain
contract before it was merged into `main`. The merged diff was inspected on `main` at
`b10e007`; the implementation satisfies the approved Task 17B D1–D7 scope.

### 2.2 Ledger-native, non-statutory read surface

Task 17B adds no second accounting truth: `accounting.ledger_entries` remains the sole
source, and the statement is computed per request with the ADR-0031 §2/§4 rules. No
statement snapshot, cache, report table, materialized view or statutory book structure
was created. The Task 12 projection (`account_balance_projections`,
`vw_account_balance_derived`) is **not** read at runtime — reconciliation against it is
a test obligation only.

### 2.3 New read permission (`Accounting.AccountStatement.View`)

The Owner accepted registering `Accounting.AccountStatement.View` as the 36th code in the
Accounting registry (decision D6, gate P-10):

- `Accounting.Balance.View` governs the rebuildable turnover projection (AC-D-31).
- `Accounting.LedgerMovement.View` governs the raw immutable posted-movement row source
  (Task 17A, ACCEPTED).
- `Accounting.AccountStatement.View` specifically governs the derived per-account
  statement (opening / running / closing). A dedicated code avoids silently widening an
  existing permission's scope. It is a READ code only — no `Execute`/`Export`/mutation
  code exists.

### 2.4 No schema, migration or index change

The statement window rides the existing `idx_ledger_entries_org_account` exactly as the
accepted Task 17A window does; zero DDL was introduced. The performance assessment
required by prompt §14 is recorded in the implementation report §9 — measured before any
index consideration, and no speculative index was warranted or added.

### 2.5 Two documented narrow judgment calls

Accepted as recorded in the implementation report §6, neither invents a business rule:
(a) movement rows carry ids + the source-document snapshot while the account's code/title
appears once in the scope echo (the accepted Task 17A row shape); (b) an explicit client
`sort` is refused with an explicit 400 reason in the service, because `sort` is a declared
shared parameter (the statement order **is** the running-balance order).

### 2.6 Status alignment after this acceptance

- **Task 17B:** ACCEPTED (2026-09-25)
- **Task 17A:** ACCEPTED (2026-09-25, PR #39 merged in `130fab9`) — unchanged
- **Task 17:** **NOT COMPLETE** — FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS
- **OQ-25:** **OPEN**
- **OQ-43:** **OPEN**
- **OQ-40, OQ-23 and every other unresolved OQ:** unchanged
- **Reporting Foundation / Report Builder:** NOT IMPLEMENTED
- **Task 12 P1 follow-up, Task 13, Task 14, Task 16:** statuses unchanged

---

## 3. Verification & Evidence Summary

The D1–D7 decisions and the prompt's technical constraints were verified against the
merged codebase on `main` (`b10e007`, merged head `1ec996e`):

| Decision / Invariant | Status | Verification Basis |
|---|---|---|
| **D1** — one account + one fiscal year + optional period | PASS | `api/dto/account-statement.dto.ts` whitelist (`organizationId`, `accountId`, `fiscalYearId`, optional `accountingPeriodId`/`financialAreaId`, `page`/`pageSize`); non-postable account → 422; no multi-account parameter exists |
| **D2** — intra-year, sequence-based opening; no carry-forward | PASS | `data/account-statements.repository.ts` prior-sequence opening sums; whole-year opens at `0`; no prior-year closing enters the arithmetic (ADR-0031 §4/§9); asserted by the next-year statement opening at `0` |
| **D3** — Debit / Credit / Net only; no classification or nature | PASS | `domain/account-statement.ts` (`net = debit − credit`, `closing = opening + net`, `signConvention: 'debit-positive'`); no `accountNature`/`account_type`/classification field in the response; exact BigInt-mantissa Decimal strings (`domain/money.ts`) |
| **D4** — organization- and financial-area-scoped; no new area-auth system | PASS | Deployment pin asserted → `requireUsableOrganization`; scope keys resolve by id inside the organization (foreign/unknown → 404, scope contradiction → 422); single area = the fiscal year's area; no per-user area grant table or code |
| **D5** — OPEN/CLOSED/SEALED readable, never mutated | PASS | Status echoed in scope, never a filter; no write verb on the repository surface (prototype lock test); e2e no-mutation regression snapshots ledger/vouchers/accounts/periods, and the live suite additionally snapshots `account_balance_projections` incl. `updated_at` |
| **D6** — independent permission `Accounting.AccountStatement.View` | PASS | `domain/accounting-permissions.ts` (36 codes) + contract §22 row; enforced by `AuthGuard` + `AuthorizationGuard` + `@RequirePermission` **and** at the service entry (ADR-0016); tests assert `LedgerMovement.View`/`Balance.View` do not satisfy it |
| **D7** — bounded read-only statement | PASS | One `GET` route only (e2e asserts 404 on POST/PUT/PATCH/DELETE); no persistence, snapshot, cache, export, print or format variant |
| Organization isolation | PASS | Organization resolved server-side; foreign ids never leak data or existence (404, never 403) |
| Exact Decimal transport | PASS | Canonical decimal strings end to end; `toAmountString`/`storedAmountToString` refuse JS numbers; no rounding, no floats |
| Bounded pagination & deterministic order | PASS | `page`/`pageSize` (100 default / 500 max); totals over the full window; running balance continuous across pages; fixed order `documentDate,voucherNumber,lineNo,id`; explicit client `sort` → 400 |
| Snapshot consistency | PASS | Count + window sums + prior-sequence opening sums + pre-page nets + page run in ONE read-only `REPEATABLE READ` transaction per request |
| No cross-module ownership violation | PASS | Owned entirely within Accounting; provided **not** exported from `accounting.module.ts` (cross-module report consumption stays OQ-26-gated, AR-07) |
| No schema / migration / index additions | PASS | Zero DDL changes; the window rides the existing `idx_ledger_entries_org_account` |
| No Reporting / export / statutory scope creep | PASS | No Reporting module, Report Builder, registry, layout, XLSX/CSV/PDF/Print, legal books, Trial Balance, P&L, Balance Sheet, Cash Flow or Treasury reporting |

### Executed tests & quality gates (recorded evidence)

- **Unit tests:** `npm test` — **1086 passed, 0 failed** (93 files), including
  `domain/account-statement.spec.ts` (17 statement-math tests),
  `application/account-statements.service.spec.ts` (24 boundary tests) and
  `domain/money.spec.ts` exactness (negate/subtract).
- **HTTP e2e tests:** `npm run test:e2e` — **246 passed**, 85 skipped by design (the
  live-PostgreSQL suites require `VARDENA_TEST_DATABASE_URL`);
  `test/accounting-account-statements.e2e-spec.ts` contributed **28** passing specs
  (envelope, cross-page running balance, sequence-gap and misaligned-order openings, no
  carry-forward, the 401/403/404/422 matrix, whitelist 400s, statuses readable and
  untouched, no-mutation, deployment pin). The 85 skips were **never relabeled as passed**.
- **Live PostgreSQL e2e:** `test/account-statements-live.e2e-spec.ts` — **11 tests
  EXECUTED green on real PostgreSQL** (`postgres:16`) in CI: reversal pair nets zero,
  opening reconciled against `vw_account_balance_derived`, misaligned
  sequence-vs-calendar fixture, `0.01` exactness, no-mutation including
  `account_balance_projections`, organization isolation, period/year statuses.
- **Quality gates:** `tsc --noEmit` clean, `prettier --check .` clean, `oxlint .`
  0 errors (6 pre-existing warnings in untouched files), `nest build` clean,
  `prisma validate` ✅ in CI.

### CI evidence

| Run | Head | Job `backend` | Notes |
|---|---|---|---|
| `36073094859` | `9ee46f7` | cancelled | superseded by the documentation push |
| `36073357644` | `8335556` | **failure** | live-suite fixture bug: the `day()` helper used JS 0-based `Date.UTC` months against 1-based call sites, posting `2026-04-05` and resolving to no period (`AccountingDocumentDateUnresolvableError`) |
| `36073988599` | `c57a1a1` | **completed success** | fixture helper corrected to 1-based (matching every call site and label); **no production code changed** |
| `36074225037` | `1ec996e` (merged head) | **completed success** (2 m 53 s) | `prisma validate` ✅, `prisma generate` ✅, lint ✅, typecheck ✅, format check ✅, unit ✅, build ✅, migrate deploy ✅, Task 11 migration rehearsal ✅, **E2E tests (incl. live-DB suites) ✅** on `postgres:16` |

Required CI was **green on the merged head** `1ec996e`. The single historical failure is
recorded honestly above: it was a test-fixture calendar defect, fixed in `c57a1a1`, with
no production-code change.

**No blocker remained at merge.**

---

## 4. Acceptance Statement

Task 17B — the bounded, read-only **Accounting Account Statement Read Surface**
(`GET /api/v1/accounting/account-statements`, `Accounting.AccountStatement.View`), as
implemented under Owner decisions D1–D7 and delivered by PR #43, is **ACCEPTED** and is
merged into `main` (`b10e007`, merged head `1ec996e`), effective **2026-09-25**, by the
Repository Owner/Reviewer.

The deferred and known limitations recorded in
`docs/tasks/task-17/task-17b-implementation-report.md` §10 remain part of this acceptance
and are **not** closed by it.

**Task 17 overall is NOT complete** and remains **FORMALIZED / IMPLEMENTATION BLOCKED BY
OPEN QUESTIONS**. **OQ-25 and OQ-43 remain OPEN**; this acceptance resolves, reclassifies
or supersedes neither, and it authorizes no future Task 17 slice.

---

## 5. Related records

- Implementation & acceptance report: `docs/tasks/task-17/task-17b-implementation-report.md`
- Authorizing prompt & Owner decisions D1–D7: `docs/tasks/task-17/task-17b-prompt.md`
- Implementation gate: `docs/tasks/task-17/task-17b-implementation-gate.md`
- Investigation / brief / decision pack: `docs/tasks/task-17/task-17b-investigation.md`,
  `task-17b-brief.md`, `task-17b-owner-decision-pack.md`
- Predecessor acceptance: `docs/tasks/task-17/task-17a-acceptance-record.md`
- Governance index: `docs/accounting/task-index.md` §2/§4/§9; `STATE.md` §7/§8
- Contract: `docs/accounting/domain-contract.md` §6/§7/§8/§13/§15/§19/§22
