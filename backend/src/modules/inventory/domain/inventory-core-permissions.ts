import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';

/**
 * The Inventory module's transactional-core permissions (AR-22, ADR-0006,
 * ADR-0022).
 *
 * Ten codes, one per implemented capability — nothing here advertises an
 * operation that does not exist:
 *
 * - `Movement.View/Create/Reverse` — post a movement, read movements, post a
 *   counter-movement. Reversal is its own code (not folded into Create):
 *   correcting posted history is an authority of its own, and auditors must
 *   be able to grant posting without granting correction.
 * - `Transfer.Create` — the atomic warehouse-to-warehouse operation. There is
 *   no `Transfer.View`: transfer legs are movements and are read as such.
 * - `Reservation.View/Create/Release` — the ACTIVE → RELEASED lifecycle.
 * - `Balance.View` — stock and availability reads.
 * - `Reconciliation.View/Execute` — the read-only drift report and the
 *   audited maintenance rebuild.
 *
 * Codes follow `Module.Entity.Action` like the master-data vocabulary in
 * `inventory-permissions.ts`. No `*.Delete`: ledger facts are never deleted.
 */

function def(code: string, description: string): PermissionDefinition {
  return { code, description };
}

export const MOVEMENT_PERMISSIONS = {
  VIEW: 'Inventory.Movement.View',
  CREATE: 'Inventory.Movement.Create',
  REVERSE: 'Inventory.Movement.Reverse',
} as const;

export const TRANSFER_PERMISSIONS = {
  CREATE: 'Inventory.Transfer.Create',
} as const;

export const RESERVATION_PERMISSIONS = {
  VIEW: 'Inventory.Reservation.View',
  CREATE: 'Inventory.Reservation.Create',
  RELEASE: 'Inventory.Reservation.Release',
} as const;

export const BALANCE_PERMISSIONS = {
  VIEW: 'Inventory.Balance.View',
} as const;

export const RECONCILIATION_PERMISSIONS = {
  VIEW: 'Inventory.Reconciliation.View',
  EXECUTE: 'Inventory.Reconciliation.Execute',
} as const;

export const INVENTORY_CORE_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] =
  [
    def(
      MOVEMENT_PERMISSIONS.VIEW,
      'View inventory movements (ledger history) and single movements.',
    ),
    def(
      MOVEMENT_PERMISSIONS.CREATE,
      'Post inventory movements (inbound, outbound, adjustments). Each posting carries a client-supplied idempotency key.',
    ),
    def(
      MOVEMENT_PERMISSIONS.REVERSE,
      'Post reversal movements correcting posted history. Reversals are full-amount counter-movements, never edits.',
    ),
    def(
      TRANSFER_PERMISSIONS.CREATE,
      'Post atomic warehouse-to-warehouse transfers (both legs commit together or not at all).',
    ),
    def(
      RESERVATION_PERMISSIONS.VIEW,
      'View inventory reservations and their lifecycle state.',
    ),
    def(
      RESERVATION_PERMISSIONS.CREATE,
      'Create inventory reservations (soft claims on availability).',
    ),
    def(
      RESERVATION_PERMISSIONS.RELEASE,
      'Release active inventory reservations. A release is terminal.',
    ),
    def(
      BALANCE_PERMISSIONS.VIEW,
      'View materialized stock balances and availability (on hand, reserved, available).',
    ),
    def(
      RECONCILIATION_PERMISSIONS.VIEW,
      'Run the read-only ledger-vs-balance reconciliation report.',
    ),
    def(
      RECONCILIATION_PERMISSIONS.EXECUTE,
      'Rebuild materialized balances from the ledger. A maintenance operation: every correction is returned in the report and logged.',
    ),
  ];
