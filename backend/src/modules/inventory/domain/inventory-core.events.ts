import type { DomainEvent } from '../../../kernel/events/domain-event-bus.js';

/**
 * Inventory core domain events (Task 7, ADR-0022, ADR-0005).
 *
 * Four event types on the existing in-process bus — no second bus, no broker:
 *
 * - `InventoryMovement.Posted` fires for EVERY ledger write: single postings,
 *   both legs of a transfer, and reversals. Consumers branch on
 *   `movementType` and correlate legs via `transferId`. One uniform contract
 *   instead of a type per posting path.
 * - `InventoryTransfer.Posted` is the transfer summary (one event for the
 *   atomic pair, carrying both leg ids).
 * - `InventoryReservation.Created` / `InventoryReservation.Released` cover the
 *   ACTIVE → RELEASED lifecycle.
 *
 * Deliberately absent: a separate `StockAdjusted`-style event — an adjustment
 * IS a movement and already emits `InventoryMovement.Posted` with
 * `movementType: adjustment_*`; a second event for the same fact would be
 * noise future consumers must dedplicate.
 *
 * Payload policy: stable identifiers plus routing fields (type, transfer and
 * reversal links), nothing else. Quantities are read back through the
 * module's public services (AR-07) — ledger rows are immutable, so a read-back
 * can never disagree with what was posted. Events publish AFTER the
 * transaction commits, so an event never claims success for a failed write.
 */

interface CoreEvent<
  TType extends string,
  TAggregate extends string,
  TPayload,
> extends DomainEvent {
  type: TType;
  aggregateType: TAggregate;
  aggregateId: string;
  payload: TPayload;
}

// ---- Movement ---------------------------------------------------------------

export const INVENTORY_MOVEMENT_POSTED_EVENT =
  'InventoryMovement.Posted' as const;

export interface InventoryMovementPostedPayload {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  movementType: string;
  /** Set on both legs of a transfer; null otherwise. */
  transferId: string | null;
  /** Set when this movement reverses another one; null otherwise. */
  reversalOfMovementId: string | null;
  operationKey: string;
}

export type InventoryMovementPostedEvent = CoreEvent<
  typeof INVENTORY_MOVEMENT_POSTED_EVENT,
  'InventoryMovement',
  InventoryMovementPostedPayload
>;

// ---- Transfer ----------------------------------------------------------------

export const INVENTORY_TRANSFER_POSTED_EVENT =
  'InventoryTransfer.Posted' as const;

export interface InventoryTransferPostedPayload {
  transferId: string;
  organizationId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  itemId: string;
  outMovementId: string;
  inMovementId: string;
  operationKey: string;
}

export type InventoryTransferPostedEvent = CoreEvent<
  typeof INVENTORY_TRANSFER_POSTED_EVENT,
  'InventoryTransfer',
  InventoryTransferPostedPayload
>;

// ---- Reservation ---------------------------------------------------------------

export const INVENTORY_RESERVATION_CREATED_EVENT =
  'InventoryReservation.Created' as const;

export const INVENTORY_RESERVATION_RELEASED_EVENT =
  'InventoryReservation.Released' as const;

export interface InventoryReservationPayload {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  operationKey: string;
}

export type InventoryReservationCreatedEvent = CoreEvent<
  typeof INVENTORY_RESERVATION_CREATED_EVENT,
  'InventoryReservation',
  InventoryReservationPayload
>;

export type InventoryReservationReleasedEvent = CoreEvent<
  typeof INVENTORY_RESERVATION_RELEASED_EVENT,
  'InventoryReservation',
  InventoryReservationPayload
>;

/** Every event the inventory core publishes (used by tests). */
export const INVENTORY_CORE_EVENT_TYPES = [
  INVENTORY_MOVEMENT_POSTED_EVENT,
  INVENTORY_TRANSFER_POSTED_EVENT,
  INVENTORY_RESERVATION_CREATED_EVENT,
  INVENTORY_RESERVATION_RELEASED_EVENT,
] as const;
