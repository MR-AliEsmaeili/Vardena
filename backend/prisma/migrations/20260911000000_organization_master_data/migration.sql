-- Organization module: organization structure + party master data.
--
-- Module + intent (docs/database-strategy.md §2): `organization` module — the
-- organization root, branches, departments, employees (minimal reference data)
-- and parties. Implements the organization-structure and party half of
-- ADR-0020; the fiscal calendar, numbering series, tax definitions, workflow
-- definitions and custom-field definitions stay unimplemented (later tasks).
--
-- Design notes:
--   * `organizations` is the business/tenant root. Every organization-scoped
--     record (in this schema and in `inventory`) carries `organization_id`,
--     so organization isolation is a schema fact, not a convention. This
--     supersedes the OQ-01 "no organization_id in v1 schemas" assumption —
--     see ADR-0021 and the updated OQ-01/OQ-22 entries.
--   * `branch` is an organizational scope dimension, NOT a legal entity and
--     NOT a separate set of books (OQ-22, D-01). No branch-level ledger
--     columns are added anywhere by this migration.
--   * `departments` and (in the inventory migration) `item_groups` are
--     self-referencing hierarchies. Self-parenting and cycles are rejected in
--     the application layer (`domain/hierarchy.ts`); the database guarantees
--     the parent exists and belongs to a row that cannot disappear
--     (ON DELETE RESTRICT).
--   * `employees` carries NO reference to `users.users`. An employee is a
--     business record; a user is a login account; a person may exist
--     operationally without an account. The linkage mechanism is unresolved
--     (OQ-37), so no column is added speculatively (AR-29).
--   * `parties` is ONE counterparty table with `is_customer`/`is_supplier`
--     capability flags (D-02). There is no `customers`/`suppliers` table.
--     Iranian legal/tax identification columns are deliberately absent —
--     their semantics are unresolved and expert-gated (OQ-30, OQ-38).
--   * Lifecycle: `is_active` is the ONLY lifecycle mechanism. No
--     `deleted_at`/`deleted_by` columns: Task 6 implements no delete
--     operation, and master-data-strategy.md §7 forbids running two competing
--     lifecycle mechanisms. Deletion semantics are OQ-36; when they are
--     decided, a follow-up migration converts the unique indexes below into
--     partial ones (`WHERE deleted_at IS NULL`).
--   * No CHECK constraints are declared here. They are not representable in
--     the Prisma schema, so a later `prisma migrate dev` would emit a
--     `DROP CONSTRAINT` for each one. All value rules (party type, capability
--     combinations, code shape) are enforced and unit-tested in the domain
--     layer instead; see docs/architecture/domain/organization-master-data.md
--     §"Validation placement".
--   * Cross-schema FK direction is strictly Inventory → Organization (see the
--     inventory migration). Nothing in this schema references another module.

CREATE SCHEMA IF NOT EXISTS "organization";

-- ---- `organization.organizations` -----------------------------------------
CREATE TABLE "organization"."organizations" (
    "id"         TEXT            NOT NULL,
    "code"       VARCHAR(64)     NOT NULL,
    "name"       VARCHAR(200)    NOT NULL,
    "is_active"  BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_by" TEXT,
    CONSTRAINT "pk_organization_organizations" PRIMARY KEY ("id")
);

-- The organization code is the tenant root's business key: unique
-- deployment-wide (there is no wider scope to be unique within).
CREATE UNIQUE INDEX "uq_organizations_code"
    ON "organization"."organizations" ("code");

CREATE INDEX "idx_organizations_is_active"
    ON "organization"."organizations" ("is_active");

-- ---- `organization.branches` ----------------------------------------------
CREATE TABLE "organization"."branches" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "code"            VARCHAR(64)     NOT NULL,
    "name"            VARCHAR(200)    NOT NULL,
    "is_active"       BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_organization_branches" PRIMARY KEY ("id"),
    CONSTRAINT "fk_organization_branches_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_branches_organization_id_code"
    ON "organization"."branches" ("organization_id", "code");

CREATE INDEX "idx_branches_organization_id_is_active"
    ON "organization"."branches" ("organization_id", "is_active");

-- ---- `organization.departments` -------------------------------------------
CREATE TABLE "organization"."departments" (
    "id"                   TEXT            NOT NULL,
    "organization_id"      TEXT            NOT NULL,
    "parent_department_id" TEXT,
    "code"                 VARCHAR(64)     NOT NULL,
    "name"                 VARCHAR(200)    NOT NULL,
    "is_active"            BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"           TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"           TEXT,
    "updated_by"           TEXT,
    CONSTRAINT "pk_organization_departments" PRIMARY KEY ("id"),
    CONSTRAINT "fk_organization_departments_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_organization_departments_parent"
        FOREIGN KEY ("parent_department_id")
        REFERENCES "organization"."departments"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_departments_organization_id_code"
    ON "organization"."departments" ("organization_id", "code");

CREATE INDEX "idx_departments_organization_id_is_active"
    ON "organization"."departments" ("organization_id", "is_active");

CREATE INDEX "idx_departments_parent_department_id"
    ON "organization"."departments" ("parent_department_id");

-- ---- `organization.employees` ---------------------------------------------
CREATE TABLE "organization"."employees" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "employee_code"   VARCHAR(64)     NOT NULL,
    "first_name"      VARCHAR(120)    NOT NULL,
    "last_name"       VARCHAR(120)    NOT NULL,
    "department_id"   TEXT,
    "branch_id"       TEXT,
    "is_active"       BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_organization_employees" PRIMARY KEY ("id"),
    CONSTRAINT "fk_organization_employees_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_organization_employees_department"
        FOREIGN KEY ("department_id")
        REFERENCES "organization"."departments"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_organization_employees_branch"
        FOREIGN KEY ("branch_id")
        REFERENCES "organization"."branches"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_employees_organization_id_employee_code"
    ON "organization"."employees" ("organization_id", "employee_code");

CREATE INDEX "idx_employees_organization_id_is_active"
    ON "organization"."employees" ("organization_id", "is_active");

CREATE INDEX "idx_employees_department_id"
    ON "organization"."employees" ("department_id");

CREATE INDEX "idx_employees_branch_id"
    ON "organization"."employees" ("branch_id");

-- ---- `organization.parties` -----------------------------------------------
CREATE TABLE "organization"."parties" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "code"            VARCHAR(64)     NOT NULL,
    "display_name"    VARCHAR(200)    NOT NULL,
    "legal_name"      VARCHAR(200),
    "party_type"      VARCHAR(20)     NOT NULL,
    "is_customer"     BOOLEAN         NOT NULL DEFAULT FALSE,
    "is_supplier"     BOOLEAN         NOT NULL DEFAULT FALSE,
    "email"           VARCHAR(320),
    "phone"           VARCHAR(64),
    "is_active"       BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_organization_parties" PRIMARY KEY ("id"),
    CONSTRAINT "fk_organization_parties_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_parties_organization_id_code"
    ON "organization"."parties" ("organization_id", "code");

CREATE INDEX "idx_parties_organization_id_is_active"
    ON "organization"."parties" ("organization_id", "is_active");

CREATE INDEX "idx_parties_organization_id_party_type"
    ON "organization"."parties" ("organization_id", "party_type");
