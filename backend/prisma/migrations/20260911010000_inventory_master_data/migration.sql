-- Inventory module: master data only (units, conversions, item groups, items,
-- warehouses).
--
-- Module + intent (docs/database-strategy.md §2): `inventory` module — the
-- master-data half of the module that master-data-strategy.md §1 assigns to
-- Inventory. Implements the "first migration candidate" step 2 of the
-- domain-blueprint §21 gate.
--
-- Explicitly NOT created here (future Inventory work — ADR-0017, OQ-24):
-- stock movements, stock balances, warehouse locations/bins, lots, serial
-- numbers, reservations, valuation/costing tables. Task 6 is the
-- master-data foundation those will consume; creating them now would encode
-- accounting semantics that are still expert-gated.
--
-- Design notes:
--   * `items` is ONE table (D-25). `item_kind` is a closed, code-defined list
--     (`src/modules/inventory/domain/item-kind.ts`) stored as VARCHAR(24),
--     deliberately NOT a database enum: the list evolves by code change, and
--     text + application validation avoids `ALTER TYPE` migrations. The seven
--     capability booleans are the stored truth the code branches on — there is
--     no EAV/JSONB attribute table and no Product/Service/StockItem table.
--   * Capability combinations that contradict master-data-strategy.md §3.2/§3.3
--     (a non-stockable item that is valued or requires lot/serial/expiry) are
--     rejected in the domain layer, not by CHECK constraints — see the
--     "no CHECK constraints" note in the organization migration.
--   * Unit conversions are split into `unit_conversions` (global, any item)
--     and `item_unit_conversions` (per item), exactly as
--     master-data-strategy.md §3.4 names them, so `1 BOX = 10 PCS` for item A
--     and `1 BOX = 24 PCS` for item B are both representable.
--   * Both conversion tables are EFFECTIVE-DATED (`valid_from`/`valid_to`,
--     D-21/D-26). A change inserts a NEW version and closes the previous one;
--     an existing version row is never rewritten, so quantities already
--     recorded against it keep their original meaning. There is no rounding
--     column — fractional conversion rounding is unresolved (OQ-29) and must
--     not be invented.
--   * `warehouses.branch_id` is NOT NULL: a warehouse belongs to exactly one
--     branch (ADR-0020 §1, master-data-strategy.md §1/§4, blueprint §11).
--     Multiple warehouses per organization and per branch are the normal case;
--     warehouse is master data, never an enum.
--   * Cross-schema foreign keys to `organization.*` use ON DELETE RESTRICT: an
--     organization or branch that master data points at can never be removed.
--     The dependency is strictly one-way (Inventory → Organization) and
--     follows the pattern the repository already uses for `identity.sessions`
--     and `rbac.user_roles` → `users.users` (docs/database-strategy.md §5).
--     Organization *consistency* (an item's group/unit must belong to the
--     item's organization) cannot be expressed by a foreign key and is
--     enforced in the application services.
--   * Lifecycle: `is_active` only, identical to the organization module.

CREATE SCHEMA IF NOT EXISTS "inventory";

-- ---- `inventory.units` -----------------------------------------------------
CREATE TABLE "inventory"."units" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "code"            VARCHAR(32)     NOT NULL,
    "name"            VARCHAR(120)    NOT NULL,
    "symbol"          VARCHAR(16),
    "is_active"       BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_inventory_units" PRIMARY KEY ("id"),
    CONSTRAINT "fk_inventory_units_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_units_organization_id_code"
    ON "inventory"."units" ("organization_id", "code");

CREATE INDEX "idx_units_organization_id_is_active"
    ON "inventory"."units" ("organization_id", "is_active");

-- ---- `inventory.item_groups` ----------------------------------------------
CREATE TABLE "inventory"."item_groups" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "parent_id"       TEXT,
    "code"            VARCHAR(64)     NOT NULL,
    "name"            VARCHAR(200)    NOT NULL,
    "is_active"       BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_inventory_item_groups" PRIMARY KEY ("id"),
    CONSTRAINT "fk_inventory_item_groups_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_item_groups_parent"
        FOREIGN KEY ("parent_id")
        REFERENCES "inventory"."item_groups"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_item_groups_organization_id_code"
    ON "inventory"."item_groups" ("organization_id", "code");

CREATE INDEX "idx_item_groups_organization_id_is_active"
    ON "inventory"."item_groups" ("organization_id", "is_active");

CREATE INDEX "idx_item_groups_parent_id"
    ON "inventory"."item_groups" ("parent_id");

-- ---- `inventory.items` -----------------------------------------------------
CREATE TABLE "inventory"."items" (
    "id"               TEXT            NOT NULL,
    "organization_id"  TEXT            NOT NULL,
    "code"             VARCHAR(64)     NOT NULL,
    "name"             VARCHAR(200)    NOT NULL,
    "description"      TEXT,
    "item_kind"        VARCHAR(24)     NOT NULL,
    "item_group_id"    TEXT,
    "base_unit_id"     TEXT            NOT NULL,
    "is_stockable"     BOOLEAN         NOT NULL,
    "is_purchasable"   BOOLEAN         NOT NULL,
    "is_sellable"      BOOLEAN         NOT NULL,
    "is_valued"        BOOLEAN         NOT NULL,
    "requires_lot"     BOOLEAN         NOT NULL DEFAULT FALSE,
    "requires_serial"  BOOLEAN         NOT NULL DEFAULT FALSE,
    "requires_expiry"  BOOLEAN         NOT NULL DEFAULT FALSE,
    "barcode"          VARCHAR(64),
    "is_active"        BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"       TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"       TEXT,
    "updated_by"       TEXT,
    CONSTRAINT "pk_inventory_items" PRIMARY KEY ("id"),
    CONSTRAINT "fk_inventory_items_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_items_item_group"
        FOREIGN KEY ("item_group_id")
        REFERENCES "inventory"."item_groups"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_items_base_unit"
        FOREIGN KEY ("base_unit_id")
        REFERENCES "inventory"."units"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_items_organization_id_code"
    ON "inventory"."items" ("organization_id", "code");

CREATE INDEX "idx_items_organization_id_is_active"
    ON "inventory"."items" ("organization_id", "is_active");

CREATE INDEX "idx_items_organization_id_item_kind"
    ON "inventory"."items" ("organization_id", "item_kind");

-- Every stock report filters on is_stockable (master-data-strategy.md §8).
CREATE INDEX "idx_items_organization_id_is_stockable"
    ON "inventory"."items" ("organization_id", "is_stockable");

CREATE INDEX "idx_items_item_group_id"
    ON "inventory"."items" ("item_group_id");

CREATE INDEX "idx_items_base_unit_id"
    ON "inventory"."items" ("base_unit_id");

-- ---- `inventory.unit_conversions` (global) ---------------------------------
CREATE TABLE "inventory"."unit_conversions" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "from_unit_id"    TEXT            NOT NULL,
    "to_unit_id"      TEXT            NOT NULL,
    "factor"          NUMERIC(18,6)   NOT NULL,
    "valid_from"      TIMESTAMPTZ(6)  NOT NULL,
    "valid_to"        TIMESTAMPTZ(6),
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_inventory_unit_conversions" PRIMARY KEY ("id"),
    CONSTRAINT "fk_inventory_unit_conversions_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_unit_conversions_from_unit"
        FOREIGN KEY ("from_unit_id")
        REFERENCES "inventory"."units"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_unit_conversions_to_unit"
        FOREIGN KEY ("to_unit_id")
        REFERENCES "inventory"."units"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_unit_conversions_pair_valid_from"
    ON "inventory"."unit_conversions"
    ("organization_id", "from_unit_id", "to_unit_id", "valid_from");

CREATE INDEX "idx_unit_conversions_pair"
    ON "inventory"."unit_conversions"
    ("organization_id", "from_unit_id", "to_unit_id");

CREATE INDEX "idx_unit_conversions_to_unit_id"
    ON "inventory"."unit_conversions" ("to_unit_id");

-- ---- `inventory.item_unit_conversions` (item-specific) ---------------------
CREATE TABLE "inventory"."item_unit_conversions" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "item_id"         TEXT            NOT NULL,
    "from_unit_id"    TEXT            NOT NULL,
    "to_unit_id"      TEXT            NOT NULL,
    "factor"          NUMERIC(18,6)   NOT NULL,
    "valid_from"      TIMESTAMPTZ(6)  NOT NULL,
    "valid_to"        TIMESTAMPTZ(6),
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_inventory_item_unit_conversions" PRIMARY KEY ("id"),
    CONSTRAINT "fk_inventory_item_unit_conversions_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_item_unit_conversions_item"
        FOREIGN KEY ("item_id")
        REFERENCES "inventory"."items"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_item_unit_conversions_from_unit"
        FOREIGN KEY ("from_unit_id")
        REFERENCES "inventory"."units"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_item_unit_conversions_to_unit"
        FOREIGN KEY ("to_unit_id")
        REFERENCES "inventory"."units"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_item_unit_conversions_pair_valid_from"
    ON "inventory"."item_unit_conversions"
    ("item_id", "from_unit_id", "to_unit_id", "valid_from");

CREATE INDEX "idx_item_unit_conversions_item_pair"
    ON "inventory"."item_unit_conversions"
    ("organization_id", "item_id", "from_unit_id", "to_unit_id");

CREATE INDEX "idx_item_unit_conversions_to_unit_id"
    ON "inventory"."item_unit_conversions" ("to_unit_id");

-- ---- `inventory.warehouses` ------------------------------------------------
CREATE TABLE "inventory"."warehouses" (
    "id"              TEXT            NOT NULL,
    "organization_id" TEXT            NOT NULL,
    "branch_id"       TEXT            NOT NULL,
    "code"            VARCHAR(64)     NOT NULL,
    "name"            VARCHAR(200)    NOT NULL,
    "is_active"       BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT,
    "updated_by"      TEXT,
    CONSTRAINT "pk_inventory_warehouses" PRIMARY KEY ("id"),
    CONSTRAINT "fk_inventory_warehouses_organization"
        FOREIGN KEY ("organization_id")
        REFERENCES "organization"."organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_inventory_warehouses_branch"
        FOREIGN KEY ("branch_id")
        REFERENCES "organization"."branches"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_warehouses_organization_id_code"
    ON "inventory"."warehouses" ("organization_id", "code");

CREATE INDEX "idx_warehouses_organization_id_is_active"
    ON "inventory"."warehouses" ("organization_id", "is_active");

CREATE INDEX "idx_warehouses_branch_id"
    ON "inventory"."warehouses" ("branch_id");
