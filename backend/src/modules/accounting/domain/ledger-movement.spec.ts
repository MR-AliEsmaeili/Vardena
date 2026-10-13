import { describe, expect, it } from 'vitest';
import { toLedgerMovementDto } from './ledger-movement.js';
import type { LedgerEntry } from './ledger-entry.js';
import { parseDateOnly } from './date-range.js';

/**
 * The Task 17A movement projection (contract §19.1/§19.2 AC-D-30, §13).
 *
 * What these tests lock down is the mapping's HONESTY: a movement is the
 * ledger entry's own values, rendered — never converted, never recomputed,
 * never enriched with a fact the ledger does not carry.
 */

const entry = (overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: '01HZZZZZZZZZZZZZZZZZZZZZZ1',
  organizationId: '01HZZZZZZZZZZZZZZZZZZZZZZ2',
  financialAreaId: '01HZZZZZZZZZZZZZZZZZZZZZZ3',
  fiscalYearId: '01HZZZZZZZZZZZZZZZZZZZZZZ4',
  accountingPeriodId: '01HZZZZZZZZZZZZZZZZZZZZZZ5',
  voucherId: '01HZZZZZZZZZZZZZZZZZZZZZZ6',
  voucherNumber: '00042',
  voucherLineId: '01HZZZZZZZZZZZZZZZZZZZZZZ7',
  lineNo: 2,
  accountId: '01HZZZZZZZZZZZZZZZZZZZZZZ8',
  debitAmount: '0',
  creditAmount: '1250.5',
  description: 'Rent for Farvardin',
  documentDate: parseDateOnly('2026-04-05')!,
  postingTimestamp: new Date('2026-04-05T09:31:07.123Z'),
  branchId: null,
  origin: 'manual',
  source: null,
  correlationId: null,
  finalizedBy: 'user-1',
  dimensionAssignments: [],
  ...overrides,
});

describe('toLedgerMovementDto', () => {
  it('maps every ledger-native field 1:1, adding no derived value', () => {
    const dto = toLedgerMovementDto(entry());

    expect(dto).toEqual({
      id: '01HZZZZZZZZZZZZZZZZZZZZZZ1',
      organizationId: '01HZZZZZZZZZZZZZZZZZZZZZZ2',
      financialAreaId: '01HZZZZZZZZZZZZZZZZZZZZZZ3',
      fiscalYearId: '01HZZZZZZZZZZZZZZZZZZZZZZ4',
      accountingPeriodId: '01HZZZZZZZZZZZZZZZZZZZZZZ5',
      voucherId: '01HZZZZZZZZZZZZZZZZZZZZZZ6',
      voucherNumber: '00042',
      voucherLineId: '01HZZZZZZZZZZZZZZZZZZZZZZ7',
      lineNo: 2,
      accountId: '01HZZZZZZZZZZZZZZZZZZZZZZ8',
      debitAmount: '0',
      creditAmount: '1250.5',
      description: 'Rent for Farvardin',
      documentDate: '2026-04-05',
      postingTimestamp: '2026-04-05T09:31:07.123Z',
      origin: 'manual',
      sourceModule: null,
      sourceEntityType: null,
      sourceEntityId: null,
      sourceOperation: null,
    });
  });

  it('renders the business date as a date-only value (never an instant, §12.3)', () => {
    const dto = toLedgerMovementDto(
      entry({ documentDate: parseDateOnly('2026-01-01')! }),
    );
    expect(dto.documentDate).toBe('2026-01-01');
    expect(dto.documentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps the posting timestamp distinct from the business date (§15.5)', () => {
    const dto = toLedgerMovementDto(
      entry({
        documentDate: parseDateOnly('2026-04-05')!,
        postingTimestamp: new Date('2026-04-09T22:05:00.000Z'),
      }),
    );
    expect(dto.documentDate).toBe('2026-04-05');
    expect(dto.postingTimestamp).toBe('2026-04-09T22:05:00.000Z');
  });

  it('preserves decimal exactness — no float, no rounding, no re-scaling', () => {
    const exact = toLedgerMovementDto(
      entry({ debitAmount: '9999999999999999.99', creditAmount: '0' }),
    );
    // A JS number would already have lost this value; a string cannot.
    expect(exact.debitAmount).toBe('9999999999999999.99');
    expect(typeof exact.debitAmount).toBe('string');

    const small = toLedgerMovementDto(
      entry({ debitAmount: '0.01', creditAmount: '0' }),
    );
    expect(small.debitAmount).toBe('0.01');
  });

  it('canonicalizes trailing zeros the way every Accounting read does', () => {
    const dto = toLedgerMovementDto(
      entry({ debitAmount: '1250.50', creditAmount: '0.00' }),
    );
    expect(dto.debitAmount).toBe('1250.5');
    expect(dto.creditAmount).toBe('0');
  });

  it('carries the system-origin source identity when the entry has one (§16.3)', () => {
    const dto = toLedgerMovementDto(
      entry({
        origin: 'system',
        source: {
          module: 'inventory',
          entityType: 'inventory_movement',
          entityId: 'mv-1',
          operation: 'issue',
        },
      }),
    );
    expect(dto.origin).toBe('system');
    expect(dto.sourceModule).toBe('inventory');
    expect(dto.sourceEntityType).toBe('inventory_movement');
    expect(dto.sourceEntityId).toBe('mv-1');
    expect(dto.sourceOperation).toBe('issue');
  });

  it('never surfaces a dimension assignment (no dimension model exists — OQ-41)', () => {
    const dto = toLedgerMovementDto(entry());
    expect(Object.keys(dto)).not.toContain('dimensionAssignments');
    expect(Object.keys(dto)).not.toContain('dimensions');
  });
});
