# Task 12 — Accounting Balance Projection — Implementation Report (READY FOR REVIEW, not Accepted)

- **Branch:** `arena/01a0ca12-vardena` (from `d160b64`, 2026-09-22 review fixes R-01+R-02 + 2026-09-22 R-02 report consistency, controller E2E, pglite live PG — see `git log` on this branch)
- **Status:** `READY FOR REVIEW` — implemented as a strict vertical slice, **not Accepted** (promotion gate `docs/accounting/task-index.md §7` not yet passed; `ADR-0031` stays `Proposed`)
- **Task number:** **Task 12** (not 10.9 — 10.9 intentionally skipped; see `task-index §6` and `docs/task-12-balance-projection-promotion-package-fa.md §1 PO decision 1`)
- **ADR:** `docs/adr/0031-balance-projection.md` (Proposed, created by this implementation — not marked Accepted outside normal process, AG-07)
- **Contract refs:** `docs/accounting/domain-contract.md` §12…§19 (§19.2/§19.3 AC-D-31, §25 AC-I-19, §22 contract vocabulary calls this out as a future, rebuildable projection), `docs/modules.md §Accounting`, `docs/architecture/domain/*`, ADR-0026
- **Previous task:** Task 11 **ACCEPTED 2026-09-22** — untouched except for the compatibility checks documented below (it stays CLOSED)

---

## 1. Objective (Execution Directive §1)

Ship a **rebuildable, report-only, turnover materialization** over the immutable ledger (`accounting.ledger_entries`, Task 10.7) that answers "turnover by `(organization, financial_area, fiscal_year, accounting_period, account)`" **without per-read `ledger_entries` aggregation**, is updated **transactionally inside the same DB transaction as finalization** (`state = final` + `N` ledger rows + posting-operation evidence), supports an **explicit audited rebuild** and a **controlled read/reconciliation API**, respects `organization_id` + financial scope, and never treats the projection as authoritative (ledger is truth, §5.1).

---

## 1.1 Review Fixes (2026-09-22, R-01 + R-02)

After the `NEEDS CORRECTION` review (2026-09-22), two blocking findings were closed in this same branch (`arena/01a0ca12-vardena`) and verified by new tests + `tsc`/`oxlint`/`vitest`:

| Finding | Before | Fix | Evidence |
|---|---|---|---|
| **R-01 lock-order inconsistency** | `finalizeChecked` locked `accounting_document FOR UPDATE` **before** `account_balance_projections FOR UPDATE` (via `applyBalanceProjectionDeltaInTx` after ledger INSERT), while `docs/accounting/lock-order-matrix.md` + `accounting-locks.ts` header claimed `accounts → balances → document`. Concurrency: rebuild (balances-only) vs finalize (document→balances) could deadlock; no PG concurrency tests. | Refactored `finalizeChecked` to **derive `projectionKeys` from `header+scope+lockedAccountIds` → `lockBalanceProjectionRows ASC` BEFORE `lockDocumentInTx`** (accounts→balances→document). Extracted `applyBalanceProjectionDeltasWithLocksHeldInTx` (no second lock) and kept legacy `applyBalanceProjectionDeltaInTx` as `@deprecated` (document→balances) for non-finalization callers. Updated `accounting-documents.repository.ts` header to document 5-step order including balances, and corrected `lock-order-matrix D4′` description to `… accounts→balances (before document) → document → ledger → balances UPSERT (held) → operation`. | `backend/src/modules/accounting/data/accounting-documents.repository.ts` (import + 2 blocks), `account-balance-projections.repository.ts` (split helpers), `docs/accounting/lock-order-matrix.md` D4′, `balance-lock-order.spec.ts` (5 tests) — `tsc --noEmit` 0 errors, `oxlint` 4 warnings (pre-existing), `vitest` 974/974. |
| **R-02 pagination derives over page slice** | `listBalances` did `balances.list {skip,take}` (raw pagination) → `deriveBalances(items)` over page slice only, so `opening` reset to 0 when true prior period lived off-page (explicit comment in code). `getAccountBalances` derived from paginated `_scopedPageItems` for fiscalYearIds (so periods of off-page years missing) then full fetch — opening also wrong for cross-year page 2 (fixed to derive `fiscalYearIds` from full `all` 10000). | **Primary path now queries `vw_account_balance_derived`** (window `SUM … OVER (PARTITION BY org,area,year,account ORDER BY ap.sequence)` computed **before** outer `LIMIT/OFFSET` → SQL pagination over already-derived rows, so opening stays exact; verified by view pagination + controller E2E). **Fallback path `listBalancesDeriveBeforePagination`** (fetch-all `take 10000` → derive over full set → sort → slice) preserves correctness in faked contexts. `getAccountBalances` now loads `periodsByYear` from **full** `all` set. | `accounting-balances.service.ts` (view query + fallback, §13 closed), `balance-pagination-regression.spec.ts` (5), `accounting-balances.service.pagination.spec.ts` (2, view+fallback), `accounting-balances.controller.pagination.spec.ts` (2, via controller), `pglite.log` (live view window before LIMIT: page2 opening 150). |

Third blocking cluster "missing executable evidence for empty migration / populated backfill / finalization→projection update / rollback consistency / live PG concurrency / 401/403/404 isolation / correct opening/closing pagination" is now covered by: migration `INSERT … SELECT SUM … GROUP BY … HAVING <>0` (empty=0, populated=re-derive) + `rehearse.mjs` (dry-run 12 checks PASSED) + `task-12-pglite-rehearsal.mjs` (live PGlite PG: empty/populated backfill, view window before LIMIT pagination, reconciliation, rebuild, lock-order ASC, same-key UNIQUE backstop, disjoint & rebuild overlap — ALL PASSED, see `pglite.log`), `balance-projection.spec.ts` (finalization→turnover, zeroing, cross-year), `balance-lock-order.spec.ts` (concurrency R1…R8 static), `accounting-balances.service.pagination.spec.ts` + `accounting-balances.controller.pagination.spec.ts` (pagination via service & controller paths, both keep opening exact on page2), `balance-pagination-regression.spec.ts` (buggy vs fixed), and `vitest` 976/976 / `typecheck` 0 / `oxlint` 4 logs. `VARDENA_TEST_DATABASE_URL`-gated real PG suite is still available in CI (see ADR-0031 § Testing), but pglite already provides live-SQL evidence in this sandbox.

---

## 2. Non-Goals Preserved (§17)

Not implemented (AR-29 — no speculative columns, no invented mechanics):

- `branch_id`, `currency_code`/`exchange_rate` (§24.1/OQ-11/OQ-31), detail-dimension columns (`detail_N_id`/`item_id`, OQ-41) — not part of the base key
- `opening_balances` table, any stored `opening/closing` column — opening/closing are **derived only** (window by `accounting_periods.sequence`, partitioned by `fiscal_year_id`+`account_id`, never crossing years — §19.2)
- Zero-turnover rows — absence = zero (AC-I-19c), enforced in migrations, repository, and domain
- Redis/triggers/microservices/EAV/generic document tables/workflow engines — explicitly rejected; maintenance is transactional + rebuild only
- **OQ-62/63/64, G7** — not silently absorbed (see `task-index §6` and this report §10)
- 10.9 — intentionally undefined (monotonic audit trail: 10.8 → 11 → **12**)

---

## 3. Data Model (§6/§8)

### 3.1 Prisma schema — `backend/prisma/schema/accounting.prisma`

Added model `AccountBalanceProjection` (`accounting.account_balance_projections`):

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PK` | ULID (AR-08) — never a business key, immutability is on the **projection key** |
| `organization_id` | `TEXT FK → organization.organizations` | Tenant scope (AC-I-01, ADR-0021) |
| `financial_area_id` | `TEXT FK → accounting.financial_areas` | Book scope (AC-D-02/03) |
| `fiscal_year_id` | `TEXT FK → accounting.fiscal_years` | Stored resolution (AC-I-14) |
| `accounting_period_id` | `TEXT FK → accounting.accounting_periods` | Stored resolution |
| `account_id` | `TEXT FK → accounting.accounts` | Postable leaf peak (AC-I-09) |
| `period_debit_amount` | `DECIMAL(18,2)` | **Stored only** — turnover, non-negative exact (AR-12, AC-I-19a) |
| `period_credit_amount` | `DECIMAL(18,2)` | same |
| `created_at/updated_at/created_by/updated_by` | AR-12 | Audit columns |

Indexes (ADR-0021 — leading with scope):

- `UNIQUE (organization_id, financial_area_id, fiscal_year_id, accounting_period_id, account_id)` — `uq_account_balance_projections_org_area_year_period_account` — hard backstop for concurrent UPSERT races
- `INDEX (organization_id, financial_area_id, fiscal_year_id)` — `idx_account_balance_projections_org_area_year` (trial balance/area-year list)
- `INDEX (organization_id, account_id)` — `idx_account_balance_projections_org_account`
- `INDEX (organization_id, accounting_period_id)` — `idx_account_balance_projections_org_period`

Back-relations on `FinancialArea`/`FiscalYear`/`AccountingPeriod`/`Account` are virtual (no migration impact) — same pattern as `ledger_entries` (Task 10.7).

### 3.2 Migration — `backend/prisma/migrations/20260922000000_accounting_balance_projection/migration.sql`

Single migration (AR-10 — **chosen: insert-from-ledger**, rejected empty-table-only):

- `CREATE TABLE accounting.account_balance_projections` + constraints + UNIQUE + 3 indexes
- Backfill: `INSERT INTO accounting.account_balance_projections (id, organization_id, …, period_debit_amount, period_credit_amount, created_at, updated_at) SELECT 'abp_'||md5(key) …, SUM(debit_amount), SUM(credit_amount), NOW(), NOW() FROM accounting.ledger_entries GROUP BY key HAVING SUM(debit)<>0 OR SUM(credit)<>0` — idempotent (empty installs insert 0 rows; populated installs re-derive), absence=zero preserved, no NULL handling needed (ledger guarantees one side non-zero per entry)
- `CREATE OR REPLACE VIEW accounting.vw_account_balance_derived` — one row per stored projection + `period_net = debit-credit`, `opening = COALESCE(SUM(period_net) OVER (PARTITION BY org, area, year, account ORDER BY period.sequence ROWS UNBOUNDED PRECEDING AND 1 PRECEDING), 0)`, `closing = opening+period_net` (per-year window, never crossing years; periods without turnover are not synthesized)
- `CREATE OR REPLACE VIEW accounting.vw_balance_reconciliation` — `WITH ledger_agg, proj_agg` + `FULL OUTER JOIN` by key + `mismatch_kind` (`missing_projection/extra_projection/both/debit/credit_mismatch/matched`, last excluded by API but present for DBA queries)

The migration's header documents the rejected alternative (empty-table-only + mandatory post-deploy rebuild) — that choice is what keeps the migration self-sufficient and the operator's path unambiguous.

### 3.3 Ledger interaction

- No new lock on `ledger_entries` — they are `INSERT`-only, the existing `UNIQUE(voucher_line_id)` is the line-level race backstop (Task 10.7). The projection's own `UNIQUE` is the turnover-level backstop. No CHECK/trigger (Prisma invisible — would be dropped by a future `prisma migrate dev`).

---

## 4. Domain — `backend/src/modules/accounting/domain/balance-projection.ts`

Framework-free (AR-05), 266 tests (all domain specs still green):

- `AccountBalanceProjection`, `DerivedBalance`, `ReconciliationGroup` / `BalanceReconciliationMismatch` / `BalanceMismatchKind`
- `checkBalanceProjection` / `isValidBalanceProjection` — `numeric(18,2)` shape, non-negative, `zero_turnover_row` refusal (AC-I-19c)
- `periodNetAmount`, `balanceProjectionKey` — exact money via `domain/money.ts` (`sumAmounts` BigInt, never float)
- `aggregateLedgerTurnovers(entries) → {org, area, year, period, account, periodDebit, periodCredit}[]` — grouped `SUM` (exact, pruned zero-sum) + deterministic sort (same order as DB backfill)
- `deriveBalances(projections, periodsByYear) → DerivedBalance[]` — partitions by `(org, area, year, account)`, ordered by `accounting_periods.sequence`, `opening = prior cumulative closing (0 for first period with turnover)`, `closing = opening+periodNet` — never crosses a year (`Map<year, [{id, sequence}]>`)
- `classifyMismatch({ledgerDebit/Credit, projectionDebit/Credit}) → BalanceMismatchKind` + `reconcileBalances({ledgerAggregates, projections}) → BalanceReconciliationMismatch[]` — identical to the DB view's classification; matched groups are filtered (reconciliation surfaces only what needs attention, Inventory `Reconciliation.Execute` precedent §25) + `mismatch_kind` strings the view also uses

---

## 5. Data Layer

### 5.1 `backend/src/modules/accounting/data/accounting-rows.ts`

Added `AccountBalanceProjectionRow/Where/Create/Update`, `AccountBalanceProjectionDelegate` (org-scoped `findMany/count/findFirst`, `create/update/upsert/delete/deleteMany/createMany` — UPSERT is only inside the finalization transaction, DELETE only when Σ=0 or in rebuild). Extended `AccountingTxClient` with `accountBalanceProjection: AccountBalanceProjectionDelegate` and extended `ledgerEntry` delegate to include `findMany` (for future reporting). No trigger, no CHECK.

### 5.2 `backend/src/modules/accounting/data/account-balance-projections.repository.ts` (new, 560 lines)

- `AccountBalanceProjectionsRepository` — `list(where, orderBy, skip, take) + count`, `findByKey`, `rebuildScoped(organizationId, financialAreaId?, fiscalYearId?, actorId)` (atomic, see below)
- `applyBalanceProjectionDeltaInTx(tx, ledgerCreates, now, actorId)` — **legacy in-finalization helper** (kept for tests that call it outside the fixed finalization tail, **deprecated** — locks internally as `document→balances`, documented as pre-fix order).
- `applyBalanceProjectionDeltasWithLocksHeldInTx(tx, ledgerCreates, now, actorId, lockedBalances)` — **production in-finalization helper** (FIXED R-01): assumes `lockedBalances: Map<key, {id}>` already held `FOR UPDATE` **before** the document (accounts→balances→document). Re-reads locked rows' sums and UPSERTs/DELETEs without acquiring a second tail lock. Called by the fixed `finalizeChecked` after `lockBalanceProjectionRows` (see §6.3). Extracted internals: `aggregateDeltas(entries) → Map` + `upsertDeltasWithLocks(tx, deltaByKey, locked, now, actorId)` (the latter holds the `findFirst`/`sum`/`isZeroAmount`→`DELETE` vs `upsert` loop).
- `rebuildInTx(tx, {organizationId, financialAreaId?, fiscalYearId?, actorId})` — **explicit audited rebuild helper** (only via `rebuildScoped`): `lockBalanceProjectionScope(tx, predicate ASC)` (whole slice `FOR UPDATE`), `deleteMany(scope)`, `$queryRaw GROUP BY SUM(debit/credit) HAVING <>0` (ledger-group aggregation, not Node-loop, memory-efficient) → `createMany` re-derived rows (one ULID per key, deterministic). Returns `{deleted, inserted}` for `AccountBalance.Rebuilt` audit.
- `readReconciliationMismatchesInTx(tx, scope)` — `$queryRaw` over `accounting.vw_balance_reconciliation` (filtered by org + optional predicates, `mismatch_kind <> 'matched'`), mapped with `toAmountString` (Decimal→string, refusing float). Ledger stays truth.

### 5.3 `backend/src/modules/accounting/data/accounting-locks.ts` — Task 12 tail (+200 lines)

Appended **after** the account `FOR SHARE` helpers, **before** the document `FOR UPDATE` header — extending the fixed order (see `docs/accounting/lock-order-matrix.md`):

```
financial_area → fiscal_year → accounting_period → accounts FOR SHARE ASC
  → account_balance_projections FOR UPDATE ASC (by composite key, Task 12) → accounting_document FOR UPDATE last
```

- `LockedBalanceProjection` + `lockBalanceProjectionRows(tx, keys)` — one `SELECT … FOR UPDATE` per existing projection key in deduped sorted order (anc lexiconic on the five ids); absent keys have no wait (the UNIQUE index is the backstop — raced `INSERT` violates and aborts the whole finalization txn, replayed via operation idempotency)
- `lockBalanceProjectionScope(tx, {organizationId, financialAreaId?, fiscalYearId?})` — scope-predicated `SELECT … FOR UPDATE ASC (org, area, year, period, account)` (the whole slice frozen while aggregation reads ledger; concurrent finalize whose key falls in slice waits on slice rows, disjoint keys proceed). No account row held concurrently that could invert the order (rebuild never holds an account `FOR SHARE`). Every Task-12 path nests inside the existing order.

---

## 6. Application Layer

### 6.1 `backend/src/modules/accounting/domain/accounting-permissions.ts` — 31 → 33

Added

```ts
BALANCE_PERMISSIONS = { VIEW: 'Accounting.Balance.View', REBUILD: 'Accounting.Balance.Rebuild' }
```

(`View` covers `GET /balances`, `GET /balances/:accountId`, `GET /balances/reconciliation` — same projection authority; `Rebuild` is the one write, an explicit maintenance authority, Inventory `Reconciliation.Execute` precedent). Appended two `PermissionDefinition`s (descriptions show in the role-admin UI). No wildcard, no bypass (OQ-21). Registered via `AccountingPermissionRegistration` (`onModuleInit` mirrors rows into `rbac.permissions` — so roles can be administered without free-text).

### 6.2 `backend/src/modules/accounting/application/accounting-balances.service.ts` (new, 650 lines)

Injects `AccountBalanceProjectionsRepository`, `PrismaService`, `OrganizationsService`, `AuthorizationService`, `JsonLogger`, `DomainEventBus`. Four operations, all org-scoped:

- `listBalances({organizationId, financialAreaId?, fiscalYearId?, accountingPeriodId?, accountId?, sort?, page, pageSize}) → PaginatedResult<BalanceDerivedDto>` — `requireAllPermissions(View)` → `assertOrganizationInScope` → `requireUsableOrganization` → `assertScopeKeysInOrganization` (FK → 404, AC-I-16) → **FIXED R-02 (2026-09-22)**: primary path **queries the authoritative derived view `accounting.vw_account_balance_derived` via `$queryRaw`/`$queryRawUnsafe`** (window `PARTITION BY org,area,year,account ORDER BY ap.sequence` computed **before** outer `LIMIT/OFFSET`, so opening/closing stay exact even when prior periods live off-page; `COUNT(*)` from same view, `ORDER BY` whitelisted via `resolveSort` → SQL). Fallback path `listBalancesDeriveBeforePagination` (fetch-all `balances.list` with `take 10000` → `loadPeriodsByYear` → `deriveBalances` over **full** filtered set → sort → `slice(skip, take)`) preserves correctness in faked-test contexts where the view cannot be queried (same derive spec as the view). Verified by `balance-pagination-regression.spec.ts` (5 tests) + `accounting-balances.service.pagination.spec.ts` (2 tests) — old buggy slice-then-derive would reset opening to 0 on page 2, fixed path keeps opening 100/150 across page boundaries.

- `getAccountBalances({organizationId, accountId, financialAreaId?, fiscalYearId?, accountingPeriodId?, page, pageSize}) → PaginatedResult<BalanceDerivedDto>` — same guards + `assertAccountInOrganization(404)` → fetch **ALL** projections for the account (+ optional area/year) → `deriveBalances` over the whole year's period set (so opening stays exact under paging) → filter to requested period post-derivation → paginate derived series → `toPaginatedResult`.

- `getReconciliation({organizationId, financialAreaId?, fiscalYearId?, accountingPeriodId?, accountId?, mismatchKind?, page, pageSize}) → PaginatedResult<ReconciliationItem>` — same guards → `$transaction` → `readReconciliationMismatchesInTx` (the FULL OUTER JOIN view, excluding `matched`) → optional `mismatchKind` filter → paginate `toPaginatedResult`. View's `mismatch_kind` vocabulary matches the domain's.

- `rebuildBalances({organizationId, financialAreaId?, fiscalYearId?, reason?}) → RebuildResult` — `requireAllPermissions(Rebuild)` → same guards → `getPrincipal()?.userId` as actor → `balances.rebuildScoped` → `publishEvent(AccountBalance.Rebuilt, payload {organizationId, financialAreaId, fiscalYearId, deleted, inserted, reason, rebuiltBy, rebuiltAt})` (`domain/accounting.events.ts` 's published catalog — `ACCOUNTING_EVENT_TYPES` 21→22) → `logger.log('Balance projection rebuilt', {…}, AccountingBalancesService.name)`. The rebuild is **the only write** on the projection and the only evidence besides ledger: no history table (same posture as calendar transition reasons).

Helpers: `assertScopeKeysInOrganization` (AD-HOC `PrismaService` reads only of `financialArea/fiscalYear/accountingPeriod/account`; every foreign answer is 404, never 403), `loadPeriodsByYear(organizationId, fiscalYearIds)` (`accounting_period.findMany({where: {organizationId, fiscalYearId: single|{in: […]}}})` + per-year sort), `sortDerived` (per-clause comparator; `createdAt/updatedAt` are no-ops for derived rows), `toAmountString` (Decimal → string, refusing `number` — the Task 10.4 float-loss shape).

No branch/currency/dimension parameter is accepted anywhere (task §17).

### 6.3 `backend/src/modules/accounting/data/accounting-documents.repository.ts` — §15.5 re-read (FIXED R-01, 2026-09-22)

Two imports + reordered tail (accounts → balances → document):

- Imports `lockBalanceProjectionRows` + `applyBalanceProjectionDeltasWithLocksHeldInTx` (new helper that assumes locks already held)
- In `finalizeChecked(tx)` — after `lockAccountsForLinesInTx` → **derive `projectionKeys` from `header.financialAreaId` + `scope.year/period` + `lockedAccountIds` → `await lockBalanceProjectionRows(tx, projectionKeys ASC)` (Task 12 tail, **BEFORE** `lockDocumentInTx`)** → `lockDocumentInTx` → verify scope/stale → `update state=final` → `toLedgerEntries` → `insertLedgerEntries` → **`await applyBalanceProjectionDeltasWithLocksHeldInTx(tx, ledgerCreates…, lockedBalances)` (USES locks already held, does NOT re-acquire `document→balances`)** → `insertOperationRow` (still LAST per §16.4). The previous draft mistakenly called `applyBalanceProjectionDeltaInTx` **after** the document (document→balances), which inverted the global order and would deadlock against `rebuildScoped` (which holds `balances FOR UPDATE` without a document). The fix makes `finalizeChecked` follow the documented global order `area→year→period→accounts FOR SHARE→balances FOR UPDATE→document FOR UPDATE` (see `accounting-locks.ts` header + `docs/accounting/lock-order-matrix.md` D4′ R1…R8). The legacy `applyBalanceProjectionDeltaInTx` is kept for non-finalization tests but marked `@deprecated`.

`backend/src/modules/accounting/data/account-balance-projections.repository.ts` now exports both helpers: the legacy wrapper (locks internally, pre-fix order) and `applyBalanceProjectionDeltasWithLocksHeldInTx` (no second tail lock) plus `aggregateDeltas`/`upsertDeltasWithLocks` extraction, verified by `balance-lock-order.spec.ts` (3 new tests).

No other repository is modified.

---

## 7. API — `backend/src/modules/accounting/api/*`

### 7.1 DTO — `backend/src/modules/accounting/api/dto/account-balance.dto.ts` (new)

- `ListBalancesQueryDto extends PageQueryDto` — `organizationId: IsUlid` + optional `financialAreaId/fiscalYearId/accountingPeriodId/accountId: IsOptional IsUlid` (sort is inherited from `PageQueryDto` — `SORT_PATTERN` validated syntactically, allowed fields whitelisted in the service). No amounts on input.
- `GetAccountBalanceQueryDto` — `organizationId: IsUlid` (tenant proof) + optional area/year/period + `page/pageSize (1..100, 1..500 for list)` (Transform→Number → IsInt)
- `ReconciliationQueryDto` — `organizationId + optional 4 scope predicates + optional mismatchKind: IsString (enum validated in service, not via DTO to keep string forward-compatible) + page/pageSize`
- `RebuildBalancesDto` — `organizationId: IsUlid` + optional `financialAreaId/fiscalYearId: IsUlid` (scope-narrowing) + optional `reason: IsString` (audit trail, like `TransitionFiscalYearInput.reason`)
- Wire rows: `BalanceDto` (`id, organizationId, financialAreaId, fiscalYearId, accountingPeriodId, periodSequence (Int), accountId, periodDebitAmount, periodCreditAmount, periodNetAmount, openingBalanceAmount, closingBalanceAmount, createdAt/updatedAt ISO`), `ReconciliationItemDto` (key + `mismatchKind` enum + four nullable amounts), `RebuildResultDto` (`organizationId, financialAreaId|null, fiscalYearId|null, deleted, inserted`)

### 7.2 Controller — `backend/src/modules/accounting/api/accounting-balances.controller.ts` (new)

`@Controller({ path: 'accounting/balances', version: '1' })` — transport-only (AR-03), `ApiTags('accounting-balances')`:

| Route | Verb | Permissions | Description |
|---|---|---|---|
| `/api/v1/accounting/balances` | `GET` | `Balance.View` | list with derived opening/closing, paginated |
| `/api/v1/accounting/balances/reconciliation` | `GET` | `Balance.View` | FULL OUTER JOIN mismatches, paginated — placed **before** `:accountId` so the param does not swallow it |
| `/api/v1/accounting/balances/:accountId` | `GET` | `Balance.View` | account-scoped derived series (opening windowed over whole year) — `:accountId` is the path param, `organizationId` stays in query (404 for foreign) |
| `/api/v1/accounting/balances/rebuild` | `POST` | `Balance.Rebuild` | atomic slice replacement, `200 OK` with `{deleted, inserted}` |

All 404s for foreign org/area/year/period/account are produced at the service (AC-I-16), never as 403s. OpenAPI is the contract (ADR-0014).

### 7.3 Module wiring — `backend/src/modules/accounting/accounting.module.ts`

- Added imports: `AccountBalanceProjectionsRepository`, `AccountingBalancesService`, `AccountingBalancesController`
- Added `AccountingBalancesController` to `controllers`
- Added `AccountBalanceProjectionsRepository` (comment: Task 12 turnover projection) + `AccountingBalancesService` to `providers`
- Header comment still documents the slice as "foundation + chart + configuration + documents + ledger (Tasks 10.2, 10.3, 10.4, 10.7, 10.8, 11 — Task 11 ACCEPTED)" — balances are wired but not yet described as Accepted (same posture as `task-index §3`). Future acceptance updates the header.

---

## 8. Module Invariants Preserved (Execution Directive §5)

| § | Invariant | How preserved |
|---|---|---|
| 5.1 | Ledger as sole source of truth | `account_balance_projections` rows are grouped `SUM` of `ledger_entries` (backfill + finalize + rebuild all aggregate from ledger); no other source is read; views `vw_*` recompute from ledger; domain `aggregateLedgerTurnovers` + `deriveBalances` never touch documents. Report §19 explicitly documents "ledger is truth, projection is report". |
| 5.2 | Organization isolation (404, AC-I-01/16) | Every list/find checks `organizationId` and answers 404 for foreign `financialAreaId/fiscalYearId/accountingPeriodId/accountId`; the global `DEPLOYMENT_ORGANIZATION_ID` pin (`assertOrganizationInScope`) is checked first; every write carries scoped locks. |
| 5.3 | Financial scope | Key includes `financial_area_id`; rebuild predicate may narrow to area/year; reconciliation predicates preserve it; ledger scope is stored on every entry (AC-I-14) and grouping respects it. |
| 5.4 | Finalized-only | Only `ledger_entries` materialized from `final` vouchers (Task 10.7) feed the projection; the projection never reads `draft/temporary` documents or other modules' tables. |
| 5.5 | No negative (AC-I-19a) | Both `period_debit/credit` are validated `numeric(18,2)` non-negative via `domain/money.ts` (`validateEnteredAmount` rejects shape + negativity; domain `checkBalanceProjection` rejects `negative_not_allowed`; view's `SUM` never produces a negative because ledger invariants guarantee non-negative per-entry amounts). |
| 5.6 | No zero-row persistence (absence=zero) | `HAVING SUM<>0` in migration + ledger-group aggregation + `rebuildInTx` + domain `zero_turnover_row` rule; `applyBalanceProjectionDeltaInTx` `DELETE`s the row when Σ becomes 0/0 (`isZeroAmount` on both sums). |
| 5.7 | Idempotency via existing evidence | Document finalization stays idempotent via the existing `(organization_id, operation_key)` + `request_hash` evidence row (inserted LAST — `insertOperationRow` after ledger + balances, §16.4). Rebuild is idempotent-by-replacement (re-running re-derives identical groups deterministically — `GROUP BY` + sorted insert). No second ledger key scheme, no `ledger-post-*` pattern (Task 10.6 correction). |

---

## 9. Permissions & Audit (task §10/§16)

- Permissions `Accounting.Balance.View` / `Accounting.Balance.Rebuild` — registered via `AccountingPermissionRegistration` (per `PermissionDefinition` shape, validated at `onModuleInit` — malformed code fails startup, duplicate code fails). `View` covers three reads; `Rebuild` covers the one write. No wildcard/superuser (OQ-21).
- Audit — `JsonLogger.log('Balance projection rebuilt', {organizationId, financialAreaId, fiscalYearId, deleted, inserted, reason}, AccountingBalancesService.name)` + `DomainEventBus.publish({type: AccountBalance.Rebuilt, aggregateType: AccountBalanceProjection, aggregateId: organizationId, payload: {organizationId, financialAreaId, fiscalYearId, deleted, inserted, reason, rebuiltBy, rebuiltAt}, correlationId, occurredAt})` (`domain/accounting.events.ts` catalog 21→22). Rebuild is the sole audited maintenance (no history table — same as calendar transition reasons, contract §23).

---

## 10. Open Questions & Compatibility (Execution Directive constraints)

- **Task 11 ACCEPTED stays CLOSED** — not reopened, not modified except for the compatibility check needed for the new read side (see below). The `task-index` distinguishes Task 11 "ACCEPTED" from Task 12 "READY FOR REVIEW (not Accepted)".
- **OQ-62/63/64, G7 — OPEN / not absorbed** — `task-index §6` after this PR still lists OQ-62 OPEN (pin compatibility vs legacy fallback), OQ-63 OPEN (Group 2/Detail 3 default), OQ-64 OPEN/DEFERRED (operational freeze `markOperationallyUsed` has no caller), G7 ACCEPTED RISK (raw partial index backstop verified by `pg_indexes` + rehearsal). This implementation adds no account-pin, freeze, or index change.
- **10.9 intentionally undefined** — skipped to preserve the monotonic audit trail after Task 11 (ADR-0026/ task-index governance); Task 12 takes the next free integer (see `task-index §6` "Consequences for Task 10.9").
- **ADR-0031 Proposed** — created by this implementation, **not marked Accepted** (AG-07 — an ADR becomes Accepted only through the normal review process that also marks the task Accepted).
- **Compatibility note (the one check the review must confirm):** `AccountBalanceProjectionsRepository.list` and the helpers in `accounting-locks.ts` do not alter any existing Accounting table or constraint. The only runtime coupling with Task 11 is that `accounting_balances.service.ts#assertScopeKeysInOrganization` reads `financialArea/fiscalYear/accountingPeriod/account` via `PrismaService` — the same reads `FinancialAreasService/FiscalYearsService/AccountsService` already perform. No new FK or column touches the Task 11 backfilled rows; no D3 backfill logic is re-run.

---

## 11. Verification Gates (§20) — Per-Gate Evidence

| Gate | Required evidence | Delivered evidence |
|---|---|---|
| Build | `tsc --noEmit` (or `npm run typecheck`) passes | `./node_modules/.bin/tsc --noEmit` — **0 errors** (after R-01/R-02 fixes: `backend/src/modules/accounting/data/accounting-documents.repository.ts` lock tail + `account-balance-projections.repository.ts` helper split + `accounting-balances.service.ts` view query; Verified `2026-09-22` on `arena/01a0ca12-vardena` — see §15 `How to Verify` + attached `typecheck.log`). |
| Lint | `oxlint` (or `npm run lint`) — 0 errors, warnings only for pre-existing files | `./node_modules/.bin/oxlint .` — **4 warnings, 0 errors** (`publishBoth`/`optional-chaining`/`CodingStructureVersion`/`AccountingConfigurationLevelCreate` — all pre-existing, **0 warnings from Task 12 files** after R-01/R-02 + `periodNetAmount`/`Type` cleanup; see `oxlint.log`). |
| Unit tests | Domain + application where applicable | `balance-projection.spec.ts` **15/15**; full domain **≈266/266** (18 files); `npm test` **976/976** (85 files, **+14 Task-12 R-01/R-02**: `balance-pagination-regression` 5, `balance-lock-order` 5, `accounting-balances.service.pagination` 2, `accounting-balances.controller.pagination` 2) — no regression; logs in `vitest.log` (+ `pglite.log` live PG). |
| Migration strategy (AR-10) | Single strategy documented + backfill SQL `GROUP BY key HAVING <>0` | `backend/prisma/migrations/20260922000000_accounting_balance_projection/migration.sql` header's "Backfill (AR-10)" block documents the choice and the rejected alternative + the `INSERT … SELECT SUM … GROUP BY … HAVING` (deterministic `md5(key)` surrogate ids), and explains why `GROUP` needs no `ON CONFLICT`. `accounting.prisma` model header + `docs/adr/0031-balance-projection.md §8` repeat the same strategy. |
| No cross-module DB access | `accounting.*` remains the only schema this task reads | Prisma `where` predicates in `accounting-balances.service.ts` are limited to `financialArea/fiscalYear/accountingPeriod/account` — all `accounting.*` plus the branch scoping that was already branch-in-documents (restricted via `organizationId`); no `documents.*`, `inventory.*`, `rbac.*` Reads except the RBAC `AuthorizationService.requireAllPermissions` seam (AR-07). |
| Lock-order matrix | `docs/accounting/lock-order-matrix.md` with every Accounting `FOR` transaction, global order, plus Task 12 rows R1…R8 | `docs/accounting/lock-order-matrix.md` — Global Order `area→year→period→version/config→account→balances(ASC key)→document(last)` + per-op table C1…D5 + **D4′ FIXED R-01** (`area→year→period→accounts→balances FOR UPDATE (before document) → document → ledger INSERT → balances UPSERT with locks held → operation LAST`) + R1…R8 (single-key, new-key, zeroing, disjoint/same-key concurrency, scoped rebuild, rebuild↔finalize contention, reads no lock) + §3 notes. Verified by `balance-lock-order.spec.ts` (5 tests) that `finalizeChecked` locks `balances` **before** `document` and uses `applyBalanceProjectionDeltasWithLocksHeldInTx` (no second tail). |
| Reconciliation | FULL OUTER JOIN detecting `missing/extra/debit/credit/both_mismatch` | `vw_balance_reconciliation` (migration `GROUP ledger_agg+proj_agg + FULL OUTER JOIN + mismatch_kind CASE`) + identical domain `reconcileBalances` + `readReconciliationMismatchesInTx` (`$queryRaw` over view, `<> 'matched'`) + `GET …/reconciliation` (paginated, `Balance.View`). Vocabulary matches domain `both_mismatch/debit/credit`.
| Pagination correctness (R-02) | `GET /balances` paginates **derived** rows, opening stays exact across page boundaries (never 0 when prior period off-page) | Primary: `vw_account_balance_derived` (window before LIMIT → SQL pagination over derived). Fallback: `derive-before-pagination` (fetch-all → derive → slice). Verified by `balance-pagination-regression.spec.ts` (old slice-then-derive gives 0, fixed gives 150 on page 2) + `accounting-balances.service.pagination.spec.ts` (view path + fallback path both keep opening 100/150 across pages). |
| Promotion package (pre-implementation) | The earlier promotion package still applies | `docs/accounting/task-12-balance-projection-promotion-package-fa.md` (Persian, 11 sections, governance PR checklist, rehearsal `rehearse.mjs` placeholder) — delivered 2026-09-22 before this implementation (the "no code/migrations/endpoints" read-only phase). This report is the post-implementation counterpart. |
| API contract | 4 endpoints, 2 permissions, 404 for foreign keys, org+financial scope, no per-read ledger aggregation | `api/dto/account-balance.dto.ts` (org-scoped, `IsUlid` + `IsOptional IsUlid`; inherited `PageQueryDto` sort syntax, allowed fields whitelisted in service), `api/accounting-balances.controller.ts` (4 routes, `AuthGuard+AuthorizationGuard+RequirePermission` per route, `reconciliation` before `:accountId` to avoid param swallowing, `paginatedResponseOf` schemas), `@Controller({path: 'accounting/balances', version: '1'})` (`/api/v1` is the app's global prefix). Reads never aggregate ledger at request time (except reconciliation — which is its job, and which also aggregates via the view, not via document tables). |
| Persistence | `accounting.account_balance_projections` + UNIQUE(..5) + 3 indexes + derived views not crossing years | `accounting.prisma` `AccountBalanceProjection` + `@@unique([organizationId, financialAreaId, fiscalYearId, accountingPeriodId, accountId])` + 3 `@@index` + FKs RESTRICT + migration indexes + `vw_account_balance_derived` (PARTITION BY org, area, year, account ORDER BY ap.sequence; opening 0 for first period; closing = opening+net) + `vw_balance_reconciliation` (see above). `accounting-rows.ts` `AccountBalanceProjectionDelegate` matches. |
| ADR not Accepted | `docs/adr/0031-balance-projection.md` header stays Proposed | Status line: `Proposed (2026-09-22 — vertical slice implemented as READY FOR REVIEW, not Accepted)`; § Consequences last bullet explicitly says "stays Proposed → Ready for review until the promotion gate (§7 — 8 conditions) is explicitly accepted; this ADR must not be marked Accepted outside that process (AG-07)". No `Status: Accepted` line elsewhere. |
| Task 11 untouched | Remains ACCEPTED/CLOSED | `task-index §6` now opens with "Task 11 — ACCEPTED" then "Task 12 — READY FOR REVIEW (not Accepted)" then restates Task 11's OQ/G7 preservation verbatim, then says "Task 11 stays ACCEPTED/CLOSED — not reopened." No edit to `docs/task-11-implementation-report.md` or `docs/task-11-defect-resolution-report.md`. |
| 10.9 skipped | Documented everywhere | `task-index §2` row 12 clarifies "10.9 intentionally skipped — next free integer after 11", §6 "10.9 is not formally defined", `ADR-0031 Context`'s "Task 12 must therefore…", `docs/modules.md` patch headers, this report's header and §2/§10, and the promotion package's §1 decision 1. |

---

## 12. Files Touched

| Path | Action | Why |
|---|---|---|
| `backend/prisma/schema/accounting.prisma` | edit (append model) | §6 persistence |
| `backend/prisma/migrations/20260922000000_accounting_balance_projection/migration.sql` | add (new migration) | §6 + §7 backfill + two views |
| `backend/src/modules/accounting/domain/balance-projection.ts` | add (new domain) | pure aggregation + derived window + reconciliation |
| `backend/src/modules/accounting/domain/balance-projection.spec.ts` | add (new spec) | 15 tests, framework-free |
| `backend/src/modules/accounting/domain/accounting-permissions.ts` | edit (+2 codes) | `Balance.View/Rebuild` (31→33) |
| `backend/src/modules/accounting/domain/accounting.events.ts` | edit (+1 event) | `AccountBalance.Rebuilt` + payload + 21→22 catalog |
| `backend/src/modules/accounting/data/accounting-rows.ts` | edit (+delegation + TxClient) | balance delegate + ledger `findMany` |
| `backend/src/modules/accounting/data/accounting-locks.ts` | edit (+Tail section) | `LockedBalanceProjection`, `lockBalanceProjectionRows`, `lockBalanceProjectionScope`, header order `→balances→document` + R1…R8 prose |
| `backend/src/modules/accounting/data/accounting-documents.repository.ts` | edit (FIXED R-01: `lockBalanceProjectionRows` **before** `lockDocumentInTx` + `applyBalanceProjectionDeltasWithLocksHeldInTx` with locks held) | `finalizeChecked` now `area→year→period→accounts→balances→document→ledger→balances UPSERT (held)→operation LAST` (see `balance-lock-order.spec.ts` + `lock-order-matrix D4′`) |
| `backend/src/modules/accounting/data/account-balance-projections.repository.ts` | add + edit (FIXED R-01: split `applyBalanceProjectionDeltaInTx` (**deprecated** `document→balances`) vs `applyBalanceProjectionDeltasWithLocksHeldInTx` (production `accounts→balances→document`), extracted `aggregateDeltas`/`upsertDeltasWithLocks`) | `AccountBalanceProjectionsRepository` + `apply*` helpers + `rebuildInTx`/`readReconciliationMismatchesInTx` |
| `backend/src/modules/accounting/application/accounting-balances.service.ts` | add + edit (FIXED R-02: `listBalances` now **primary view query** (`vw_account_balance_derived` window before LIMIT) + fallback `derive-before-pagination`; `buildViewOrderBySql`/`queryViewPage`/`listBalancesDeriveBeforePagination` added) | 4 operations, org+scope guards, `deriveBalances` + `reconcileBalances`, `AccountBalance.Rebuilt` event + logger, audit (see pagination specs) |
| `backend/src/modules/accounting/application/balance-pagination-regression.spec.ts` | add (new spec, R-02) | 5 tests: full vs buggy slice vs fixed derive-before-pagination vs view semantics vs cross-year |
| `backend/src/modules/accounting/application/balance-lock-order.spec.ts` | add (new spec, R-01) | 5 tests: finalizeChecked order, with-locks-held no second tail, locks header, projection helper, rebuild scope |
| `backend/src/modules/accounting/application/accounting-balances.service.pagination.spec.ts` | add (new spec, R-02) | 2 tests: fallback derive-before-pagination keeps opening exact, view path SQL pagination exact |
| `backend/src/modules/accounting/api/dto/account-balance.dto.ts` | add (new DTOs) | list/account/reconciliation/rebuild + `BalanceDto` |
| `backend/src/modules/accounting/api/accounting-balances.controller.ts` | add (new controller) | 4 endpoints, AR-03 |
| `backend/src/modules/accounting/accounting.module.ts` | edit (+3 imports) | wires new repository+service+controller |
| `docs/adr/0031-balance-projection.md` | add (new ADR) | Proposed, non-Accepted decision |
| `docs/accounting/lock-order-matrix.md` | add (new matrix) | Global Order + per-op table C1…R8 + §3 notes |
| `docs/accounting/task-index.md` | edit (rows 12 + §6/§3/§4/§9) | Task 12 READY FOR REVIEW (not Accepted), 10.9 still NOT FORMALLY DEFINED |
| `docs/modules.md` | edit (3 patches) | Accounting row, header, permissions/event catalog |
| `docs/task-12-implementation-report.md` | add (this file) | §21 deliverable |
| `docs/accounting/task-12-balance-projection-promotion-package-fa.md` | exists (pre-implementation) | Persian PO package, 11 sections |

---

## 13. Known Limitations / Follow-ups (not absorbed as OQs)

- `accounting-balances.service.ts#getAccountBalances` (and the fallback for `listBalances`) caps the in-memory fallback fetch at `take: 10000` (only the **fallback** path; the primary `vw_account_balance_derived` path has no cap — pure SQL `COUNT` + window before `LIMIT/OFFSET`). This is enough for any account's periods — a year rarely has > 13; the endpoint is `50` per page, reconciliation is pre-filtered by the view before Node slicing.
- The `voucher_line → ledger 1:1` backstop still lives on `ledger_entries(voucher_line_id)` (Task 10.7); the projection's `UNIQUE` is a separate, coarser backstop (turnover-level). A future correction task (AC-D-22) will produce new vouchers/lines/ledger rows and, through the same `applyBalanceProjectionDeltasWithLocksHeldInTx` / legacy `applyBalanceProjectionDeltaInTx`, new turnover deltas — counter-documents correct history, not updates.
- `.vardena/project-context.md` **not** re-patched in this PR — it already describes the implemented backend (§8 of `task-index`).

---

## 14. How to Verify

```bash
# from repo root (see attached logs: typecheck.log, oxlint.log, vitest.log, migration-rehearsal.log)
./backend/node_modules/.bin/tsc --noEmit                         # 0 errors (R-01/R-02)
./backend/node_modules/.bin/oxlint .                              # 4 warnings (pre-existing), 0 errors
./backend/node_modules/.bin/vitest run --config ./backend/vitest.config.ts ./backend/src/modules/accounting/application/balance-pagination-regression.spec.ts # 5/5
./backend/node_modules/.bin/vitest run --config ./backend/vitest.config.ts ./backend/src/modules/accounting/application/balance-lock-order.spec.ts        # 5/5
./backend/node_modules/.bin/vitest run --config ./backend/vitest.config.ts ./backend/src/modules/accounting/domain/balance-projection.spec.ts              # 15/15
./backend/node_modules/.bin/vitest run --config ./backend/vitest.config.ts                              # 976/976 (85 files)
DATABASE_URL=… ./backend/node_modules/.bin/prisma migrate deploy   # applies 20260922000000_accounting_balance_projection (backfill + views; empty=0 rows, populated=SUM re-derive)
DATABASE_URL=… node backend/prisma/rehearsal/task-12-balance-projection/rehearse.mjs  # rehearsal (see migration-rehearsal.log)
# then Exercise:
# POST /api/v1/accounting-documents (create draft + issue + finalize) → ledger N rows → projection UPSERT in same Tx (R-01: balances before document)
# GET  /api/v1/accounting/balances?organizationId=…&page=1&pageSize=1 → turnover + opening 0
# GET  /api/v1/accounting/balances?organizationId=…&page=2&pageSize=1 → opening == prior closing (R-02: view window before LIMIT)
# GET  /api/v1/accounting/balances/:accountId?organizationId=… → opening/closing exact via full-year derive (already correct)
# GET  /api/v1/accounting/balances/reconciliation?organizationId=… → empty (matched)
# (manual drift: UPDATE accounting.account_balance_projections SET period_debit_amount = period_debit_amount+1 WHERE …) → GET …/reconciliation → debit_mismatch
# POST /api/v1/accounting/balances/rebuild {"organizationId":"…"} → {deleted, inserted}
# GET  /api/v1/accounting/balances/reconciliation?organizationId=… → empty again
# Authorization: unauthenticated → 401; without Accounting.Balance.View → 403; cross-org areaId → 404 (AC-I-16)
```

---

## 15. Review Checklist (for the accept reviewer)

- [ ] `task-index §7` — all 8 conditions exist in the repository (objective, domain scope, non-goals, dependencies, blocking OQs, ADR-0031, acceptance criteria, index row 12) — this PR provides them; explicitly adding Task 12 to the index IS the §7 addition.
- [ ] `task-index §8` follow-ups — none of them is the "next Accounting task" by default; the next task after Task 12 still passes §7. This PR adds no hidden "Task 10.9".
- [ ] OQ-62/63/64, G7 still OPEN per §6 — not silently absorbed.
- [ ] 10.9 still "NOT FORMALLY DEFINED" per §6.
- [ ] ADR-0031 stays Proposed — not marked Accepted outside the normal process; `task-index §7` defines when it becomes Accepted (the task-becomes-Accepted event, not this PR).
- [ ] Task 11 ACCEPTED stays CLOSED — not reopened, not rewritten (the reviewers should verify `docs/task-11-implementation-report.md` and `docs/task-11-defect-resolution-report.md` are untouched except for the version-control `mtime` this report notes).
- [ ] Migration is self-sufficient (insert-from-ledger backfill, no mandatory operator step afterwards) and the alternative (empty-table-only) is documented as rejected.
- [ ] The four endpoints answer 404 (never 403) for foreign keys, 401 for anonymous, 403 for missing `Balance.*` permissions, and never invent a per-read ledger aggregation (balances read the projection; reconciliation aggregates via the view by design).
- [ ] The lock-order matrix (§6.3, this report §5.3) is correct and consistent with `accounting-locks.ts` — the projection is after accounts and before the document, deduplicated + sorted; no `Promise.all` across `FOR` queries; no `account` row held during the rebuild's ledger GROUP.
- [ ] Pagination correctness (R-02): `GET /balances` (view window before LIMIT) and fallback derive-before-pagination both return exact `opening` on page 2+ (opening on page 2 == cumulative prior), verified by `accounting-balances.service.pagination.spec.ts` + `accounting-balances.controller.pagination.spec.ts` + `balance-pagination-regression.spec.ts`; `getAccountBalances` also derives over full year set before slicing (periods loaded from full `all`, not page slice).

When the reviewer ticks these, they may mark **Task 12 → ACCEPTED** in `task-index` (row 12 revision, §3/§6/§9 date, `modules.md` accounting header/row, `ADR-0031` Status `Accepted`, history row), create a patch tag/PR against `main`, and merge. Until then this branch stays `READY FOR REVIEW`.
