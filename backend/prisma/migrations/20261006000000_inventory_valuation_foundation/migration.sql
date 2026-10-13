-- Inventory module: valuation foundation (PDR-05, ADR-0039, D-06, OQ-24
-- partially answered by Owner decisions OD-VAL-01…OD-VAL-19).
--
-- WHAT THIS MIGRATION DOES
--   1. adds the VALUE half to the EXISTING quantity ledger
--      (`inventory_movements`) — no second ledger, no duplicate accounting
--      receipt/issue table;
--   2. adds the effective-dated valuation-method configuration
--      (`item_valuation_methods`, organization + item);
--   3. adds the Moving Weighted Average state projection
--      (`inventory_valuation_states`, warehouse + item);
--   4. adds the audit record of explicit repricing commands
--      (`inventory_valuation_runs`).
--
-- NON-DESTRUCTIVE BY CONSTRUCTION
--   * every added movement column is NULLABLE, or NOT NULL with a DEFAULT
--     that reproduces today's meaning: an existing movement has no value, so
--     it is `valuation_status = 'unvalued'` with `total_cost IS NULL` — which
--     is exactly what it has always been;
--   * no column is dropped, renamed, re-typed or back-filled;
--   * no existing index or constraint is changed;
--   * no existing read changes: every current query selects named columns.
--
-- DESIGN NOTES (full rationale in prisma/schema/inventory.prisma)
--   * `inventory_movements.total_cost` is the SIGNED value effect
--     (+ inbound, − outbound), mirroring `base_quantity`, so inventory value
--     is `SUM(total_cost)` exactly like on-hand is `SUM(base_quantity)`.
--     It is NULLABLE because a warehouse receipt must be postable without any
--     monetary value (OD-VAL-05) — cost never gates a quantity fact.
--   * there is deliberately NO stored `unit_cost`: a per-unit figure is a
--     ROUNDED presentation of `total_cost / base_quantity` and must not
--     become a second truth.
--   * `valuation_status` is `unvalued` | `provisional` | `valued` and states
--     FINALITY: `provisional` is a real value that an explicit recalculation
--     will change. `valuation_source` is `entered` | `average_cost` |
--     `transfer` | `reversal`; everything except `average_cost` is a value
--     the fact carries on its own authority and survives a replay verbatim.
--   * `valuation_status` / `valuation_source` / `status` / `trigger` /
--     `method` are closed, code-defined lists stored as text — the same
--     convention as `item_kind`, `movement_type` and
--     `inventory_reservations.status`. No CHECK constraints anywhere (Prisma
--     cannot express them; value rules live in the framework-free domain
--     layer and are unit-tested), and no `ALTER TYPE` is ever needed.
--   * money is `numeric(18,2)` and quantities stay `numeric(18,4)`
--     (docs/database-strategy.md §6).
--   * all foreign keys are ON DELETE RESTRICT, matching every other table in
--     this module; constraint names follow the module's `pk_*`/`fk_*`
--     convention.

-- ---- value half of the existing quantity ledger ----------------------------
ALTER TABLE "inventory"."inventory_movements"
    ADD COLUMN "total_cost"       NUMERIC(18, 2),
    ADD COLUMN "valuation_status" VARCHAR(16) NOT NULL DEFAULT 'unvalued',
    ADD COLUMN "valuation_source" VARCHAR(24),
    ADD COLUMN "valued_at"        TIMESTAMPTZ(6),
    ADD COLUMN "valuation_run_id" TEXT;

-- ---- `inventory.item_valuation_methods` ------------------------------------
CREATE TABLE "inventory"."item_valuation_methods" (
    "id"              TEXT           NOT NULL,
    "organization_id" TEXT           NOT NULL,
    "item_id"         TEXT           NOT NULL,
    "method"          VARCHAR(32)    NOT NULL,
    "valid_from"      TIMESTAMPTZ(6) NOT NULL,
    "valid_to"        TIMESTAMPTZ(6),
    "note"            VARCHAR(500),
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,

    CONSTRAINT "pk_item_valuation_methods" PRIMARY KEY ("id"),
    CONSTRAINT "fk_item_valuation_methods_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_item_valuation_methods_item"
        FOREIGN KEY ("item_id")
        REFERENCES "inventory"."items"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_item_valuation_methods_item_valid_from"
    ON "inventory"."item_valuation_methods" ("organization_id", "item_id", "valid_from");
CREATE INDEX "idx_item_valuation_methods_org_item"
    ON "inventory"."item_valuation_methods" ("organization_id", "item_id");

-- ---- `inventory.inventory_valuation_runs` ----------------------------------
-- Created BEFORE the state table, which references the run that last rebuilt
-- it.
CREATE TABLE "inventory"."inventory_valuation_runs" (
    "id"                          TEXT           NOT NULL,
    "organization_id"             TEXT           NOT NULL,
    "branch_id"                   TEXT           NOT NULL,
    "warehouse_id"                TEXT           NOT NULL,
    "item_id"                     TEXT           NOT NULL,
    "method"                      VARCHAR(32)    NOT NULL,
    "trigger"                     VARCHAR(24)    NOT NULL,
    "from_date"                   TIMESTAMPTZ(6),
    "movements_examined"          INTEGER        NOT NULL,
    "movements_revalued"          INTEGER        NOT NULL,
    "resulting_valued_quantity"   NUMERIC(18, 4) NOT NULL,
    "resulting_uncosted_quantity" NUMERIC(18, 4) NOT NULL,
    "resulting_total_value"       NUMERIC(18, 2) NOT NULL,
    "resulting_status"            VARCHAR(16)    NOT NULL,
    "operation_key"               VARCHAR(128)   NOT NULL,
    "reason"                      VARCHAR(500),
    "executed_at"                 TIMESTAMPTZ(6) NOT NULL,
    "created_at"                  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"                  TEXT,
    "updated_by"                  TEXT,

    CONSTRAINT "pk_inventory_valuation_runs" PRIMARY KEY ("id"),
    CONSTRAINT "fk_inventory_valuation_runs_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_valuation_runs_branch"
        FOREIGN KEY ("branch_id")
        REFERENCES "organization"."branches"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_valuation_runs_warehouse"
        FOREIGN KEY ("warehouse_id")
        REFERENCES "inventory"."warehouses"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_valuation_runs_item"
        FOREIGN KEY ("item_id")
        REFERENCES "inventory"."items"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_valuation_runs_org_key_executed_at"
    ON "inventory"."inventory_valuation_runs" ("organization_id", "warehouse_id", "item_id", "executed_at");
CREATE INDEX "idx_valuation_runs_org_executed_at"
    ON "inventory"."inventory_valuation_runs" ("organization_id", "executed_at");

-- ---- `inventory.inventory_valuation_states` --------------------------------
CREATE TABLE "inventory"."inventory_valuation_states" (
    "id"                    TEXT           NOT NULL,
    "organization_id"       TEXT           NOT NULL,
    "branch_id"             TEXT           NOT NULL,
    "warehouse_id"          TEXT           NOT NULL,
    "item_id"               TEXT           NOT NULL,
    "method"                VARCHAR(32)    NOT NULL,
    "valued_quantity"       NUMERIC(18, 4) NOT NULL DEFAULT 0,
    "uncosted_quantity"     NUMERIC(18, 4) NOT NULL DEFAULT 0,
    "total_value"           NUMERIC(18, 2) NOT NULL DEFAULT 0,
    "status"                VARCHAR(16)    NOT NULL DEFAULT 'valued',
    "stale_since"           TIMESTAMPTZ(6),
    "last_valued_at"        TIMESTAMPTZ(6),
    "last_recalculation_id" TEXT,
    "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"            TEXT,
    "updated_by"            TEXT,

    CONSTRAINT "pk_inventory_valuation_states" PRIMARY KEY ("id"),
    CONSTRAINT "fk_inventory_valuation_states_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_valuation_states_branch"
        FOREIGN KEY ("branch_id")
        REFERENCES "organization"."branches"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_valuation_states_warehouse"
        FOREIGN KEY ("warehouse_id")
        REFERENCES "inventory"."warehouses"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_valuation_states_item"
        FOREIGN KEY ("item_id")
        REFERENCES "inventory"."items"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_valuation_states_last_recalculation"
        FOREIGN KEY ("last_recalculation_id")
        REFERENCES "inventory"."inventory_valuation_runs"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_valuation_states_org_warehouse_item"
    ON "inventory"."inventory_valuation_states" ("organization_id", "warehouse_id", "item_id");
CREATE INDEX "idx_valuation_states_org_status"
    ON "inventory"."inventory_valuation_states" ("organization_id", "status");
CREATE INDEX "idx_valuation_states_org_item"
    ON "inventory"."inventory_valuation_states" ("organization_id", "item_id");
CREATE INDEX "idx_valuation_states_last_recalculation_id"
    ON "inventory"."inventory_valuation_states" ("last_recalculation_id");

-- ---- ledger wiring for the valuation read/audit paths ----------------------
-- The Inventory Accounting worklist ("which facts on this key still carry no
-- value?") and the run → revalued-facts audit trail.
ALTER TABLE "inventory"."inventory_movements"
    ADD CONSTRAINT "fk_inventory_movements_valuation_run"
        FOREIGN KEY ("valuation_run_id")
        REFERENCES "inventory"."inventory_valuation_runs"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_movements_org_key_valuation_status"
    ON "inventory"."inventory_movements" ("organization_id", "warehouse_id", "item_id", "valuation_status");
CREATE INDEX "idx_movements_valuation_run_id"
    ON "inventory"."inventory_movements" ("valuation_run_id");
