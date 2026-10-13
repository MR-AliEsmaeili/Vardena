import type {
  InventoryDocument,
  InventoryDocumentKind,
  InventoryDocumentStatus,
} from '@/api/contracts';
import { t } from '@/lib/i18n';

/**
 * Inventory business-document vocabulary.
 *
 * Both unions come from the generated contract, so this file cannot name a
 * kind or a lifecycle status the backend does not have — and adding one on
 * the backend breaks the build here until it is translated.
 */

export const DOCUMENT_KINDS: readonly InventoryDocumentKind[] = [
  'receipt',
  'issue',
  'transfer',
];

export const DOCUMENT_STATUSES: readonly InventoryDocumentStatus[] = [
  'draft',
  'operational',
  'accounting_posted',
  'immutable',
  'cancelled',
];

export function documentKindLabel(kind: InventoryDocumentKind): string {
  return t.inventoryDocuments.kinds[kind];
}

export function documentStatusLabel(status: InventoryDocumentStatus): string {
  return t.inventoryDocuments.statuses[status];
}

/** Badge tone per lifecycle state (semantic tokens only). */
export function documentStatusTone(
  status: InventoryDocumentStatus,
): 'neutral' | 'info' | 'success' | 'warning' {
  switch (status) {
    case 'draft':
      return 'neutral';
    case 'operational':
      return 'info';
    case 'accounting_posted':
    case 'immutable':
      return 'success';
    case 'cancelled':
      return 'warning';
  }
}

/** The warehouse a row is "about" — source for a transfer, otherwise its own. */
export function documentWarehouseId(document: {
  kind: InventoryDocumentKind;
  warehouseId: string | null;
  sourceWarehouseId: string | null;
}): string | null {
  return document.kind === 'transfer'
    ? document.sourceWarehouseId
    : document.warehouseId;
}

/**
 * Whether a receipt cost may be typed at all.
 *
 * The backend refuses a cost on an issue/transfer outright, and refuses to
 * apportion ONE amount across several receipt lines
 * (`inventory.document.cost_apportionment_unsupported`). The form mirrors
 * exactly that rule instead of letting the user discover it as a 422.
 */
export function acceptsCost(
  kind: InventoryDocumentKind,
  lineCount: number,
): boolean {
  return kind === 'receipt' && lineCount === 1;
}

/** `true` while the document still has no allocated number. */
export function isUnnumbered(document: InventoryDocument): boolean {
  return document.number === null;
}
