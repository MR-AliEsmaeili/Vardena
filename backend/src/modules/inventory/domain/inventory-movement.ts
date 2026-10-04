import type { MovementType } from './movement-type.js';
import type {
  MovementValuationStatus,
  ValuationSource,
} from './inventory-valuation.js';

/**
 * Inventory movement — one immutable ledger fact (D-04/D-05, ADR-0022).
 *
 * A movement identifies WHO (organization/branch/warehouse), WHAT (item),
 * HOW MUCH (entered quantity + unit AND the signed base quantity + base-unit
 * snapshot), WHEN (business `movementDate` + technical `createdAt`), WHY
 * (type, transfer/reversal links, logical reference, reason) and — since
 * PDR-05 — WHAT IT IS WORTH (the valuation fields).
 *
 * The value fields are deliberately part of the SAME record, not a parallel
 * "accounting movement": one fact, one row, one truth (D-04). They are also
 * deliberately OPTIONAL: a warehouse receipt is a complete, valid movement
 * with no value at all (OD-VAL-05), which is what lets the warehouse work
 * without waiting for a price.
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
  /**
   * SIGNED value effect of this movement (+ inbound, − outbound), mirroring
   * `baseQuantity`; `null` when the movement carries no value. Decimal
   * string, scale 2.
   */
  totalCost: string | null;
  /** `unvalued` | `provisional` | `valued` — see `inventory-valuation.ts`. */
  valuationStatus: MovementValuationStatus;
  valuationSource: ValuationSource | null;
  valuedAt: Date | null;
  /** The recalculation run that last wrote these fields, if any. */
  valuationRunId: string | null;
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
  totalCost: string | null;
  valuationStatus: MovementValuationStatus;
  valuationSource: ValuationSource | null;
  valuedAt: string | null;
  valuationRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Map a movement for the API.
 *
 * `includeCost` is the field-level authorization switch (brief §21): a user
 * who may see warehouse QUANTITIES but not inventory VALUE gets the same
 * record with the monetary fields blanked, rather than a different endpoint
 * or a silently different shape. The status is kept — knowing that a
 * movement is valued is an operational fact, not a monetary one — while the
 * amount itself is withheld.
 */
export function toInventoryMovementDto(
  movement: InventoryMovement,
  includeCost = true,
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
    totalCost: includeCost ? movement.totalCost : null,
    valuationStatus: movement.valuationStatus,
    valuationSource: includeCost ? movement.valuationSource : null,
    valuedAt: movement.valuedAt?.toISOString() ?? null,
    valuationRunId: includeCost ? movement.valuationRunId : null,
    createdAt: movement.createdAt.toISOString(),
    updatedAt: movement.updatedAt.toISOString(),
  };
}
