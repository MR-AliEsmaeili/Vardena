/**
 * Document relations — the typed, quantity-aware link model
 * (Task 8 §13, ADR-0019 §5).
 *
 * Relation kinds are a CLOSED, code-managed list; adding one is a code change
 * (and an ADR if it changes semantics — AR-29). Configuration may decide
 * whether an automation CREATES a relation; it never decides whether a kind
 * exists.
 *
 * Links are LOGICAL references (module + type + id + optional line id): there
 * is no cross-module foreign key, so Sales → Accounting, Inventory → Accounting
 * etc. link without coupling schemas (AR-07/08). Cross-module existence
 * integrity is enforced by the creating (owning) service inside its
 * transaction — the Foundation validates shape, kind and quantity.
 *
 * Framework-free (AR-05).
 */

import { isUlid } from '../../../kernel/ids/ulid.js';
import { isValidDocumentTypeCode, isValidModuleName } from './document-type.js';

export const RELATION_KINDS = [
  'reference',
  'derive',
  'fulfill',
  'settle',
  'reverse',
  'transfer_of',
] as const;

export type RelationKind = (typeof RELATION_KINDS)[number];

export function isRelationKind(value: string): value is RelationKind {
  return (RELATION_KINDS as readonly string[]).includes(value);
}

/**
 * The kinds that carry a base-unit quantity (partial fulfilment — ADR-0019
 * §5.2). All other kinds are whole-document or informational and must not
 * carry a quantity.
 */
export const QUANTITY_AWARE_KINDS = ['fulfill'] as const;

export function isQuantityAwareKind(kind: RelationKind): boolean {
  return (QUANTITY_AWARE_KINDS as readonly string[]).includes(kind);
}

/** One end of a relation: a logical document (or line) reference. */
export interface DocumentEndpoint {
  module: string;
  documentType: string;
  documentId: string;
  lineId?: string | null | undefined;
}

export type RelationProblem =
  | 'invalid_kind'
  | 'invalid_endpoint'
  | 'self_reference'
  | 'quantity_required'
  | 'quantity_forbidden'
  | 'invalid_quantity';

export interface RelationPlan {
  problem: RelationProblem | null;
}

/** A base-unit quantity for the `fulfill` kind: > 0, ≤ 4 decimals, fits
 * `numeric(18,4)`. Mirrors the repository's storage contract locally so the
 * documents module stays self-contained (AR-07: no cross-module domain
 * imports). */
const BASE_QUANTITY_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;

export function isValidBaseQuantity(value: string): boolean {
  if (!BASE_QUANTITY_PATTERN.test(value)) return false;
  // Not all-zero (e.g. "0", "0.0", "00.00").
  return /[1-9]/.test(value);
}

export function relationProblemMessage(problem: RelationProblem): string {
  switch (problem) {
    case 'invalid_kind':
      return `Relation kind must be one of: ${RELATION_KINDS.join(', ')}.`;
    case 'invalid_endpoint':
      return 'Each relation endpoint needs a valid module, document type and document id.';
    case 'self_reference':
      return 'A document cannot be linked to itself.';
    case 'quantity_required':
      return 'The "fulfill" relation kind requires a positive base-unit quantity.';
    case 'quantity_forbidden':
      return 'Only the "fulfill" relation kind carries a quantity.';
    case 'invalid_quantity':
      return 'The quantity must be a positive decimal with at most 4 fractional digits.';
  }
}

function validateEndpoint(endpoint: DocumentEndpoint): boolean {
  return (
    isValidModuleName(endpoint.module) &&
    isValidDocumentTypeCode(endpoint.documentType) &&
    isUlid(endpoint.documentId) &&
    (endpoint.lineId === undefined ||
      endpoint.lineId === null ||
      isUlid(endpoint.lineId))
  );
}

function endpointsEqual(a: DocumentEndpoint, b: DocumentEndpoint): boolean {
  return (
    a.module === b.module &&
    a.documentType === b.documentType &&
    a.documentId === b.documentId &&
    (a.lineId ?? null) === (b.lineId ?? null)
  );
}

/**
 * Validate a relation before it is stored (Task 8 §13). Shape, kind and
 * quantity rules live here; cross-module existence is the creating module's
 * responsibility (ADR-0019 consequence).
 */
export function planRelation(input: {
  kind: string;
  source: DocumentEndpoint;
  target: DocumentEndpoint;
  quantity?: string | null | undefined;
}): RelationPlan {
  if (!isRelationKind(input.kind)) return { problem: 'invalid_kind' };
  if (!validateEndpoint(input.source) || !validateEndpoint(input.target)) {
    return { problem: 'invalid_endpoint' };
  }
  if (endpointsEqual(input.source, input.target)) {
    return { problem: 'self_reference' };
  }

  const hasQuantity = input.quantity !== undefined && input.quantity !== null;
  if (isQuantityAwareKind(input.kind)) {
    if (!hasQuantity) return { problem: 'quantity_required' };
    if (!isValidBaseQuantity(input.quantity as string)) {
      return { problem: 'invalid_quantity' };
    }
    return { problem: null };
  }
  if (hasQuantity) return { problem: 'quantity_forbidden' };
  return { problem: null };
}

// ---------------------------------------------------------------------------
// Stored relation (entity + API shape)
// ---------------------------------------------------------------------------

export interface DocumentRelation {
  id: string;
  organizationId: string;
  source: DocumentEndpoint;
  target: DocumentEndpoint;
  relationKind: RelationKind;
  /** Base-unit quantity, only for the quantity-aware `fulfill` kind. */
  quantity: string | null;
  createdByProcess: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** A stored endpoint as it leaves the module: `lineId` is explicit null. */
export interface DocumentEndpointDto {
  module: string;
  documentType: string;
  documentId: string;
  lineId: string | null;
}

export interface DocumentRelationDto {
  id: string;
  organizationId: string;
  source: DocumentEndpointDto;
  target: DocumentEndpointDto;
  relationKind: RelationKind;
  quantity: string | null;
  createdByProcess: boolean;
  createdAt: string;
}

export function toDocumentRelationDto(
  relation: DocumentRelation,
): DocumentRelationDto {
  return {
    id: relation.id,
    organizationId: relation.organizationId,
    source: toEndpointDto(relation.source),
    target: toEndpointDto(relation.target),
    relationKind: relation.relationKind,
    quantity: relation.quantity,
    createdByProcess: relation.createdByProcess,
    createdAt: relation.createdAt.toISOString(),
  };
}

function toEndpointDto(endpoint: DocumentEndpoint): DocumentEndpointDto {
  return {
    module: endpoint.module,
    documentType: endpoint.documentType,
    documentId: endpoint.documentId,
    lineId: endpoint.lineId ?? null,
  };
}
