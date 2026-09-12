import type { DomainEvent } from '../../../kernel/events/domain-event-bus.js';

/**
 * Document Foundation domain events (Task 8 §21).
 *
 * Two layers, both using the repository's `Entity.PastTenseVerb` convention:
 *
 * 1. The events the Foundation ITSELF publishes for the mechanics it owns —
 *    numbering allocation, relation changes, document-type configuration.
 *    These are emitted inside the owning write's transaction, exactly like the
 *    Inventory/Organization lifecycle events, and are the future Audit
 *    module's hook (AR-23).
 *
 * 2. The generic document-lifecycle event CONTRACT the owning modules publish
 *    for their own documents (`Document.Created`, `Document.StateChanged`,
 *    `Document.Finalized`, `Document.Deleted`). The Foundation cannot publish
 *    these — it does not own any business document — but it fixes the names
 *    and payload shapes so every document type reports the same way to
 *    cross-cutting consumers (audit, document register, numbering
 *    reconciliation). Owning modules keep their entity-specific events too
 *    (`InventoryReceipt.Created`, …); the generic event is additive.
 */

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

/** A logical (module + type + id) document reference — never a DB FK. */
export interface DocumentRefPayload {
  module: string;
  documentType: string;
  documentId: string;
  lineId?: string | null | undefined;
}

/** Numbering allocation payload (Foundation-owned). */
export interface DocumentNumberAllocatedPayload {
  id: string;
  organizationId: string;
  seriesId: string;
  documentType: string;
  number: string;
  referenceModule: string | null;
  referenceDocumentType: string | null;
  referenceDocumentId: string | null;
}

/** Relation payload (Foundation-owned). */
export interface DocumentRelationPayload {
  id: string;
  organizationId: string;
  relationKind: string;
  source: DocumentRefPayload;
  target: DocumentRefPayload;
}

/** Document-type configuration payload (Foundation-owned). */
export interface DocumentTypeConfiguredPayload {
  organizationId: string;
  documentType: string;
  draftRequired: boolean;
}

/** Generic document lifecycle payload (published by owning modules). */
export interface DocumentLifecyclePayload {
  documentType: string;
  documentId: string;
  organizationId: string;
  module: string;
  state: string | null;
}

// ---------------------------------------------------------------------------
// Foundation-owned events
// ---------------------------------------------------------------------------

export const DOCUMENT_NUMBER_ALLOCATED_EVENT =
  'DocumentNumber.Allocated' as const;
export const DOCUMENT_RELATION_CREATED_EVENT =
  'DocumentRelation.Created' as const;
export const DOCUMENT_RELATION_REMOVED_EVENT =
  'DocumentRelation.Removed' as const;
export const DOCUMENT_TYPE_CONFIGURED_EVENT =
  'DocumentType.Configured' as const;

export type DocumentNumberAllocatedEvent = DomainEvent & {
  type: typeof DOCUMENT_NUMBER_ALLOCATED_EVENT;
  aggregateType: 'DocumentNumber';
  aggregateId: string;
  payload: DocumentNumberAllocatedPayload;
};

export type DocumentRelationCreatedEvent = DomainEvent & {
  type: typeof DOCUMENT_RELATION_CREATED_EVENT;
  aggregateType: 'DocumentRelation';
  aggregateId: string;
  payload: DocumentRelationPayload;
};

export type DocumentRelationRemovedEvent = DomainEvent & {
  type: typeof DOCUMENT_RELATION_REMOVED_EVENT;
  aggregateType: 'DocumentRelation';
  aggregateId: string;
  payload: DocumentRelationPayload;
};

export type DocumentTypeConfiguredEvent = DomainEvent & {
  type: typeof DOCUMENT_TYPE_CONFIGURED_EVENT;
  aggregateType: 'DocumentType';
  aggregateId: string;
  payload: DocumentTypeConfiguredPayload;
};

// ---------------------------------------------------------------------------
// Generic document lifecycle contract (published by owning modules)
// ---------------------------------------------------------------------------

export const DOCUMENT_CREATED_EVENT = 'Document.Created' as const;
export const DOCUMENT_STATE_CHANGED_EVENT = 'Document.StateChanged' as const;
export const DOCUMENT_FINALIZED_EVENT = 'Document.Finalized' as const;
export const DOCUMENT_DELETED_EVENT = 'Document.Deleted' as const;

/** The events the Foundation itself publishes (used by tests). */
export const DOCUMENT_EVENT_TYPES = [
  DOCUMENT_NUMBER_ALLOCATED_EVENT,
  DOCUMENT_RELATION_CREATED_EVENT,
  DOCUMENT_RELATION_REMOVED_EVENT,
  DOCUMENT_TYPE_CONFIGURED_EVENT,
] as const;

/** The generic lifecycle contract the owning modules publish. */
export const DOCUMENT_LIFECYCLE_EVENT_TYPES = [
  DOCUMENT_CREATED_EVENT,
  DOCUMENT_STATE_CHANGED_EVENT,
  DOCUMENT_FINALIZED_EVENT,
  DOCUMENT_DELETED_EVENT,
] as const;
