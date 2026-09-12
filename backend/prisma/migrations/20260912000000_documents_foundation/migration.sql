-- Document Foundation: shared document mechanics (Task 8, ADR-0023,
-- implements ADR-0019).
--
-- Module + intent (docs/database-strategy.md §2): the `documents` module owns
-- the shared mechanics every future business document will use — document type
-- configuration, numbering (series + allocation ledger) and typed document
-- relations. It owns NO business document: there is deliberately no
-- `documents`/`document_lines` table (ADR-0019 §2, AR-07/08). Inventory,
-- Sales, Purchasing and Accounting each own their document tables; this schema
-- references them only through LOGICAL (module + type + id) columns, never
-- cross-module foreign keys.
--
-- Design notes:
--   * `document_type` codes are code-defined (the application
--     `DocumentTypeRegistry`), stored as text — same decision as
--     `items.item_kind` / `movement_type` (closed lists as text, application
--     rejects anything outside them). No CHECK constraints anywhere (Prisma
--     cannot represent them); value rules live in the framework-free domain
--     layer and are unit-tested.
--   * Numbering: `numbering_series.last_value` is the locked counter. The data
--     layer allocates with `SELECT … FOR UPDATE` on the series row, so
--     concurrent allocations for one series serialize; `uq_numbering_allocations_series_number`
--     is the hard no-duplicate guarantee. Serials are NUMERIC ONLY
--     (Task 8 §11): no prefixes/suffixes/separators. Strategy and reuse policy
--     are configurable seams (`strategy`, `reuse_policy` columns); only the
--     `monotonic` / `never` behaviour is implemented — fiscal-year components,
--     resets and recycling are expert-gated (OQ-12) and out of Task 8 scope.
--   * `scope_key` is '' for a type's default series (PostgreSQL treats NULLs as
--     distinct in unique indexes, so an empty string keeps the uniqueness
--     exact instead of relying on a partial index).
--   * Relations: closed kind list (reference/derive/fulfill/settle/reverse/
--     transfer_of) with optional line-level ids and a base-unit quantity for
--     the quantity-aware `fulfill` kind. Cross-module integrity is enforced by
--     the creating service in its transaction (ADR-0019 consequence); no FK
--     exists because it would couple module schemas permanently.
--   * Deliberately NOT created (ADR-0018/ADR-0023): workflow definitions,
--     document_transitions history, approvals — those are the Workflow
--     Foundation (Task 9). No business document tables, no accounting tables.
--   * All foreign keys are ON DELETE RESTRICT ON UPDATE CASCADE.

CREATE SCHEMA IF NOT EXISTS "documents";

-- ---- `documents.document_type_configs` -------------------------------------
CREATE TABLE "documents"."document_type_configs" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "document_type"   VARCHAR(64)     NOT NULL,
    "draft_required"  BOOLEAN         NOT NULL DEFAULT FALSE,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_document_type_configs" PRIMARY KEY ("id"),
    CONSTRAINT "fk_document_type_configs_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- One configuration row per (organization, document type).
CREATE UNIQUE INDEX "uq_document_type_configs_org_type"
    ON "documents"."document_type_configs" ("organization_id", "document_type");

CREATE INDEX "idx_document_type_configs_org"
    ON "documents"."document_type_configs" ("organization_id");

-- ---- `documents.numbering_series` (configuration + locked counter) ---------
CREATE TABLE "documents"."numbering_series" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "document_type"   VARCHAR(64)     NOT NULL,
    "scope_key"       VARCHAR(64)     NOT NULL DEFAULT '',
    "name"            VARCHAR(200)    NOT NULL,
    "strategy"        VARCHAR(24)     NOT NULL DEFAULT 'monotonic',
    "width"           INTEGER         NOT NULL DEFAULT 0,
    "reuse_policy"    VARCHAR(16)     NOT NULL DEFAULT 'never',
    "last_value"      BIGINT          NOT NULL DEFAULT 0,
    "is_active"       BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_numbering_series" PRIMARY KEY ("id"),
    CONSTRAINT "fk_numbering_series_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- One series per (organization, document type, scope): two series for one type
-- must never silently share a counter.
CREATE UNIQUE INDEX "uq_numbering_series_org_type_scope"
    ON "documents"."numbering_series"
    ("organization_id", "document_type", "scope_key");

CREATE INDEX "idx_numbering_series_org_type"
    ON "documents"."numbering_series" ("organization_id", "document_type");

-- ---- `documents.numbering_allocations` (the numbering ledger) --------------
CREATE TABLE "documents"."numbering_allocations" (
    "id"                       TEXT            NOT NULL,
    "series_id"                TEXT            NOT NULL,
    "organization_id"          TEXT            NOT NULL,
    "document_type"            VARCHAR(64)     NOT NULL,
    "number"                   VARCHAR(32)     NOT NULL,
    "allocation_key"           VARCHAR(128)    NOT NULL,
    "reference_module"         VARCHAR(64),
    "reference_document_type"  VARCHAR(64),
    "reference_document_id"    TEXT,
    "created_at"               TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"               TEXT,
    "updated_by"               TEXT,
    CONSTRAINT "pk_numbering_allocations" PRIMARY KEY ("id"),
    CONSTRAINT "fk_numbering_allocations_series"
        FOREIGN KEY ("series_id")
        REFERENCES "documents"."numbering_series"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_numbering_allocations_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The hard guarantees: one serial per series, one allocation per idempotency
-- key. The FOR UPDATE allocation path makes collisions impossible; these make
-- a violation visible instead of silent.
CREATE UNIQUE INDEX "uq_numbering_allocations_series_number"
    ON "documents"."numbering_allocations" ("series_id", "number");

CREATE UNIQUE INDEX "uq_numbering_allocations_series_key"
    ON "documents"."numbering_allocations" ("series_id", "allocation_key");

-- Number register: a type's issued numbers in order.
CREATE INDEX "idx_numbering_allocations_org_type_number"
    ON "documents"."numbering_allocations"
    ("organization_id", "document_type", "number");

-- "Which number did THIS logical document get?"
CREATE INDEX "idx_numbering_allocations_reference"
    ON "documents"."numbering_allocations"
    ("reference_module", "reference_document_type", "reference_document_id");

-- ---- `documents.document_relations` (typed, quantity-aware links) ----------
CREATE TABLE "documents"."document_relations" (
    "id"                    TEXT            NOT NULL,
    "organization_id"       TEXT            NOT NULL,
    "source_module"         VARCHAR(64)     NOT NULL,
    "source_document_type"  VARCHAR(64)     NOT NULL,
    "source_document_id"    TEXT            NOT NULL,
    "source_line_id"        TEXT,
    "target_module"         VARCHAR(64)     NOT NULL,
    "target_document_type"  VARCHAR(64)     NOT NULL,
    "target_document_id"    TEXT            NOT NULL,
    "target_line_id"        TEXT,
    "relation_kind"         VARCHAR(16)     NOT NULL,
    "quantity"              NUMERIC(18,4),
    "created_by_process"    BOOLEAN         NOT NULL DEFAULT FALSE,
    "created_at"            TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"            TEXT,
    "updated_by"            TEXT,
    CONSTRAINT "pk_document_relations" PRIMARY KEY ("id"),
    CONSTRAINT "fk_document_relations_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- "What links out of this document?" / "What links into this document?"
CREATE INDEX "idx_document_relations_source"
    ON "documents"."document_relations"
    ("organization_id", "source_module", "source_document_type", "source_document_id");

CREATE INDEX "idx_document_relations_target"
    ON "documents"."document_relations"
    ("organization_id", "target_module", "target_document_type", "target_document_id");

CREATE INDEX "idx_document_relations_org_kind"
    ON "documents"."document_relations" ("organization_id", "relation_kind");
