import { describe, expect, it } from 'vitest';
import type { AccountingDocumentLine } from './voucher-lines.js';
import {
  CORRECTION_KIND_REVERSAL,
  invertDocumentLine,
  invertDocumentLines,
  isAccountingCorrectionKind,
} from './document-reversal.js';

const line = (
  overrides: Partial<AccountingDocumentLine> & { lineNo: number },
): AccountingDocumentLine => ({
  id: `line-${overrides.lineNo}`,
  documentId: 'doc',
  accountId: 'acc',
  debitAmount: '0',
  creditAmount: '0',
  description: null,
  sourceLineReference: null,
  ...overrides,
});

describe('document reversal invert (Task 15, AC-D-22)', () => {
  it('knows only reversal as a correction kind', () => {
    expect(isAccountingCorrectionKind(CORRECTION_KIND_REVERSAL)).toBe(true);
    expect(isAccountingCorrectionKind('correction')).toBe(false);
    expect(isAccountingCorrectionKind('replacement')).toBe(false);
  });

  it('swaps debit and credit as exact decimal strings', () => {
    const inverted = invertDocumentLine(
      line({
        lineNo: 1,
        accountId: 'cash',
        debitAmount: '1250.50',
        creditAmount: '0',
        description: 'Cash',
      }),
    );
    expect(inverted).toEqual({
      lineNo: 1,
      accountId: 'cash',
      debitAmount: '0',
      creditAmount: '1250.5',
      description: 'Cash',
      sourceLineReference: null,
    });
  });

  it('preserves ordinals and inverts the whole set in line-no order', () => {
    const inverted = invertDocumentLines([
      line({
        lineNo: 2,
        accountId: 'rev',
        debitAmount: '0',
        creditAmount: '10',
      }),
      line({
        lineNo: 1,
        accountId: 'cash',
        debitAmount: '10',
        creditAmount: '0',
      }),
    ]);
    expect(inverted.map((entry) => entry.lineNo)).toEqual([1, 2]);
    expect(inverted.map((entry) => entry.debitAmount)).toEqual(['0', '10']);
    expect(inverted.map((entry) => entry.creditAmount)).toEqual(['10', '0']);
  });
});
