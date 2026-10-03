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
  | { kind: 'reservation'; reservationId: string };

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
