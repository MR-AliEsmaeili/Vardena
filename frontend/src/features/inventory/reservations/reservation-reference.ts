import type { InventoryReservation } from '@/api/contracts';

/** Backend-owned Material Request line reference discriminator. */
export const MATERIAL_REQUEST_LINE_RESERVATION_REFERENCE_TYPE =
  'material_request_line';

export function isMaterialRequestLineReservation(
  reservation: Pick<InventoryReservation, 'referenceType'>,
): boolean {
  return (
    reservation.referenceType ===
    MATERIAL_REQUEST_LINE_RESERVATION_REFERENCE_TYPE
  );
}

export function canGenericReleaseReservation(
  reservation: Pick<InventoryReservation, 'status' | 'referenceType'>,
  hasReleasePermission: boolean,
): boolean {
  return (
    hasReleasePermission &&
    reservation.status === 'active' &&
    !isMaterialRequestLineReservation(reservation)
  );
}
