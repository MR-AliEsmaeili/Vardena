-- The organization-calendar transition guard must find the earliest
-- unrenderable BusinessDate across every Inventory-owned date column without
-- repeatedly scanning full tenant histories. Each index is organization-first
-- and matches one branch of the deterministic UNION query in
-- InventoryBusinessDocumentsRepository.findFirstUnrenderableBusinessDate.
--
-- Keep this additive migration atomic: a lock/build failure rolls all indexes
-- back and the migration can be retried. PostgreSQL's ordinary CREATE INDEX
-- holds a table lock that blocks writes until this transaction commits, so
-- deploy in a write-quiesced/low-traffic window after rehearsal against a
-- production-sized copy. A 10-second lock timeout fails before waiting
-- indefinitely; it does not limit index-build duration.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE INDEX "idx_movements_org_business_date"
  ON "inventory"."inventory_movements" ("organization_id", "movement_date");

CREATE INDEX "idx_unit_conversions_org_valid_from"
  ON "inventory"."unit_conversions" ("organization_id", "valid_from");
CREATE INDEX "idx_unit_conversions_org_valid_to"
  ON "inventory"."unit_conversions" ("organization_id", "valid_to");

CREATE INDEX "idx_item_unit_conversions_org_valid_from"
  ON "inventory"."item_unit_conversions" ("organization_id", "valid_from");
CREATE INDEX "idx_item_unit_conversions_org_valid_to"
  ON "inventory"."item_unit_conversions" ("organization_id", "valid_to");

CREATE INDEX "idx_item_valuation_methods_org_valid_from"
  ON "inventory"."item_valuation_methods" ("organization_id", "valid_from");
CREATE INDEX "idx_item_valuation_methods_org_valid_to"
  ON "inventory"."item_valuation_methods" ("organization_id", "valid_to");

CREATE INDEX "idx_valuation_runs_org_from_date"
  ON "inventory"."inventory_valuation_runs" ("organization_id", "from_date");

CREATE INDEX "idx_pricing_runs_org_from_date"
  ON "inventory"."inventory_pricing_runs" ("organization_id", "from_date");
CREATE INDEX "idx_pricing_runs_org_to_date"
  ON "inventory"."inventory_pricing_runs" ("organization_id", "to_date");

CREATE INDEX "idx_balances_org_last_movement_date"
  ON "inventory"."inventory_balances" ("organization_id", "last_movement_date");

CREATE INDEX "idx_inventory_accounting_posting_snapshots_org_document_date"
  ON "inventory"."inventory_accounting_posting_snapshots" ("organization_id", "document_date");

COMMIT;
