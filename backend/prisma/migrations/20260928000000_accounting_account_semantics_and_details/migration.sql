-- Accounting module: Account Semantics & Detail Foundation (Task 30 — OD-29-01, OD-29-02, OD-29-03, OD-29-06)
--
-- Adds:
--   * Account Type (OD-29-02) to `accounting.accounts` and `accounting.base_chart_template_nodes`
--   * Detail Coding Structure (`accounting.detail_structure_versions`, `accounting.detail_structure_levels`)
--   * Detail Hierarchy (`accounting.details`)
--   * Level-1 Detail Group link (`accounting.accounts.detail_group_id`)
--   * Line & Ledger Detail allocations (`accounting.accounting_document_lines.detail_id`, `accounting.ledger_entries.detail_id`)

-- 1. Alter accounting.accounts to add account_type and detail_group_id, and normalize account_nature
ALTER TABLE "accounting"."accounts"
    ADD COLUMN "account_type" VARCHAR(32) NOT NULL DEFAULT 'BALANCE_SHEET',
    ADD COLUMN "detail_group_id" TEXT;

UPDATE "accounting"."accounts"
    SET "account_nature" = UPPER("account_nature")
    WHERE "account_nature" IN ('debit', 'credit', 'dual');

-- 2. Alter accounting.base_chart_template_nodes to add account_type, and normalize account_nature
ALTER TABLE "accounting"."base_chart_template_nodes"
    ADD COLUMN "account_type" VARCHAR(32) NOT NULL DEFAULT 'BALANCE_SHEET';

UPDATE "accounting"."base_chart_template_nodes"
    SET "account_nature" = UPPER("account_nature")
    WHERE "account_nature" IN ('debit', 'credit', 'dual');

-- 3. Detail Structure Versions (configurable detail coding structure)
CREATE TABLE "accounting"."detail_structure_versions" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "code"            VARCHAR(64)     NOT NULL,
    "version_number"  INTEGER         NOT NULL,
    "status"          VARCHAR(16)     NOT NULL DEFAULT 'draft',
    "max_depth"       INTEGER         NOT NULL,
    "separator"       VARCHAR(1)      NOT NULL DEFAULT '',
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_accounting_detail_structure_versions" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_detail_structure_versions_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_detail_structure_versions_org_code_version"
    ON "accounting"."detail_structure_versions" ("organization_id", "code", "version_number");

CREATE INDEX "idx_detail_structure_versions_org_status"
    ON "accounting"."detail_structure_versions" ("organization_id", "status");

CREATE INDEX "idx_detail_structure_versions_org_code"
    ON "accounting"."detail_structure_versions" ("organization_id", "code");

-- 4. Detail Structure Levels
CREATE TABLE "accounting"."detail_structure_levels" (
    "id"                          TEXT            NOT NULL,
    "organization_id"             TEXT            NOT NULL,
    "detail_structure_version_id" TEXT            NOT NULL,
    "level_index"                 INTEGER         NOT NULL,
    "title"                       VARCHAR(200)    NOT NULL,
    "digit_length"                INTEGER         NOT NULL,
    "created_at"                  TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"                  TEXT,
    "updated_by"                  TEXT,
    CONSTRAINT "pk_accounting_detail_structure_levels" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_detail_structure_levels_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_detail_structure_levels_version"
        FOREIGN KEY ("detail_structure_version_id")
        REFERENCES "accounting"."detail_structure_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_detail_structure_levels_version_level"
    ON "accounting"."detail_structure_levels" ("detail_structure_version_id", "level_index");

CREATE INDEX "idx_detail_structure_levels_org_version"
    ON "accounting"."detail_structure_levels" ("organization_id", "detail_structure_version_id");

-- 5. Detail Hierarchy Records
CREATE TABLE "accounting"."details" (
    "id"                          TEXT            NOT NULL,
    "organization_id"             TEXT            NOT NULL,
    "code"                        VARCHAR(32)     NOT NULL,
    "title"                       VARCHAR(200)    NOT NULL,
    "parent_id"                   TEXT,
    "level"                       INTEGER         NOT NULL,
    "detail_structure_version_id" TEXT            NOT NULL,
    "is_postable"                 BOOLEAN         NOT NULL DEFAULT TRUE,
    "is_active"                   BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"                  TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"                  TEXT,
    "updated_by"                  TEXT,
    CONSTRAINT "pk_accounting_details" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_details_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_details_parent"
        FOREIGN KEY ("parent_id")
        REFERENCES "accounting"."details"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_details_version"
        FOREIGN KEY ("detail_structure_version_id")
        REFERENCES "accounting"."detail_structure_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_details_organization_id_code"
    ON "accounting"."details" ("organization_id", "code");

CREATE INDEX "idx_details_organization_id_parent_id"
    ON "accounting"."details" ("organization_id", "parent_id");

CREATE INDEX "idx_details_organization_id_level"
    ON "accounting"."details" ("organization_id", "level");

CREATE INDEX "idx_details_organization_id_is_active"
    ON "accounting"."details" ("organization_id", "is_active");

CREATE INDEX "idx_details_organization_id_is_postable"
    ON "accounting"."details" ("organization_id", "is_postable");

CREATE INDEX "idx_details_detail_structure_version_id"
    ON "accounting"."details" ("detail_structure_version_id");

-- 6. Add Foreign Key for Account -> Detail Group
ALTER TABLE "accounting"."accounts"
    ADD CONSTRAINT "fk_accounting_accounts_detail_group"
    FOREIGN KEY ("detail_group_id")
    REFERENCES "accounting"."details"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_accounts_organization_id_detail_group_id"
    ON "accounting"."accounts" ("organization_id", "detail_group_id");

-- 7. Document Lines detail allocation
ALTER TABLE "accounting"."accounting_document_lines"
    ADD COLUMN "detail_id" TEXT,
    ADD CONSTRAINT "fk_accounting_document_lines_detail"
    FOREIGN KEY ("detail_id")
    REFERENCES "accounting"."details"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_accounting_document_lines_org_detail"
    ON "accounting"."accounting_document_lines" ("organization_id", "detail_id");

-- 8. Ledger Entries detail allocation
ALTER TABLE "accounting"."ledger_entries"
    ADD COLUMN "detail_id" TEXT,
    ADD CONSTRAINT "fk_accounting_ledger_entries_detail"
    FOREIGN KEY ("detail_id")
    REFERENCES "accounting"."details"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_ledger_entries_org_detail"
    ON "accounting"."ledger_entries" ("organization_id", "detail_id");
