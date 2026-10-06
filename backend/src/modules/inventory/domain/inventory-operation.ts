/**
 * Inventory operation — the idempotency ledger (ADR-0022).
 *
 * One row per completed mutating operation, keyed by
 * (organization_id, operation_key). The row is written in the SAME transaction
 * as the ledger effect: a committed effect always has its key, a failed one
 * never does.
 *
 * `requestHash` (sha256 over the canonical request) separates a legitimate
 * retry — same bytes, replay the stored result — from a key reuse with
 * different intent, which is rejected with 409 and never applied.
 *
 * Framework-free (AR-05).
 */

export const INVENTORY_OPERATIONS = [
  'movement_post',
  'movement_reversal',
  'transfer_post',
  'reservation_create',
  'reservation_release',
  /** A Material Request invocation consumed part (or all) of a line's
   *  active reservation (C-50 §3.8/Owner decision). Unlike
   *  `reservation_release`, the claim was CONSUMED (carried into a
   *  downstream process), not returned to available stock — the
   *  distinction matters for reconciliation even though both decrement
   *  `inventory_balances.reserved`. */
  'reservation_consume',
  /** A cost was assigned to a movement that was posted without one
   *  (PDR-05 OD-VAL-06). Idempotent like every other command: a retried
   *  key replays the stored result instead of pricing twice. */
  'valuation_cost_assignment',
  /** An explicit, bounded repricing of one item and warehouse
   *  (PDR-05 OD-VAL-11/12). Recorded here as well as in
   *  `inventory_valuation_runs` so a retry cannot run the replay twice. */
  'valuation_recalculation',
  /** C-59E: a Periodic Pricing Operation batch (OD-PDP-01…05). ONE operation
   *  row for the WHOLE batch — the batch, not the per-key replay, is the
   *  idempotency unit — with the `inventory_pricing_runs` id in the result
   *  so a retry replays the stored run report. */
  'pricing_run',
  /** C-59E+: Reverse Pricing (OD-RVP-01…08). One operation row for the
   *  whole compensating batch; the retained original run row carries the
   *  `reversed_by` linkage (OD-RVP-05). */
  'reverse_pricing',
] as const;

export type InventoryOperationKind = (typeof INVENTORY_OPERATIONS)[number];

export function isInventoryOperationKind(
  value: string,
): value is InventoryOperationKind {
  return (INVENTORY_OPERATIONS as readonly string[]).includes(value);
}

/**
 * The stored result: created-row ids only. A replay re-reads the rows and
 * returns current DTOs, so it can never serve a stale snapshot.
 */
export type InventoryOperationResult =
  | { kind: 'movement'; movementIds: string[] }
  | { kind: 'transfer'; movementIds: [string, string] }
  | { kind: 'reservation'; reservationId: string }
  /** The run row records what the replay did; `runId` is null when the
   *  operator explicitly chose NOT to reprice (OD-VAL-11). */
  | { kind: 'valuation'; runId: string | null; movementId: string | null }
  /** C-59E: the pricing-run header the batch wrote (either kind). */
  | { kind: 'pricing'; pricingRunId: string };

/** The operation kinds that produce each result shape. */
export function resultKindFor(
  operation: InventoryOperationKind,
): InventoryOperationResult['kind'] {
  switch (operation) {
    case 'movement_post':
    case 'movement_reversal':
      return 'movement';
    case 'transfer_post':
      return 'transfer';
    case 'reservation_create':
    case 'reservation_release':
    case 'reservation_consume':
      return 'reservation';
    case 'valuation_cost_assignment':
    case 'valuation_recalculation':
      return 'valuation';
    case 'pricing_run':
    case 'reverse_pricing':
      return 'pricing';
  }
}

export interface InventoryOperation {
  id: string;
  organizationId: string;
  operationKey: string;
  operation: InventoryOperationKind;
  requestHash: string;
  result: InventoryOperationResult;
  createdAt: Date;
  updatedAt: Date;
}
