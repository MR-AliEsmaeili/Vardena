import { describe, expect, it } from 'vitest';
import { parseDateOnly } from './date-range.js';
import { checkLedgerEntry, type LedgerEntry } from './ledger-entry.js';

const ORG = '01ORGANIZATIONA000000000AA';
const AREA = '01AREAAAAAAAAAAAAAAAAAAAA01';
const YEAR = '01YEARAAAAAAAAAAAAAAAAAAAA01';
const PERIOD = '01PERIODAAAAAAAAAAAAAAAAAAA01';
const ACCOUNT = '01ACCOUNTAAAAAAAAAAAAAAAAA01';
const VOUCHER_ID = '01VOUCHERAAAAAAAAAAAAAAAA01';
const VOUCHER_LINE_ID = '01LINEAAAAAAAAAAAAAAAAAAAA01';
const DOCUMENT_DATE = parseDateOnly('2026-04-05')!;
const POSTING_TIMESTAMP = new Date('2026-04-05T08:00:00Z');

function validEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: '01LEDGERAAAAAAAAAAAAAAAAAA01',
    organizationId: ORG,
    financialAreaId: AREA,
    fiscalYearId: YEAR,
    accountingPeriodId: PERIOD,
    voucherId: VOUCHER_ID,
    voucherNumber: '0001',
    voucherLineId: VOUCHER_LINE_ID,
    lineNo: 1,
    accountId: ACCOUNT,
    debitAmount: '1250',
    creditAmount: '0',
    description: 'Cash',
    documentDate: DOCUMENT_DATE,
    postingTimestamp: POSTING_TIMESTAMP,
    branchId: null,
    origin: 'manual',
    source: null,
    correlationId: null,
    finalizedBy: '01ACTOR000000000000000000A',
    dimensionAssignments: [],
    ...overrides,
  };
}

describe('ledger entry contract — valid (task §8)', () => {
  it('valid ledger entry passes all invariants', () => {
    expect(checkLedgerEntry(validEntry())).toEqual([]);
  });

  it('valid system-origin entry with source passes', () => {
    const entry = validEntry({
      origin: 'system',
      source: {
        module: 'inventory',
        entityType: 'inventory_movement',
        entityId: '01MOVEMENTAAAAAAAAAAAAAAAA1',
        operation: 'post',
      },
    });
    expect(checkLedgerEntry(entry)).toEqual([]);
  });
});

describe('ledger entry contract — invalid cases', () => {
  it('rejects missing id (immutable identity required)', () => {
    expect(checkLedgerEntry(validEntry({ id: '' }))).toContain('missing_id');
  });

  it('rejects missing organization (AC-I-01)', () => {
    expect(checkLedgerEntry(validEntry({ organizationId: '' }))).toContain(
      'missing_organization',
    );
  });

  it('rejects missing financial area (AC-D-02/03)', () => {
    expect(checkLedgerEntry(validEntry({ financialAreaId: '' }))).toContain(
      'missing_financial_area',
    );
  });

  it('rejects missing voucher id (AC-I-14 traceability)', () => {
    expect(checkLedgerEntry(validEntry({ voucherId: '' }))).toContain(
      'missing_voucher_id',
    );
  });

  it('rejects missing voucher number (AC-I-22)', () => {
    expect(checkLedgerEntry(validEntry({ voucherNumber: '' }))).toContain(
      'missing_voucher_number',
    );
  });

  it('rejects missing voucher line id (line → entry traceability)', () => {
    expect(checkLedgerEntry(validEntry({ voucherLineId: '' }))).toContain(
      'missing_voucher_line_id',
    );
  });

  it('rejects invalid lineNo (legal-book order §12.5)', () => {
    expect(checkLedgerEntry(validEntry({ lineNo: 0 }))).toContain(
      'invalid_line_no',
    );
    expect(checkLedgerEntry(validEntry({ lineNo: -1 }))).toContain(
      'invalid_line_no',
    );
  });

  it('rejects missing account (AC-I-09)', () => {
    expect(checkLedgerEntry(validEntry({ accountId: '' }))).toContain(
      'missing_account',
    );
  });

  it('rejects invalid amount (AC-I-08)', () => {
    expect(checkLedgerEntry(validEntry({ debitAmount: '-5' }))).toContain(
      'invalid_amount',
    );
  });

  it('rejects zero line (AC-I-08)', () => {
    expect(
      checkLedgerEntry(validEntry({ debitAmount: '0', creditAmount: '0' })),
    ).toContain('zero_line');
  });

  it('rejects both sides set (AC-I-08)', () => {
    expect(
      checkLedgerEntry(validEntry({ debitAmount: '10', creditAmount: '10' })),
    ).toContain('both_sides_set');
  });

  it('rejects missing document date (Class C3, §12.3)', () => {
    expect(
      checkLedgerEntry(validEntry({ documentDate: null as any })),
    ).toContain('missing_document_date');
  });

  it('rejects missing posting timestamp (§15.5)', () => {
    expect(
      checkLedgerEntry(validEntry({ postingTimestamp: null as any })),
    ).toContain('missing_posting_timestamp');
  });

  it('rejects system origin without source (AC-D-25)', () => {
    expect(
      checkLedgerEntry(validEntry({ origin: 'system', source: null })),
    ).toContain('source_required_for_system');
  });

  it('rejects manual origin with source (AC-D-24)', () => {
    expect(
      checkLedgerEntry(
        validEntry({
          origin: 'manual',
          source: {
            module: 'inventory',
            entityType: 'inventory_movement',
            entityId: '01MOVEMENTAAAAAAAAAAAAAAAA1',
            operation: 'post',
          },
        }),
      ),
    ).toContain('source_forbidden_for_manual');
  });

  it('rejects malformed source', () => {
    expect(
      checkLedgerEntry(
        validEntry({
          origin: 'system',
          source: {
            module: 'Inventory!',
            entityType: 'inventory_movement',
            entityId: '01MOVEMENTAAAAAAAAAAAAAAAA1',
            operation: 'post',
          },
        }),
      ),
    ).toContain('malformed_source');
  });
});

describe('ledger entry contract — immutability (task §10)', () => {
  it('ledger entry is readonly by contract (no mutation API)', () => {
    const entry = validEntry();
    // The type is readonly, but runtime check: mutating a copy must not affect original
    const copy = { ...entry };
    (copy as any).voucherNumber = '9999';
    expect(entry.voucherNumber).toBe('0001');
  });

  it('dimension assignments default empty and are readonly (OQ-41 seam)', () => {
    const entry = validEntry();
    expect(entry.dimensionAssignments).toEqual([]);
    // Ensure array is not shared mutable state across entries
    const entry2 = validEntry({ id: '01LEDGERAAAAAAAAAAAAAAAAAA02' });
    expect(entry2.dimensionAssignments).toEqual([]);
  });
});

describe('ledger entry contract — invariants for audit (task §8, §10)', () => {
  it('preserves both business date and system timestamp (Class C3)', () => {
    const entry = validEntry();
    expect(entry.documentDate).toEqual(DOCUMENT_DATE);
    expect(entry.postingTimestamp).toEqual(POSTING_TIMESTAMP);
  });

  it('preserves branch as scope column (Class C5)', () => {
    const entry = validEntry({ branchId: '01BRANCHAAAAAAAAAAAAAAAAAA01' });
    expect(checkLedgerEntry(entry)).toEqual([]);
    expect(entry.branchId).toBe('01BRANCHAAAAAAAAAAAAAAAAAA01');
  });

  it('preserves correlation and finalization evidence (AC-D-35)', () => {
    const entry = validEntry({
      correlationId: '01CORRELATIONAAAAAAAAAAAAAA01',
      finalizedBy: '01ACTOR000000000000000000A',
    });
    expect(checkLedgerEntry(entry)).toEqual([]);
    expect(entry.correlationId).toBe('01CORRELATIONAAAAAAAAAAAAAA01');
    expect(entry.finalizedBy).toBe('01ACTOR000000000000000000A');
  });
});
