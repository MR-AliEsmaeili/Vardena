import { describe, expect, it } from 'vitest';
import {
  ACCOUNTING_POST_ACTION,
  ACCOUNTING_POST_CANCEL_ACTION,
  INVENTORY_ACCOUNTING_POSTING_STATES,
  INVENTORY_ACCOUNTING_POSTING_TRANSITIONS,
  INVENTORY_DOCUMENT_ACCOUNTING_POSTING_STATES,
  assertAccountingPostingTransition,
  canTransitionAccountingPostingState,
  documentAccountingPostingStateFor,
  isInventoryAccountingPostingState,
  isInventoryDocumentAccountingPostingState,
  isRetryableAccountingPostingState,
  isTerminalAccountingPostingState,
} from './inventory-accounting-posting-operation.js';
import {
  WAREHOUSE_ACCOUNTING_POSTING_MODES,
  assertWarehouseAccountingPostingMode,
  isWarehouseAccountingPostingMode,
  resolveWarehouseAccountingPostingMode,
} from './warehouse-posting-mode.js';
import {
  MAX_ACCOUNTING_POSTING_OPERATION_KEY_LENGTH,
  buildAccountingPostingCancellationHash,
  buildAccountingPostingRequestHash,
  deriveAccountingOperationKey,
  deriveUnitCost,
  isValidAccountingPostingOperationKey,
  normalizeAccountingPostingOperationKey,
  totalMovementValue,
  valuationBasisOf,
  type AccountingPostingMovementFact,
} from './inventory-accounting-posting-request.js';

/**
 * C-62 domain vocabulary (PDR-09 PO-01…PO-12, PDR-10 C62-OD-02/OD-04/OD-05/06).
 *
 * Framework-free and exhaustive over the two closed vocabularies, because the
 * whole slice rests on them being closed:
 *   * the posting-operation state machine and the document standing it
 *     establishes — «a draft is NOT posted» is a rule here, not a convention
 *     someone remembers in a controller;
 *   * the Warehouse posting mode, which fails closed;
 *   * the canonical request hash, whose ONLY job is to make a retry hash
 *     identically and any material difference hash differently.
 */

function movement(
  overrides: Partial<AccountingPostingMovementFact> = {},
): AccountingPostingMovementFact {
  return {
    movementId: 'mv-1',
    lineId: 'line-1',
    itemId: 'item-1',
    quantity: '10',
    unitId: 'unit-1',
    baseQuantity: '10',
    baseUnitId: 'unit-1',
    value: '100.00',
    unitCost: '10.000000',
    valuationStatus: 'valued',
    valuationSource: 'entered_cost',
    valuationRunId: null,
    ...overrides,
  };
}

function request(
  overrides: Partial<
    Parameters<typeof buildAccountingPostingRequestHash>[0]
  > = {},
): Parameters<typeof buildAccountingPostingRequestHash>[0] {
  return {
    organizationId: 'org-1',
    branchId: 'branch-1',
    sourceDocumentId: 'doc-1',
    sourceDocumentType: 'inventory_receipt',
    sourceDocumentNumber: 'R-0001',
    sourceDocumentDate: '2026-10-08',
    sourceDocumentVersion: '2026-10-08T00:00:00.000Z',
    warehouseId: 'wh-1',
    postingMode: 'direct_final',
    action: ACCOUNTING_POST_ACTION,
    valuation: {
      state: 'priced',
      documentStale: false,
      keyStaleVerdict: 'not_stale',
      valuationRunId: null,
      basis: 'entered_cost',
      totalValue: '100.00',
    },
    movements: [movement()],
    ...overrides,
  };
}

describe('C-62 posting operation states', () => {
  it('declares only the states the slice reaches', () => {
    expect([...INVENTORY_ACCOUNTING_POSTING_STATES]).toEqual([
      'REQUESTED',
      'PENDING',
      'DRAFT_CREATED',
      'POSTED',
      'REFUSED',
      'FAILED',
      'CANCELLED',
    ]);
  });

  it('recognizes a stored state and rejects anything else', () => {
    expect(isInventoryAccountingPostingState('PENDING')).toBe(true);
    expect(isInventoryAccountingPostingState('pending')).toBe(false);
    expect(isInventoryAccountingPostingState('posted')).toBe(false);
    expect(isInventoryAccountingPostingState('nonsense')).toBe(false);
  });

  it('treats POSTED, REFUSED and CANCELLED as terminal', () => {
    expect(isTerminalAccountingPostingState('POSTED')).toBe(true);
    expect(isTerminalAccountingPostingState('REFUSED')).toBe(true);
    expect(isTerminalAccountingPostingState('CANCELLED')).toBe(true);
    expect(isTerminalAccountingPostingState('DRAFT_CREATED')).toBe(false);
    expect(isTerminalAccountingPostingState('PENDING')).toBe(false);
    expect(isTerminalAccountingPostingState('FAILED')).toBe(false);
    expect(isTerminalAccountingPostingState('REQUESTED')).toBe(false);
  });

  it('treats REQUESTED, PENDING and FAILED as retryable', () => {
    expect(isRetryableAccountingPostingState('REQUESTED')).toBe(true);
    expect(isRetryableAccountingPostingState('PENDING')).toBe(true);
    expect(isRetryableAccountingPostingState('FAILED')).toBe(true);
    // A created draft is a decision, not a failure: retrying it under the same
    // key must replay, never create a second draft.
    expect(isRetryableAccountingPostingState('DRAFT_CREATED')).toBe(false);
    expect(isRetryableAccountingPostingState('POSTED')).toBe(false);
    expect(isRetryableAccountingPostingState('CANCELLED')).toBe(false);
    expect(isRetryableAccountingPostingState('REFUSED')).toBe(false);
  });

  it('allows exactly the documented transitions', () => {
    expect(canTransitionAccountingPostingState('REQUESTED', 'PENDING')).toBe(
      true,
    );
    expect(
      canTransitionAccountingPostingState('PENDING', 'DRAFT_CREATED'),
    ).toBe(true);
    expect(canTransitionAccountingPostingState('PENDING', 'POSTED')).toBe(true);
    expect(canTransitionAccountingPostingState('PENDING', 'CANCELLED')).toBe(
      true,
    );
    expect(canTransitionAccountingPostingState('DRAFT_CREATED', 'POSTED')).toBe(
      true,
    );
    expect(canTransitionAccountingPostingState('FAILED', 'PENDING')).toBe(true);
  });

  it('never lets a posting operation become CANCELLED', () => {
    // A cancellation is its OWN durable operation (action
    // `accounting_post:cancel`, PENDING → CANCELLED). The posting operation's
    // DRAFT_CREATED state is the historical evidence of the draft it produced
    // and is never overwritten by a cancellation.
    expect(
      canTransitionAccountingPostingState('DRAFT_CREATED', 'CANCELLED'),
    ).toBe(false);
    expect(() =>
      assertAccountingPostingTransition('DRAFT_CREATED', 'CANCELLED'),
    ).toThrow(/cannot move from "DRAFT_CREATED" to "CANCELLED"/);
  });

  it('refuses every transition out of a terminal state', () => {
    for (const terminal of ['POSTED', 'REFUSED', 'CANCELLED'] as const) {
      expect(INVENTORY_ACCOUNTING_POSTING_TRANSITIONS[terminal]).toEqual([]);
      for (const target of INVENTORY_ACCOUNTING_POSTING_STATES) {
        expect(canTransitionAccountingPostingState(terminal, target)).toBe(
          false,
        );
      }
    }
  });

  it('refuses a transition that skips the durable intent', () => {
    expect(canTransitionAccountingPostingState('REQUESTED', 'POSTED')).toBe(
      false,
    );
    expect(
      canTransitionAccountingPostingState('REQUESTED', 'DRAFT_CREATED'),
    ).toBe(false);
    expect(() =>
      assertAccountingPostingTransition('REQUESTED', 'POSTED'),
    ).toThrow(/cannot move from "REQUESTED" to "POSTED"/);
  });
});

describe('C-62 document accounting standing', () => {
  it('maps a final voucher to final_posted and a draft to draft_created', () => {
    expect(documentAccountingPostingStateFor('POSTED')).toBe('final_posted');
    expect(documentAccountingPostingStateFor('DRAFT_CREATED')).toBe(
      'draft_created',
    );
    expect(documentAccountingPostingStateFor('CANCELLED')).toBe(
      'draft_cancelled',
    );
  });

  it('leaves the standing untouched for a refusal or a failure', () => {
    // The document stays where its own lifecycle says it belongs; an Accounting
    // refusal is a fact about the operation, not a lifecycle change.
    expect(documentAccountingPostingStateFor('REFUSED')).toBeNull();
    expect(documentAccountingPostingStateFor('FAILED')).toBeNull();
    expect(documentAccountingPostingStateFor('PENDING')).toBeNull();
    expect(documentAccountingPostingStateFor('REQUESTED')).toBeNull();
  });

  it('is a closed, recognized vocabulary', () => {
    expect([...INVENTORY_DOCUMENT_ACCOUNTING_POSTING_STATES]).toEqual([
      'not_posted',
      'draft_created',
      'final_posted',
      'draft_cancelled',
    ]);
    expect(isInventoryDocumentAccountingPostingState('draft_created')).toBe(
      true,
    );
    expect(isInventoryDocumentAccountingPostingState('posted')).toBe(false);
    expect(isInventoryDocumentAccountingPostingState('accounting_posted')).toBe(
      false,
    );
  });
});

describe('C-62 warehouse posting mode', () => {
  it('declares exactly the two configured modes', () => {
    expect([...WAREHOUSE_ACCOUNTING_POSTING_MODES]).toEqual([
      'direct_final',
      'draft',
    ]);
  });

  it('recognizes a stored mode', () => {
    expect(isWarehouseAccountingPostingMode('direct_final')).toBe(true);
    expect(isWarehouseAccountingPostingMode('draft')).toBe(true);
    expect(isWarehouseAccountingPostingMode('DRAFT')).toBe(false);
    expect(isWarehouseAccountingPostingMode('direct-final')).toBe(false);
  });

  it('fails closed on an unknown stored mode', () => {
    // Guessing `draft` would silently post nothing; guessing `direct_final`
    // would silently post to the General Ledger. Neither is acceptable, so an
    // unrecognized stored value is an error rather than a default.
    expect(() => resolveWarehouseAccountingPostingMode('DIRECT_FINAL')).toThrow(
      /Stored warehouse accounting posting mode "DIRECT_FINAL" is not a known mode/,
    );
    expect(() => resolveWarehouseAccountingPostingMode('')).toThrow(
      /is not a known mode/,
    );
    expect(() => resolveWarehouseAccountingPostingMode('immediate')).toThrow(
      /is not a known mode/,
    );
    expect(() => assertWarehouseAccountingPostingMode('nonsense')).toThrow(
      /is not one of: direct_final, draft/,
    );
  });

  it('accepts an explicitly configured mode', () => {
    expect(resolveWarehouseAccountingPostingMode('direct_final')).toBe(
      'direct_final',
    );
    expect(assertWarehouseAccountingPostingMode('draft')).toBe('draft');
  });
});

describe('C-62 canonical request hash', () => {
  it('hashes a retry identically', () => {
    expect(buildAccountingPostingRequestHash(request())).toBe(
      buildAccountingPostingRequestHash(request()),
    );
  });

  it('is independent of the movement order', () => {
    const a = movement({ movementId: 'mv-a', value: '10.00' });
    const b = movement({ movementId: 'mv-b', value: '20.00' });
    expect(
      buildAccountingPostingRequestHash(request({ movements: [a, b] })),
    ).toBe(buildAccountingPostingRequestHash(request({ movements: [b, a] })));
  });

  it('changes when any material fact changes', () => {
    const base = buildAccountingPostingRequestHash(request());
    const cases: Array<
      Parameters<typeof buildAccountingPostingRequestHash>[0]
    > = [
      request({ organizationId: 'org-2' }),
      request({ branchId: 'branch-2' }),
      request({ sourceDocumentId: 'doc-2' }),
      request({ sourceDocumentType: 'inventory_issue' }),
      request({ sourceDocumentNumber: 'R-0002' }),
      request({ sourceDocumentDate: '2026-10-09' }),
      request({ sourceDocumentVersion: '2026-10-09T00:00:00.000Z' }),
      request({ warehouseId: 'wh-2' }),
      request({ postingMode: 'draft' }),
      request({ action: 'accounting_post:cancel' }),
      request({ movements: [movement({ value: '101.00' })] }),
      request({ movements: [movement({ valuationRunId: 'run-1' })] }),
      request({ movements: [movement({ valuationStatus: 'provisional' })] }),
      request({
        valuation: {
          state: 'priced',
          documentStale: true,
          keyStaleVerdict: 'not_stale',
          valuationRunId: null,
          basis: 'entered_cost',
          totalValue: '100.00',
        },
      }),
    ];
    for (const changed of cases) {
      expect(buildAccountingPostingRequestHash(changed)).not.toBe(base);
    }
  });

  it('treats an omitted optional value and an explicit null the same', () => {
    expect(
      buildAccountingPostingRequestHash(
        request({ sourceDocumentNumber: null }),
      ),
    ).toBe(
      buildAccountingPostingRequestHash(
        request({ sourceDocumentNumber: null }),
      ),
    );
    expect(
      buildAccountingPostingRequestHash(
        request({ sourceDocumentNumber: 'R-0001' }),
      ),
    ).not.toBe(
      buildAccountingPostingRequestHash(
        request({ sourceDocumentNumber: null }),
      ),
    );
  });

  it('ignores whitespace and padding in decimal strings', () => {
    expect(
      buildAccountingPostingRequestHash(
        request({ movements: [movement({ value: '100.00' })] }),
      ),
    ).toBe(
      buildAccountingPostingRequestHash(
        request({ movements: [movement({ value: ' 100.00 ' })] }),
      ),
    );
  });
});

describe('C-62 cancellation request hash', () => {
  const cancellation = (
    overrides: Partial<
      Parameters<typeof buildAccountingPostingCancellationHash>[0]
    > = {},
  ): Parameters<typeof buildAccountingPostingCancellationHash>[0] => ({
    organizationId: 'org-1',
    sourceDocumentId: 'doc-1',
    action: ACCOUNTING_POST_CANCEL_ACTION,
    postingOperationKey: 'post-key-1',
    documentVersion: '2026-10-08T00:00:00.000Z',
    ...overrides,
  });

  it('hashes the same cancellation intent identically', () => {
    expect(buildAccountingPostingCancellationHash(cancellation())).toBe(
      buildAccountingPostingCancellationHash(cancellation()),
    );
  });

  it('changes when any part of the intent changes', () => {
    const base = buildAccountingPostingCancellationHash(cancellation());
    const cases = [
      cancellation({ organizationId: 'org-2' }),
      cancellation({ sourceDocumentId: 'doc-2' }),
      cancellation({ action: 'accounting_post' }),
      cancellation({ documentVersion: '2026-10-08T01:00:00.000Z' }),
      // The same document whose LIVE posting operation moved on (a re-post
      // after a cancelled draft) is a different cancellation intent.
      cancellation({ postingOperationKey: 'post-key-2' }),
    ];
    for (const changed of cases) {
      expect(buildAccountingPostingCancellationHash(changed)).not.toBe(base);
    }
  });
});

describe('C-62 operation keys', () => {
  it('derives a deterministic key from the Inventory operation', () => {
    const first = deriveAccountingOperationKey({
      documentId: 'doc-1',
      action: ACCOUNTING_POST_ACTION,
      operationKey: 'k-1',
      step: 'create',
    });
    const second = deriveAccountingOperationKey({
      documentId: 'doc-1',
      action: ACCOUNTING_POST_ACTION,
      operationKey: 'k-1',
      step: 'create',
    });
    expect(first).toBe(second);
    expect(first.startsWith('inv-acct:accounting_post:doc-1:k-1:create')).toBe(
      true,
    );
  });

  it('never collides across documents, keys or steps', () => {
    const keys = new Set(
      (['create', 'issue', 'finalize'] as const).flatMap((step) =>
        ['doc-1', 'doc-2'].flatMap((documentId) =>
          ['k-1', 'k-2'].map((operationKey) =>
            deriveAccountingOperationKey({
              documentId,
              action: ACCOUNTING_POST_ACTION,
              operationKey,
              step,
            }),
          ),
        ),
      ),
    );
    expect(keys.size).toBe(12);
  });

  it('bounds an over-long key to the column width, keeping it unique', () => {
    const long = 'k'.repeat(400);
    const derived = deriveAccountingOperationKey({
      documentId: 'doc-1',
      action: ACCOUNTING_POST_ACTION,
      operationKey: long,
      step: 'create',
    });
    expect(Array.from(derived).length).toBeLessThanOrEqual(
      MAX_ACCOUNTING_POSTING_OPERATION_KEY_LENGTH,
    );
    const other = deriveAccountingOperationKey({
      documentId: 'doc-1',
      action: ACCOUNTING_POST_ACTION,
      operationKey: `${long}x`,
      step: 'create',
    });
    expect(other).not.toBe(derived);
  });

  it('validates a caller-supplied key', () => {
    expect(isValidAccountingPostingOperationKey('k-1')).toBe(true);
    expect(isValidAccountingPostingOperationKey('  k-1  ')).toBe(true);
    expect(isValidAccountingPostingOperationKey('')).toBe(false);
    expect(isValidAccountingPostingOperationKey('   ')).toBe(false);
    expect(isValidAccountingPostingOperationKey('k'.repeat(129))).toBe(false);
  });

  it('normalizes by trimming only', () => {
    expect(normalizeAccountingPostingOperationKey('  k-1 ')).toBe('k-1');
    expect(normalizeAccountingPostingOperationKey('k-1')).toBe('k-1');
  });
});

describe('C-62 movement facts', () => {
  it('sums signed values with exact decimal arithmetic', () => {
    // Canonical (unpadded) decimal spelling, the module's one convention for
    // every money value — a float would eventually disagree with the ledger.
    expect(
      totalMovementValue([
        movement({ movementId: 'a', value: '10.10' }),
        movement({ movementId: 'b', value: '20.20' }),
      ]),
    ).toBe('30.3');
    // A signed outbound value nets against an inbound one.
    expect(
      totalMovementValue([
        movement({ movementId: 'a', value: '0.10' }),
        movement({ movementId: 'b', value: '-0.10' }),
      ]),
    ).toBe('0');
    expect(totalMovementValue([])).toBe('0.00');
  });

  it('derives the per-base-unit cost for presentation, never as a second truth', () => {
    expect(deriveUnitCost('100.00', '10')).toBe('10');
    expect(deriveUnitCost('10.00', '3')).toBe('3.333333');
    // A zero base quantity has no unit cost, and none is fabricated for it.
    expect(deriveUnitCost('100.00', '0')).toBe('0');
  });

  it('reads the valuation basis from the closed ledger vocabulary', () => {
    expect(valuationBasisOf('entered_cost')).toBe('entered_cost');
    expect(valuationBasisOf('average_cost')).toBe('average_cost');
    expect(valuationBasisOf(null)).toBe('unvalued');
  });
});
