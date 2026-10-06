import type { DomainEvent } from '../../../kernel/events/domain-event-bus.js';

/**
 * Inventory Business Document lifecycle events (C-58, ADR-0005).
 *
 * Published on the existing in-process bus AFTER the transaction commits, so
 * an event never claims success for a rolled-back operation. Identifiers and
 * routing fields only — no quantities and no money (the same payload policy
 * as `inventory-core.events.ts`).
 *
 * `InventoryDocument.ValuationStale` is the OD-54-11 alert hook: a material
 * edit the operator chose to continue WITHOUT repricing must be emittable to
 * a future administrative alert surface. The alert centre itself is not
 * designed or implemented here.
 */

interface DocumentEvent<TType extends string, TPayload> extends DomainEvent {
  type: TType;
  aggregateType: 'InventoryBusinessDocument';
  aggregateId: string;
  payload: TPayload;
}

export interface InventoryDocumentPayload {
  id: string;
  organizationId: string;
  kind: string;
  number: string | null;
  status: string;
  /** Every movement the command created, in creation order. */
  movementIds: string[];
}

export const INVENTORY_DOCUMENT_CREATED_EVENT =
  'InventoryDocument.Created' as const;
export const INVENTORY_DOCUMENT_UPDATED_EVENT =
  'InventoryDocument.Updated' as const;
export const INVENTORY_DOCUMENT_FINALIZED_EVENT =
  'InventoryDocument.Finalized' as const;
export const INVENTORY_DOCUMENT_ACCOUNTING_POSTED_EVENT =
  'InventoryDocument.AccountingPosted' as const;
export const INVENTORY_DOCUMENT_SEALED_EVENT =
  'InventoryDocument.Sealed' as const;
export const INVENTORY_DOCUMENT_CANCELLED_EVENT =
  'InventoryDocument.Cancelled' as const;
export const INVENTORY_DOCUMENT_VALUATION_STALE_EVENT =
  'InventoryDocument.ValuationStale' as const;

export type InventoryDocumentCreatedEvent = DocumentEvent<
  typeof INVENTORY_DOCUMENT_CREATED_EVENT,
  InventoryDocumentPayload
>;
export type InventoryDocumentFinalizedEvent = DocumentEvent<
  typeof INVENTORY_DOCUMENT_FINALIZED_EVENT,
  InventoryDocumentPayload
>;
export type InventoryDocumentCancelledEvent = DocumentEvent<
  typeof INVENTORY_DOCUMENT_CANCELLED_EVENT,
  InventoryDocumentPayload
>;

export const INVENTORY_DOCUMENT_EVENT_TYPES = [
  INVENTORY_DOCUMENT_CREATED_EVENT,
  INVENTORY_DOCUMENT_UPDATED_EVENT,
  INVENTORY_DOCUMENT_FINALIZED_EVENT,
  INVENTORY_DOCUMENT_ACCOUNTING_POSTED_EVENT,
  INVENTORY_DOCUMENT_SEALED_EVENT,
  INVENTORY_DOCUMENT_CANCELLED_EVENT,
  INVENTORY_DOCUMENT_VALUATION_STALE_EVENT,
] as const;
