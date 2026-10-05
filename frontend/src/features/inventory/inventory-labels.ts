import type { MovementType, MovementValuationStatus } from '@/api/contracts';
import { t } from '@/lib/i18n';

/**
 * Inventory domain labels — the backend's own vocabulary, rendered in the
 * canonical Persian of `docs/frontend/ux/persian-ux-writing-standard.md` §3.4.
 *
 * The unions are narrowed from the generated OpenAPI enums; nothing here
 * invents a status or a movement type the backend cannot return.
 */

export const MOVEMENT_TYPE_LABELS: Readonly<Record<MovementType, string>> =
  t.inventory.movementTypes;

export function movementTypeLabel(type: MovementType): string {
  return MOVEMENT_TYPE_LABELS[type];
}

/** Movement-level valuation finality (always visible, money is not). */
export function movementValuationStatusLabel(
  status: MovementValuationStatus,
): string {
  return t.inventory.valuationStatuses[status];
}

/** Key-level valuation state (states endpoint). */
export type ValuationStateStatus =
  keyof typeof t.inventory.valuationStateStatuses;

export function valuationStateStatusLabel(
  status: ValuationStateStatus,
): string {
  return t.inventory.valuationStateStatuses[status];
}
