-- Accounting module: the Base Chart product template + explicit organization
-- adoption (Task 23 — OD-20-1; Task 21 governance baseline §1…§5/§7/§8/§12;
-- docs/tasks/task-23/task-23-implementation-report.md).
--
-- Module + intent (docs/database-strategy.md §2): the `accounting` schema
-- already owns the organization's chart of accounts (`accounting.accounts`).
-- This migration adds the PRODUCT side of the chart: a versioned template
-- store that belongs to no organization, plus the tenant-scoped adoption
-- record that is the ONLY link between the two — and the only path that
-- materializes organization-owned `accounts` rows out of a template
-- (adoption = COPY, never a runtime reference).
--
--   * `accounting.base_chart_templates`         — template identity (code +
--     title). New versions of one template share it: stable template
--     identity, independent version identity.
--   * `accounting.base_chart_template_versions` — version identity + the
--     `draft → approved → published → superseded` lifecycle (Task 21 §8).
--     `status` is a closed code-defined TEXT list (no CHECK — the same
--     reason every previous migration records: Prisma cannot represent it,
--     so a later generated migration would DROP it; the transition table
--     lives in `domain/base-chart-template.ts` and is unit-tested). A
--     published/superseded version is immutable: content edits only happen
--     while `draft`, inside a locked transaction (the ADR-0024 draft-
--     workspace rule the coding structure established).
--     `superseded_by_version_id` names the newer published version that
--     replaced this one (RESTRICT: history is never removed).
--   * `accounting.base_chart_template_levels`   — the template's level SHAPE
--     (digit lengths + per-level postability defaults, Task 21 §7). It
--     mirrors `coding_structure_levels` MINUS `title`/`level_kind`: level
--     titles and kinds are organization configuration vocabulary
--     (contract §8.1), not template content. Configurable depth — nothing
--     hardcodes four levels.
--   * `accounting.base_chart_template_nodes`    — the template chart tree.
--     Hierarchy exists in the template key space BEFORE any organization
--     `Account.id` exists: `node_key` + authored `parent_node_key`
--     (Task 21 §2), with the RESOLVED edge stored as the same adjacency +
--     RESTRICT self-FK `parent_id` that `accounts` uses (an ancestor can
--     never disappear under its subtree). `level` is stored DERIVED
--     (root = 1), exactly like `accounts.level`. Values (codes, titles,
--     natures, the mandatory set) are owner/accountant content — OQ-25
--     stays OPEN and this migration seeds NOTHING.
--   * `accounting.base_chart_adoptions`         — the adoption record:
--     organization X explicitly adopted published version Y, pinned to the
--     ODR-1 configuration pair the copied `accounts` rows carry. UNIQUE
--     (organization_id, template_version_id) is the idempotency backstop:
--     two concurrent adoptions of one version collide here and exactly one
--     commits, so a duplicate chart can never exist.
--
-- Design notes:
--   * Template identity is NEVER ledger identity (OD-20-1): there is no
--     column on `accounts`, `accounting_document_lines`, `ledger_entries`
--     or `account_balance_projections` referencing any template table, and
--     no such FK is added anywhere — adoption writes ordinary
--     organization-owned `accounts` rows under the organization's existing
--     `(coding_structure_version_id, accounting_configuration_id)` pin
--     pair (ODR-1), so every adopted account is indistinguishable from a
--     manually created one on every existing read/post path.
--   * TENANCY: the four template tables carry NO `organization_id`. The
--     schema-wide "every row carries organization_id" rule guards TENANT
--     data; the template is product/catalog data whose organization ids
--     are excluded BY DESIGN (OD-20-1, Task 21 §2a), the same way
--     `rbac.permissions` is global. `base_chart_adoptions` restores the
--     full tenant boundary (`organization_id` NOT NULL, FK RESTRICT,
--     scope-leading index — ADR-0021 §3).
--   * Deliberately absent (AR-29, OQ boundary): no
--     `accounts.base_chart_template_node_id` (account-level provenance is
--     explicitly OPEN — Task 21 §4.2/§8), no `accounts.is_mandatory`
--     (mandatoriness is an adoption-time completeness rule), no
--     control-role column (OD-20-2/3), no dimension or statutory column
--     (OQ-41/OQ-43), no `account_type`/`is_temporary` (OQ-25), no
--     `reserved_ranges`.
--   * Purely additive: no existing table, column, index or FK is touched,
--     no data is migrated, and nothing is dropped. The chart/ledger paths
--     are behaviorally unchanged until an explicit adoption operation runs.

-- ---- template identity ------------------------------------------------------
CREATE TABLE "accounting"."base_chart_templates" (
    "id"         TEXT            NOT NULL,
    "code"       VARCHAR(64)     NOT NULL,
    "title"      VARCHAR(200)    NOT NULL,
    "created_at" TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_by" TEXT,
    CONSTRAINT "pk_accounting_base_chart_templates" PRIMARY KEY ("id")
);

-- Template identity is stable across versions: one code, one template.
CREATE UNIQUE INDEX "uq_base_chart_templates_code"
    ON "accounting"."base_chart_templates" ("code");

-- ---- template versions (lifecycle) -------------------------------------------
CREATE TABLE "accounting"."base_chart_template_versions" (
    "id"                       TEXT            NOT NULL,
    "template_id"              TEXT            NOT NULL,
    "version_number"           INTEGER         NOT NULL,
    "status"                   VARCHAR(16)     NOT NULL DEFAULT 'draft',
    "max_depth"                INTEGER         NOT NULL,
    "approved_at"              TIMESTAMPTZ(6),
    "published_at"             TIMESTAMPTZ(6),
    "superseded_at"            TIMESTAMPTZ(6),
    "superseded_by_version_id" TEXT,
    "created_at"               TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"               TEXT,
    "updated_by"               TEXT,
    CONSTRAINT "pk_accounting_base_chart_template_versions"
        PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_base_chart_template_versions_template"
        FOREIGN KEY ("template_id")
        REFERENCES "accounting"."base_chart_templates"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- Which newer PUBLISHED version of the same template replaced this one
    -- (NULL when superseded without a named successor, e.g. retirement).
    CONSTRAINT "fk_accounting_base_chart_template_versions_superseded_by"
        FOREIGN KEY ("superseded_by_version_id")
        REFERENCES "accounting"."base_chart_template_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Version ordinals race the same way coding-structure ordinals do; this is
-- the authoritative guard, the application retries with a recomputed number.
CREATE UNIQUE INDEX "uq_base_chart_template_versions_template_id_version_number"
    ON "accounting"."base_chart_template_versions" ("template_id", "version_number");

-- "The template's published version" — the adoption resolver's lookup.
CREATE INDEX "idx_base_chart_template_versions_template_id_status"
    ON "accounting"."base_chart_template_versions" ("template_id", "status");

-- ---- template level shape ----------------------------------------------------
CREATE TABLE "accounting"."base_chart_template_levels" (
    "id"                  TEXT            NOT NULL,
    "version_id"          TEXT            NOT NULL,
    "level_index"         INTEGER         NOT NULL,
    "digit_length"        INTEGER         NOT NULL,
    "default_is_postable" BOOLEAN         NOT NULL DEFAULT FALSE,
    "created_at"          TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"          TEXT,
    "updated_by"          TEXT,
    CONSTRAINT "pk_accounting_base_chart_template_levels" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_base_chart_template_levels_version"
        FOREIGN KEY ("version_id")
        REFERENCES "accounting"."base_chart_template_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_base_chart_template_levels_version_id_level_index"
    ON "accounting"."base_chart_template_levels" ("version_id", "level_index");

-- ---- template chart tree (template-internal keys) -----------------------------
CREATE TABLE "accounting"."base_chart_template_nodes" (
    "id"                TEXT            NOT NULL,
    "version_id"        TEXT            NOT NULL,
    "node_key"          VARCHAR(64)     NOT NULL,
    "parent_node_key"   VARCHAR(64),
    "parent_id"         TEXT,
    "code"              VARCHAR(32)     NOT NULL,
    "title"             VARCHAR(200)    NOT NULL,
    "account_nature"    VARCHAR(8)      NOT NULL,
    "is_postable"       BOOLEAN         NOT NULL DEFAULT FALSE,
    "is_mandatory"      BOOLEAN         NOT NULL DEFAULT FALSE,
    "default_is_active" BOOLEAN         NOT NULL DEFAULT TRUE,
    "level"             INTEGER         NOT NULL,
    "created_at"        TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"        TEXT,
    "updated_by"        TEXT,
    CONSTRAINT "pk_accounting_base_chart_template_nodes" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_base_chart_template_nodes_version"
        FOREIGN KEY ("version_id")
        REFERENCES "accounting"."base_chart_template_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- The resolved tree edge. RESTRICT: an ancestor can never disappear
    -- under its subtree (the `accounts.parent_id` precedent).
    CONSTRAINT "fk_accounting_base_chart_template_nodes_parent"
        FOREIGN KEY ("parent_id")
        REFERENCES "accounting"."base_chart_template_nodes"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The template-internal key space (Task 21 §2): unique within one version.
CREATE UNIQUE INDEX "uq_base_chart_template_nodes_version_id_node_key"
    ON "accounting"."base_chart_template_nodes" ("version_id", "node_key");

-- Code uniqueness within one version (the template-local §9.2 mirror).
CREATE UNIQUE INDEX "uq_base_chart_template_nodes_version_id_code"
    ON "accounting"."base_chart_template_nodes" ("version_id", "code");

CREATE INDEX "idx_base_chart_template_nodes_version_id_parent_id"
    ON "accounting"."base_chart_template_nodes" ("version_id", "parent_id");

CREATE INDEX "idx_base_chart_template_nodes_version_id_level"
    ON "accounting"."base_chart_template_nodes" ("version_id", "level");

-- ---- adoption records (tenant-scoped) -----------------------------------------
CREATE TABLE "accounting"."base_chart_adoptions" (
    "id"                          TEXT            NOT NULL,
    "organization_id"             TEXT            NOT NULL,
    "template_version_id"         TEXT            NOT NULL,
    "accounting_configuration_id" TEXT            NOT NULL,
    "coding_structure_version_id" TEXT            NOT NULL,
    "account_count"               INTEGER         NOT NULL,
    "created_at"                  TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"                  TEXT,
    "updated_by"                  TEXT,
    CONSTRAINT "pk_accounting_base_chart_adoptions" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_base_chart_adoptions_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- Adoptions pin the immutable published version forever: version rows
    -- are never deleted (lifecycle only), and this RESTRICT keeps it so.
    CONSTRAINT "fk_accounting_base_chart_adoptions_template_version"
        FOREIGN KEY ("template_version_id")
        REFERENCES "accounting"."base_chart_template_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_base_chart_adoptions_accounting_configuration"
        FOREIGN KEY ("accounting_configuration_id")
        REFERENCES "accounting"."accounting_configurations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_base_chart_adoptions_coding_structure_version"
        FOREIGN KEY ("coding_structure_version_id")
        REFERENCES "accounting"."coding_structure_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- One adoption of the same version per organization — the idempotency
-- backstop: a concurrent duplicate adoption collides here and answers a
-- deterministic conflict; a duplicate chart can never exist.
CREATE UNIQUE INDEX "uq_base_chart_adoptions_organization_id_template_version_id"
    ON "accounting"."base_chart_adoptions" ("organization_id", "template_version_id");

-- The organization-side listing (scope-leading, ADR-0021 §3).
CREATE INDEX "idx_base_chart_adoptions_organization_id"
    ON "accounting"."base_chart_adoptions" ("organization_id");

-- "Which organizations adopted this version" — the reverse lookup.
CREATE INDEX "idx_base_chart_adoptions_template_version_id"
    ON "accounting"."base_chart_adoptions" ("template_version_id");
