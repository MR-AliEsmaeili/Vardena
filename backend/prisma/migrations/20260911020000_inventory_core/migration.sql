-- Inventory module: the operational core — ledger, balances, reservations,
-- idempotency (Task 7, ADR-0017, ADR-0022).
--
-- Module + intent (docs/database-strategy.md §2): `inventory` module — the
-- transactional half of the module. The master-data half (Task 6) is consumed
-- here, never modified structurally except for the two policy columns below.
--
-- Design notes:
--   * `inventory_movements` is the IMMUTABLE ledger (D-04/D-05). Rows are
--     insert-only; corrections are counter-movements linked by
--     `reversal_of_movement_id`. `quantity` is the entered magnitude (> 0);
--     `base_quantity` is the signed base-unit effect that balances aggregate.
--   * `movement_type`, reservation `status` and operation `operation` are
--     closed, code-defined lists stored as text — the same decision Task 6
--     made for `items.item_kind` (extending the list is an ordinary change,
--     never an `ALTER TYPE`; the application rejects anything outside it).
--   * No CHECK constraints anywhere, same rule as the Task 6 migrations:
--     Prisma cannot represent them, so every value rule lives in the
--     framework-free domain layer and is unit-tested instead.
--   * `reversal_of_movement_id` carries a plain UNIQUE index. PostgreSQL
--     treats NULLs as distinct, so this is exactly "at most one reversal per
--     movement" with no partial-index syntax that Prisma could not express.
--   * `warehouses.allow_negative_stock` (NOT NULL DEFAULT FALSE) and
--     `items.allow_negative_stock` (NULL = follow the warehouse) are the
--     negative-stock policy (D-07, OQ-24). Existing rows keep the fail-closed
--     default: warehouses get FALSE, items get NULL (inherit).
--   * Deliberately NOT created (ADR-0022): cost columns (no Task 7 flow knows
--     a cost; precision is OQ-03-gated), lot/serial/expiry tables (fail-closed
--     via the item capability flags), inventory documents, valuation state,
--     accounting postings. Those arrive with their own designed migrations.
--   * All foreign keys are ON DELETE RESTRICT: referenced master data and
--     ledger facts can never be removed out from under history.

-- ---- policy columns on existing master data --------------------------------
ALTER TABLE "inventory"."warehouses"
    ADD COLUMN "allow_negative_stock" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "inventory"."items"
    ADD COLUMN "allow_negative_stock" BOOLEAN;

-- ---- `inventory.inventory_movements` (immutable ledger) --------------------
CREATE TABLE "inventory"."inventory_movements" (
    "id"                      TEXT            NOT NULL,
    "organization_id"         TEXT            NOT NULL,
    "branch_id"               TEXT            NOT NULL,
    "warehouse_id"            TEXT            NOT NULL,
    "item_id"                 TEXT            NOT NULL,
    "movement_type"           VARCHAR(24)     NOT NULL,
    "quantity"                NUMERIC(18,4)   NOT NULL,
    "unit_id"                 TEXT            NOT NULL,
    "base_quantity"           NUMERIC(18,4)   NOT NULL,
    "base_unit_id"            TEXT            NOT NULL,
    "conversion_factor"       NUMERIC(18,6)   NOT NULL,
    "movement_date"           TIMESTAMPTZ(6)  NOT NULL,
    "transfer_id"             TEXT,
    "reversal_of_movement_id" TEXT,
    "reference_type"          VARCHAR(64),
    "reference_id"            TEXT,
    "reason"                  VARCHAR(500),
    "operation_key"           VARCHAR(128)    NOT NULL,
    "created_at"              TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"              TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"              TEXT,
    "updated_by"              TEXT,
    CONSTRAINT "pk_inventory_movements" PRIMARY KEY ("id"),
    CONSTRAINT "fk_inventory_movements_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_movements_branch"
        FOREIGN KEY ("branch_id")
        REFERENCES "organization"."branches"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_movements_warehouse"
        FOREIGN KEY ("warehouse_id")
        REFERENCES "inventory"."warehouses"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_movements_item"
        FOREIGN KEY ("item_id")
        REFERENCES "inventory"."items"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_movements_unit"
        FOREIGN KEY ("unit_id")
        REFERENCES "inventory"."units"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_movements_base_unit"
        FOREIGN KEY ("base_unit_id")
        REFERENCES "inventory"."units"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_movements_reversal_of"
        FOREIGN KEY ("reversal_of_movement_id")
        REFERENCES "inventory"."inventory_movements"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- One full reversal per movement (NULLs do not clash).
CREATE UNIQUE INDEX "uq_movements_reversal_of_movement_id"
    ON "inventory"."inventory_movements" ("reversal_of_movement_id");

-- Balance-key postings in date order (posting path + key history).
CREATE INDEX "idx_movements_org_warehouse_item_date"
    ON "inventory"."inventory_movements"
    ("organization_id", "warehouse_id", "item_id", "movement_date");

-- Stock card: one item across warehouses, in date order.
CREATE INDEX "idx_movements_org_item_date"
    ON "inventory"."inventory_movements"
    ("organization_id", "item_id", "movement_date");

-- Branch-scoped movement reports (branch is a first-class scope, ADR-0020).
CREATE INDEX "idx_movements_org_branch_date"
    ON "inventory"."inventory_movements"
    ("organization_id", "branch_id", "movement_date");

-- The two legs of one transfer.
CREATE INDEX "idx_movements_transfer_id"
    ON "inventory"."inventory_movements" ("transfer_id");

-- Traceability from an idempotency key to its ledger effect.
CREATE INDEX "idx_movements_org_operation_key"
    ON "inventory"."inventory_movements" ("organization_id", "operation_key");

-- ---- `inventory.inventory_balances` (materialized projection) --------------
CREATE TABLE "inventory"."inventory_balances" (
    "id"                TEXT            NOT NULL,
    "organization_id"   TEXT            NOT NULL,
    "branch_id"         TEXT            NOT NULL,
    "warehouse_id"      TEXT            NOT NULL,
    "item_id"           TEXT            NOT NULL,
    "on_hand"           NUMERIC(18,4)   NOT NULL DEFAULT 0,
    "reserved_quantity" NUMERIC(18,4)   NOT NULL DEFAULT 0,
    "last_movement_at"  TIMESTAMPTZ(6),
    "created_at"        TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"        TEXT,
    "updated_by"        TEXT,
    CONSTRAINT "pk_inventory_balances" PRIMARY KEY ("id"),
    CONSTRAINT "fk_inventory_balances_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_balances_branch"
        FOREIGN KEY ("branch_id")
        REFERENCES "organization"."branches"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_balances_warehouse"
        FOREIGN KEY ("warehouse_id")
        REFERENCES "inventory"."warehouses"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_balances_item"
        FOREIGN KEY ("item_id")
        REFERENCES "inventory"."items"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- One projection row per stocking key; also the row lock postings serialize on.
CREATE UNIQUE INDEX "uq_balances_org_warehouse_item"
    ON "inventory"."inventory_balances"
    ("organization_id", "warehouse_id", "item_id");

CREATE INDEX "idx_balances_org_warehouse"
    ON "inventory"."inventory_balances" ("organization_id", "warehouse_id");

CREATE INDEX "idx_balances_org_item"
    ON "inventory"."inventory_balances" ("organization_id", "item_id");

CREATE INDEX "idx_balances_org_branch"
    ON "inventory"."inventory_balances" ("organization_id", "branch_id");

-- ---- `inventory.inventory_reservations` ------------------------------------
CREATE TABLE "inventory"."inventory_reservations" (
    "id"                  TEXT            NOT NULL,
    "organization_id"     TEXT            NOT NULL,
    "branch_id"           TEXT            NOT NULL,
    "warehouse_id"        TEXT            NOT NULL,
    "item_id"             TEXT            NOT NULL,
    "quantity"            NUMERIC(18,4)   NOT NULL,
    "unit_id"             TEXT            NOT NULL,
    "base_quantity"       NUMERIC(18,4)   NOT NULL,
    "base_unit_id"        TEXT            NOT NULL,
    "conversion_factor"   NUMERIC(18,6)   NOT NULL,
    "status"              VARCHAR(16)     NOT NULL,
    "reference_type"      VARCHAR(64),
    "reference_id"        TEXT,
    "reason"              VARCHAR(500),
    "operation_key"       VARCHAR(128)    NOT NULL,
    "released_at"         TIMESTAMPTZ(6),
    "released_by"         TEXT,
    "release_operation_key" VARCHAR(128),
    "created_at"          TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"          TEXT,
    "updated_by"          TEXT,
    CONSTRAINT "pk_inventory_reservations" PRIMARY KEY ("id"),
    CONSTRAINT "fk_inventory_reservations_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_reservations_branch"
        FOREIGN KEY ("branch_id")
        REFERENCES "organization"."branches"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_reservations_warehouse"
        FOREIGN KEY ("warehouse_id")
        REFERENCES "inventory"."warehouses"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_reservations_item"
        FOREIGN KEY ("item_id")
        REFERENCES "inventory"."items"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_reservations_unit"
        FOREIGN KEY ("unit_id")
        REFERENCES "inventory"."units"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_reservations_base_unit"
        FOREIGN KEY ("base_unit_id")
        REFERENCES "inventory"."units"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_reservations_org_warehouse_item_status"
    ON "inventory"."inventory_reservations"
    ("organization_id", "warehouse_id", "item_id", "status");

CREATE INDEX "idx_reservations_org_status"
    ON "inventory"."inventory_reservations" ("organization_id", "status");

-- ---- `inventory.inventory_operations` (idempotency ledger) ------------------
CREATE TABLE "inventory"."inventory_operations" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "operation_key"   VARCHAR(128)    NOT NULL,
    "operation"       VARCHAR(32)     NOT NULL,
    "request_hash"    CHAR(64)        NOT NULL,
    "result"          JSONB           NOT NULL,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_inventory_operations" PRIMARY KEY ("id"),
    CONSTRAINT "fk_inventory_operations_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The idempotency guarantee: one completed operation per key per organization.
CREATE UNIQUE INDEX "uq_operations_org_operation_key"
    ON "inventory"."inventory_operations" ("organization_id", "operation_key");
