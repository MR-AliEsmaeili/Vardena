import { describe, expect, it } from 'vitest';
import {
  assertCancellable,
  assertDeletable,
  assertEditable,
  assertNoManualIssueCost,
  assertTransition,
  canTransition,
  classifyDocumentEdit,
  hasLedgerEffect,
  INVENTORY_DOCUMENT_STATUSES,
  InventoryDocumentRuleError,
  isInventoryDocumentKind,
  isInventoryDocumentStatus,
  toInventoryDocumentDto,
  transitionDocument,
  validateDocument,
  type InventoryDocumentLine,
  type InventoryDocumentStatus,
  type InventoryReceipt,
} from './inventory-business-document.js';

/**
 * C-58 domain rules. Framework-free and exhaustive over the lifecycle: every
 * legal AND illegal transition is asserted, because "reject illegal
 * transitions" is a contract, not an implementation detail.
 */

const line: InventoryDocumentLine = {
  id: 'line-1',
  lineNumber: 1,
  itemId: 'item-1',
  quantity: '10',
  unitId: 'unit-1',
  baseQuantity: '10',
  baseUnitId: 'unit-1',
  conversionFactor: '1',
  movementId: null,
  outMovementId: null,
  inMovementId: null,
};

const receipt: InventoryReceipt = {
  kind: 'receipt',
  id: 'doc-1',
  organizationId: 'org-1',
  number: null,
  businessDate: new Date('2026-10-01T00:00:00.000Z'),
  warehouseId: 'wh-1',
  sourceWarehouseId: null,
  destinationWarehouseId: null,
  cost: null,
  lines: [line],
  description: null,
  reference: null,
  status: 'draft',
  operationKey: null,
  valuationStale: false,
  finalizedAt: null,
  finalizedBy: null,
  accountingPostedAt: null,
  accountingPostedBy: null,
  sealedAt: null,
  sealedBy: null,
  cancelledAt: null,
  cancelledBy: null,
  cancellationReason: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  createdBy: null,
  updatedBy: null,
};

const LEGAL: ReadonlyArray<[InventoryDocumentStatus, InventoryDocumentStatus]> =
  [
    ['draft', 'operational'],
    ['draft', 'cancelled'],
    ['operational', 'accounting_posted'],
    ['operational', 'cancelled'],
    ['accounting_posted', 'immutable'],
  ];

describe('C-58 inventory business document lifecycle', () => {
  it('accepts exactly the legal transitions', () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
      expect(transitionDocument({ ...receipt, status: from }, to).status).toBe(
        to,
      );
    }
  });

  it('rejects every other transition, including self-transitions', () => {
    for (const from of INVENTORY_DOCUMENT_STATUSES) {
      for (const to of INVENTORY_DOCUMENT_STATUSES) {
        const legal = LEGAL.some(
          ([legalFrom, legalTo]) => legalFrom === from && legalTo === to,
        );
        if (legal) continue;
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
        expect(() => assertTransition(from, to)).toThrow(
          InventoryDocumentRuleError,
        );
      }
    }
  });

  it('never allows a skip from draft straight to accounting posted', () => {
    expect(canTransition('draft', 'accounting_posted')).toBe(false);
  });

  it('allows nothing at all out of immutable or cancelled', () => {
    for (const to of INVENTORY_DOCUMENT_STATUSES) {
      expect(canTransition('immutable', to)).toBe(false);
      expect(canTransition('cancelled', to)).toBe(false);
    }
  });

  it('knows which statuses carry a ledger effect', () => {
    expect(hasLedgerEffect('draft')).toBe(false);
    expect(hasLedgerEffect('cancelled')).toBe(false);
    expect(hasLedgerEffect('operational')).toBe(true);
    expect(hasLedgerEffect('accounting_posted')).toBe(true);
    expect(hasLedgerEffect('immutable')).toBe(true);
  });
});

describe('C-58 edit / delete / cancel boundaries (OQ-54)', () => {
  it('allows editing a draft and an operational document', () => {
    expect(() => assertEditable({ status: 'draft' })).not.toThrow();
    expect(() => assertEditable({ status: 'operational' })).not.toThrow();
  });

  it('forbids editing after Accounting Post', () => {
    expect(() => assertEditable({ status: 'accounting_posted' })).toThrow(
      /immutable/,
    );
    expect(() => assertEditable({ status: 'immutable' })).toThrow(/immutable/);
  });

  it('forbids editing a cancelled document', () => {
    expect(() => assertEditable({ status: 'cancelled' })).toThrow(/historical/);
  });

  it('only ever deletes a draft', () => {
    expect(() => assertDeletable({ status: 'draft' })).not.toThrow();
    for (const status of [
      'operational',
      'accounting_posted',
      'immutable',
      'cancelled',
    ] as const) {
      expect(() => assertDeletable({ status })).toThrow(/Only a draft/);
    }
  });

  it('cancels before Accounting Post and refuses afterwards', () => {
    expect(() => assertCancellable({ status: 'draft' })).not.toThrow();
    expect(() => assertCancellable({ status: 'operational' })).not.toThrow();
    expect(() => assertCancellable({ status: 'accounting_posted' })).toThrow(
      /accounting correction/,
    );
    expect(() => assertCancellable({ status: 'cancelled' })).toThrow(
      /already cancelled/,
    );
  });

  it('carries a stable code on every rule violation', () => {
    try {
      assertEditable({ status: 'accounting_posted' });
      expect.unreachable('expected a rule violation');
    } catch (error) {
      expect(error).toBeInstanceOf(InventoryDocumentRuleError);
      expect((error as InventoryDocumentRuleError).code).toBe(
        'inventory.document.accounting_posted_is_immutable',
      );
    }
  });
});

describe('C-58 document validation', () => {
  const base = {
    organizationId: 'org-1',
    kind: 'receipt' as const,
    warehouseId: 'wh-1',
    lines: [line],
  };

  it('keeps receipt cost optional', () => {
    expect(() => validateDocument(base)).not.toThrow();
    expect(() => validateDocument({ ...base, cost: '125.50' })).not.toThrow();
    expect(() => validateDocument({ ...base, cost: null })).not.toThrow();
  });

  it('rejects a negative or malformed receipt cost', () => {
    expect(() => validateDocument({ ...base, cost: '-1' })).toThrow(
      /non-negative/,
    );
    expect(() => validateDocument({ ...base, cost: 'abc' })).toThrow();
  });

  it('refuses a manual cost on an issue or a transfer', () => {
    expect(() =>
      validateDocument({ ...base, kind: 'issue', cost: '10' }),
    ).toThrow(/Only a receipt/);
    expect(() =>
      validateDocument({
        organizationId: 'org-1',
        kind: 'transfer',
        sourceWarehouseId: 'a',
        destinationWarehouseId: 'b',
        lines: [line],
        cost: '10',
      }),
    ).toThrow(/Only a receipt/);
    expect(() => assertNoManualIssueCost(undefined)).not.toThrow();
    expect(() => assertNoManualIssueCost(null)).not.toThrow();
    expect(() => assertNoManualIssueCost('12')).toThrow(/derived/);
  });

  it('requires a warehouse for a receipt or an issue', () => {
    expect(() => validateDocument({ ...base, warehouseId: null })).toThrow(
      /requires a warehouse/,
    );
  });

  it('requires two DIFFERENT warehouses for a transfer', () => {
    expect(() =>
      validateDocument({
        organizationId: 'org-1',
        kind: 'transfer',
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-1',
        lines: [line],
      }),
    ).toThrow(/must differ/);
    expect(() =>
      validateDocument({
        organizationId: 'org-1',
        kind: 'transfer',
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: null,
        lines: [line],
      }),
    ).toThrow(/source and a destination/);
    expect(() =>
      validateDocument({
        organizationId: 'org-1',
        kind: 'transfer',
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
        lines: [line],
      }),
    ).not.toThrow();
  });

  it('requires at least one line and an organization', () => {
    expect(() => validateDocument({ ...base, lines: [] })).toThrow(
      /at least one line/,
    );
    expect(() => validateDocument({ ...base, organizationId: '  ' })).toThrow(
      /requires an organization/,
    );
  });

  it('requires a positive quantity and a positive conversion factor', () => {
    expect(() =>
      validateDocument({ ...base, lines: [{ ...line, quantity: '0' }] }),
    ).toThrow(/positive quantity/);
    expect(() =>
      validateDocument({ ...base, lines: [{ ...line, quantity: '-5' }] }),
    ).toThrow(/positive quantity/);
    expect(() =>
      validateDocument({
        ...base,
        lines: [{ ...line, conversionFactor: '0' }],
      }),
    ).toThrow(/positive conversion/);
  });

  it('requires an item and a unit on every line', () => {
    expect(() =>
      validateDocument({ ...base, lines: [{ ...line, itemId: '' }] }),
    ).toThrow(/item and a unit/);
  });
});

describe('C-58 side-effect classification (ADR-0040 §3)', () => {
  const before = {
    businessDate: new Date('2026-10-01T00:00:00.000Z'),
    warehouseId: 'wh-1',
    sourceWarehouseId: null,
    destinationWarehouseId: null,
    cost: null,
    lines: [{ itemId: 'i1', unitId: 'u1', quantity: '10', baseQuantity: '10' }],
  };

  it('classifies any change to a draft as safe (a draft has no effect)', () => {
    const assessment = classifyDocumentEdit({
      hasPostedEffect: false,
      before,
      after: {
        ...before,
        lines: [
          { itemId: 'i1', unitId: 'u1', quantity: '99', baseQuantity: '99' },
        ],
      },
    });
    expect(assessment.classification).toBe('safe');
    expect(assessment.requiresLedgerReconciliation).toBe(false);
  });

  it('classifies an effect-free edit of a posted document as safe', () => {
    const assessment = classifyDocumentEdit({
      hasPostedEffect: true,
      before,
      after: { ...before },
    });
    expect(assessment.classification).toBe('safe');
    expect(assessment.reasons).toHaveLength(0);
  });

  it('detects a quantity change as a material side effect', () => {
    const assessment = classifyDocumentEdit({
      hasPostedEffect: true,
      before,
      after: {
        ...before,
        lines: [
          { itemId: 'i1', unitId: 'u1', quantity: '9', baseQuantity: '9' },
        ],
      },
    });
    expect(assessment.classification).toBe('material');
    expect(assessment.reasons).toContain('inventory.document.change.lines');
    expect(assessment.requiresLedgerReconciliation).toBe(true);
    expect(assessment.affectsValuation).toBe(true);
  });

  it('detects warehouse, business date, item and cost changes', () => {
    expect(
      classifyDocumentEdit({
        hasPostedEffect: true,
        before,
        after: { ...before, warehouseId: 'wh-2' },
      }).reasons,
    ).toContain('inventory.document.change.warehouse');
    expect(
      classifyDocumentEdit({
        hasPostedEffect: true,
        before,
        after: { ...before, businessDate: new Date('2026-09-01T00:00:00Z') },
      }).reasons,
    ).toContain('inventory.document.change.business_date');
    expect(
      classifyDocumentEdit({
        hasPostedEffect: true,
        before,
        after: {
          ...before,
          lines: [
            { itemId: 'i2', unitId: 'u1', quantity: '10', baseQuantity: '10' },
          ],
        },
      }).reasons,
    ).toContain('inventory.document.change.lines');
    expect(
      classifyDocumentEdit({
        hasPostedEffect: true,
        before,
        after: { ...before, cost: '50' },
      }).reasons,
    ).toContain('inventory.document.change.cost');
  });

  it('ignores line ORDER: the same effect is the same effect', () => {
    const twoLines = {
      ...before,
      lines: [
        { itemId: 'i1', unitId: 'u1', quantity: '10', baseQuantity: '10' },
        { itemId: 'i2', unitId: 'u1', quantity: '5', baseQuantity: '5' },
      ],
    };
    const reordered = {
      ...before,
      lines: [twoLines.lines[1]!, twoLines.lines[0]!],
    };
    expect(
      classifyDocumentEdit({
        hasPostedEffect: true,
        before: twoLines,
        after: reordered,
      }).classification,
    ).toBe('safe');
  });
});

describe('C-58 guards and DTO', () => {
  it('recognizes its own closed vocabularies', () => {
    expect(isInventoryDocumentKind('receipt')).toBe(true);
    expect(isInventoryDocumentKind('purchase_order')).toBe(false);
    expect(isInventoryDocumentStatus('accounting_posted')).toBe(true);
    expect(isInventoryDocumentStatus('posted')).toBe(false);
  });

  it('hides the cost from a caller who may not see inventory value', () => {
    const priced = { ...receipt, cost: '100.00' };
    expect(toInventoryDocumentDto(priced, true).cost).toBe('100.00');
    expect('cost' in toInventoryDocumentDto(priced, false)).toBe(false);
  });

  it('never advertises an action the lifecycle forbids', () => {
    const posted = toInventoryDocumentDto(
      { ...receipt, status: 'accounting_posted' },
      true,
    );
    expect(posted.canEdit).toBe(false);
    expect(posted.canCancel).toBe(false);
    expect(posted.canDelete).toBe(false);
    expect(posted.canSeal).toBe(true);

    const draft = toInventoryDocumentDto(receipt, true);
    expect(draft.canEdit).toBe(true);
    expect(draft.canFinalize).toBe(true);
    expect(draft.canAccountingPost).toBe(false);
  });
});
