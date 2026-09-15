-- Accounting module: the configurable coding structure + the chart of
-- accounts (Task 10.3, ADR-0026, docs/accounting/domain-contract.md §8/§9/§14,
-- AC-D-06…AC-D-10, AC-D-19, AC-I-10/11/16).
--
-- Module + intent (docs/database-strategy.md §2): the `accounting` schema
-- already owns the bookkeeping scope spine (Task 10.2); this migration adds the
-- account-structure spine every future posting flow must be able to trust:
--   * `accounting.coding_structure_versions` — the organization's CONFIGURABLE
--     coding structure (depth + per-level digit lengths + display separator),
--     versioned `draft → active → superseded` with exactly one ACTIVE version
--     per organization (contract §9.1/§9.4);
--   * `accounting.coding_structure_levels`   — one row per level of one
--     version (`level_index`, `title`, `digit_length`, `default_is_postable`,
--     informational `level_kind`);
--   * `accounting.accounts`                  — the whole chart of accounts in
--     ONE table via adjacency (`parent_id`) + integer `level` (AC-D-06/07).
--
-- Design notes:
--   * Nothing about the coding shape is hardcoded: `2 + 3 + 3` is one
--     configuration among many, so there is no fixed segment count, no fixed
--     digit length and no per-level table (contract §2.2/§9.1 reject the
--     four-table `group/general/subsidiary/detail` layout — depth is data,
--     reported up to 8 levels). `max_depth` and the total code length are
--     ARCHITECTURE caps enforced in the domain layer (8 and 32, §9.1), with
--     `accounts.code varchar(32)` as the storage width so the cap can never be
--     bypassed by a domain-layer bug.
--   * Levels belong to the VERSION, not to a mutable "current structure" row:
--     a published or superseded version is never reinterpreted by a later
--     structure change (§9.4), which is exactly why `accounts.
--     coding_structure_version_id` is NOT NULL — every code stays
--     interpretable without the current configuration (AC-I-14).
--   * `accounts.code` is the canonical digits-only concatenation of the level
--     segments (§9.2): no separator, no letter, no padding rule beyond the
--     per-level segment width. A separator is stored on the version for
--     RENDERING only and never becomes part of a code or of uniqueness. Codes
--     are compared case-sensitively and literally, and are never reused
--     (§8.6, OQ-36 posture).
--   * Uniqueness scope: `code` unique per ORGANIZATION (AC-D-04 — the chart
--     and the coding structure are organization-scoped; areas only gain
--     APPLICABILITY, §5.4). If OQ-40 ever resolves to per-area charts, the key
--     widens to `(organization_id, financial_area_id, code)` as an additive
--     change; no area column is invented now (AR-29, and there is no posting
--     validation to consume it yet).
--   * Status/kind/nature lists (`draft|active|superseded`,
--     `group|general|subsidiary|detail`, `debit|credit`) are closed,
--     code-defined lists stored as TEXT — the decision every previous
--     migration records: extending a list is an ordinary change, never an
--     `ALTER TYPE`. No CHECK constraints: Prisma cannot represent them, so a
--     later generated migration would `DROP` them; the value rules live in the
--     framework-free domain layer and are unit-tested instead.
--   * Concurrency (docs/database-strategy.md §13, AR-11): the invariants that
--     depend on read-before-write — "exactly one active version per
--     organization", "a level set is complete before publication", "a child's
--     level = parent's level + 1", "child code = parent code + the level's
--     segment", "no cycles" and "postable ⇒ leaf" — are re-evaluated INSIDE
--     short `SELECT … FOR UPDATE` transactions in the module's `data/` layer,
--     never checked-then-acted across the boundary. Lock ORDER is fixed and
--     never reversed: coding-structure versions lock the organization's
--     version rows ascending by id; an account write locks the parent account
--     (create) or the two involved rows ascending by id (move), which is what
--     makes concurrent cycle-forming re-parenting settle with one winner.
--     Neither an exclusion constraint nor a recursive CHECK/trigger is used:
--     both are invisible to Prisma and would be dropped by the next generated
--     migration, silently losing the invariant. The unique indexes below stay
--     the hard backstop for identity races.
--   * Lifecycle: `is_active` only (OQ-36 posture) and NO DELETE — accounts are
--     never deleted and their codes are never reused (§8.6). The only rows
--     this migration's data path ever deletes are the level rows of a coding
--     structure version that is still a `draft` (an unreferenced configuration
--     workspace replaced atomically, the ADR-0024 draft-configuration rule).
--   * Every table carries `organization_id` (NOT NULL, FK RESTRICT): the
--     tenant/security boundary (ADR-0021, AC-D-01/AC-I-01). Cross-schema FK
--     direction stays strictly Accounting → Organization.
--   * Deferred by the contract, so NOT created here (seams recorded in
--     `prisma/schema/accounting.prisma`): area applicability rows for accounts
--     (§8.3, entangled with OQ-40), `account_type`/`is_temporary` and the
--     control-role mapping (§8.7, OQ-25), reserved ranges (§9.1, OQ-25) and
--     everything in contract §10–§20 (dimensions, documents, posting).

-- ---- `accounting.coding_structure_versions` --------------------------------
CREATE TABLE "accounting"."coding_structure_versions" (
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
    CONSTRAINT "pk_accounting_coding_structure_versions" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_coding_structure_versions_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Two concurrent "create the next version of structure X" writes collide
-- here: the loser retries with the recomputed ordinal (the Workflow version
-- precedent). "Exactly one active version per organization" is NOT a partial
-- unique index on purpose — Prisma would drop it — it is guarded by the
-- org-wide row locks in `data/coding-structures.repository.ts`.
CREATE UNIQUE INDEX "uq_coding_structure_versions_org_id_code_version_number"
    ON "accounting"."coding_structure_versions" ("organization_id", "code", "version_number");

CREATE INDEX "idx_coding_structure_versions_organization_id_status"
    ON "accounting"."coding_structure_versions" ("organization_id", "status");

CREATE INDEX "idx_coding_structure_versions_organization_id_code"
    ON "accounting"."coding_structure_versions" ("organization_id", "code");

-- ---- `accounting.coding_structure_levels` ----------------------------------
CREATE TABLE "accounting"."coding_structure_levels" (
    "id"                       TEXT            NOT NULL,
    "organization_id"          TEXT            NOT NULL,
    "coding_structure_version_id" TEXT         NOT NULL,
    "level_index"              INTEGER         NOT NULL,
    "title"                    VARCHAR(200)    NOT NULL,
    "digit_length"             INTEGER         NOT NULL,
    "default_is_postable"      BOOLEAN         NOT NULL DEFAULT FALSE,
    "level_kind"               VARCHAR(20),
    "created_at"               TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"               TEXT,
    "updated_by"               TEXT,
    CONSTRAINT "pk_accounting_coding_structure_levels" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_coding_structure_levels_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_coding_structure_levels_version"
        FOREIGN KEY ("coding_structure_version_id")
        REFERENCES "accounting"."coding_structure_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- One row per level ordinal of one version: a duplicated level index is a
-- database rejection, a MISSING one is refused at publish (the level set must
-- cover exactly 1..max_depth).
CREATE UNIQUE INDEX "uq_coding_structure_levels_version_id_level_index"
    ON "accounting"."coding_structure_levels" ("coding_structure_version_id", "level_index");

CREATE INDEX "idx_coding_structure_levels_organization_id_version_id"
    ON "accounting"."coding_structure_levels" ("organization_id", "coding_structure_version_id");

-- ---- `accounting.accounts` --------------------------------------------------
CREATE TABLE "accounting"."accounts" (
    "id"                          TEXT            NOT NULL,
    "organization_id"             TEXT            NOT NULL,
    "code"                        VARCHAR(32)     NOT NULL,
    "title"                       VARCHAR(200)    NOT NULL,
    "parent_id"                   TEXT,
    "level"                       INTEGER         NOT NULL,
    "coding_structure_version_id" TEXT            NOT NULL,
    "account_nature"              VARCHAR(8)      NOT NULL,
    "is_postable"                 BOOLEAN         NOT NULL DEFAULT FALSE,
    "is_active"                   BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"                  TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"                  TEXT,
    "updated_by"                  TEXT,
    CONSTRAINT "pk_accounting_accounts" PRIMARY KEY ("id"),
    CONSTRAINT "fk_accounting_accounts_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- The tree edge. RESTRICT: an ancestor can never disappear under the
    -- subtree (nothing is deleted — §8.6). A CYCLE is not expressible as a
    -- constraint here; it is refused by the locked domain guard in
    -- `data/accounts.repository.ts` (see the header note on why no trigger).
    CONSTRAINT "fk_accounting_accounts_parent"
        FOREIGN KEY ("parent_id")
        REFERENCES "accounting"."accounts"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_accounting_accounts_coding_structure_version"
        FOREIGN KEY ("coding_structure_version_id")
        REFERENCES "accounting"."coding_structure_versions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The canonical-code uniqueness scope (§9.2): one code, one account, per
-- organization. This index — not a SELECT-then-INSERT — is the authoritative
-- duplicate guard under concurrency.
CREATE UNIQUE INDEX "uq_accounts_organization_id_code"
    ON "accounting"."accounts" ("organization_id", "code");

CREATE INDEX "idx_accounts_organization_id_parent_id"
    ON "accounting"."accounts" ("organization_id", "parent_id");

CREATE INDEX "idx_accounts_organization_id_level"
    ON "accounting"."accounts" ("organization_id", "level");

CREATE INDEX "idx_accounts_organization_id_is_active"
    ON "accounting"."accounts" ("organization_id", "is_active");

-- "Which accounts pin this version": the query a structure-version retirement
-- or (OQ-25) a structure migration must answer.
CREATE INDEX "idx_accounts_coding_structure_version_id"
    ON "accounting"."accounts" ("coding_structure_version_id");
