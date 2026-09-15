-- Accounting module: the accounting document (voucher) aggregate — header,
-- lines and the posting-operation idempotency ledger (Task 10.4,
-- docs/accounting/domain-contract.md §12/§13/§15/§16/§18,
-- AC-D-16…AC-D-23, AC-I-04/05/06/07/08/09/12/14/16/22).
--
-- Module + intent (docs/database-strategy.md §2): `accounting` owns the
-- voucher. These are TYPED, Accounting-owned tables — there is deliberately no
-- universal document table and no move of business documents into the
-- Document Foundation's schema (ADR-0019/ADR-0023: the Foundation supplies
-- type registration, numbering and relations; every business module owns its
-- own document tables and lifecycle):
--   * `accounting.accounting_documents`        — the voucher header;
--   * `accounting.accounting_document_lines`   — its lines (debit/credit,
--     account, dense 1-based `line_no`);
--   * `accounting.accounting_posting_operations` — the idempotency ledger
--     (one row per completed posting operation, unique per
--     `(organization_id, operation_key)`), written inside the transaction
--     that performs the effect.
--
-- Design notes:
--   * Money is `numeric(18,2)` (AR-12, contract §13.5). Two non-negative
--     columns (`debit_amount`, `credit_amount`) instead of a signed amount:
--     the statutory layouts are debit/credit columns, and `Σ debit = Σ credit`
--     stays expressible as plain SQL (AC-D-18, §13.3). The exact-arithmetic
--     balance rule and "exactly one side non-zero" are domain rules
--     (`domain/voucher-lines.ts`, `domain/money.ts`), re-evaluated INSIDE the
--     finalization transaction under the document lock (§13.1, §15.5).
--   * `document_date` is `DATE` — a business date, not an instant (§12.3).
--     The resolved `fiscal_year_id` + `accounting_period_id` are STORED on the
--     header and denormalized onto every line, so reports never recompute a
--     period from a date and history stays interpretable without the current
--     calendar configuration (AC-I-14, ADR-0021 §3).
--   * `state` (`draft`|`temporary`|`final`) and `origin` (`manual`|`system`)
--     are closed, code-defined lists stored as TEXT — the decision every
--     previous migration records: extending a list is an ordinary change,
--     never an `ALTER TYPE`. `draft` is the Foundation's pre-issuance PHASE,
--     not a third state (AC-D-20). No CHECK constraints: Prisma cannot
--     represent them, so a later generated migration would `DROP` them; the
--     value rules live in the framework-free domain layer and are unit-tested.
--   * Final is structurally immutable and never deletable (AC-I-05/06):
--     `state = 'final'` is written only by the finalization transaction, and
--     the application exposes no update path for it. A pre-final voucher may
--     be deleted (§15.3, AC-D-21) — the ONLY delete in the accounting schema,
--     and the reason `accounting_document_lines.document_id` cascades. A
--     discarded numbered voucher leaves its `documents.numbering_allocations`
--     row untouched: the gap is visible and auditable (`reuse_policy =
--     never`, §15.3/§18).
--   * Numbering is NOT re-implemented here. The serial is allocated by the
--     Document Foundation (ADR-0023 §3: series row lock + `(series_id, number)`
--     unique + append-only allocation ledger, idempotent per
--     `(series_id, allocation_key)`), with `scope_key` = the financial area
--     (§18). The `uq_accounting_documents_org_area_number` index below is the
--     accounting-side backstop that makes a duplicate number impossible to
--     persist; `document_number` is NULL until issuance, and PostgreSQL treats
--     NULLs as distinct, so any number of drafts coexist.
--   * Concurrency (docs/database-strategy.md §13, AR-11): every document write
--     re-evaluates its guard INSIDE one short `SELECT … FOR UPDATE`
--     transaction, never check-then-act across the boundary. Lock order is
--     fixed and never reversed: financial area → fiscal year → accounting
--     period → referenced accounts (ascending by id, `FOR SHARE`) → the
--     document row itself. No path ever takes a later lock before an earlier
--     one, so no deadlock cycle exists. Neither exclusion constraints nor
--     triggers are used: they are invisible to Prisma and would be dropped by
--     the next generated migration, silently losing the invariant.
--   * System-origin identity (`source_module`/`source_entity_type`/
--     `source_entity_id`/`source_operation`) and the idempotency evidence
--     (`idempotency_reference`, `request_hash`) are LOGICAL references, never
--     cross-module FKs (AR-07/08, §16.3). No production system-posting
--     integration exists before OQ-39 is resolved (§16.6, AC-D-26); the
--     columns exist because the row must be able to represent both origins
--     (§12.1), and the domain enforces that a `manual` document carries no
--     source identity while a `system` one carries all of it.
--   * Deferred by the contract, so NOT created here (AR-29): correction links
--     and `correction_kind`/`correction_reason` (§15.4, AC-D-22 — the
--     correction task), per-line dimension assignments
--     (`accounting_document_line_details`, §10.6/§24 — OQ-41), currency/
--     exchange-rate (§24.1, OQ-03), quantity (§12.6) and attachments (§12.6).
--   * Cross-schema FK direction stays strictly Accounting → Organization.
--
-- Locking/guard note for the next reader: the guards live in
-- `data/accounting-locks.ts` (+ the repository transactions), which is the
-- documentation the concurrency-critical raw SQL depends on (AR-11).

-- ---- `accounting.accounting_documents` ------------------------------------

CREATE TABLE "accounting"."accounting_documents" (
    "id"                     TEXT NOT NULL,
    "organization_id"        TEXT NOT NULL,
    "financial_area_id"      TEXT NOT NULL,
    "fiscal_year_id"         TEXT NOT NULL,
    "accounting_period_id"   TEXT NOT NULL,
    "document_type"          VARCHAR(64) NOT NULL DEFAULT 'accounting_voucher',
    "document_number"        VARCHAR(32),
    "document_date"          DATE NOT NULL,
    "description"            VARCHAR(500) NOT NULL,
    "state"                  VARCHAR(16) NOT NULL DEFAULT 'draft',
    "origin"                 VARCHAR(16) NOT NULL,
    "branch_id"              TEXT,
    "source_module"          VARCHAR(64),
    "source_entity_type"     VARCHAR(64),
    "source_entity_id"       TEXT,
    "source_operation"       VARCHAR(32),
    "idempotency_reference"  VARCHAR(128),
    "request_hash"           CHAR(64),
    "finalized_at"           TIMESTAMPTZ(6),
    "finalized_by"           TEXT,
    "correlation_id"         VARCHAR(64),
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"             TEXT,
    "updated_by"             TEXT,
    CONSTRAINT "pk_accounting_documents" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_documents_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- RESTRICT everywhere: an area/year/period/branch a document resolved can
    -- never disappear (nothing in the calendar is deleted — OQ-36). A moved
    -- document is re-dated, never re-pointed, and `final` is immutable.
    CONSTRAINT "fk_accounting_documents_financial_area"
        FOREIGN KEY ("financial_area_id")
        REFERENCES "accounting"."financial_areas"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_documents_fiscal_year"
        FOREIGN KEY ("fiscal_year_id")
        REFERENCES "accounting"."fiscal_years"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_documents_accounting_period"
        FOREIGN KEY ("accounting_period_id")
        REFERENCES "accounting"."accounting_periods"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_documents_branch"
        FOREIGN KEY ("branch_id")
        REFERENCES "organization"."branches"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The number's uniqueness scope (§18: one monotonic series per
-- (organization, type, area)). NULLs are distinct in PostgreSQL, so drafts
-- (no number yet) never collide.
CREATE UNIQUE INDEX "uq_accounting_documents_org_area_number"
    ON "accounting"."accounting_documents" ("organization_id", "financial_area_id", "document_number");

CREATE INDEX "idx_accounting_documents_organization_id_state"
    ON "accounting"."accounting_documents" ("organization_id", "state");

CREATE INDEX "idx_accounting_documents_org_area_date"
    ON "accounting"."accounting_documents" ("organization_id", "financial_area_id", "document_date");

CREATE INDEX "idx_accounting_documents_org_period"
    ON "accounting"."accounting_documents" ("organization_id", "accounting_period_id");

-- ---- `accounting.accounting_document_lines` -------------------------------

CREATE TABLE "accounting"."accounting_document_lines" (
    "id"                    TEXT NOT NULL,
    "document_id"           TEXT NOT NULL,
    "organization_id"       TEXT NOT NULL,
    "financial_area_id"     TEXT NOT NULL,
    "fiscal_year_id"        TEXT NOT NULL,
    "accounting_period_id"  TEXT NOT NULL,
    "line_no"               INTEGER NOT NULL,
    "account_id"            TEXT NOT NULL,
    "debit_amount"          DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit_amount"         DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description"           VARCHAR(500),
    "source_line_reference" VARCHAR(128),
    "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"            TEXT,
    "updated_by"            TEXT,
    CONSTRAINT "pk_accounting_document_lines" PRIMARY KEY ("id"),
    -- CASCADE: a line has no existence outside its document, and deleting a
    -- pre-final voucher (§15.3) removes its aggregate parts. `final` is never
    -- deletable, so no line of a booked document can ever be lost this way.
    CONSTRAINT "fk_accounting_document_lines_document"
        FOREIGN KEY ("document_id")
        REFERENCES "accounting"."accounting_documents"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_document_lines_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_document_lines_financial_area"
        FOREIGN KEY ("financial_area_id")
        REFERENCES "accounting"."financial_areas"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_document_lines_fiscal_year"
        FOREIGN KEY ("fiscal_year_id")
        REFERENCES "accounting"."fiscal_years"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_document_lines_accounting_period"
        FOREIGN KEY ("accounting_period_id")
        REFERENCES "accounting"."accounting_periods"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- RESTRICT: an account that carries lines can never disappear, and the
    -- freeze of `is_postable`/`parent_id`/`level`/`account_nature` after use
    -- is enforced by the account guard transaction (AC-I-11).
    CONSTRAINT "fk_accounting_document_lines_account"
        FOREIGN KEY ("account_id")
        REFERENCES "accounting"."accounts"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The legal-book rendering order, and the hard backstop for a duplicated or
-- missing line ordinal (dense numbering is asserted by the domain rule).
CREATE UNIQUE INDEX "uq_accounting_document_lines_document_id_line_no"
    ON "accounting"."accounting_document_lines" ("document_id", "line_no");

-- Account statements / ledger reads by account within the organization scope.
CREATE INDEX "idx_accounting_document_lines_org_account"
    ON "accounting"."accounting_document_lines" ("organization_id", "account_id");

-- ---- `accounting.accounting_posting_operations` ---------------------------

CREATE TABLE "accounting"."accounting_posting_operations" (
    "id"              TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "operation_key"   VARCHAR(128) NOT NULL,
    "operation"       VARCHAR(32) NOT NULL,
    "request_hash"    CHAR(64) NOT NULL,
    "result"          JSONB NOT NULL,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_accounting_posting_operations" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_posting_operations_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The idempotency key scope (AC-I-12, §16.4): one completed operation per
-- (organization, key). This index — not a SELECT-then-INSERT — is the
-- authoritative guard; the insert is the LAST statement of the effect
-- transaction, so a lost key race aborts the whole transaction and can never
-- leave a committed effect without its key.
CREATE UNIQUE INDEX "uq_accounting_posting_operations_org_key"
    ON "accounting"."accounting_posting_operations" ("organization_id", "operation_key");

CREATE INDEX "idx_accounting_posting_operations_org_operation"
    ON "accounting"."accounting_posting_operations" ("organization_id", "operation");
