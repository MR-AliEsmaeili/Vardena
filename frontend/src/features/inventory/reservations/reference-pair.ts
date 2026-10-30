export function hasCompleteReservationReference(
  referenceType: string,
  referenceId: string,
): boolean {
  return (referenceType.trim() === '') === (referenceId.trim() === '');
}
