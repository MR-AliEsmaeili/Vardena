-- Indexes for concrete filter/order consumers in current Inventory repositories:
-- - InventoryMovementsRepository.list filters by organizationId and optional
--   movementDate bounds; the Kardex also filters/orders by movement_date using
--   its more-specific warehouse/item composite index.
-- - UnitConversionsRepository.listGlobal/listForItem and
--   ItemValuationMethodsRepository.findEffectiveVersionAt/list filter by
--   organizationId and activeAt (`valid_from <= day` and open/greater `valid_to`)
--   and may order by valid_from.
-- No calendar-transition history scan or renderability gate exists in the MVP.
-- Informational date fields on run/balance/posting-snapshot rows are not indexed
-- here because current read paths do not filter or order by those fields.
--
-- Keep the additive index migration atomic. Ordinary CREATE INDEX may block
-- writes until this transaction commits; rehearse the exact migration on the
-- temporary PostgreSQL CI database. The 10-second lock timeout bounds lock
-- acquisition, not index-build duration. No production-size plan/performance
-- claim is made by the fixture rehearsal.
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

COMMIT;
