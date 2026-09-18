-- Accounting Configuration Foundation (Task 11 — Final)
-- Squashed migration per D5 — replaces 20260917, 20260918, 20260919
--
-- This migration creates the generic, organization-scoped, versioned configuration root
-- that Task 11 requires as foundation for Chart of Accounts and future domains.
--
-- Design (per D2, D3, D5, ADR-0028):
-- - Creates accounting.accounting_configurations (DRAFT → ACTIVE → SUPERSEDED, one ACTIVE per org)
-- - Creates accounting.accounting_configuration_levels (configurable levels per version)
-- - Adds accounting.accounts.accounting_configuration_id nullable FK RESTRICT → accounting_configurations.id
-- - Backfills accounting_configuration_id from active accounting configuration per org (D3)
--   If org has no active config, account remains legacy orphan (accounting_configuration_id = null) — documented in ADR-0028
-- - Partial unique index uq_accounting_configurations_org_active for concurrency safety (FOR UPDATE lock remains primary guard)
-- - Does NOT touch coding_structure_versions (per D2 — freeze policy out of scope)
-- - Does NOT create coding_structure_version_id column on accounting_configurations
-- - Does NOT create partial unique index on coding_structure_versions
-- - Prisma schema is source of truth, migration-only persistence, no triggers, partial indexes via raw SQL

-- ---- accounting.accounting_configurations ----
CREATE TABLE "accounting"."accounting_configurations" (
    "id"                   TEXT NOT NULL,
    "organization_id"      TEXT NOT NULL,
    "code"                 VARCHAR(64) NOT NULL,
    "name"                 VARCHAR(200) NOT NULL,
    "version_number"       INTEGER NOT NULL,
    "status"               VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "effective_from"       TIMESTAMPTZ(6),
    "operationally_used_at" TIMESTAMPTZ(6),
    "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"           TEXT,
    "updated_by"           TEXT,
    CONSTRAINT "pk_accounting_configurations" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_configurations_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_accounting_configurations_org_code_version"
    ON "accounting"."accounting_configurations" ("organization_id", "code", "version_number");

CREATE INDEX "idx_accounting_configurations_org_status"
    ON "accounting"."accounting_configurations" ("organization_id", "status");

CREATE INDEX "idx_accounting_configurations_org_code"
    ON "accounting"."accounting_configurations" ("organization_id", "code");

-- DB-level backstop for single ACTIVE per org (FOR UPDATE lock remains primary guard)
CREATE UNIQUE INDEX "uq_accounting_configurations_org_active"
    ON "accounting"."accounting_configurations" ("organization_id")
    WHERE "status" = 'ACTIVE';

-- ---- accounting.accounting_configuration_levels ----
CREATE TABLE "accounting"."accounting_configuration_levels" (
    "id"                          TEXT NOT NULL,
    "organization_id"             TEXT NOT NULL,
    "accounting_configuration_id" TEXT NOT NULL,
    "level_index"                 INTEGER NOT NULL,
    "title"                       VARCHAR(200) NOT NULL,
    "digit_length"                INTEGER NOT NULL,
    "default_is_postable"         BOOLEAN NOT NULL DEFAULT FALSE,
    "level_kind"                  VARCHAR(20),
    "created_at"                  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"                  TEXT,
    "updated_by"                  TEXT,
    CONSTRAINT "pk_accounting_configuration_levels" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_configuration_levels_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_configuration_levels_configuration"
        FOREIGN KEY ("accounting_configuration_id")
        REFERENCES "accounting"."accounting_configurations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_accounting_configuration_levels_config_level"
    ON "accounting"."accounting_configuration_levels" ("accounting_configuration_id", "level_index");

CREATE INDEX "idx_accounting_configuration_levels_org_config"
    ON "accounting"."accounting_configuration_levels" ("organization_id", "accounting_configuration_id");

-- ---- Alter accounting.accounts — new canonical configuration scope ----
ALTER TABLE "accounting"."accounts"
    ADD COLUMN "accounting_configuration_id" TEXT;

ALTER TABLE "accounting"."accounts"
    ADD CONSTRAINT "fk_accounts_accounting_configuration"
        FOREIGN KEY ("accounting_configuration_id")
        REFERENCES "accounting"."accounting_configurations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_accounts_accounting_configuration_id"
    ON "accounting"."accounts" ("accounting_configuration_id");

-- ---- Backfill per D3 ----
-- For all existing accounts where accounting_configuration_id IS NULL, set it to active config of same org if exists.
-- If org has no active config, remains NULL (legacy orphan) — documented in ADR-0028.
UPDATE "accounting"."accounts" a
SET "accounting_configuration_id" = (
  SELECT ac."id"
  FROM "accounting"."accounting_configurations" ac
  WHERE ac."organization_id" = a."organization_id"
    AND ac."status" = 'ACTIVE'
  LIMIT 1
)
WHERE a."accounting_configuration_id" IS NULL;
