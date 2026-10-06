import {
  DRAFT_PHASE,
  type DocumentTypeDefinition,
} from '../../documents/domain/document-type.js';
import type { InventoryDocumentKind } from './inventory-business-document.js';

/**
 * The three Inventory Business Document types registered in the Documents
 * Foundation's type registry (ADR-0023), for the SAME single reason Material
 * Request registers (`material-request-document-type.ts`): an organization
 * must be able to configure a `documents.numbering_series` per type, and
 * `NumberingSeriesService.createNumberingSeries` requires a registered type.
 *
 * C-58's own lifecycle (`inventory-business-document.ts`) is enforced by the
 * Inventory module, not by the Foundation's draft/temporary/final phase
 * machinery; `entryStates`/`deletablePhases` below exist only to satisfy
 * `assertValidDocumentTypeDefinition` and to describe the types honestly to
 * `GET /document-types`.
 */

export const INVENTORY_RECEIPT_DOCUMENT_TYPE = 'inventory_receipt';
export const INVENTORY_ISSUE_DOCUMENT_TYPE = 'inventory_issue';
export const INVENTORY_TRANSFER_DOCUMENT_TYPE = 'inventory_transfer';

export function documentTypeFor(kind: InventoryDocumentKind): string {
  switch (kind) {
    case 'receipt':
      return INVENTORY_RECEIPT_DOCUMENT_TYPE;
    case 'issue':
      return INVENTORY_ISSUE_DOCUMENT_TYPE;
    case 'transfer':
      return INVENTORY_TRANSFER_DOCUMENT_TYPE;
  }
}

function definition(
  code: string,
  name: string,
  description: string,
): DocumentTypeDefinition {
  return {
    code,
    module: 'inventory',
    name,
    description,
    draftCapable: true,
    entryStates: ['temporary'],
    deletablePhases: [DRAFT_PHASE],
  };
}

export const INVENTORY_DOCUMENT_TYPE_DEFINITIONS: readonly DocumentTypeDefinition[] =
  [
    definition(
      INVENTORY_RECEIPT_DOCUMENT_TYPE,
      'Inventory Receipt',
      'A warehouse receipt: stock enters one warehouse. Cost is an optional Inventory valuation assignment, never a purchase price.',
    ),
    definition(
      INVENTORY_ISSUE_DOCUMENT_TYPE,
      'Inventory Issue',
      'A warehouse issue: stock leaves one warehouse. Cost is derived by Inventory valuation and is never entered manually.',
    ),
    definition(
      INVENTORY_TRANSFER_DOCUMENT_TYPE,
      'Inventory Transfer',
      'A warehouse-to-warehouse transfer: two atomic authoritative movement legs sharing one transfer id.',
    ),
  ];
