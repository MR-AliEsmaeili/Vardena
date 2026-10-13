-- C-59D/C-59E: Return documents and the Pricing Run batch records.
--
-- Three additive changes, no destructive ones:
--
-- 1. `inventory_business_document_lines.basis_movement_id` — the optional
--    per-line RETURN basis link (PDR-08 OD-RET-01): the ledger fact of the
--    originating receipt (purchase return) or issue (sales return). A plain
--    id, not a foreign key to the ledger, exactly like the movement links the
--    table already carries: a reversed basis row stays forever (AR-13).
--
-- 2. `inventory_pricing_runs` — ONE row per executed Periodic Pricing
--    Operation batch, and one per compensating batch written by Reverse
--    Pricing (PDR-07 OD-PRC-05…07, PDR-08 OD-PDP-01…05 / OD-RVP-01…08).
--    Audit/reporting only: current truth stays
--    inventory_valuation_states + inventory_movements (OD-VH-01, OD-DOC-01).
--    Reversing marks the original (reversed_by_run_id) and never deletes it
--    (OD-RVP-05).
--
-- 3. `inventory_pricing_run_key_outcomes` — the per-key outcome rows the
--    batch must report (OD-PRC-07): priced/failed/reversed, the named
--    failure reason, the offending movements, and the per-key
--    inventory_valuation_runs row the outcome produced.
--
-- New movement types (`purchase_return`, `sales_return`), valuation sources
-- (`return_basis`) and run triggers (`pricing_operation`, `reverse_pricing`)
-- are code-defined vocabularies stored as text — no ALTER TYPE is needed,
-- by design.

-- 1. The return basis link -------------------------------------------------

ALTER TABLE "inventory"."inventory_business_document_lines"
  ADD COLUMN "basis_movement_id" text;

CREATE INDEX "idx_inventory_business_document_lines_org_basis_movement"
  ON "inventory"."inventory_business_document_lines" ("organization_id", "basis_movement_id");

-- 2. The pricing run batch header -------------------------------------------

CREATE TABLE "inventory"."inventory_pricing_runs" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL,
  "warehouse_id" text,
  "document_kinds" text[] NOT NULL,
  "from_date" timestamptz(6),
  "to_date" timestamptz(6) NOT NULL,
  "kind" varchar(24) NOT NULL,
  "reverses_run_id" text,
  "reversed_by_run_id" text,
  "reversed_at" timestamptz(6),
  "keys_examined" integer NOT NULL DEFAULT 0,
  "keys_priced" integer NOT NULL DEFAULT 0,
  "keys_failed" integer NOT NULL DEFAULT 0,
  "movements_examined" integer NOT NULL DEFAULT 0,
  "movements_revalued" integer NOT NULL DEFAULT 0,
  "reason" varchar(500),
  "operation_key" varchar(128) NOT NULL,
  "executed_by" text,
  "executed_at" timestamptz(6) NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "created_by" text,
  "updated_by" text,
  CONSTRAINT "fk_inventory_pricing_runs_organization"
    FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_pricing_runs_warehouse"
    FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_pricing_runs_reverses_run"
    FOREIGN KEY ("reverses_run_id") REFERENCES "inventory"."inventory_pricing_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_pricing_runs_reversed_by_run"
    FOREIGN KEY ("reversed_by_run_id") REFERENCES "inventory"."inventory_pricing_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_pricing_runs_org_scope_executed_at"
  ON "inventory"."inventory_pricing_runs" ("organization_id", "warehouse_id", "kind", "executed_at");
CREATE INDEX "idx_pricing_runs_org_executed_at"
  ON "inventory"."inventory_pricing_runs" ("organization_id", "executed_at");
-- OD-RVP-05 + the at-most-once rule: each run is reversed by at most ONE
-- compensating run. The service guard decides; this constraint is the
-- backstop (Postgres allows multiple NULLs, unreversed runs are unaffected).
ALTER TABLE "inventory"."inventory_pricing_runs"
  ADD CONSTRAINT "uq_inventory_pricing_runs_reverses_run"
  UNIQUE ("reverses_run_id");

-- 3. The per-key outcome rows ------------------------------------------------

CREATE TABLE "inventory"."inventory_pricing_run_key_outcomes" (
  "id" text PRIMARY KEY,
  "pricing_run_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "warehouse_id" text NOT NULL,
  "item_id" text NOT NULL,
  "outcome" varchar(16) NOT NULL,
  "reason" varchar(500),
  "failed_movement_ids" text[] NOT NULL DEFAULT '{}',
  "valuation_run_id" text,
  "movements_examined" integer NOT NULL DEFAULT 0,
  "movements_revalued" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "created_by" text,
  "updated_by" text,
  CONSTRAINT "fk_inventory_pricing_run_key_outcomes_pricing_run"
    FOREIGN KEY ("pricing_run_id") REFERENCES "inventory"."inventory_pricing_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_pricing_run_key_outcomes_organization"
    FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_pricing_run_key_outcomes_valuation_run"
    FOREIGN KEY ("valuation_run_id") REFERENCES "inventory"."inventory_valuation_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_pricing_run_key_outcomes_run"
  ON "inventory"."inventory_pricing_run_key_outcomes" ("pricing_run_id");
CREATE INDEX "idx_pricing_run_key_outcomes_key"
  ON "inventory"."inventory_pricing_run_key_outcomes" ("organization_id", "warehouse_id", "item_id");
CREATE INDEX "idx_pricing_run_key_outcomes_valuation_run"
  ON "inventory"."inventory_pricing_run_key_outcomes" ("valuation_run_id");
