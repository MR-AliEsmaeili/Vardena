import type { MaterialRequestStatus } from '@/api/contracts';

/**
 * Status → allowed authoring operations, mirroring the backend's own plan
 * functions (`planEdit` uses `EDITABLE_MATERIAL_REQUEST_STATUSES`, and
 * `deleteDraft` accepts only `draft`).
 *
 * These predicates decide which control the UI OFFERS (UX only, AR-21). The
 * server re-checks every transition and answers `422` with the same rules, so
 * the UI never invents a state the backend would refuse.
 */
export const EDITABLE_MATERIAL_REQUEST_STATUSES: readonly MaterialRequestStatus[] =
  ['draft', 'returned'];

export function isMaterialRequestEditable(
  status: MaterialRequestStatus,
): boolean {
  return EDITABLE_MATERIAL_REQUEST_STATUSES.includes(status);
}

/** Edit, submit and delete share the backend's editable set… */
export function isMaterialRequestSubmittable(
  status: MaterialRequestStatus,
): boolean {
  return isMaterialRequestEditable(status);
}

/** …while deletion stays narrower: drafts only (`deleteDraft`). */
export function isMaterialRequestDeletable(
  status: MaterialRequestStatus,
): boolean {
  return status === 'draft';
}

/**
 * A line that has already been carried into a subsequent process (C-50 §3.8)
 * must keep its exact contribution: the backend refuses a decrease below
 * `invokedBaseQuantity`. Because the UI cannot convert an entered unit to the
 * base unit without repeating server decimal math (standards.md §7), every
 * invoked line is locked as a whole instead of allowing a partial edit.
 */
export function isMaterialRequestLineLocked(line: {
  invocationCount: number;
}): boolean {
  return line.invocationCount > 0;
}
