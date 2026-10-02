-- Inventory module: Material Request (C-50) — an Inventory-owned business
-- aggregate recording DEMAND for stock, never a movement/receipt/issue,
-- Purchase Request or accounting document.
--
-- Design notes (see prisma/schema/inventory.prisma for the full rationale):
--   * `material_requests.status` is a closed, code-defined list
--     (`draft|submitted|approved|rejected`) stored as text, same convention
--     as `inventory_reservations.status` / `items.item_kind`. No CHECK
--     constraints anywhere, same rule as every other migration in this
--     module: Prisma cannot represent them, so value rules live in the
--     framework-free domain layer and are unit-tested instead.
--   * `material_requests.number` carries a plain UNIQUE index together with
--     `organization_id`. PostgreSQL treats NULLs as distinct, so this is
--     exactly "at most one request per allocated number, any number of
--     un-numbered drafts" — the same trick `uq_movements_reversal_of...`
--     already relies on.
--   * `material_request_lines.reservation_id` is a real FK into
--     `inventory_reservations` (both tables live in this module) with a
--     UNIQUE index: a reservation belongs to at most one line.
--   * `material_request_lines.invoked_base_quantity`/`invocation_count` are
--     AUTHORITATIVE counters maintained transactionally by this module under
--     the request's own row lock (never recomputed from
--     `documents.document_relations`, which stays the cross-module
--     traceability record only) — this is what makes the invoked-quantity
--     cap race-free across concurrent invocations and immune to that other
--     table's own page-size limits.
--   * `material_request_lines.branch_id` is DENORMALIZED from
--     `warehouses.branch_id` at line-creation time, same as the inventory
--     core ledger tables — branch is a first-class reporting scope
--     (ADR-0020), not a new header-level concept.
--   * `material_request_events` is the narrow, append-only, typed-column
--     audit trail for the request-level lifecycle narrative (approval,
--     rejection, reversal, invocation) — no JSONB, no generic audit
--     framework.
--   * `warehouses.reservations_reduce_available` (NOT NULL DEFAULT TRUE) is
--     the new warehouse system setting controlling whether ACTIVE
--     reservations reduce the CALCULATED `available` figure. TRUE preserves
--     today's unconditional `on_hand - reserved` behavior for every existing
--     warehouse — this migration changes no existing read.
--   * All foreign keys are ON DELETE RESTRICT, matching every other table in
--     this module.

-- ---- policy column on existing master data ---------------------------------
ALTER TABLE "inventory"."warehouses"
    ADD COLUMN "reservations_reduce_available" BOOLEAN NOT NULL DEFAULT TRUE;

-- ---- `inventory.material_requests` ------------------------------------------
CREATE TABLE "inventory"."material_requests" (
    "id"                        TEXT            NOT NULL,
    "organization_id"           TEXT            NOT NULL,
    "number"                    VARCHAR(32),
    "status"                    VARCHAR(16)     NOT NULL DEFAULT 'draft',
    "description"               VARCHAR(1000),
    "requested_by"              TEXT            NOT NULL,
    "submitted_at"              TIMESTAMPTZ(6),
    "submitted_by"              TEXT,
    "approved_at"               TIMESTAMPTZ(6),
    "approved_by"               TEXT,
    "rejected_at"               TIMESTAMPTZ(6),
    "rejected_by"               TEXT,
    "rejection_reason"          VARCHAR(1000),
    "approval_reversed_at"      TIMESTAMPTZ(6),
    "approval_reversed_by"      TEXT,
    "approval_reversal_reason"  VARCHAR(1000),
    "created_at"                TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"                TEXT,
    "updated_by"                TEXT,
    CONSTRAINT "pk_material_requests" PRIMARY KEY ("id"),
    CONSTRAINT "fk_material_requests_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- At most one request per allocated number per organization; any number of
-- NULL (draft) numbers coexist.
CREATE UNIQUE INDEX "uq_material_requests_org_number"
    ON "inventory"."material_requests" ("organization_id", "number");

CREATE INDEX "idx_material_requests_org_status"
    ON "inventory"."material_requests" ("organization_id", "status");

CREATE INDEX "idx_material_requests_org_created_at"
    ON "inventory"."material_requests" ("organization_id", "created_at");

CREATE INDEX "idx_material_requests_org_requested_by"
    ON "inventory"."material_requests" ("organization_id", "requested_by");

-- ---- `inventory.material_request_lines` -------------------------------------
CREATE TABLE "inventory"."material_request_lines" (
    "id"                     TEXT            NOT NULL,
    "material_request_id"    TEXT            NOT NULL,
    "organization_id"        TEXT            NOT NULL,
    "branch_id"              TEXT            NOT NULL,
    "line_number"            INTEGER         NOT NULL,
    "item_id"                TEXT            NOT NULL,
    "warehouse_id"           TEXT            NOT NULL,
    "quantity"               NUMERIC(18,4)   NOT NULL,
    "unit_id"                TEXT            NOT NULL,
    "base_quantity"          NUMERIC(18,4)   NOT NULL,
    "base_unit_id"           TEXT            NOT NULL,
    "conversion_factor"      NUMERIC(18,6)   NOT NULL,
    "reservation_requested"  BOOLEAN         NOT NULL DEFAULT FALSE,
    "reservation_id"         TEXT,
    "invoked_base_quantity"  NUMERIC(18,4)   NOT NULL DEFAULT 0,
    "invocation_count"       INTEGER         NOT NULL DEFAULT 0,
    "created_at"             TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"             TEXT,
    "updated_by"             TEXT,
    CONSTRAINT "pk_material_request_lines" PRIMARY KEY ("id"),
    CONSTRAINT "fk_material_request_lines_request"
        FOREIGN KEY ("material_request_id")
        REFERENCES "inventory"."material_requests"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_material_request_lines_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_material_request_lines_branch"
        FOREIGN KEY ("branch_id")
        REFERENCES "organization"."branches"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_material_request_lines_item"
        FOREIGN KEY ("item_id")
        REFERENCES "inventory"."items"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_material_request_lines_warehouse"
        FOREIGN KEY ("warehouse_id")
        REFERENCES "inventory"."warehouses"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_material_request_lines_unit"
        FOREIGN KEY ("unit_id")
        REFERENCES "inventory"."units"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_material_request_lines_base_unit"
        FOREIGN KEY ("base_unit_id")
        REFERENCES "inventory"."units"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_material_request_lines_reservation"
        FOREIGN KEY ("reservation_id")
        REFERENCES "inventory"."inventory_reservations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- A reservation belongs to at most one Material Request line.
CREATE UNIQUE INDEX "uq_material_request_lines_reservation_id"
    ON "inventory"."material_request_lines" ("reservation_id");

CREATE UNIQUE INDEX "uq_material_request_lines_request_line_number"
    ON "inventory"."material_request_lines" ("material_request_id", "line_number");

CREATE INDEX "idx_material_request_lines_org_item"
    ON "inventory"."material_request_lines" ("organization_id", "item_id");

CREATE INDEX "idx_material_request_lines_org_warehouse"
    ON "inventory"."material_request_lines" ("organization_id", "warehouse_id");

CREATE INDEX "idx_material_request_lines_org_branch"
    ON "inventory"."material_request_lines" ("organization_id", "branch_id");

-- ---- `inventory.material_request_events` (append-only audit trail) --------
CREATE TABLE "inventory"."material_request_events" (
    "id"                  TEXT            NOT NULL,
    "material_request_id" TEXT            NOT NULL,
    "organization_id"     TEXT            NOT NULL,
    "event_type"          VARCHAR(32)     NOT NULL,
    "from_status"         VARCHAR(16),
    "to_status"           VARCHAR(16),
    "actor_id"            TEXT,
    "reason"              VARCHAR(1000),
    "reference_id"        TEXT,
    "occurred_at"         TIMESTAMPTZ(6)  NOT NULL,
    "created_at"          TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pk_material_request_events" PRIMARY KEY ("id"),
    CONSTRAINT "fk_material_request_events_request"
        FOREIGN KEY ("material_request_id")
        REFERENCES "inventory"."material_requests"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_material_request_events_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_material_request_events_request_time"
    ON "inventory"."material_request_events"
    ("organization_id", "material_request_id", "occurred_at");
