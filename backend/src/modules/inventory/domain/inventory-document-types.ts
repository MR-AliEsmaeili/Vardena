import {
  DRAFT_PHASE,
  type DocumentTypeDefinition,
} from '../../documents/domain/document-type.js';
import type { InventoryDocumentKind } from './inventory-business-document.js';

/**
 * The Inventory Business Document types registered in the Documents
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
export const INVENTORY_PURCHASE_RETURN_DOCUMENT_TYPE =
  'inventory_purchase_return';
export const INVENTORY_SALES_RETURN_DOCUMENT_TYPE = 'inventory_sales_return';

export function documentTypeFor(kind: InventoryDocumentKind): string {
  switch (kind) {
    case 'receipt':
      return INVENTORY_RECEIPT_DOCUMENT_TYPE;
    case 'issue':
      return INVENTORY_ISSUE_DOCUMENT_TYPE;
    case 'transfer':
      return INVENTORY_TRANSFER_DOCUMENT_TYPE;
    case 'purchase_return':
      return INVENTORY_PURCHASE_RETURN_DOCUMENT_TYPE;
    case 'sales_return':
      return INVENTORY_SALES_RETURN_DOCUMENT_TYPE;
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
    definition(
      INVENTORY_PURCHASE_RETURN_DOCUMENT_TYPE,
      'Inventory Purchase Return',
      'A purchase return: stock returns to the supplier. With a basis on the original receipt it leaves at that receipt\u2019s own cost; otherwise at the current Moving Weighted Average. No commercial amount is accepted (OD-RET-01\u202604).',
    ),
    definition(
      INVENTORY_SALES_RETURN_DOCUMENT_TYPE,
      'Inventory Sales Return',
      'A sales return: goods come back from a customer. Valued at inventory cost (the current Moving Weighted Average), never at the sales price; an explicit amount requires a basis on the original issue (OD-RET-05\u202607).',
    ),
  ];
