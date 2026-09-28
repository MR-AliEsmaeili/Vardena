# ADR-0031: Accounting Balance Projection — Rebuildable Turnover-Only Materialization

- **Status:** Proposed (2026-09-22 — vertical slice implemented as `READY FOR REVIEW`, not Accepted)
- **Date:** 2026-09-22
- **Implements:** Task 12 (Accounting Balance Projection), contract §19.3 AC-D-31, §25 AC-I-19
- **Builds on:** ADR-0026 (Accounting bounded context), ADR-0008/0009/0017, ADR-0021/0025 (scope), ADR-0022/0023 (idempotency/numbering)
- **Open questions intentionally not absorbing:** OQ-62/63/64, G7, OQ-03/41/42 — see § Deferred

## Context

The accounting contract (§19.2/§19.3) allows **two** legitimate consumers of accounting state: (1) the immutable ledger (final document lines → `ledger_entries`, Task 10.7) and (2) a **materialized, rebuildable** balance projection per `(organization, financial_area, fiscal_year, accounting_period, account)`. No other consumer may read operational documents or other modules' tables (AR-07, AC-I-13), and no report may recompute accounting from business facts at read time (AC-D-31). The ledger is sole source of truth; the projection is reporting-only and answers "turnover by period × account" without per-read `ledger_entries` aggregation. The contract deliberately leaves branch/currency/dimension widening, opening-balance carry, and multi-area semantics as later additive questions (OQ-03/40/41/42/43) — AR-29 forbids speculative columns.

Task 12 must therefore ship a **strict vertical slice**: a projection that is (a) written **transactionally** inside finalization, (b) re-derivable from the ledger by an explicit audited operation, (c) readable only within one organization (AC-I-01/16 → 404) and one financial scope, (d) scoped to `final`-only rows, (e) never persisting zero-turnover rows, and (f) idempotent-by-replacement on rebuild — while preserving the module's fixed lock order (§5.7/AR-11) and introducing no Redis/triggers/microservices/EAV.

## Decision

1. **Table `accounting.account_balance_projections`** (Prisma `AccountBalanceProjection`) with five-column natural key `UNIQUE (organization_id, financial_area_id, fiscal_year_id, accounting_period_id, account_id)` + three secondary indexes `(org, area, year)`, `(org, account)`, `(org, period)` (ADR-0021 — indexes lead with scope). No other unique.

2. **Stored measures ONLY `period_debit_amount`, `period_credit_amount`** — both `numeric(18,2)` (AR-12), non-negative, exact, never rounded. Derived `period_net = debit − credit`, `opening = window SUM closing up to prior period`, `closing = opening + period_net` are **never stored** — computed in `vw_account_balance_derived` (window ordered by `accounting_periods.sequence` within the year) and identically in the domain (`deriveBalances`). Views never cross fiscal-year boundaries (PARTITION BY fiscal_year_id).

3. **Key is five columns only.** `branch_id` (AC-D-17 — header-level reporting filter), `currency_code`/`exchange_rate` (§24.1/OQ-03), and detail-dimension FKs (OQ-41) are **absent by design** (AR-29). Widening is an additive migration with a new ADR.

4. **Absence = zero turnover (AC-I-19c) — interpretation A chosen and explicit.** A key with `0/0` turnover is not persisted; deleting the last turnover deletes the row. Migrated or rebuilt ledgers whose `SUM(debit)=SUM(credit)=0` for a key produce no row. **Only periods that have non-zero turnover appear in the projection and in `vw_account_balance_derived`; periods without turnover are NOT synthesized (absence = zero turnover, not a zero-balance row).** Callers that need a dense period series (Trial Balance, General Ledger, Balance Sheet, periodic reporting) must explicitly `LEFT JOIN accounting.accounting_periods` to generate empty periods — the projection itself never fabricates them. This is the contract-compliant choice for Task 12; a future reporting helper may provide a dense view, but it is not part of this ADR's scope.

5. **Transactional maintenance.** `AccountingDocumentsRepository.finalizeChecked` UPSERTs the touched projection keys **after** `insertLedgerEntries` and **before** `insertOperationRow` (which stays LAST per §16.4). Ledger entries are built once via `domain/posting.ts` (no second implementation); balance deltas are grouped by projection key and summed exactly. Concurrency: projection rows are locked `FOR UPDATE` after the existing `accounts FOR SHARE (ascending id)` and before `accounting_document FOR UPDATE`, ordered by key — see `data/accounting-locks.ts` Task 12 tail and `docs/accounting/lock-order-matrix.md` rows R1…R8. The UNIQUE index is the cross-transaction backstop; a raced `INSERT` is retried as `UPDATE` inside the transaction.

6. **Rebuild is scoped, atomic, audited, idempotent-by-replacement (AC-I-19e).** `POST /balances/rebuild` (permission `Accounting.Balance.Rebuild`) takes `financial_area_id`? and `fiscal_year_id`? (both must belong to the org, 404 otherwise); scope is always org-wide and optionally narrowed. Inside one transaction it `DELETE`s the scoped slice (`FOR UPDATE` on the slice), `GROUP BY` the ledger (`SUM(debit/credit) HAVING <> 0` — ledger-only source), `INSERT`s the re-derived rows. The Inventory `Reconciliation.Execute` precedent (§19.3) governs authorization and audit. Emits `AccountBalance.Rebuilt` with `(org, area?, year?, deleted, inserted, reason, rebuiltBy, rebuiltAt)`; no history table.

7. **Reads.** `GET /balances` (paginated, permission `Balance.View`) requires `organizationId` + optional `financialAreaId/fiscalYearId/accountingPeriodId/accountId`; `GET /balances/:accountId` (account-scoped, opening windowed over the whole year so paging stays exact) and `GET /balances/reconciliation` (FULL OUTER JOIN ledger-aggregate vs projection — `vw_balance_reconciliation` + identical domain `reconcileBalances`, surfacing `missing_projection/extra_projection/debit_mismatch/credit_mismatch/both_mismatch`). All reads answer 404 for foreign keys (AC-I-16), 401/403 via the shared `AuthGuard/AuthorizationGuard`.

8. **Migration (AR-10 — single strategy, chosen).** One migration `20260922000000_accounting_balance_projection`: creates the table, UNIQUE + 3 indexes, two views (`vw_account_balance_derived`, `vw_balance_reconciliation`), and a backfill `INSERT … SELECT SUM(debit/credit) FROM ledger_entries GROUP BY key HAVING <> 0` (empty installs insert 0 rows — idempotent; populated installs become coherent without app code). The alternative (empty-table-only + mandatory post-deploy rebuild) is rejected for the baseline because a two-path migration would make the outcome operator-dependent. Ledger entries remain source (§15.2).

9. **Deferred (not invented).** No `branch_id`, no `currency_code`, no `detail_N_id`, no `opening_balances` table, no trigger, no Redis, no generic document tables, no EAV, no workflow engine. OQ-62/63/64/G7 are **not absorbed**. **Fiscal-year opening carry-forward is explicitly deferred:** Task 12's `vw_account_balance_derived` window is `PARTITION BY organization, financial_area, fiscal_year, account` (never crossing a year boundary), so the opening of the first period of any fiscal year is always `0` (or the cumulative of earlier periods _within the same year only_). Transfer of a prior year's closing balance as the next year's opening (Opening Balance / Fiscal Year Transition) is **out of scope** for Task 12 and will be decided in a dedicated additive task (Fiscal Year Transition / Opening Balance) with its own ADR — Task 12 only provides intra-year turnover and derived opening/closing within the same fiscal year.

## Alternatives Considered

- **Empty-table-only migration + app rebuild** — rejected: makes the migration outcome ambiguous and forces a mandatory operator step for coherence; ledger stays truthful, but historically the post-migration state would be inconsistent until rebuild succeeds.
- **Per-opening-balance column/storage + carry forwarding** — rejected: §19.2 forbids storing opening/closing; they must be derived. Crossing-year carry would violate the per-year window rule.
- **Per-voucher closing trigger/background aggregator** — rejected: AR-29 and the contract's "explicit audited rebuild" (AC-I-19) forbid invisible maintenance.

## Consequences

- Trial-balance and period × account reports can read the projection (or the derived view) instead of aggregating `ledger_entries` on every request, with identical answers to the ledger (reconciliation detects drift).
- The module's lock order gains a nested tail (projection rows after accounts, before the document), documented in `docs/accounting/lock-order-matrix.md`; every finalization and rebuild path obeys it, and the UNIQUE index preserves serializability across transactions.
- Two permissions (`Accounting.Balance.View`, `Accounting.Balance.Rebuild`) register via `AccountingPermissionRegistration` and gate exactly the four new endpoints; no wildcard, no bypass (OQ-21).
- Future widening (branch, currency, dimensions) is **additive**: new columns to the key and to the UPSERT predicates, plus updated views and rebuild predicates — the base key never silently gains a dimension.
- Risks: pagination of derived `{opening, closing}` is correct only on single-account / single-year windows or via the view; the cross-year derived series must be assembled explicitly (the view/documents-section rule). The candidacy of Task 12 stays `Proposed` → `Ready for review` until the promotion gate (§7 — 8 conditions) is explicitly accepted; this ADR must not be marked Accepted outside that process (AG-07).
- If rejected, the migration and the four endpoints are reverted, the projection table/views are dropped, and reporting falls back to ledger aggregation (the contract-compliant but slower path) until a new ADR proposes the projection.

## Links

- Contract: `docs/accounting/domain-contract.md` §12…§19, §22, §25, §28 (§7/§19.2/§19.3 authority for turnover-only, no opening, rebuildable, financial scope)
- Module docs: `docs/modules.md` §Accounting (68 → 69 when Accepted), `docs/accounting/task-index.md` (Task 12 candidate, 10.9 skipped)
- Code: `backend/prisma/schema/accounting.prisma` (model), `backend/prisma/migrations/20260922000000_accounting_balance_projection/migration.sql` (single-strategy backfill + two views), `backend/src/modules/accounting/domain/balance-projection.ts` (pure aggregation + window + reconciliation), `backend/src/modules/accounting/data/account-balance-projections.repository.ts` (in-tx UPSERT + audited slice rebuild), `backend/src/modules/accounting/data/accounting-locks.ts` (Task 12 tail), `backend/src/modules/accounting/application/accounting-balances.service.ts` + `api/accounting-balances.controller.ts` (AR-03), `domain/accounting-permissions.ts` (31 → 33), `domain/accounting.events.ts` (`AccountBalance.Rebuilt`)
- Invariants preserved: §5.1 ledger as truth, §5.2 org isolation → 404, §5.3 financial scope, §5.4 final-only, §5.5 no negative, §5.6 zero-rows-absent, §5.7 idempotency via existing evidence; §6 delivery semantics gate (OQ-39)
- Open questions still open: OQ-03 (currency), OQ-40 (area applicability), OQ-41 (dimensions), OQ-42 (approval vs finalize), OQ-43 (statutory), plus new-branch OQ-62/63/64/G7 (deferred)
