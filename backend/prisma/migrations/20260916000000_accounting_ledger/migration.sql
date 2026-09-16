-- Accounting module: the immutable ledger entries table (Task 10.7,
-- docs/accounting/domain-contract.md §12/§13/§15/§19,
-- AC-D-16…AC-D-23, AC-I-05/06/07/08/14/19/22).
--
-- Module + intent (docs/database-strategy.md §2): `accounting` owns its
-- ledger. This is a TYPED, Accounting-owned table — the rows the task brief
-- calls for, materialized atomically by the finalization transaction
-- (`AccountingDocumentsRepository.finalizeChecked`, §15.5 AC-D-23):
--   * `accounting.ledger_entries` — one immutable row per posted voucher
--     line (N rows per finalization, N = stored lines ≥ 2), committed in the
--     SAME transaction as the document state change and the
--     `accounting_posting_operations` evidence row.
--
-- Design notes:
--   * There is deliberately NO separate `posted` state (AC-D-20): `final` =
--     posted. The idempotency evidence stays the existing
--     `document_finalize` row in `accounting_posting_operations` — that
--     ledger is evidence infrastructure, NOT the ledger identity and NOT a
--     Posting entity (Task 10.6 correction). The entry identity is the row's
--     own ULID (`id`), never reused, never derived from a mutable business
--     field, and NOT `accounting_posting_operations.id`.
--   * Money is `numeric(18,2)` (AR-12, contract §13.5): two non-negative
--     columns (`debit_amount`, `credit_amount`), exactly one non-zero per
--     entry (§13.2, AC-I-08). Money is carried as decimal STRINGS through
--     the domain, never floats, never rounded (§13.1/§13.5, AC-I-07).
--   * The scope is STORED on every entry (`organization_id`,
--     `financial_area_id`, `fiscal_year_id`, `accounting_period_id`): reports
--     never recompute a resolution, and history stays interpretable without
--     the current calendar configuration (AC-I-14, ADR-0021 §3).
--   * Complete sourcing snapshot: `voucher_id` + `voucher_line_id` (the 1:1
--     traceability key) + `line_no`, the immutable `voucher_number` (AC-I-22,
--     §18), the account, the business `document_date` (Class C3), the
--     `posting_timestamp` snapshot of `finalized_at` (§15.5), the
--     header-level `branch_id` (AC-D-17, Class C5), `origin` (§16.1, AC-D-24),
--     the logical system-source identity (§16.3), `correlation_id`
--     (docs/architecture.md §9) and `finalized_by` (§23) — so an entry is
--     traceable to organization, area, year, period, voucher, voucher number,
--     voucher line and account without re-reading mutable state.
--   * The UNIQUE backstop below (`uq_ledger_entries_voucher_line_id`) makes
--     a second entry for one voucher line impossible to persist, however many
--     times a finalization is retried — the structural half of the
--     first-persister-wins rule; the state machine + the operation ledger are
--     the other half.
--   * Immutability is STRUCTURAL: the application exposes no update or delete
--     path for these rows (AC-I-05/06, §15.2/§15.3); corrections are future
--     counter-documents with new entries (AC-D-22). No CHECK constraints and
--     no triggers: Prisma cannot represent them, so a later generated
--     migration would `DROP` them; the amount/side/line-number rules live in
--     the framework-free domain (`domain/ledger-entry.ts`, `domain/posting.ts`)
--     and are evaluated INSIDE the finalization transaction under the
--     document lock.
--   * All FKs are RESTRICT: a voucher/line/account/area/year/period/branch
--     with ledger evidence can never disappear (§8.6, OQ-36 posture — nothing
--     is deleted). Cross-schema FK direction stays strictly
--     Accounting → Organization. The system-source identity stays LOGICAL
--     references, never cross-module FKs (AR-07/08, §16.3); production
--     system-posting integrations still wait on OQ-39 (§16.6, AC-D-26).
--   * Deferred by the contract, so NOT created here (AR-29): dimension
--     assignments (the typed child table of §10.6 arrives with OQ-41 — no
--     `detail_1_id` columns, no EAV, no JSONB), currency/exchange-rate
--     (§24.1, OQ-03) and balance projections (§19.3 — a future rebuildable
--     projection OVER these rows, never state maintained here).
--
-- Locking/guard note for the next reader: the materialization lives in the
-- finalization transaction, so no new lock order exists — the established
-- order (financial area → fiscal year → accounting period → referenced
-- accounts ascending by id `FOR SHARE` → the document row) is unchanged, and
-- the INSERTs land between the state update and the operation-ledger insert
-- (kept LAST, the §16.4 evidence rule). The guards live in
-- `data/accounting-locks.ts` (+ the repository transactions), which is the
-- documentation the concurrency-critical raw SQL depends on (AR-11).

-- ---- `accounting.ledger_entries` ------------------------------------------

CREATE TABLE "accounting"."ledger_entries" (
    "id"                   TEXT NOT NULL,
    "organization_id"      TEXT NOT NULL,
    "financial_area_id"    TEXT NOT NULL,
    "fiscal_year_id"       TEXT NOT NULL,
    "accounting_period_id" TEXT NOT NULL,
    "voucher_id"           TEXT NOT NULL,
    "voucher_number"       VARCHAR(32) NOT NULL,
    "voucher_line_id"      TEXT NOT NULL,
    "line_no"              INTEGER NOT NULL,
    "account_id"           TEXT NOT NULL,
    "debit_amount"         DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit_amount"        DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description"          VARCHAR(500),
    "document_date"        DATE NOT NULL,
    "posting_timestamp"    TIMESTAMPTZ(6) NOT NULL,
    "branch_id"            TEXT,
    "origin"               VARCHAR(16) NOT NULL,
    "source_module"        VARCHAR(64),
    "source_entity_type"   VARCHAR(64),
    "source_entity_id"     TEXT,
    "source_operation"     VARCHAR(32),
    "correlation_id"       VARCHAR(64),
    "finalized_by"         TEXT,
    "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"           TEXT,
    "updated_by"           TEXT,
    CONSTRAINT "pk_ledger_entries" PRIMARY KEY ("id"),
    CONSTRAINT "fk_ledger_entries_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_ledger_entries_financial_area"
        FOREIGN KEY ("financial_area_id")
        REFERENCES "accounting"."financial_areas"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_ledger_entries_fiscal_year"
        FOREIGN KEY ("fiscal_year_id")
        REFERENCES "accounting"."fiscal_years"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_ledger_entries_accounting_period"
        FOREIGN KEY ("accounting_period_id")
        REFERENCES "accounting"."accounting_periods"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- RESTRICT: a voucher with ledger evidence can never disappear (`final`
    -- is never deletable, so this backstop only speaks for hand-written rows).
    CONSTRAINT "fk_ledger_entries_voucher"
        FOREIGN KEY ("voucher_id")
        REFERENCES "accounting"."accounting_documents"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- RESTRICT + UNIQUE (below): exactly one entry per voucher line (1:1),
    -- and a line with ledger evidence can never disappear.
    CONSTRAINT "fk_ledger_entries_voucher_line"
        FOREIGN KEY ("voucher_line_id")
        REFERENCES "accounting"."accounting_document_lines"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- RESTRICT: an account with ledger entries can never disappear (§8.6).
    CONSTRAINT "fk_ledger_entries_account"
        FOREIGN KEY ("account_id")
        REFERENCES "accounting"."accounts"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_ledger_entries_branch"
        FOREIGN KEY ("branch_id")
        REFERENCES "organization"."branches"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The 1:1 backstop (VoucherLine → LedgerEntry): a second entry for the same
-- line is impossible to persist, however many times a finalization is
-- retried. The voucher side needs no uniqueness: one voucher yields N
-- entries (read via `idx_ledger_entries_org_voucher`).
CREATE UNIQUE INDEX "uq_ledger_entries_voucher_line_id"
    ON "accounting"."ledger_entries" ("voucher_line_id");

-- One voucher's entries within the organization scope (the materialization
-- read after finalization, the voucher's ledger view).
CREATE INDEX "idx_ledger_entries_org_voucher"
    ON "accounting"."ledger_entries" ("organization_id", "voucher_id");

-- Account ledger reads within the organization scope (postings by account).
CREATE INDEX "idx_ledger_entries_org_account"
    ON "accounting"."ledger_entries" ("organization_id", "account_id");

-- Period ledger reads within the organization scope (postings by period).
CREATE INDEX "idx_ledger_entries_org_period"
    ON "accounting"."ledger_entries" ("organization_id", "accounting_period_id");
