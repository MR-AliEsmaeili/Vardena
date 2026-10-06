/** C-58 business-document boundary. Inventory owns these aggregates; the movement
 * ledger remains the only source of stock truth. */
export const INVENTORY_DOCUMENT_STATUSES = [
  'draft',
  'operational',
  'accounting_posted',
  'immutable',
] as const;
export type InventoryDocumentStatus =
  (typeof INVENTORY_DOCUMENT_STATUSES)[number];

export type InventoryDocumentLine = {
  itemId: string;
  quantity: string;
  unitId: string;
  conversionFactor: string;
};
export type InventoryDocumentBase = {
  id: string;
  organizationId: string;
  number: string;
  businessDate: Date;
  lines: readonly InventoryDocumentLine[];
  description?: string | null;
  reference?: string | null;
  status: InventoryDocumentStatus;
};
export type InventoryReceipt = InventoryDocumentBase & {
  kind: 'receipt';
  warehouseId: string;
  cost?: string | null;
};
export type InventoryIssue = InventoryDocumentBase & {
  kind: 'issue';
  warehouseId: string;
};
export type InventoryTransfer = InventoryDocumentBase & {
  kind: 'transfer';
  sourceWarehouseId: string;
  destinationWarehouseId: string;
};
export type InventoryBusinessDocument =
  InventoryReceipt | InventoryIssue | InventoryTransfer;

export class InventoryDocumentRuleError extends Error {}

export function transitionDocument(
  document: InventoryBusinessDocument,
  target: InventoryDocumentStatus,
): InventoryBusinessDocument {
  const allowed: Record<
    InventoryDocumentStatus,
    readonly InventoryDocumentStatus[]
  > = {
    draft: ['operational'],
    operational: ['accounting_posted'],
    accounting_posted: ['immutable'],
    immutable: [],
  };
  if (!allowed[document.status].includes(target)) {
    throw new InventoryDocumentRuleError(
      `Cannot transition ${document.status} to ${target}.`,
    );
  }
  return { ...document, status: target };
}

export function assertEditable(document: InventoryBusinessDocument): void {
  if (
    document.status === 'accounting_posted' ||
    document.status === 'immutable'
  ) {
    throw new InventoryDocumentRuleError(
      'Accounting-posted documents are immutable; use correction or reversal.',
    );
  }
}

export function validateDocument(document: InventoryBusinessDocument): void {
  if (
    !document.organizationId ||
    !document.number ||
    document.lines.length === 0
  ) {
    throw new InventoryDocumentRuleError(
      'A document requires organization, number and at least one line.',
    );
  }
  for (const line of document.lines) {
    if (
      !line.itemId ||
      !line.unitId ||
      Number(line.quantity) <= 0 ||
      Number(line.conversionFactor) <= 0
    ) {
      throw new InventoryDocumentRuleError(
        'Document lines require positive quantity and conversion.',
      );
    }
  }
  if (
    document.kind === 'receipt' &&
    document.cost !== null &&
    document.cost !== undefined &&
    Number(document.cost) < 0
  ) {
    throw new InventoryDocumentRuleError('Receipt cost cannot be negative.');
  }
  if (
    document.kind === 'transfer' &&
    document.sourceWarehouseId === document.destinationWarehouseId
  ) {
    throw new InventoryDocumentRuleError(
      'Transfer source and destination must differ.',
    );
  }
}

/** Issue deliberately has no cost property; receipt cost is optional. */
export function isManualIssueCost(value: unknown): false {
  if (value !== undefined && value !== null)
    throw new InventoryDocumentRuleError(
      'Issue cost is derived by Inventory valuation and cannot be entered.',
    );
  return false;
}
