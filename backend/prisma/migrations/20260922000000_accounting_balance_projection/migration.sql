-- Accounting module: materialized turnover projection (Task 12,
-- docs/accounting/domain-contract.md §19.3 AC-D-31, §25 AC-I-19, ADR-0031).
--
-- Module + intent (docs/database-strategy.md §2): `accounting` owns its
-- balances. This is a REBUILDABLE, REPORTING-ONLY projection over the
-- immutable ledger — the ledger remains the sole source of truth (§15.2),
-- balances answer \"turnover by period × account\" without per-read
-- `ledger_entries` aggregation. The projection is maintained
-- TRANSACTIONALLY inside the finalization that produced the ledger rows
-- (accounting-documents.repository.ts#finalizeChecked, §15.5 re-read) and
-- via an explicit, audited rebuild operation (domain/balance-projection.ts),
-- never by triggers, background workers, Redis, or cron.
--
-- Design notes:
--   * Key = 5 columns (organization_id, financial_area_id, fiscal_year_id,
--     accounting_period_id, account_id), covering the turnover projection's
--     filter surface. `branch_id`, `currency_code`, `detail` dimension FKs
--     are NOT part of the base key (AR-29, OQ-03/OQ-41 task §17), so they
--     are absent by design — widening the key later is an ADDITIVE
--     migration with a new ADR.
--   * Stored measures are ONLY period turnover (`period_debit_amount`,
--     `period_credit_amount`), both `numeric(18,2)` (AR-12), non-negative
--     exact decimals (AC-I-19a). Derived attributes (`period_net_amount`,
--     `opening_balance_amount`, `closing_balance_amount`) are computed in
--     reporting views / application (window SUM ordered by
--     `accounting_periods.sequence` within the year) and NEVER stored, so no
--     opening/closing columns exist.
--   * Lifecycle: a key's row exists iff the period has non-zero net turnover
--     for that account (AC-I-19c — absence = zero). Zero-sum periods are
--     purged, not persisted. A stale/future assertion such as \"zero rows
--     become non-zero on INSERT\" is refused by this invariant.
--   * Freshness is transactional (§15.5): `finalizeChecked` UPSERTs the
--     projection rows that `ledger_entries` changed in the SAME transaction
--     that inserts those ledger rows and the `accounting_posting_operations`
--     evidence. A concurrent rebuild may either commit first and be observed,
--     or wait on the same row locks — it cannot interleave a partial state.
--   * Concurrency (AR-11): `account_balance_projections` rows are locked
--     after the existing finalization order (financial area → fiscal year →
--     accounting period → referenced accounts `FOR SHARE` ascending by id →
--     the document row `FOR UPDATE`) and before `INSERT`-ed ledger rows are
--     committed — balance rows are taken `FOR UPDATE` in the same ascending
--     order as the accounts that produced them, so no lock-order reversal
--     exists (see data/accounting-locks.ts). This is documented in
--     `docs/accounting/lock-order-matrix.md` Task 12 §(R) row.
--   * Organization isolation: every read filters by `organization_id`
--     (AC-I-01/16 → 404 for foreign keys) and every write carries scoped
--     locks (the `area_is_active` / cross-organization `account_not_found`
--     guards before any write).
--   * No CHECK constraints, no triggers: Prisma cannot represent them, so a
--     later generated migration would silently `DROP` them. The
--     non-negativity / non-negativity-of-measure rules live in the
--     framework-free domain (`domain/balance-projection.ts`) and in the
--     transactional guards (the repository), which is the same reason the
--     ledger migration gives.
--   * Back-compat: the migration chooses ONE strategy (AR-10) — see the
--     backfill block below. The chosen strategy for the Task 12 baseline is:
--     insert-from-ledger (see INSERT selection). Empty installs insert zero
--     rows (idempotent); populated installs re-derive the projection from
--     already-committed ledger entries so the projection is coherent without
--     app code. Ledger entries remain source of truth (§15.2).
--   * Deferred by the contract, so NOT columns here (AR-29): `branch_id`
--     (AC-D-17 is a report filter, not a balance key — OQ-41 branch scope is
--     an additive key widening), `currency_code` / `exchange_rate` (§24.1,
--     OQ-03), dimension `detail_N_id` / `item_id` columns (OQ-41), or opening
--     balance carry/forwards (no `opening_balances` table).
--   * FKs are RESTRICT: a referenced area/year/period/account/organization
--     with balance evidence can never disappear (§8.6, OQ-36 posture). Cross-
--     schema FK direction stays strictly Accounting → Organization.

-- ---- `accounting.account_balance_projections` -----------------------------

CREATE TABLE "accounting"."account_balance_projections" (
    "id"                   TEXT NOT NULL,
    "organization_id"      TEXT NOT NULL,
    "financial_area_id"    TEXT NOT NULL,
    "fiscal_year_id"       TEXT NOT NULL,
    "accounting_period_id" TEXT NOT NULL,
    "account_id"           TEXT NOT NULL,
    -- Period turnover — sum of ledger debit/credit for this key (§19.3,
    -- AC-I-19a). Exact, non-negative, two decimals (AR-12 §13).
    "period_debit_amount"  DECIMAL(18,2) NOT NULL DEFAULT 0,
    "period_credit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"           TEXT,
    "updated_by"           TEXT,

    CONSTRAINT "pk_account_balance_projections" PRIMARY KEY ("id"),

    CONSTRAINT "fk_account_balance_projections_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT "fk_account_balance_projections_financial_area"
        FOREIGN KEY ("financial_area_id")
        REFERENCES "accounting"."financial_areas"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT "fk_account_balance_projections_fiscal_year"
        FOREIGN KEY ("fiscal_year_id")
        REFERENCES "accounting"."fiscal_years"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT "fk_account_balance_projections_accounting_period"
        FOREIGN KEY ("accounting_period_id")
        REFERENCES "accounting"."accounting_periods"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT "fk_account_balance_projections_account"
        FOREIGN KEY ("account_id")
        REFERENCES "accounting"."accounts"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Projection key — one row per (org, area, year, period, account). Hard
-- backstop for concurrent UPSERT races (Task 12 §5.7 idempotency-by-replacement
-- in rebuild and transactional UPSERT in finalizeChecked).
CREATE UNIQUE INDEX "uq_account_balance_projections_org_area_year_period_account"
    ON "accounting"."account_balance_projections"
       ("organization_id", "financial_area_id", "fiscal_year_id",
        "accounting_period_id", "account_id");

-- Hot reads — trial balance & area-year list (ADR-0031).
CREATE INDEX "idx_account_balance_projections_org_area_year"
    ON "accounting"."account_balance_projections"
       ("organization_id", "financial_area_id", "fiscal_year_id");

CREATE INDEX "idx_account_balance_projections_org_account"
    ON "accounting"."account_balance_projections"
       ("organization_id", "account_id");

CREATE INDEX "idx_account_balance_projections_org_period"
    ON "accounting"."account_balance_projections"
       ("organization_id", "accounting_period_id");

-- ---- Backfill (AR-10): insert-from-ledger ---------------------------------
-- One-shot, idempotent INSERT into the new table from already-committed
-- ledger entries. Empty installs insert zero rows (the SELECT returns no
-- groups); populated installs re-derive the projection aggregated by
-- (organization, financial_area, fiscal_year, accounting_period, account)
-- — the projection key — with SUM(period_debit/credit). Absence = zero is
-- preserved: keys whose net is zero still materialize with their non-zero
-- turnover; means-zero-but-turnover-zero keys stay absent (AC-I-19c).
--
-- The alternative AR-10 strategy (empty-table-only, \"app rebuild controls
-- it\") was considered and REJECTED for the baseline: a two-path migration
-- (\"maybe insert, maybe not\") would make the migration outcome ambiguous and
-- force operators to remember to run a post-deploy command. The chosen
-- `insert-from-ledger` keeps the migration self-sufficient, and `rebuild`
-- remains the explicit, audited re-derivation path for future drift.
--
-- Note: ledger rows store scope redundantly on each entry (AC-I-14), so the
-- GROUP aggregates read only the rows themselves; no FK join is needed.
-- Period ordering / opening/closing derivation lives in the reporting view,
-- not in stored data (ADR-0031 §\"Derived only\").

INSERT INTO "accounting"."account_balance_projections"
       ("id",
        "organization_id", "financial_area_id", "fiscal_year_id",
        "accounting_period_id", "account_id",
        "period_debit_amount", "period_credit_amount",
        "created_at", "updated_at")
SELECT
    -- ULID-style random ids are not available in SQL; use deterministic
    -- synthetic ids based on the projection key — collisions are impossible
    -- because the grouping key is UNIQUE by definition.
    -- Use md5 of the concatenated key as surrogate stability (hex 32 chars),
    -- prefixed so the shape stays TEXT id-compatible. Any stable deterministic
    -- function serves: `id` is never a business key, immutability is on the
    -- projection KEY, not on this synthetic id.
    -- This does NOT violate AR-08 (ULID): runtime UPSERTs use `generateId()`
    -- (ULID) in `account-balance-projections.repository.ts`; the backfill's
    -- `abp_`+md5 is a one-time deterministic TEXT PK for migration
    -- idempotency only, shape-compatible with TEXT PK, never used as ULID
    -- outside the migration. A future INSERT via the app never uses this path.
    -- `ledger_entries` at this point contains only finalized rows (only
    -- `finalizeChecked` ever INSERTs ledger rows), so the GROUP re-derives
    -- exactly the finalized turnover without needing a status filter.
    'abp_' || md5(
        le."organization_id" || '|' || le."financial_area_id" || '|' ||
        le."fiscal_year_id" || '|' || le."accounting_period_id" || '|' ||
        le."account_id"
    ),
    le."organization_id", le."financial_area_id", le."fiscal_year_id",
    le."accounting_period_id", le."account_id",
    SUM(le."debit_amount"), SUM(le."credit_amount"),
    NOW(), NOW()
FROM "accounting"."ledger_entries" le
GROUP BY le."organization_id", le."financial_area_id", le."fiscal_year_id",
         le."accounting_period_id", le."account_id"
-- Keep only turnover-non-zero groups: if SUM(debit)=SUM(credit)=0 no row is
-- persisted (AC-I-19c — absence = zero). A numeric exact 0 check on
-- DECIMAL(18,2) is safe — ledger invariants guarantee exactly one of
-- (debit,credit) non-zero per entry, so SUMs are never null.
HAVING SUM(le."debit_amount") <> 0 OR SUM(le."credit_amount") <> 0;
-- The GROUP above is already unique, so no ON CONFLICT is needed; the UNIQUE
-- index is the backstop for any later concurrent UPSERTs.

-- ---- Derived reporting views (ADR-0031 §\"Derived only\") --------------------
-- These views replace the \"opening/closing balance columns\" that §19.2
-- forbids to store — they stay Accounting-owned (report reads never cross a
-- module boundary for balances), are ordered by `accounting_periods.sequence`
-- which is per-year, and never cross fiscal-year boundaries (§4 invariant
-- §5.1/\"Derived only\"). The kernel `PrismaService` has no codegen for
-- views; repositories read them via `$queryRaw` (the documented AR-07 seam
-- for cross-primitive reads).
--
-- `vw_account_balance_derived`: one row per stored projection + derived
-- measures. `period_net_amount = period_debit - period_credit`,
-- `opening_balance_amount = cumulative closing up to prior period` and
-- `closing_balance_amount = opening + period_net` — all windowed by
-- (organization, financial_area, fiscal_year, account) ordered by period
-- sequence (the authoritative intra-year ordering §7.1). `opening` is zero
-- for the first period with data; periods without projection rows are NOT
-- synthesized (absence = zero turnover, NOT a zero-balance row) — callers
-- that need dense period series should LEFT JOIN `accounting_periods`
-- explicitly in their reporting query (§19.2 — balances are TURNOVER, not
-- trial-balance rows).
--
-- `vw_balance_reconciliation`: the FULL OUTER JOIN between ledger-derived
-- turnover and projection rows, exposing `scope_mismatch` vs `debit_mismatch`
-- vs `credit_mismatch` (§25). The application layer (`balance-reconciliation`
-- domain) classifies mismatches identically; this view is the SQL mirror for
-- DBAs and is what `reconcile` could also `$queryRaw` against.

CREATE OR REPLACE VIEW "accounting"."vw_account_balance_derived" AS
SELECT
    abp."id",
    abp."organization_id",
    abp."financial_area_id",
    abp."fiscal_year_id",
    abp."accounting_period_id",
    ap."sequence" AS "period_sequence",
    abp."account_id",
    abp."period_debit_amount",
    abp."period_credit_amount",
    -- Period net turnover (exact, DECIMAL(18,2) arithmetic in Postgres).
    (abp."period_debit_amount" - abp."period_credit_amount")
        AS "period_net_amount",
    -- Opening balance for this period = cumulative closing up to prior period
    -- (windowed, never crossing a fiscal year boundary by construction: the
    -- PARTITION includes fiscal_year_id, so the first period's prior sum is
    -- NULL → coalesced to 0).
    COALESCE(
        SUM(abp."period_debit_amount" - abp."period_credit_amount")
            OVER (PARTITION BY abp."organization_id", abp."financial_area_id",
                                abp."fiscal_year_id", abp."account_id"
                  ORDER BY ap."sequence"
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),
        0
    ) AS "opening_balance_amount",
    -- Closing = opening + period_net.
    COALESCE(
        SUM(abp."period_debit_amount" - abp."period_credit_amount")
            OVER (PARTITION BY abp."organization_id", abp."financial_area_id",
                                abp."fiscal_year_id", abp."account_id"
                  ORDER BY ap."sequence"
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),
        0
    ) + (abp."period_debit_amount" - abp."period_credit_amount")
        AS "closing_balance_amount",
    abp."created_at",
    abp."updated_at"
FROM "accounting"."account_balance_projections" abp
JOIN "accounting"."accounting_periods" ap
  ON ap."id" = abp."accounting_period_id";

CREATE OR REPLACE VIEW "accounting"."vw_balance_reconciliation" AS
-- FULL OUTER JOIN is asymmetric without a driving raw: generate both sides
-- from their grouped ledger aggregate and projection rows, so that
-- ledger-only, projection-only, and mismatched groups all surface.
WITH ledger_agg AS (
    SELECT le."organization_id", le."financial_area_id", le."fiscal_year_id",
           le."accounting_period_id", le."account_id",
           SUM(le."debit_amount")  AS "ledger_debit",
           SUM(le."credit_amount") AS "ledger_credit"
    FROM "accounting"."ledger_entries" le
    GROUP BY le."organization_id", le."financial_area_id", le."fiscal_year_id",
             le."accounting_period_id", le."account_id"
    HAVING SUM(le."debit_amount") <> 0 OR SUM(le."credit_amount") <> 0
),
proj_agg AS (
    SELECT abp."organization_id", abp."financial_area_id", abp."fiscal_year_id",
           abp."accounting_period_id", abp."account_id",
           abp."period_debit_amount"  AS "proj_debit",
           abp."period_credit_amount" AS "proj_credit"
    FROM "accounting"."account_balance_projections" abp
)
SELECT
    COALESCE(la."organization_id", pa."organization_id")      AS "organization_id",
    COALESCE(la."financial_area_id", pa."financial_area_id") AS "financial_area_id",
    COALESCE(la."fiscal_year_id", pa."fiscal_year_id")       AS "fiscal_year_id",
    COALESCE(la."accounting_period_id", pa."accounting_period_id")
                                                             AS "accounting_period_id",
    COALESCE(la."account_id", pa."account_id")                AS "account_id",
    la."ledger_debit",  la."ledger_credit",
    pa."proj_debit",    pa."proj_credit",
    CASE
        WHEN la."account_id" IS NULL THEN 'extra_projection'
        WHEN pa."account_id" IS NULL THEN 'missing_projection'
        WHEN la."ledger_debit"  <> pa."proj_debit"  AND
             la."ledger_credit" <> pa."proj_credit" THEN 'both_mismatch'
        WHEN la."ledger_debit"  <> pa."proj_debit"  THEN 'debit_mismatch'
        WHEN la."ledger_credit" <> pa."proj_credit" THEN 'credit_mismatch'
        -- Exact 0/0 turnover groups stay excluded by the HAVING — neither side
        -- should surface them — so remaining ledger=projection equality is
        -- truly matched.
        ELSE 'matched'
    END AS "mismatch_kind"
FROM ledger_agg la
FULL OUTER JOIN proj_agg pa
  ON  la."organization_id"       = pa."organization_id"
 AND la."financial_area_id"     = pa."financial_area_id"
 AND la."fiscal_year_id"        = pa."fiscal_year_id"
 AND la."accounting_period_id"  = pa."accounting_period_id"
 AND la."account_id"            = pa."account_id";
