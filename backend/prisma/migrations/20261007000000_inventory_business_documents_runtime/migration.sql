-- C-58 runtime: make the Inventory Business Document tables real.
--
-- The C-58 foundation migration (20261006000000_inventory_business_documents)
-- created two tables that the Prisma models never mapped onto
-- (`@@map`/`@@index` names existed, the `@@map("inventory_business_documents")`
-- did not), so no code path has ever read or written them: there is no data to
-- preserve and no deployment where they are populated. They are therefore
-- dropped and recreated with the real contract instead of being patched by a
-- long ALTER chain that would still leave the wrong column set.
--
-- What the runtime contract adds over the foundation shape:
--   * `number` becomes NULLABLE — the Documents Foundation allocates it at
--     FINALIZE, so a draft never consumes a serial (ADR-0023, OD-54-09).
--   * real foreign keys to organization / warehouse / item / unit,
--   * resolved base quantity + base unit + conversion factor per line (D-26),
--   * the movement ids a line currently owns, so an edit reverses exactly the
--     facts it posted (OQ-54 / ADR-0040),
--   * the lifecycle timestamps (finalize / accounting post / seal / cancel)
--     and the honest `valuation_stale` flag (OD-54-06).
--
-- The movement ledger is untouched: this migration creates no second stock
-- ledger and no generic document table (ADR-0017/ADR-0022).

DROP TABLE IF EXISTS "inventory"."inventory_business_document_lines";
DROP TABLE IF EXISTS "inventory"."inventory_business_documents";

CREATE TABLE "inventory"."inventory_business_documents" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL,
  "kind" varchar(16) NOT NULL,
  "number" varchar(64),
  "business_date" timestamptz(6) NOT NULL,
  "warehouse_id" text,
  "source_warehouse_id" text,
  "destination_warehouse_id" text,
  "receipt_cost" numeric(18,2),
  "status" varchar(24) NOT NULL,
  "description" varchar(1000),
  "reference" varchar(128),
  "operation_key" varchar(128),
  "valuation_stale" boolean NOT NULL DEFAULT false,
  "finalized_at" timestamptz(6),
  "finalized_by" text,
  "accounting_posted_at" timestamptz(6),
  "accounting_posted_by" text,
  "sealed_at" timestamptz(6),
  "sealed_by" text,
  "cancelled_at" timestamptz(6),
  "cancelled_by" text,
  "cancellation_reason" varchar(1000),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "created_by" text,
  "updated_by" text,
  CONSTRAINT "fk_inventory_business_documents_organization"
    FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_business_documents_warehouse"
    FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_business_documents_source_warehouse"
    FOREIGN KEY ("source_warehouse_id") REFERENCES "inventory"."warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_business_documents_destination_warehouse"
    FOREIGN KEY ("destination_warehouse_id") REFERENCES "inventory"."warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Numbers come from the Documents Foundation, which keeps ONE monotonic
-- numeric-only series PER DOCUMENT TYPE (`numbering.ts`: no prefixes, no
-- letters). A receipt and an issue therefore both legitimately reach `0001`,
-- so uniqueness is per (organization, kind) — the series itself guarantees a
-- serial is never reused inside its own type. NULL numbers do not clash: any
-- number of drafts coexist until finalize allocates one.
CREATE UNIQUE INDEX "uq_inventory_business_documents_org_kind_number"
  ON "inventory"."inventory_business_documents"
  ("organization_id", "kind", "number");
CREATE INDEX "idx_inventory_business_documents_org_kind_status"
  ON "inventory"."inventory_business_documents" ("organization_id", "kind", "status");
CREATE INDEX "idx_inventory_business_documents_org_business_date"
  ON "inventory"."inventory_business_documents" ("organization_id", "business_date");

CREATE TABLE "inventory"."inventory_business_document_lines" (
  "id" text PRIMARY KEY,
  "document_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "line_number" integer NOT NULL,
  "item_id" text NOT NULL,
  "quantity" numeric(18,4) NOT NULL,
  "unit_id" text NOT NULL,
  "base_quantity" numeric(18,4) NOT NULL,
  "base_unit_id" text NOT NULL,
  "conversion_factor" numeric(18,6) NOT NULL,
  "movement_id" text,
  "out_movement_id" text,
  "in_movement_id" text,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "created_by" text,
  "updated_by" text,
  CONSTRAINT "fk_inventory_business_document_lines_document"
    FOREIGN KEY ("document_id") REFERENCES "inventory"."inventory_business_documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_business_document_lines_organization"
    FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_business_document_lines_item"
    FOREIGN KEY ("item_id") REFERENCES "inventory"."items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_business_document_lines_unit"
    FOREIGN KEY ("unit_id") REFERENCES "inventory"."units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_inventory_business_document_lines_base_unit"
    FOREIGN KEY ("base_unit_id") REFERENCES "inventory"."units" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_inventory_business_document_lines_document_line_number"
  ON "inventory"."inventory_business_document_lines" ("document_id", "line_number");
CREATE INDEX "idx_inventory_business_document_lines_document"
  ON "inventory"."inventory_business_document_lines" ("document_id");
CREATE INDEX "idx_inventory_business_document_lines_org_item"
  ON "inventory"."inventory_business_document_lines" ("organization_id", "item_id");
