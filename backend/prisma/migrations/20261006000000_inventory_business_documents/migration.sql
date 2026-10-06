CREATE TABLE "inventory"."inventory_business_documents" (
 "id" text PRIMARY KEY, "organization_id" text NOT NULL, "kind" varchar(16) NOT NULL,
 "number" varchar(64) NOT NULL, "business_date" timestamptz(6) NOT NULL,
 "warehouse_id" text, "source_warehouse_id" text, "destination_warehouse_id" text,
 "receipt_cost" numeric(18,2), "status" varchar(24) NOT NULL,
 "description" text, "reference" text, "operation_key" varchar(128),
 "created_at" timestamptz(6) NOT NULL DEFAULT now(), "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
 "created_by" text, "updated_by" text,
 CONSTRAINT "uq_inventory_business_documents_org_number" UNIQUE ("organization_id", "number")
);
CREATE INDEX "idx_inventory_business_documents_org_kind_status" ON "inventory"."inventory_business_documents" ("organization_id", "kind", "status");
CREATE TABLE "inventory"."inventory_business_document_lines" (
 "id" text PRIMARY KEY, "document_id" text NOT NULL, "organization_id" text NOT NULL,
 "item_id" text NOT NULL, "quantity" numeric(18,4) NOT NULL, "unit_id" text NOT NULL,
 "conversion_factor" numeric(18,6) NOT NULL
);
CREATE INDEX "idx_inventory_business_document_lines_document" ON "inventory"."inventory_business_document_lines" ("document_id");
