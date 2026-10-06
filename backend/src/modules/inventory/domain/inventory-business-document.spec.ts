import { describe, expect, it } from 'vitest';
import { assertEditable, isManualIssueCost, transitionDocument, validateDocument, type InventoryReceipt, type InventoryTransfer } from './inventory-business-document.js';

const receipt: InventoryReceipt = { kind: 'receipt', id: 'r1', organizationId: 'org', number: 'R-1', businessDate: new Date(), warehouseId: 'w', cost: null, lines: [{ itemId: 'i', quantity: '10', unitId: 'u', conversionFactor: '1' }], status: 'draft' };

describe('C-58 inventory business documents', () => {
  it('allows self-finalization without an approval transition', () => {
    expect(transitionDocument(receipt, 'operational').status).toBe('operational');
    expect(transitionDocument({ ...receipt, status: 'operational' }, 'accounting_posted').status).toBe('accounting_posted');
  });
  it('keeps receipt cost optional and rejects manual issue cost', () => {
    expect(() => validateDocument(receipt)).not.toThrow();
    expect(() => isManualIssueCost('12')).toThrow(/derived/);
  });
  it('blocks edits after Accounting Post', () => {
    expect(() => assertEditable({ ...receipt, status: 'accounting_posted' })).toThrow(/immutable/);
  });
  it('rejects same-warehouse transfers and bad lines', () => {
    const transfer: InventoryTransfer = { kind: 'transfer', ...receipt, sourceWarehouseId: 'w', destinationWarehouseId: 'w' };
    expect(() => validateDocument(transfer)).toThrow(/differ/);
    expect(() => validateDocument({ ...receipt, lines: [{ ...receipt.lines[0], quantity: '0' }] })).toThrow(/positive/);
  });
});
