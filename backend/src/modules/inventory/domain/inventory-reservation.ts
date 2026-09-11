/**
 * Inventory reservation — a soft claim on availability (D-07, ADR-0022).
 *
 * A reservation promises stock without moving it: it increments the balance
 * row's `reserved` counter and leaves `onHand` untouched. Releasing it
 * decrements the counter again. The ledger never sees either transition.
 *
 * Lifecycle is ACTIVE → RELEASED, terminal, no other transition. A CANCELLED
 * state (voiding a hold because the owning order died) would decrement the
 * counter identically — without the Sales module its meaning is
 * indistinguishable from a release, so it is deferred rather than invented.
 *
 * Framework-free (AR-05).
 */

export const RESERVATION_STATUSES = ['active', 'released'] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export function isReservationStatus(value: string): value is ReservationStatus {
  return (RESERVATION_STATUSES as readonly string[]).includes(value);
}

export type ReservationTransitionProblem =
  'already_released' | 'unknown_status';

/** The only allowed transition: an ACTIVE reservation may be released. */
export function planRelease(status: string): {
  problem: ReservationTransitionProblem | null;
} {
  if (status === 'active') return { problem: null };
  if (status === 'released') return { problem: 'already_released' };
  return { problem: 'unknown_status' };
}

export function reservationTransitionMessage(
  problem: ReservationTransitionProblem,
): string {
  switch (problem) {
    case 'already_released':
      return 'The reservation is already released. A release is terminal and cannot be applied twice.';
    case 'unknown_status':
      return 'The reservation is in an unknown state and cannot be released.';
  }
}

export interface InventoryReservation {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  /** Entered magnitude, always > 0. Decimal string. */
  quantity: string;
  enteredUnitId: string;
  /** Base-unit claim, always > 0. Decimal string. */
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  status: ReservationStatus;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  operationKey: string;
  releasedAt: Date | null;
  releasedBy: string | null;
  releaseOperationKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryReservationDto {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  quantity: string;
  enteredUnitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  status: ReservationStatus;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  operationKey: string;
  releasedAt: string | null;
  releasedBy: string | null;
  releaseOperationKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toInventoryReservationDto(
  reservation: InventoryReservation,
): InventoryReservationDto {
  return {
    id: reservation.id,
    organizationId: reservation.organizationId,
    branchId: reservation.branchId,
    warehouseId: reservation.warehouseId,
    itemId: reservation.itemId,
    quantity: reservation.quantity,
    enteredUnitId: reservation.enteredUnitId,
    baseQuantity: reservation.baseQuantity,
    baseUnitId: reservation.baseUnitId,
    conversionFactor: reservation.conversionFactor,
    status: reservation.status,
    referenceType: reservation.referenceType,
    referenceId: reservation.referenceId,
    reason: reservation.reason,
    operationKey: reservation.operationKey,
    releasedAt: reservation.releasedAt?.toISOString() ?? null,
    releasedBy: reservation.releasedBy,
    releaseOperationKey: reservation.releaseOperationKey,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
  };
}
