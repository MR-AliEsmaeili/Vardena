/**
 * Accounting document lines — the debit/credit shape and the balance
 * invariant (Task 10.4, contract §12.5/§13, AC-D-18, AC-I-07/AC-I-08).
 *
 * DECIDED rules this file owns (pure, framework-free, unit-tested — AR-05):
 *
 * - a voucher has at least TWO lines, with at least one debit line and at
 *   least one credit line (§13.1);
 * - `Σ debit = Σ credit` EXACTLY, compared with zero tolerance (§13.1);
 * - amounts are non-negative and exactly one side of a line is non-zero —
 *   both-zero is rejected (it carries no accounting fact and pads the ledger)
 *   and both-set is rejected (that is two lines, §13.2);
 * - `line_no` is 1-based, unique per document and DENSE (§12.5). The service
 *   assigns it from the submitted order (`assignLineNumbers`), and
 *   `checkLineNumbers` re-validates the resulting set and any set read back
 *   from storage — a client never supplies an ordinal it could get wrong.
 *
 * The check runs at composition (fast feedback) AND again inside the
 * finalization transaction under the document lock (§13.1/§15.5) — the
 * authoritative run. Both call sites use this one decision table, so the two
 * can never drift.
 *
 * No dimension rules live here: per-line dimension assignments are a typed
 * child table and OQ-41-gated (contract §10.6/§24; Task 10.4 implements none).
 */

import {
  canonicalizeAmount,
  isZeroAmount,
  sumAmounts,
  validateEnteredAmount,
} from './money.js';

/** A voucher below this many lines can never be balanced (§13.1). */
export const MIN_ACCOUNTING_DOCUMENT_LINES = 2;

/** One line as the domain composes it (amounts are exact decimal strings). */
export interface AccountingDocumentLineInput {
  /** 1-based, dense; assigned by the server, never trusted from a client. */
  lineNo: number;
  accountId: string;
  /** Non-negative `numeric(18,2)` decimal string. */
  debitAmount: string;
  /** Non-negative `numeric(18,2)` decimal string. */
  creditAmount: string;
  description: string | null;
  sourceLineReference: string | null;
}

export type AccountingDocumentLine = AccountingDocumentLineInput & {
  id: string;
  documentId: string;
};

export type VoucherLineProblem =
  /** Fewer than two lines: not a double-entry document. */
  | 'too_few_lines'
  /** No line carries a debit: nothing to balance the credits against. */
  | 'missing_debit_side'
  /** No line carries a credit. */
  | 'missing_credit_side'
  /** `Σ debit ≠ Σ credit` — compared exactly, never rounded (§13.1). */
  | 'unbalanced_document'
  /** A malformed or negative amount (§13.2). */
  | 'invalid_amount'
  /** Both sides zero — no accounting fact. */
  | 'zero_line'
  /** Both sides non-zero — that is two lines, not one. */
  | 'both_sides_set'
  /** `line_no` is not a positive integer. */
  | 'invalid_line_no'
  /** The same `line_no` appears twice. */
  | 'duplicate_line_no'
  /** Line numbers are not exactly 1..n (dense numbering, §12.5). */
  | 'gaps_in_line_numbers';

export function voucherLineProblemMessage(problem: VoucherLineProblem): string {
  switch (problem) {
    case 'too_few_lines':
      return `An accounting document needs at least ${MIN_ACCOUNTING_DOCUMENT_LINES} lines (a double-entry document has two sides).`;
    case 'missing_debit_side':
      return 'At least one line must carry a debit amount.';
    case 'missing_credit_side':
      return 'At least one line must carry a credit amount.';
    case 'unbalanced_document':
      return 'The document is unbalanced: the sum of debits must equal the sum of credits exactly.';
    case 'invalid_amount':
      return 'Line amounts must be non-negative decimals with at most 2 decimal places.';
    case 'zero_line':
      return 'A line must carry either a debit or a credit, not zero on both sides.';
    case 'both_sides_set':
      return 'A line carries either a debit or a credit, never both — a line with both is two lines.';
    case 'invalid_line_no':
      return 'Line numbers are 1-based positive integers.';
    case 'duplicate_line_no':
      return 'Line numbers must be unique within a document.';
    case 'gaps_in_line_numbers':
      return 'Line numbers must be dense: 1..n with no gaps.';
  }
}

/**
 * Assign the canonical `line_no` sequence to lines in submission order
 * (§12.5). The server owns this ordinal: a client-supplied order is the input,
 * a client-supplied number is never trusted.
 */
export function assignLineNumbers<T extends object>(
  lines: readonly T[],
): Array<T & { lineNo: number }> {
  return lines.map((line, index) => ({ ...line, lineNo: index + 1 }));
}

/**
 * Decide whether a set of lines is a valid double-entry composition.
 *
 * Returns EVERY problem found (not just the first) so one response can tell
 * the caller everything that is wrong with the submission.
 */
export function checkVoucherLines(
  lines: readonly AccountingDocumentLineInput[],
): VoucherLineProblem[] {
  const problems: VoucherLineProblem[] = [];
  if (lines.length < MIN_ACCOUNTING_DOCUMENT_LINES) {
    problems.push('too_few_lines');
  }
  problems.push(...checkLineNumbers(lines.map((line) => line.lineNo)));

  let hasDebit = false;
  let hasCredit = false;
  let malformed = false;
  for (const line of lines) {
    const debitProblem = validateEnteredAmount(line.debitAmount);
    const creditProblem = validateEnteredAmount(line.creditAmount);
    if (debitProblem !== null || creditProblem !== null) {
      malformed = true;
      continue;
    }
    const debitZero = isZeroAmount(line.debitAmount);
    const creditZero = isZeroAmount(line.creditAmount);
    if (debitZero && creditZero) problems.push('zero_line');
    if (!debitZero && !creditZero) problems.push('both_sides_set');
    if (!debitZero) hasDebit = true;
    if (!creditZero) hasCredit = true;
  }
  if (malformed) {
    // A malformed amount makes the side/balance verdicts meaningless: report
    // the shape problem instead of a derived one.
    problems.push('invalid_amount');
    problems.push(...checkVoucherBalance(lines));
    return dedupe(problems);
  }
  if (!hasDebit) problems.push('missing_debit_side');
  if (!hasCredit) problems.push('missing_credit_side');
  problems.push(...checkVoucherBalance(lines));
  return dedupe(problems);
}

/**
 * The balance verdict alone (§13.1): `Σ debit = Σ credit` exactly, with
 * both sides present. Used by the finalization transaction, which re-checks
 * the STORED lines under the document lock.
 */
export function checkVoucherBalance(
  lines: readonly Pick<
    AccountingDocumentLineInput,
    'debitAmount' | 'creditAmount'
  >[],
): VoucherLineProblem[] {
  const problems: VoucherLineProblem[] = [];
  if (lines.length < MIN_ACCOUNTING_DOCUMENT_LINES) {
    problems.push('too_few_lines');
  }
  if (lines.some((line) => !isWellFormedAmount(line.debitAmount))) {
    problems.push('invalid_amount');
  }
  if (lines.some((line) => !isWellFormedAmount(line.creditAmount))) {
    problems.push('invalid_amount');
  }
  if (problems.includes('invalid_amount')) return dedupe(problems);

  const totalDebit = sumAmounts(lines.map((line) => line.debitAmount));
  const totalCredit = sumAmounts(lines.map((line) => line.creditAmount));
  // A zero total on a side means the side does not exist: every amount is
  // non-negative, so a positive total is exactly "at least one line here".
  if (isZeroAmount(totalDebit)) problems.push('missing_debit_side');
  if (isZeroAmount(totalCredit)) problems.push('missing_credit_side');
  if (canonicalizeAmount(totalDebit) !== canonicalizeAmount(totalCredit)) {
    problems.push('unbalanced_document');
  }
  return dedupe(problems);
}

/** The exact totals of a line set (canonical decimal strings). */
export function voucherTotals(
  lines: readonly Pick<
    AccountingDocumentLineInput,
    'debitAmount' | 'creditAmount'
  >[],
): { totalDebit: string; totalCredit: string; balanced: boolean } {
  const totalDebit = sumAmounts(lines.map((line) => line.debitAmount));
  const totalCredit = sumAmounts(lines.map((line) => line.creditAmount));
  return {
    totalDebit,
    totalCredit,
    balanced:
      canonicalizeAmount(totalDebit) === canonicalizeAmount(totalCredit),
  };
}

/**
 * Dense 1-based line numbering (§12.5): every ordinal `1..n` appears exactly
 * once, whatever the submission order was.
 */
export function checkLineNumbers(
  lineNumbers: readonly number[],
): VoucherLineProblem[] {
  const problems: VoucherLineProblem[] = [];
  const seen = new Set<number>();
  for (const lineNo of lineNumbers) {
    if (!Number.isInteger(lineNo) || lineNo < 1) {
      problems.push('invalid_line_no');
      continue;
    }
    if (seen.has(lineNo)) problems.push('duplicate_line_no');
    seen.add(lineNo);
  }
  if (problems.length > 0) return dedupe(problems);
  for (let expected = 1; expected <= lineNumbers.length; expected += 1) {
    if (!seen.has(expected)) {
      problems.push('gaps_in_line_numbers');
      break;
    }
  }
  return dedupe(problems);
}

function isWellFormedAmount(value: string): boolean {
  return validateEnteredAmount(value) === null;
}

function dedupe<T>(problems: readonly T[]): T[] {
  return [...new Set(problems)];
}
