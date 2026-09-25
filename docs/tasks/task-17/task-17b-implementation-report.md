# Task 17B — Account Statement Read Surface — Implementation Report

**Status: READY FOR REVIEW — NOT ACCEPTED.** Only the Owner/Reviewer may record
`ACCEPTED`; nothing in this report self-accepts.

| | |
|---|---|
| Slice | Task 17B Account Statement — the bounded, read-only **account statement** (one account + one fiscal year + optional period) and one narrow read endpoint over it |
| Status | **READY FOR REVIEW** |
| Branch | `arena/01a0d5a0-vardena` (base `main` @ `4b1489d952cb932727b4d95f8ef1e65163d67232`) |
| Commit | `9ee46f7` — `feat(accounting): add account statement read surface` (implementation + tests); `8335556` — documentation; `c57a1a1` — live-fixture calendar fix (see §8) |
| PR | [#43](https://github.com/MR-AliEsmaeili/Vardena/pull/43) |
| Owner authority | `docs/tasks/task-17/task-17b-prompt.md` (saved before implementation) — Owner decisions **D1–D7**; gate P-10 authorizes the `Accounting.AccountStatement.View` vocabulary addition |
| Contract references | `docs/accounting/domain-contract.md` §6/§7/§8/§13/§15/§19 (AC-D-30/31/34; AC-I-01/05/06/07/09/16/19), §22 (permission vocabulary), ADR-0031 §2/§4/§9, ADR-0009, ADR-0025, AR-05/AR-07/AR-21/AR-22/AR-25 |
| Not implemented here | Task 17 (Accounting Reporting Foundation) remains **FORMALIZED / IMPLEMENTATION BLOCKED (OQ-25, OQ-43)**; no Reporting module, Report Builder, exports, statutory books, Trial Balance/Income/Balance Sheet/Cash Flow, Treasury reporting |

---

## 1. Approved scope and Owner decisions (as implemented)

The approved scope is exactly the Task 17B Account Statement slice described in
`docs/tasks/task-17/task-17b-prompt.md`, implemented under the recorded Owner
decisions:

| Decision | As implemented |
|---|---|
| **D1** — one account + one fiscal year + optional period | `GET /api/v1/accounting/account-statements` takes exactly `organizationId`, `accountId`, `fiscalYearId`, optional `accountingPeriodId`, optional `financialAreaId` (+ shared `page`/`pageSize`). Non-postable accounts answer **422** (ancestor rollups are out of this slice — D1). |
| **D2** — intra-fiscal-year, sequence-based opening | Whole-year window opens at `0`; a period opens at Σ(debit − credit) of the lower-`sequence` periods of the **same** fiscal year (gap sequences skipped silently, §7.1). **No prior-year carry-forward exists** (ADR-0031 §4/§9; the accepted Task 12 behavior) — proven by the 2027 statement opening at `0` after 2026 closed at `135.51`. |
| **D3** — Debit/Credit/Net only | `net = debit − credit`, `closing = opening + net` (`signConvention: 'debit-positive'` echoed on every response). Exact decimal strings only (BigInt-mantissa arithmetic in `domain/money.ts` — `negateAmount`/`subtractAmounts` added); no rounding, no floats, no `accountNature`/classification presentation anywhere in the response. |
| **D4** — org-scoped + financial area in scope | The statement is single-area: the fiscal year's `financialAreaId` (the contract's one-area-per-year rule). Optional client `financialAreaId` must exist in the organization (**404** otherwise) and equal the year's area (**422** on mismatch). No per-user area grants or new area-auth system was created (OQ-40 posture unchanged). |
| **D5** — all period statuses readable | `open`/`closed`/`sealed` periods and years are equally readable; status is echoed in the scope, never a read filter, and the read path never mutates it (asserted before/after with `updated_at` in the live suite). |
| **D6** — independent permission | New **36th** code `Accounting.AccountStatement.View` (`domain/accounting-permissions.ts` + contract §22 row, authorized by gate P-10). Enforced route-level (`AuthGuard` + `AuthorizationGuard` + `@RequirePermission`) **and** at the service entry (ADR-0016 double enforcement). Not satisfied by `Accounting.LedgerMovement.View` or `Accounting.Balance.View` (asserted in tests). |
| **D7** — bounded read-only statement | One `GET`, computed per request from the immutable ledger. No `POST`/`PUT`/`PATCH`/`DELETE` route (e2e asserts 404 on all four), no persistence, no snapshot/cache, no export/print/format variants. |

Stop conditions were evaluated against repository reality before implementation
(`docs/tasks/task-17/task-17b-prompt.md` §3): none triggered — D1–D7 match the
repo, 17A is the sole accepted dependency, OQ-25/OQ-43 stay governed by the
prompt's own D3 boundary (nature-agnostic Debit/Credit/Net), and no rule had to
be invented. Nothing was silently decided: every semantic above is one of D1–D7
or an existing repo convention (see §6 for the two narrow judgment calls).

## 2. Implemented (file map)

| Item | Where |
|---|---|
| Exact statement math (net, running, closing identity) + disclosures + scope echo | `backend/src/modules/accounting/domain/account-statement.ts` |
| Exact decimal negation/subtraction (`0.3 − 0.1 = 0.2`; signed derived measures) | `backend/src/modules/accounting/domain/money.ts` (`negateAmount`, `subtractAmounts`) |
| 36th permission `Accounting.AccountStatement.View` | `backend/src/modules/accounting/domain/accounting-permissions.ts` |
| Read-only window repository (scope reads + ONE `REPEATABLE READ` transaction: count, window sums, prior-sequence opening sums, pre-page nets, page) | `backend/src/modules/accounting/data/account-statements.repository.ts` |
| Shared row mapping exported (one mapping, never two) | `backend/src/modules/accounting/data/ledger-entries.repository.ts` (`toLedgerEntryFromRow`, `storedAmountToString`; class verbs untouched) |
| Application boundary (permission → org pin → org usability → `sort` 400 → scope-key matrix → opening/running/totals) | `backend/src/modules/accounting/application/account-statements.service.ts` |
| Query/response DTOs (whitelist-only query surface; exact-string amounts) | `backend/src/modules/accounting/api/dto/account-statement.dto.ts` |
| Single `GET` controller (no other method exists) | `backend/src/modules/accounting/api/account-statements.controller.ts` |
| Wiring (providers + controller; provided **not** exported — cross-module report consumption is OQ-26-gated, AR-07) | `backend/src/modules/accounting/accounting.module.ts` |
| In-memory statement repository fake (mirrors the predicates/order/aggregates exactly) | `backend/test/support/account-statement-repositories.ts` |

**No schema, migration, or index change** (stop-condition compliant). The window
predicate `(organization_id, financial_area_id, fiscal_year_id, account_id,
accounting_period_id)` rides the existing `idx_ledger_entries_org_account`
(org + account leading keys) exactly as the accepted Task 17A window does; per
prompt §14 a selectivity assessment is recorded in §9 below — measured before
any index consideration, and none was warranted.

## 3. API

`GET /api/v1/accounting/account-statements` — the preferred canonical path from
the prompt (§22), single endpoint, typed OpenAPI response
(`AccountStatementResponseDto`), no aliases, no `POST`.

**Query (whitelisted; anything else → 400 `forbidNonWhitelisted`):**
`organizationId`*, `accountId`*, `fiscalYearId`*, `accountingPeriodId`,
`financialAreaId`, `page` (default 1), `pageSize` (default 100, hard max 500).
An explicit `sort` is refused **400** (the statement order IS the running-balance
order — §11). No date range, voucher, serial, status, text or nature filter
exists (date ranges would require an opening-at-date basis D2 does not
authorize).

**Response:** header/scope echo (`financialArea`, `fiscalYear` with `YYYY-MM-DD`
bounds + status, `account` code/title — never a nature —, `accountingPeriod |
null` with sequence/bounds/status) + `movements: {items, total, page, pageSize}`
(rows: `documentDate`, `postingTimestamp`, `voucherNumber`, `lineNo`,
`description`, `debitAmount`, `creditAmount`, `netAmount`,
`runningBalanceAmount`, voucher/voucher-line ids and the `source*` document
traceability snapshot) + `totals: {openingBalanceAmount, debitTotalAmount,
creditTotalAmount, netChangeAmount, closingBalanceAmount}` + the disclosures
`signConvention: 'debit-positive'`, `openingBasis: 'intra-fiscal-year'`,
`orderBasis: 'documentDate,voucherNumber,lineNo,id'`.

## 4. Permission

`Accounting.AccountStatement.View` — NEW (36 codes total), one READ code,
deliberately independent of `Accounting.LedgerMovement.View` (the raw movement
row source) and `Accounting.Balance.View` (the rebuildable projection). Read-only
surface: no `Execute`/`Export`/mutation code exists (registry assertions in the
e2e suite). Registered in `domain/accounting-permissions.ts` and mirrored into
`rbac.permissions` at startup; contract §22 row added under gate P-10 authority.

## 5. Source of Truth

The immutable `accounting.ledger_entries` (one row per finalized voucher line) is
the **only** source. Opening/running/closing are derived per request with the
ADR-0031 §2/§4 rules — nothing is persisted (no statement snapshot, no cache, no
report row), so the statement can never disagree with a second truth. The Task 12
projection (`account_balance_projections`, `vw_account_balance_derived`) is
**not** read at runtime; reconciliation against the view is a TEST obligation
(live suite) proving the maintained projection agrees with the ledger-derived
opening.

## 6. Semantics (opening / periods / isolation / areas / Decimal / pagination)

- **Opening** (D2): sequence-based, intra-fiscal-year only. `0` for whole-year
  and first-period windows; otherwise Σ(debit − credit) over lower-`sequence`
  periods of the same year. Opening vouchers inside the year appear as ordinary
  movement rows (never as "opening").
- **Periods** (D5): `open`/`closed`/`sealed` all readable; a period of ANOTHER
  year answers **422** (exists, out of scope).
- **Organization isolation** (AC-I-01/16): organization resolved server-side
  (deployment pin asserted first → 404; then `requireUsableOrganization` →
  unknown 404 / disabled **422** — the established helper posture). Every scope
  key resolves **by id inside the organization**: foreign/unknown account, year,
  period or area → **404** (never 403 — never confirm a foreign id exists);
  keys that exist but contradict the requested scope (non-postable account,
  other-year period, area ≠ year's area) → **422**. This is the structural-area
  posture of OQ-40 exactly (no per-user grants).
- **Financial areas** (D4): one area per request — the year's area.
- **Decimal semantics** (AR-05, §13): canonical decimal strings end to end
  (`toAmountString`/`storedAmountToString` refuses JS numbers); statement math is
  BigInt-mantissa exact (`negateAmount`, `subtractAmounts`, `sumAmounts`);
  `closing = opening + net` is asserted before serialization.
- **Pagination** (§13): bounded `page`/`pageSize` (100/500), totals over the full
  window (page-independent), running balance continuous across pages (pre-page
  nets measured over the same predicate + snapshot), deterministic order
  `documentDate, voucherNumber, lineNo, id` (the Task 17A legal-book order with
  its unique tie-breaker).
- **Consistency** (gate R-6): the five window reads run in ONE read-only
  `REPEATABLE READ` transaction (per request, never across requests), so totals,
  opening and page always derive from one snapshot even while an open period
  receives postings.
- **Two narrow judgment calls** (documented, no rule invented): (a) the movement
  rows carry `accountId` + the source-document snapshot and the account's
  code/title lives once in the scope echo — the accepted Task 17A row shape
  ("ids on rows, labels at the owning read API"), not a new projection;
  (b) `sort` is a declared shared parameter, so its refusal happens in the
  service with an explicit 400 reason rather than at the whitelist.

## 7. Security

Backend-enforced (never frontend org context): permission (route + service) →
deployment pin → organization usability → organization-first scope-key
resolution (404/422 per AC-I-16) → parameterized queries only (no raw SQL, no
client sort/order/SQL). Foreign ids never leak data or existence. The read path
is write-free by construction: the repository type surface has no write verb
(locked by a prototype test analogous to the `posting.service.spec.ts` surface
lock), and the e2e no-mutation regression snapshots ledger/vouchers/accounts/
periods (in-memory suite) and ledger/documents/**`account_balance_projections`**/
periods incl. `updated_at` (live suite) before/after representative reads.

## 8. Tests actually executed (this sandbox, 2026-09-25)

| Suite | Command | Result |
|---|---|---|
| Statement domain math (`domain/account-statement.spec.ts`) | `npm test` | ✅ 17 passed |
| Exact money (`domain/money.spec.ts`, incl. negate/subtract) | `npm test` | ✅ passed (in the 1086 below) |
| Application boundary (`application/account-statements.service.spec.ts`) | `npm test` | ✅ 24 passed |
| Full unit battery (93 files) | `npm test` | ✅ **1086 passed** (0 failed) |
| In-memory HTTP e2e (`test/accounting-account-statements.e2e-spec.ts`) | `npm run test:e2e` | ✅ **28 passed** (envelope, cross-page running, sequence-gap + misaligned-order openings, no carry-forward, 401/403/404/422 matrix, whitelist 400s, statuses readable + untouched, no mutation, deployment pin) |
| Full e2e battery (28 files) | `npm run test:e2e` | ✅ **246 passed**, 85 skipped (the 85 are live-PostgreSQL tests — skipped by design without `VARDENA_TEST_DATABASE_URL`; **never relabeled as passed**) |
| Live PostgreSQL (`test/account-statements-live.e2e-spec.ts`, 11 tests) | `npm run test:e2e` | ⏭️ **skipped locally** (CI-only): reversal pair nets zero, opening ↔ `vw_account_balance_derived`, misaligned sequence-vs-calendar fixture, 0.01 exactness, no-mutation incl. `account_balance_projections`, org isolation, statuses |
| Formatting | `npm run format:check` | ✅ "All matched files use Prettier code style" |
| Lint | `npm run lint` | ✅ 0 errors (6 pre-existing warnings in untouched files remain) |
| Typecheck | `npx tsc --noEmit` | ✅ clean |
| Build | `npm run build` | ✅ clean |
| Prisma validate | `npx prisma validate` | ⚠️ **not runnable in this sandbox** — `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL` (binaries.prisma.sh blocked; same environment as 17A §13.4). The schema is **unchanged** by this task (zero migration/index edits), so no schema risk is introduced; CI must run it. |

**CI evidence:** PR #43, run **36073988599** (head `c57a1a1`), job `backend`
**completed success** — `prisma validate` ✅, `prisma generate` ✅, lint ✅,
typecheck/format ✅, unit ✅, build ✅, `migrate deploy` ✅ and
**"E2E tests (incl. live-DB suites)" ✅** on `postgres:16` — i.e. the 11-test
`account-statements-live.e2e-spec.ts` EXECUTED green against real PostgreSQL
(reversal pair, `vw_account_balance_derived` reconciliation, misaligned
sequence fixture, no-mutation incl. `account_balance_projections`). Honest
history: the first CI pass (run `36073357644`) **failed** that step — a fixture
bug in the live suite's `day()` helper (JS 0-based `Date.UTC` months vs 1-based
call sites posted `2026-04-05`, resolving to no period
`AccountingDocumentDateUnresolvableError`); fixed in `c57a1a1` (helper made
1-based, matching every call site and label) and re-verified green. No
production code changed in the fix.

## 9. Performance assessment (prompt §14 — measured before index consideration)

The statement window rides the existing `idx_ledger_entries_org_account`
(org + account leading keys) exactly as the accepted Task 17A read does; it adds
only equality filters (`fiscal_year_id`, `accounting_period_id`) and one
aggregate pass over the same window. Row count is bounded to one account-year
(gate SCL-3); the pre-page fetch reads two `numeric` columns of `≤ offset` rows.
Per §14 this is documented as an assessment — **no speculative index is added**;
if a real workload ever proves the window slow, that is a separate measured
index task (stop condition: inspect + measure first).

## 10. Deferred / known limitations (intentional, evidence-backed)

- **Cross-year carry-forward / brought-forward / opening vouchers as a class**
  — deliberately absent (D2; OQ-23 open). A prior-year closing NEVER enters the
  arithmetic.
- **Account nature presentation** (credit-nature positive balances), account
  type/classification, hierarchy/rollup statements, multi-account or
  comparative statements, date-window statements, exports/print formats,
  Treasury views, statutory books — all out of scope (D1/D3/D7; OQ-25/43).
- **Per-user financial-area grants** — not invented (OQ-40).
- **A second account overview («مرور حساب») engine** — forbidden by §20; this
  read surface is THE canonical account-movement calculation any future view
  must consume.
- **`REPEATABLE READ` on the window transaction** — asserted by code (option in
  `account-statements.repository.ts`); if a target database rejects the
  isolation option, drop it and document — CI green on `postgres:16` (run
  `36073988599`) shows the option is accepted there.
- **`prisma validate`/live-PG evidence in the sandbox** — sandbox-limited (§8);
  both now have green CI evidence (run `36073988599`: `prisma validate` ✅ and
  the live-PostgreSQL suite ✅).

## 11. Governance statements (explicit)

- **Task 17B status: READY FOR REVIEW — NOT ACCEPTED.** No self-acceptance.
- **OQ-25 and OQ-43 remain OPEN.** This slice resolves, reclassifies or
  supersedes neither. The statement carries no report layout, grouping,
  classification or statutory column set.
- **Task 17 remains FORMALIZED / IMPLEMENTATION BLOCKED.** This is a bounded
  slice under the prompt's own D1–D7 authorization — not the Accounting
  Reporting Foundation.
- **No generic Reporting Foundation / Report Builder / Report registry /
  aggregation platform** exists or is scaffolded here (ADR-0009 view-first
  posture preserved; the statement is Accounting-owned like 17A's source).
- **No Treasury reporting** and no Treasury/Sales/Inventory/Party table is read
  as an Accounting source (§17; AR-07/AR-16).
- **No ADR status was promoted.** ADR-0031 stays Proposed (its §4/§9 rules are
  reused, not ratified); ADR-0009/0025/0026/0032 unchanged.
- **Unrelated task statuses unchanged** (Task 12 P1 follow-up, Task 13, Task 14,
  Task 16, Task 17). `docs/accounting/domain-contract.md` §22 gained exactly one
  row under gate P-10 authority; `docs/modules.md` records the 36-code count and
  corrects its stale 17A status line to the recorded acceptance (PR #39) — a
  factual correction, not a new decision.
- **No schema/migration/index change, no Redis, no reporting DB, no
  cross-module dependency** was introduced.

## 12. Review request

Please review PR #43 (`arena/01a0d5a0-vardena`, implementation commit
`9ee46f7`) against `docs/tasks/task-17/task-17b-prompt.md` (D1–D7) and the gate
checklist. Awaiting Owner/Reviewer verdict; the correct outcome on acceptance is
an Owner decision recorded separately — this report remains **READY FOR REVIEW**
until then.
