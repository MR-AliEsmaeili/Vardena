-- Accounting module: Financial Area + Fiscal Year + Accounting Period
-- foundation (Task 10.2, ADR-0026, docs/accounting/domain-contract.md
-- §4/§5/§6/§7, AC-D-01…AC-D-05, AC-I-01/AC-I-03).
--
-- Module + intent (docs/database-strategy.md §2): `accounting` module — the
-- bookkeeping scope spine every later Accounting concept hangs off:
--   * `accounting.financial_areas`    — bookkeeping scopes (حوزه مالی),
--     owned by exactly one organization (n ≥ 1 areas per organization;
--     OQ-40 multiplicity stays open, the model permits more than one);
--   * `accounting.fiscal_years`       — explicit dated years per area;
--   * `accounting.accounting_periods` — explicit dated rows inside one year.
--
-- Design notes:
--   * Every row carries `organization_id` (NOT NULL, FK RESTRICT): the
--     tenant/security boundary (ADR-0021, AC-D-01). Periods additionally
--     denormalize `financial_area_id` so scope checks and list indexes lead
--     with the scope (ADR-0021 §3). Cross-schema FK direction is strictly
--     Accounting → Organization (one way, like Inventory → Organization).
--   * Dates are inclusive date-only ranges (`DATE`, never timestamptz):
--     `start_date`/`end_date` with `[start, end]` overlap semantics
--     (AC-I-03). Years of one (organization, area) never overlap; periods
--     of one year never overlap and lie inside the year.
--   * Statuses (`open`/`closed`/`sealed`) and `period_kind` (`normal` is the
--     only v1 value — an adjustment period is expert-gated, OQ-23) are
--     closed code-defined lists stored as TEXT. No CHECK constraints are
--     declared here: they are not representable in the Prisma schema, so a
--     later `prisma migrate dev` would emit a `DROP CONSTRAINT` for each
--     one. All value rules are enforced and unit-tested in the domain layer
--     instead (the same reason the organization migration gives).
--   * Overlap and lifecycle guards that must hold under concurrent writes
--     are enforced by short `SELECT … FOR UPDATE` transactions in the
--     module's `data/` layer (docs/modules.md §Accounting, AR-11), NOT by
--     PostgreSQL exclusion constraints: an exclusion needs the `btree_gist`
--     superuser extension and — decisively — is invisible to Prisma, so the
--     next generated migration would silently `DROP` it and lose the
--     invariant. Parent-row locks (area → year → period order, never
--     reversed) serialize the same writers with no drift hazard; the unique
--     indexes below stay the hard backstop for identity races.
--   * Lifecycle: `is_active` is the ONLY lifecycle mechanism (OQ-36
--     posture). No `deleted_at` columns: Task 10.2 implements no delete
--     operation. Periods carry no `is_active` at all — `status` is their
--     whole lifecycle (contract §7.1).
--   * `is_default` (at most one default area per organization, contract
--     §5.5) is enforced in the application transaction, not by a partial
--     unique index — for the same Prisma-invisibility reason as above.
--   * `prior_year_id` is an optional informational link to the previous year
--     of the same (organization, area) — the year-transition chain
--     (contract §6.1). Same-scope is enforced in the application layer
--     (a foreign key cannot express "same organization"); the database
--     guarantees the target exists and cannot disappear (ON DELETE RESTRICT).

CREATE SCHEMA IF NOT EXISTS "accounting";

-- ---- `accounting.financial_areas` ------------------------------------------
CREATE TABLE "accounting"."financial_areas" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "code"            VARCHAR(64)     NOT NULL,
    "title"           VARCHAR(200)    NOT NULL,
    "is_default"      BOOLEAN         NOT NULL DEFAULT FALSE,
    "is_active"       BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_accounting_financial_areas" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_financial_areas_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The area code is the business key within one organization (the same code
-- in another organization is a different bookkeeping scope).
CREATE UNIQUE INDEX "uq_financial_areas_organization_id_code"
    ON "accounting"."financial_areas" ("organization_id", "code");

CREATE INDEX "idx_financial_areas_organization_id_is_active"
    ON "accounting"."financial_areas" ("organization_id", "is_active");

-- ---- `accounting.fiscal_years` ----------------------------------------------
CREATE TABLE "accounting"."fiscal_years" (
    "id"                TEXT            NOT NULL,
    "organization_id"   TEXT            NOT NULL,
    "financial_area_id" TEXT            NOT NULL,
    "code"              VARCHAR(64)     NOT NULL,
    "title"             VARCHAR(200)    NOT NULL,
    "start_date"        DATE            NOT NULL,
    "end_date"          DATE            NOT NULL,
    "status"            VARCHAR(20)     NOT NULL DEFAULT 'open',
    "is_active"         BOOLEAN         NOT NULL DEFAULT TRUE,
    "prior_year_id"     TEXT,
    "created_at"        TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"        TEXT,
    "updated_by"        TEXT,
    CONSTRAINT "pk_accounting_fiscal_years" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_fiscal_years_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_fiscal_years_financial_area"
        FOREIGN KEY ("financial_area_id")
        REFERENCES "accounting"."financial_areas"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_fiscal_years_prior_year"
        FOREIGN KEY ("prior_year_id")
        REFERENCES "accounting"."fiscal_years"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The year code is the business key within one (organization, area): two
-- areas of one organization may each have a year "1405".
CREATE UNIQUE INDEX "uq_fiscal_years_organization_id_financial_area_id_code"
    ON "accounting"."fiscal_years" ("organization_id", "financial_area_id", "code");

CREATE INDEX "idx_fiscal_years_organization_id_financial_area_id"
    ON "accounting"."fiscal_years" ("organization_id", "financial_area_id");

CREATE INDEX "idx_fiscal_years_organization_id_financial_area_id_status"
    ON "accounting"."fiscal_years" ("organization_id", "financial_area_id", "status");

CREATE INDEX "idx_fiscal_years_prior_year_id"
    ON "accounting"."fiscal_years" ("prior_year_id");

-- ---- `accounting.accounting_periods` -----------------------------------------
CREATE TABLE "accounting"."accounting_periods" (
    "id"                TEXT            NOT NULL,
    "organization_id"   TEXT            NOT NULL,
    "financial_area_id" TEXT            NOT NULL,
    "fiscal_year_id"    TEXT            NOT NULL,
    "sequence"          INTEGER         NOT NULL,
    "title"             VARCHAR(200)    NOT NULL,
    "start_date"        DATE            NOT NULL,
    "end_date"          DATE            NOT NULL,
    "status"            VARCHAR(20)     NOT NULL DEFAULT 'open',
    "period_kind"       VARCHAR(20)     NOT NULL DEFAULT 'normal',
    "created_at"        TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"        TEXT,
    "updated_by"        TEXT,
    CONSTRAINT "pk_accounting_accounting_periods" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_accounting_periods_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_accounting_periods_financial_area"
        FOREIGN KEY ("financial_area_id")
        REFERENCES "accounting"."financial_areas"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_accounting_periods_fiscal_year"
        FOREIGN KEY ("fiscal_year_id")
        REFERENCES "accounting"."fiscal_years"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The 1-based ordinal inside one year (contract §7.1); unique per year.
CREATE UNIQUE INDEX "uq_accounting_periods_fiscal_year_id_sequence"
    ON "accounting"."accounting_periods" ("fiscal_year_id", "sequence");

CREATE INDEX "idx_accounting_periods_organization_id_fiscal_year_id"
    ON "accounting"."accounting_periods" ("organization_id", "fiscal_year_id");

CREATE INDEX "idx_accounting_periods_organization_id_fiscal_year_id_status"
    ON "accounting"."accounting_periods" ("organization_id", "fiscal_year_id", "status");
