-- C-62 — Inventory → Accounting posting operations, immutable posting
-- snapshots, the Warehouse posting mode and the Accounting-owned source
-- posting mapping (PDR-09 PO-01…PO-12, PDR-10 C62-OD-01…06, ADR-0041).
--
-- Five additive changes, no destructive ones:
--
-- 1. `inventory.warehouses.accounting_posting_mode` — the per-Warehouse
--    Accounting posting mode (C62-OD-02): `direct_final` | `draft`. A closed,
--    code-defined vocabulary stored as text (every other vocabulary column in
--    this module is text, so no ALTER TYPE is needed). DEFAULT
--    `direct_final`: it is what every existing warehouse already does
--    conceptually, so turning the setting on for existing rows changes
--    nothing (same deterministic-default convention as
--    `reservations_reduce_available` in C-50).
--
-- 2. `inventory.inventory_business_documents.accounting_*` — the document's
--    Accounting standing projected onto its own header, exactly like
--    `operation_key` already is. The AUTHORITATIVE record stays the posting
--    operation ledger below; these columns are a projection, never a second
--    truth. `accounting_posting_state` defaults to `not_posted` so every
--    existing row keeps its current meaning.
--
-- 3. `inventory.inventory_accounting_posting_operations` — the durable,
--    restart-safe posting operation (C62-OD-06). Unique on
--    (organization, document, action, operation key): the same key with the
--    same canonical request hash replays the persisted result, the same key
--    with a different hash conflicts (409), and a process restart finds the
--    row exactly where it was left.
--
-- 4. `inventory.inventory_accounting_posting_snapshots` +
--    `inventory_accounting_posting_snapshot_movements` — the immutable
--    posting snapshot (C62-OD-05). Typed and normalized rather than a JSON
--    blob, so "what exactly was sent to Accounting and what exact Inventory
--    valuation was used?" is a query. Written once with the operation; no
--    UPDATE path exists in the application, and the rows survive every later
--    repricing, reverse pricing, valuation mutation or document edit.
--
-- 5. `accounting.source_posting_mappings` — the Accounting-owned mapping from
--    a source fact to the journal it produces (C62-OD-04). This is the ONLY
--    place a system-origin posting's accounts can come from; a missing row is
--    a fail-closed configuration error, never a guessed account.
--
-- Every new table carries the standard audit columns and an organization FK
-- with RESTRICT (an organization row can never disappear under its records),
-- exactly like every other table in these modules.

-- 1. The Warehouse posting mode -------------------------------------------

ALTER TABLE "inventory"."warehouses"
  ADD COLUMN "accounting_posting_mode" varchar(16) NOT NULL DEFAULT 'direct_final';

-- 2. The document's Accounting standing ------------------------------------

ALTER TABLE "inventory"."inventory_business_documents"
  ADD COLUMN "accounting_posting_state" varchar(24) NOT NULL DEFAULT 'not_posted',
  ADD COLUMN "accounting_posting_operation_id" text,
  ADD COLUMN "accounting_document_id" text,
  ADD COLUMN "accounting_document_number" varchar(64),
  ADD COLUMN "accounting_document_phase" varchar(16);

-- 3. The durable posting operation -----------------------------------------

CREATE TABLE "inventory"."inventory_accounting_posting_operations" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL,
  "document_id" text NOT NULL,
  "action" varchar(32) NOT NULL,
  "operation_key" varchar(128) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "document_version" varchar(64) NOT NULL,
  "posting_mode" varchar(16) NOT NULL,
  "state" varchar(24) NOT NULL,
  "refusal_code" varchar(128),
  "refusal_reason" varchar(500),
  "accounting_document_id" text,
  "accounting_document_number" varchar(64),
  "accounting_document_phase" varchar(16),
  "accounting_operation_key" varchar(128),
  "gl_posted" boolean NOT NULL DEFAULT false,
  "replayed" boolean NOT NULL DEFAULT false,
  "actor_user_id" text,
  "actor_permission" varchar(128) NOT NULL,
  "requested_at" timestamptz(6) NOT NULL,
  "completed_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" text,
  "updated_by" text,
  CONSTRAINT "fk_inventory_accounting_posting_operations_organization"
    FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_accounting_posting_operations_document"
    FOREIGN KEY ("document_id") REFERENCES "inventory"."inventory_business_documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The idempotency key (C62-OD-06). Scoped by (organization, document,
-- action) so the same caller-chosen key can never collide across
-- organizations or documents, and a duplicate effect is impossible at the
-- database level rather than merely unlikely.
CREATE UNIQUE INDEX "uq_inventory_accounting_posting_operations_key"
  ON "inventory"."inventory_accounting_posting_operations" ("organization_id", "document_id", "action", "operation_key");

CREATE INDEX "idx_inventory_accounting_posting_operations_org_document"
  ON "inventory"."inventory_accounting_posting_operations" ("organization_id", "document_id");
CREATE INDEX "idx_inventory_accounting_posting_operations_org_state"
  ON "inventory"."inventory_accounting_posting_operations" ("organization_id", "state");

-- 4a. The immutable posting snapshot header ---------------------------------

CREATE TABLE "inventory"."inventory_accounting_posting_snapshots" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL,
  "operation_id" text NOT NULL,
  "document_id" text NOT NULL,
  "document_type" varchar(16) NOT NULL,
  "document_number" varchar(64),
  "document_version" varchar(64) NOT NULL,
  "document_date" timestamptz(6) NOT NULL,
  "branch_id" text NOT NULL,
  "warehouse_id" text NOT NULL,
  "valuation_state" varchar(24) NOT NULL,
  "valuation_stale" boolean NOT NULL,
  "stale_verdict" varchar(24) NOT NULL,
  "valuation_run_id" text,
  "valuation_basis" varchar(64) NOT NULL,
  "total_value" numeric(18,2) NOT NULL,
  "actor_user_id" text,
  "captured_at" timestamptz(6) NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" text,
  CONSTRAINT "fk_inventory_accounting_posting_snapshots_organization"
    FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_accounting_posting_snapshots_operation"
    FOREIGN KEY ("operation_id") REFERENCES "inventory"."inventory_accounting_posting_operations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_accounting_posting_snapshots_document"
    FOREIGN KEY ("document_id") REFERENCES "inventory"."inventory_business_documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_accounting_posting_snapshots_branch"
    FOREIGN KEY ("branch_id") REFERENCES "organization"."branches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_accounting_posting_snapshots_warehouse"
    FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ONE snapshot per operation: the database itself makes a second snapshot for
-- one posting impossible.
CREATE UNIQUE INDEX "uq_inventory_accounting_posting_snapshots_operation"
  ON "inventory"."inventory_accounting_posting_snapshots" ("operation_id");

CREATE INDEX "idx_inventory_accounting_posting_snapshots_org_document"
  ON "inventory"."inventory_accounting_posting_snapshots" ("organization_id", "document_id");

-- 4b. The per-movement snapshot rows ---------------------------------------

CREATE TABLE "inventory"."inventory_accounting_posting_snapshot_movements" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL,
  "snapshot_id" text NOT NULL,
  "movement_id" text NOT NULL,
  "line_id" text NOT NULL,
  "item_id" text NOT NULL,
  "quantity" numeric(18,4) NOT NULL,
  "unit_id" text NOT NULL,
  "base_quantity" numeric(18,4) NOT NULL,
  "base_unit_id" text NOT NULL,
  "total_value" numeric(18,2) NOT NULL,
  "unit_cost" numeric(18,6) NOT NULL,
  "valuation_status" varchar(16) NOT NULL,
  "valuation_source" varchar(24),
  "valuation_run_id" text,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_inventory_accounting_posting_snapshot_movements_organization"
    FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_accounting_posting_snapshot_movements_snapshot"
    FOREIGN KEY ("snapshot_id") REFERENCES "inventory"."inventory_accounting_posting_snapshots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_accounting_posting_snapshot_movements_item"
    FOREIGN KEY ("item_id") REFERENCES "inventory"."items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_accounting_posting_snapshot_movements_unit"
    FOREIGN KEY ("unit_id") REFERENCES "inventory"."units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_accounting_posting_snapshot_movements_base_unit"
    FOREIGN KEY ("base_unit_id") REFERENCES "inventory"."units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_inventory_accounting_posting_snapshot_movements"
  ON "inventory"."inventory_accounting_posting_snapshot_movements" ("snapshot_id", "movement_id");

CREATE INDEX "idx_inventory_accounting_posting_snapshot_movements_org_movement"
  ON "inventory"."inventory_accounting_posting_snapshot_movements" ("organization_id", "movement_id");

-- 5. The Accounting-owned source posting mapping ---------------------------

CREATE TABLE "accounting"."source_posting_mappings" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL,
  "source_module" varchar(64) NOT NULL,
  "source_document_type" varchar(64) NOT NULL,
  "financial_area_id" text NOT NULL,
  "debit_account_id" text NOT NULL,
  "credit_account_id" text NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" text,
  "updated_by" text,
  CONSTRAINT "fk_source_posting_mappings_organization"
    FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_source_posting_mappings_financial_area"
    FOREIGN KEY ("financial_area_id") REFERENCES "accounting"."financial_areas" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_source_posting_mappings_debit_account"
    FOREIGN KEY ("debit_account_id") REFERENCES "accounting"."accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_source_posting_mappings_credit_account"
    FOREIGN KEY ("credit_account_id") REFERENCES "accounting"."accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- One mapping per (organization, source module, source document type): the
-- database makes an ambiguous mapping impossible.
CREATE UNIQUE INDEX "uq_source_posting_mappings_org_module_document_type"
  ON "accounting"."source_posting_mappings" ("organization_id", "source_module", "source_document_type");

CREATE INDEX "idx_source_posting_mappings_organization_id"
  ON "accounting"."source_posting_mappings" ("organization_id");
