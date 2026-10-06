import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';

/**
 * The Inventory module's VALUATION permissions (AR-22, ADR-0006, PDR-05,
 * PDR-07/PDR-08 for the pricing operations).
 *
 * Six codes, one per implemented capability — nothing here advertises an
 * operation that does not exist:
 *
 * - `Valuation.View` — see inventory VALUE: the per-key state, the run
 *   history, and the monetary fields on movements. Separate from
 *   `Movement.View` on purpose: a warehouse operator reads quantities all
 *   day and has no business reading costs, and the two UX workspaces the
 *   brief describes (Warehouse Operations vs Inventory Accounting) are
 *   exactly that split. Without this code the records are still returned —
 *   with the monetary fields blanked, never with a different shape
 *   (`toInventoryMovementDto(..., includeCost)`).
 * - `Valuation.Configure` — set which valuation method an item uses, from
 *   when. An accounting-policy authority, not an operational one.
 * - `Valuation.AssignCost` — attach a value to stock: supply a cost with a
 *   receipt, or price a receipt that was posted without one. This is the
 *   code that makes "cost is optional for the warehouse" enforceable: a
 *   warehouse user who lacks it can still post the receipt, just not the
 *   money.
 * - `Valuation.Recalculate` — run the explicit, bounded ONE-KEY repricing
 *   command. Its own code because repricing rewrites numbers other people
 *   have already seen; granting someone the right to enter a cost must not
 *   implicitly grant the right to restate a period.
 * - `Valuation.RunPricing` — run the Periodic Pricing Operation: a scoped
 *   batch repricing over many keys (OD-PRC-05…07, OD-PDP-01…05). A batch
 *   over a warehouse is a strictly bigger authority than one key, so it is
 *   a separate code, not an overload of `Recalculate`.
 * - `Valuation.ReversePricing` — reverse a completed Pricing Run (OD-RVP-08).
 *   Un-pricing already-published figures is a different act from computing
 *   them; it must be grantable independently of every other code.
 *
 * Codes follow `Module.Entity.Action` like the rest of the module. No
 * `*.Delete`: valuation records are never deleted, only superseded or
 * recomputed.
 */

function def(code: string, description: string): PermissionDefinition {
  return { code, description };
}

export const VALUATION_PERMISSIONS = {
  VIEW: 'Inventory.Valuation.View',
  CONFIGURE: 'Inventory.Valuation.Configure',
  ASSIGN_COST: 'Inventory.Valuation.AssignCost',
  RECALCULATE: 'Inventory.Valuation.Recalculate',
  RUN_PRICING: 'Inventory.Valuation.RunPricing',
  REVERSE_PRICING: 'Inventory.Valuation.ReversePricing',
} as const;

export const INVENTORY_VALUATION_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] =
  [
    def(
      VALUATION_PERMISSIONS.VIEW,
      'View inventory valuation: per item/warehouse value state, average cost, valuation and pricing runs, and monetary fields on movements.',
    ),
    def(
      VALUATION_PERMISSIONS.CONFIGURE,
      'Configure the valuation method of an item, effective-dated. Only implemented methods can be activated.',
    ),
    def(
      VALUATION_PERMISSIONS.ASSIGN_COST,
      'Assign a cost to inventory: supply a cost with an inbound posting, or price a movement that was posted without one.',
    ),
    def(
      VALUATION_PERMISSIONS.RECALCULATE,
      'Run an explicit, bounded valuation recalculation for one item and warehouse.',
    ),
    def(
      VALUATION_PERMISSIONS.RUN_PRICING,
      'Run the Periodic Pricing Operation: a scoped, reportable batch repricing over the keys of the selected warehouses, document kinds and date range.',
    ),
    def(
      VALUATION_PERMISSIONS.REVERSE_PRICING,
      'Reverse a completed Pricing Run: removes the run\u2019s valuation effect without touching quantities, creating a compensating run. Blocked while any affected document has crossed the Accounting Post boundary.',
    ),
  ];
