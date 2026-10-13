/**
 * Accounting document reversal — invert debit/credit exactly (Task 15,
 * contract §15.4 AC-D-22, AC-I-15).
 *
 * A reversal is a NEW document. The original Final voucher is never mutated
 * except for the typed `reversed_by` link. Amounts are exact decimal strings
 * (never JS floats).
 *
 * Framework-free (AR-05).
 */

import type { AccountingDocumentLine } from './voucher-lines.js';
import { canonicalizeAmount } from './money.js';

export const CORRECTION_KIND_REVERSAL = 'reversal' as const;

export const ACCOUNTING_CORRECTION_KINDS = [CORRECTION_KIND_REVERSAL] as const;

export type AccountingCorrectionKind =
  (typeof ACCOUNTING_CORRECTION_KINDS)[number];

export function isAccountingCorrectionKind(
  value: string,
): value is AccountingCorrectionKind {
  return (ACCOUNTING_CORRECTION_KINDS as readonly string[]).includes(value);
}

export type ReversalEligibilityProblem =
  'not_final' | 'already_reversed' | 'not_accounting_document';

export function reversalEligibilityProblemMessage(
  problem: ReversalEligibilityProblem,
): string {
  switch (problem) {
    case 'not_final':
      return 'Only a finalized accounting document can be reversed.';
    case 'already_reversed':
      return 'The accounting document has already been reversed.';
    case 'not_accounting_document':
      return 'Only an accounting voucher can be reversed.';
  }
}

/**
 * Invert one stored line: debit ↔ credit, same account, same ordinal, same
 * description. Amounts are re-canonicalized so the stored spelling is the
 * exact `numeric(18,2)` representation.
 */
export function invertDocumentLine(line: AccountingDocumentLine): {
  lineNo: number;
  accountId: string;
  detailId: string | null;
  debitAmount: string;
  creditAmount: string;
  description: string | null;
  sourceLineReference: string | null;
} {
  return {
    lineNo: line.lineNo,
    accountId: line.accountId,
    detailId: line.detailId ?? null,
    debitAmount: canonicalizeAmount(line.creditAmount),
    creditAmount: canonicalizeAmount(line.debitAmount),
    description: line.description,
    sourceLineReference: line.sourceLineReference,
  };
}

export function invertDocumentLines(
  lines: readonly AccountingDocumentLine[],
): ReturnType<typeof invertDocumentLine>[] {
  return [...lines]
    .sort((left, right) => left.lineNo - right.lineNo)
    .map(invertDocumentLine);
}
