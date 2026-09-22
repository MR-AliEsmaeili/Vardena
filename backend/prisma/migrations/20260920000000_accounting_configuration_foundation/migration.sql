-- Accounting Configuration Foundation (Task 11 — Final per D1-D7)
-- Squashed migration per D5 — replaces previous 20260917/18/19
-- Implements D1-D7:
-- D1: accounts.accounting_configuration_id sole scope, MUST be NOT NULL after backfill, root requires ACTIVE config
-- D2: does NOT touch coding_structure_versions (name/effective_from/operationally_used_at out of scope)
-- D3: backfill + NOT NULL based on orphan query. Handles both orphan=0 and orphan>0 (Legacy Config strategy)
-- D4: markOperationallyUsed deferred — no caller in Task 11, documented in ADR
-- D5: single clean migration, no DROP
-- D6: typed errors (NoActiveAccountingConfigurationError) — no string matching
-- D7: live DB FK test, in-memory FK mismatch test removed

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

-- ---- Alter accounting.accounts — new canonical configuration scope (D1, D3) ----
-- D3: must handle both orphan=0 and orphan>0. Add as nullable first, backfill, create legacy configs if needed, then SET NOT NULL.

ALTER TABLE "accounting"."accounts"
    ADD COLUMN "accounting_configuration_id" TEXT;

ALTER TABLE "accounting"."accounts"
    ADD CONSTRAINT "fk_accounts_accounting_configuration"
        FOREIGN KEY ("accounting_configuration_id")
        REFERENCES "accounting"."accounting_configurations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_accounts_accounting_configuration_id"
    ON "accounting"."accounts" ("accounting_configuration_id");

-- ---- Backfill per D3: first attempt from ACTIVE accounting config ----
UPDATE "accounting"."accounts" a
SET "accounting_configuration_id" = (
  SELECT ac."id"
  FROM "accounting"."accounting_configurations" ac
  WHERE ac."organization_id" = a."organization_id"
    AND ac."status" = 'ACTIVE'
  LIMIT 1
)
WHERE a."accounting_configuration_id" IS NULL;

-- ---- D3 orphan handling: if orphan > 0 (org has accounts with NULL accounting_configuration_id and no ACTIVE config), create Legacy Config per org ----
-- This implements Product Strategy 5 Legacy Config strategy for orphan>0 case.
-- If orphan=0, this inserts 0 rows and is no-op.
-- Uses gen_random_uuid() for ids (TEXT column accepts uuid text).
-- Level handling (Task 11 remediation): a legacy configuration either COPIES
-- the organization's active coding-structure level set (all of it, unchanged —
-- including a ONE-level set) or, when there is nothing to copy, receives the
-- two documented default levels below. Levels are never appended to a copied
-- set.

-- Create legacy accounting_configurations for orphan orgs
WITH orphan_orgs AS (
  SELECT DISTINCT a."organization_id"
  FROM "accounting"."accounts" a
  WHERE a."accounting_configuration_id" IS NULL
),
legacy_insert AS (
  INSERT INTO "accounting"."accounting_configurations"
    ("id", "organization_id", "code", "name", "version_number", "status", "effective_from", "operationally_used_at", "created_at", "updated_at")
  SELECT gen_random_uuid()::text, o."organization_id", 'LEGACY', 'Legacy Accounting Configuration', 1, 'ACTIVE', NULL, NOW(), NOW(), NOW()
  FROM orphan_orgs o
  WHERE NOT EXISTS (
    SELECT 1 FROM "accounting"."accounting_configurations" ac
    WHERE ac."organization_id" = o."organization_id" AND ac."status" = 'ACTIVE'
  )
  RETURNING "id", "organization_id"
)
-- Copy levels from active coding_structure_versions if exists (preserve code shape), else will create defaults below
-- Copy the level set of the organization's ACTIVE coding structure, so the
-- legacy configuration describes the SAME shape the organization's codes were
-- composed under. The "active" version is selected deterministically (newest
-- version_number, then id) instead of relying on the "exactly one active
-- version" invariant holding in legacy data: were that invariant violated, a
-- multi-row join would insert two rows for one level_index and abort the whole
-- migration on uq_accounting_configuration_levels_config_level.
INSERT INTO "accounting"."accounting_configuration_levels"
  ("id", "organization_id", "accounting_configuration_id", "level_index", "title", "digit_length", "default_is_postable", "level_kind", "created_at", "updated_at")
SELECT gen_random_uuid()::text, li."organization_id", li."accounting_configuration_id", li."level_index", li."title", li."digit_length", li."default_is_postable", li."level_kind", NOW(), NOW()
FROM (
  SELECT lc."id" AS accounting_configuration_id, lc."organization_id", csl."level_index", csl."title", csl."digit_length", csl."default_is_postable", csl."level_kind"
  FROM legacy_insert lc
  JOIN "accounting"."coding_structure_versions" csv
    ON csv."organization_id" = lc."organization_id"
   AND csv."status" = 'active'
   AND csv."id" = (
         SELECT v."id"
         FROM "accounting"."coding_structure_versions" v
         WHERE v."organization_id" = lc."organization_id"
           AND v."status" = 'active'
         ORDER BY v."version_number" DESC, v."id" ASC
         LIMIT 1
       )
  JOIN "accounting"."coding_structure_levels" csl ON csl."coding_structure_version_id" = csv."id"
) li;

-- Fallback for a legacy configuration whose organization had NO usable coding
-- structure (no active version, or a version with no level rows): insert the
-- documented default shape — level 1 = Group/2 digits (not postable),
-- level 2 = Detail/3 digits (postable) — in ONE statement.
--
-- The guard is "this configuration has NO level rows", deliberately NOT
-- "it has exactly one level row": a configuration COPIED from a ONE-LEVEL
-- coding structure already has exactly one level row, and appending a second
-- level would silently widen that organization's active code shape (its
-- accounts would become creatable one level deeper than the coding structure
-- allows). A copied level set is never extended.
INSERT INTO "accounting"."accounting_configuration_levels"
  ("id", "organization_id", "accounting_configuration_id", "level_index", "title", "digit_length", "default_is_postable", "level_kind", "created_at", "updated_at")
SELECT gen_random_uuid()::text, lc."organization_id", lc."id", d."level_index", d."title", d."digit_length", d."default_is_postable", NULL, NOW(), NOW()
FROM "accounting"."accounting_configurations" lc
CROSS JOIN (
  VALUES
    (1, 'Group', 2, false),
    (2, 'Detail', 3, true)
) AS d("level_index", "title", "digit_length", "default_is_postable")
WHERE lc."code" = 'LEGACY'
  AND lc."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "accounting"."accounting_configuration_levels" acl WHERE acl."accounting_configuration_id" = lc."id"
  );

-- Second backfill: after legacy configs created, fill remaining NULL accounts (orphan case)
UPDATE "accounting"."accounts" a
SET "accounting_configuration_id" = (
  SELECT ac."id"
  FROM "accounting"."accounting_configurations" ac
  WHERE ac."organization_id" = a."organization_id"
    AND ac."status" = 'ACTIVE'
  LIMIT 1
)
WHERE a."accounting_configuration_id" IS NULL;

-- ---- D3 final: SET NOT NULL (must succeed for both orphan=0 and orphan>0 after legacy handling) ----
ALTER TABLE "accounting"."accounts"
    ALTER COLUMN "accounting_configuration_id" SET NOT NULL;
