import type { MovementType } from './movement-type.js';

/**
 * Inventory movement — one immutable ledger fact (D-04/D-05, ADR-0022).
 *
 * A movement identifies WHO (organization/branch/warehouse), WHAT (item),
 * HOW MUCH (entered quantity + unit AND the signed base quantity + base-unit
 * snapshot), WHEN (business `movementDate` + technical `createdAt`), and WHY
 * (type, transfer/reversal links, logical reference, reason).
 *
 * Immutability is structural: the application exposes no update or delete
 * path, and the domain offers no "apply patch" helper to misuse. A correction
 * is a new movement with `reversalOfMovementId` set.
 *
 * Framework-free (AR-05).
 */

export interface InventoryMovement {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  movementType: MovementType;
  /** Entered magnitude, always > 0. Decimal string. */
  quantity: string;
  enteredUnitId: string;
  /** Signed base-unit effect (+in, −out, never 0). Decimal string. */
  baseQuantity: string;
  baseUnitId: string;
  /** Exact factor applied. Decimal string; '1' for same-unit postings. */
  conversionFactor: string;
  movementDate: Date;
  transferId: string | null;
  reversalOfMovementId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  operationKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryMovementDto {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  movementType: MovementType;
  quantity: string;
  enteredUnitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  movementDate: string;
  transferId: string | null;
  reversalOfMovementId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  operationKey: string;
  createdAt: string;
  updatedAt: string;
}

export function toInventoryMovementDto(
  movement: InventoryMovement,
): InventoryMovementDto {
  return {
    id: movement.id,
    organizationId: movement.organizationId,
    branchId: movement.branchId,
    warehouseId: movement.warehouseId,
    itemId: movement.itemId,
    movementType: movement.movementType,
    quantity: movement.quantity,
    enteredUnitId: movement.enteredUnitId,
    baseQuantity: movement.baseQuantity,
    baseUnitId: movement.baseUnitId,
    conversionFactor: movement.conversionFactor,
    movementDate: movement.movementDate.toISOString(),
    transferId: movement.transferId,
    reversalOfMovementId: movement.reversalOfMovementId,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    reason: movement.reason,
    operationKey: movement.operationKey,
    createdAt: movement.createdAt.toISOString(),
    updatedAt: movement.updatedAt.toISOString(),
  };
}
