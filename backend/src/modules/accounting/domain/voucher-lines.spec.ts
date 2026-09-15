import { describe, expect, it } from 'vitest';
import {
  assignLineNumbers,
  checkLineNumbers,
  checkVoucherBalance,
  checkVoucherLines,
  MIN_ACCOUNTING_DOCUMENT_LINES,
  voucherLineProblemMessage,
  voucherTotals,
  type AccountingDocumentLineInput,
} from './voucher-lines.js';

/**
 * The double-entry decision table (contract §13/§12.5, AC-D-18,
 * AC-I-07/08), and its two properties that matter most:
 *
 * - it reports EVERY problem, not just the first, so one response can tell a
 *   caller everything that is wrong with the composed document;
 * - a malformed amount short-circuits the derived verdicts (a balance computed
 *   from unusable numbers would be a lie).
 */
function line(
  lineNo: number,
  debitAmount: string,
  creditAmount: string,
): AccountingDocumentLineInput {
  return {
    lineNo,
    accountId: `ACC-${lineNo}`,
    debitAmount,
    creditAmount,
    description: null,
    sourceLineReference: null,
  };
}

const BALANCED: AccountingDocumentLineInput[] = [
  line(1, '1250.00', '0'),
  line(2, '0', '1250.00'),
];

describe('accounting document lines (contract §13)', () => {
  it('accepts the minimum balanced two-line document and nothing fewer', () => {
    expect(MIN_ACCOUNTING_DOCUMENT_LINES).toBe(2);
    expect(checkVoucherLines(BALANCED)).toEqual([]);
    // EVERY problem is reported: one line cannot carry a double entry, it has
    // no credit side, and it cannot balance against itself.
    expect(
      checkVoucherLines([BALANCED[0] as AccountingDocumentLineInput]),
    ).toEqual(['too_few_lines', 'missing_credit_side', 'unbalanced_document']);
  });

  it('refuses an unbalanced document without rounding it into balance', () => {
    const unbalanced = [line(1, '10', '0'), line(2, '0', '9.99')];
    expect(checkVoucherLines(unbalanced)).toEqual(['unbalanced_document']);
    // A single cent may never be absorbed: the check is exact.
    expect(
      checkVoucherLines([line(1, '10', '0'), line(2, '0', '10.01')]),
    ).toEqual(['unbalanced_document']);
    expect(voucherTotals(unbalanced)).toEqual({
      totalDebit: '10',
      totalCredit: '9.99',
      balanced: false,
    });
  });

  it('requires both sides to exist', () => {
    expect(checkVoucherLines([line(1, '5', '0'), line(2, '5', '0')])).toEqual([
      'missing_credit_side',
      'unbalanced_document',
    ]);
    expect(checkVoucherLines([line(1, '0', '5'), line(2, '0', '5')])).toEqual([
      'missing_debit_side',
      'unbalanced_document',
    ]);
  });

  it('refuses a line with no side and a line with both sides', () => {
    expect(checkVoucherLines([line(1, '0', '0'), line(2, '0', '0')])).toEqual([
      'zero_line',
      'missing_debit_side',
      'missing_credit_side',
    ]);
    expect(checkVoucherLines([line(1, '5', '5'), line(2, '5', '0')])).toEqual([
      'both_sides_set',
      'unbalanced_document',
    ]);
  });

  it('refuses negative amounts outright — the side never comes from a sign', () => {
    const negative = [line(1, '-5', '0'), line(2, '0', '5')];
    const problems = checkVoucherLines(negative);
    expect(problems).toContain('invalid_amount');
    // The balance verdict is withheld: a sum of unparsable values proves nothing.
    expect(problems).not.toContain('unbalanced_document');
  });

  it('reports malformed and over-precise amounts as ONE shape problem', () => {
    expect(
      checkVoucherLines([line(1, '1.005', '0'), line(2, '0', '1')]),
    ).toContain('invalid_amount');
    expect(
      checkVoucherLines([line(1, '10000000000000000', '0'), line(2, '0', '1')]),
    ).toContain('invalid_amount');
  });

  it('demands dense 1-based line numbering and reports gaps once', () => {
    expect(checkLineNumbers([1, 2, 3])).toEqual([]);
    expect(checkLineNumbers([1, 3])).toEqual(['gaps_in_line_numbers']);
    expect(checkLineNumbers([2, 3])).toEqual(['gaps_in_line_numbers']);
    expect(checkLineNumbers([1, 1])).toEqual(['duplicate_line_no']);
    expect(checkLineNumbers([0, 1])).toEqual(['invalid_line_no']);
    expect(checkLineNumbers([1, 2.5])).toEqual(['invalid_line_no']);
    expect(checkVoucherLines([line(1, '5', '0'), line(3, '0', '5')])).toContain(
      'gaps_in_line_numbers',
    );
  });

  it('assigns the canonical ordinal from submission order, never from input', () => {
    const assigned = assignLineNumbers([
      { accountId: 'A' },
      { accountId: 'B' },
      { accountId: 'C' },
    ]);
    expect(assigned.map((entry) => entry.lineNo)).toEqual([1, 2, 3]);
    expect(assigned.map((entry) => entry.accountId)).toEqual(['A', 'B', 'C']);
  });

  it('deduplicates the problem list and gives every problem a message', () => {
    const problems = checkVoucherLines([line(1, '0', '0'), line(1, '0', '0')]);
    expect(new Set(problems).size).toBe(problems.length);
    for (const problem of problems) {
      expect(voucherLineProblemMessage(problem).length).toBeGreaterThan(0);
    }
  });

  it('checks the balance alone for the finalization-time re-check', () => {
    expect(checkVoucherBalance(BALANCED)).toEqual([]);
    expect(checkVoucherBalance([line(1, '1', '0')])).toEqual([
      'too_few_lines',
      'missing_credit_side',
      'unbalanced_document',
    ]);
    expect(voucherTotals(BALANCED)).toEqual({
      totalDebit: '1250',
      totalCredit: '1250',
      balanced: true,
    });
  });
});
