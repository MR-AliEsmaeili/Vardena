/**
 * Ledger Entry contract — the immutable historical accounting evidence
 * that the future Posting Engine will materialize (Task 10.6,
 * contract §12/§13/§15/§19, AC-D-16…AC-D-23, AC-D-30/31, AC-I-05/06/07/08/14/19).
 *
 * WHAT THIS FILE IS
 *
 * A framework-free, deterministic, testable CONTRACT for the future ledger.
 * It defines the MINIMUM invariant set a ledger entry must carry, derived
 * ONLY from the accepted domain contract — no invented statutory, dimension
 * or multi-company semantics (OQ-39…OQ-43 remain open and are explicitly
 * deferred).
 *
 * RELATIONSHIP (contract §12.5/§15.5/§19.2)
 *
 * ```
 * AccountingDocument (final, immutable, numbered)
 *   1
 *   │ posting (finalization is the act that makes the voucher part of the books,
 *   │          §15.5 AC-D-23 — no separate `posted` state, see posting.ts)
 *   ▼
 * LedgerEntry
 *   N   (one per voucher line, preserving traceability)
 * ```
 *
 * - One finalized voucher produces N ledger entries, where N = number of
 *   lines (≥2, §13.1). Each line maps to exactly ONE entry, so
 *   VoucherLine 1 → 1 LedgerEntry and the original line identity is retained.
 * - A voucher can be posted at most once: the posting operation identity is
 *   the existing `accounting_posting_operations` row for `document_finalize`
 *   (§16.4 AC-I-12). A retry replays the stored result (re-reading current
 *   rows), never creating a second set of entries.
 * - Correction/reversal (AC-D-22, AC-I-15) creates NEW vouchers and therefore
 *   NEW ledger entries; original entries remain immutable.
 *
 * IMMUTABILITY (contract §15.2/§15.3, AC-I-05/06, AC-I-19)
 *
 * - Final voucher header: immutable (no field, date, number or period change)
 * - Voucher lines: immutable (no edit, no delete)
 * - Posting record (`accounting_posting_operations`): append-only, never
 *   updated/deleted
 * - Ledger entries: immutable, never updated/deleted, rebuildable only via
 *   explicit audited maintenance that re-derives from final lines (the
 *   Inventory `Reconciliation.Execute` precedent, §19.3 AC-D-31/AC-I-19)
 *
 * WHAT MUST BE RETAINED PERMANENTLY (AC-D-35, §23)
 *
 * - organization, financial area, fiscal year, period resolution (AC-I-02/14)
 * - voucher identity + number (AC-I-22, §18)
 * - voucher line identity + rendering order (lineNo, §12.5)
 * - account reference (AC-I-09)
 * - debit/credit amounts (AC-I-07/08)
 * - line description (if any)
 * - origin + logical source identity (AC-D-24/25, §16.3) + correlation
 * - finalization evidence (finalized_at/by, §15.5)
 * - numbering allocation evidence (via voucher number, §18)
 *
 * WHAT IS DEFERRED (OQ-41 dimensions, OQ-40 area applicability, OQ-43
 * statutory, OQ-39 delivery, OQ-42 approval)
 *
 * - Dimensions: the contract MUST carry dimensions when OQ-41 is resolved,
 *   but the dimension model is unresolved. The seam is therefore
 *   extension-capable: `dimensionAssignments` is defined as an optional
 *   readonly array of a deferred type, defaulting to empty. No fixed
 *   `detail_1_id` columns, no EAV, no JSONB (contract §10.6, §3.3).
 * - Financial area applicability: per-account area applicability (§14 rule 1)
 *   is OQ-40-gated; no applicability table is invented. The ledger entry
 *   carries `financialAreaId` as the book scope (AC-D-02/03) and nothing more.
 * - Statutory/e-ledger (OQ-43): no legal rule is hardcoded. The entry keeps
 *   BOTH business date (`documentDate`) and system timestamp
 *   (`postingTimestamp` = `finalizedAt`) so any entry-timing rule is
 *   measurable (Class C3), and keeps branch as scope column (Class C5).
 * - Delivery (OQ-39): system-origin ledger entries inherit the source
 *   identity but no durable delivery semantics are invented.
 * - Approval (OQ-42): no approval state is added; finalization is the
 *   posting act and `Finalize` ≠ `Approve` (§22).
 *
 * BALANCE PROJECTIONS (contract §19.3, AC-D-31, AC-I-19)
 *
 * Future balance consumers are allowed to consume ONLY:
 * - Final document lines (or ledger entries derived from them) as the
 *   authoritative source of truth
 * - Materialized balances per (organization, financial area, fiscal year,
 *   period, account) — and, where dimension reporting demands it, per
 *   dimension — that are rebuildable from final lines by an explicit audited
 *   operation
 *
 * They must NOT:
 * - read operational documents or other modules' tables (AR-07, AC-I-13)
 * - recompute accounting from business facts at report time
 * - treat balances as authoritative (balances are projection, ledger is truth)
 *
 * Framework-free (AR-05): pure types and functions, no Nest, no Prisma,
 * no HTTP.
 */

import { isZeroAmount, validateEnteredAmount } from './money.js';
import type { AccountingDocumentSource } from './accounting-document.js';

// ---------------------------------------------------------------------------
// Deferred dimension seam (OQ-41)
// ---------------------------------------------------------------------------

/**
 * Deferred dimension assignment seam.
 *
 * When OQ-41 is resolved, this will carry typed assignments
 * `(dimensionId, itemId)` validated against the account's compatibility.
 * Until then it is an empty, extension-capable array — no fixed columns,
 * no EAV, no JSONB (contract §10.6, task §17).
 *
 * The type is intentionally minimal: it records that dimensions MAY be
 * present, without choosing cardinality, requiredness or binding (OQ-41).
 */
export interface LedgerDimensionAssignment {
  /** The dimension identity (when OQ-41 defines it). */
  dimensionId: string;
  /** The detail item identity. */
  itemId: string;
}

// ---------------------------------------------------------------------------
// Ledger Entry
// ---------------------------------------------------------------------------

/** One immutable ledger entry — one voucher line posted to the books. */
export interface LedgerEntry {
  /** Immutable identity (ULID), never reused. */
  readonly id: string;
  /** Tenant scope (AC-I-01). */
  readonly organizationId: string;
  /** Bookkeeping scope (AC-D-02/03). */
  readonly financialAreaId: string;
  /** Stored fiscal year resolution (AC-I-02/14). */
  readonly fiscalYearId: string;
  /** Stored accounting period resolution (AC-I-02/14). */
  readonly accountingPeriodId: string;
  /** Source voucher identity (AC-I-14, traceability). */
  readonly voucherId: string;
  /** Numeric-only serial, immutable after final (AC-I-22, §18). */
  readonly voucherNumber: string;
  /** Source voucher line identity (Voucher Line → Ledger Entry traceability). */
  readonly voucherLineId: string;
  /** 1-based dense rendering order (legal-book order, §12.5). */
  readonly lineNo: number;
  /** Postable account reference (AC-I-09). */
  readonly accountId: string;
  /** Non-negative exact decimal, exactly one of debit/credit non-zero (AC-I-08). */
  readonly debitAmount: string;
  /** Non-negative exact decimal, exactly one of debit/credit non-zero (AC-I-08). */
  readonly creditAmount: string;
  /** Optional line narration. */
  readonly description: string | null;
  /** Business/occurrence date (date-only, §12.3, Class C3). */
  readonly documentDate: Date;
  /** System timestamp when voucher became final (posting timestamp, §15.5). */
  readonly postingTimestamp: Date;
  /** Optional operational scope dimension, header-level (AC-D-17, Class C5). */
  readonly branchId: string | null;
  /** Manual vs system origin (AC-D-24). */
  readonly origin: 'manual' | 'system';
  /** Logical source identity for system origin (AC-D-25, §16.3). */
  readonly source: AccountingDocumentSource | null;
  /** End-to-end traceability (architecture §9). */
  readonly correlationId: string | null;
  /** Actor who finalized the voucher (finalization evidence, §23). */
  readonly finalizedBy: string | null;
  /** Deferred dimension assignments (OQ-41 seam, see above). */
  readonly dimensionAssignments: readonly LedgerDimensionAssignment[];
}

/** Problems a ledger entry can have (machine-readable, stable). */
export type LedgerEntryProblem =
  | 'missing_id'
  | 'missing_organization'
  | 'missing_financial_area'
  | 'missing_fiscal_year'
  | 'missing_accounting_period'
  | 'missing_voucher_id'
  | 'missing_voucher_number'
  | 'missing_voucher_line_id'
  | 'invalid_line_no'
  | 'missing_account'
  | 'invalid_amount'
  | 'zero_line'
  | 'both_sides_set'
  | 'missing_document_date'
  | 'missing_posting_timestamp'
  | 'invalid_origin'
  | 'source_required_for_system'
  | 'source_forbidden_for_manual'
  | 'malformed_source';

export function ledgerEntryProblemMessage(problem: LedgerEntryProblem): string {
  switch (problem) {
    case 'missing_id':
      return 'Ledger entry requires an immutable identity.';
    case 'missing_organization':
      return 'Ledger entry requires an organization scope.';
    case 'missing_financial_area':
      return 'Ledger entry requires a financial area scope.';
    case 'missing_fiscal_year':
      return 'Ledger entry requires a fiscal year resolution.';
    case 'missing_accounting_period':
      return 'Ledger entry requires an accounting period resolution.';
    case 'missing_voucher_id':
      return 'Ledger entry requires a source voucher identity.';
    case 'missing_voucher_number':
      return 'Ledger entry requires a voucher number (numbering evidence).';
    case 'missing_voucher_line_id':
      return 'Ledger entry requires a source voucher line identity.';
    case 'invalid_line_no':
      return 'Ledger entry line number must be a positive integer (legal-book order).';
    case 'missing_account':
      return 'Ledger entry requires a postable account reference.';
    case 'invalid_amount':
      return 'Ledger entry amounts must be non-negative decimals with at most 2 decimal places.';
    case 'zero_line':
      return 'Ledger entry must carry either debit or credit, not zero on both sides.';
    case 'both_sides_set':
      return 'Ledger entry carries either debit or credit, never both.';
    case 'missing_document_date':
      return 'Ledger entry requires a business date (document date).';
    case 'missing_posting_timestamp':
      return 'Ledger entry requires a posting timestamp (finalized at).';
    case 'invalid_origin':
      return 'Ledger entry origin must be manual or system.';
    case 'source_required_for_system':
      return 'A system-origin ledger entry requires a source identity.';
    case 'source_forbidden_for_manual':
      return 'A manual ledger entry must not carry a system source identity.';
    case 'malformed_source':
      return 'Ledger entry source identity is malformed.';
  }
}

/**
 * Validate a ledger entry against the contract's minimum invariants.
 * Returns every problem found (checkVoucherLines convention), empty when valid.
 */
export function checkLedgerEntry(entry: LedgerEntry): LedgerEntryProblem[] {
  const problems: LedgerEntryProblem[] = [];

  if (entry.id.trim() === '') problems.push('missing_id');
  if (entry.organizationId.trim() === '') problems.push('missing_organization');
  if (entry.financialAreaId.trim() === '')
    problems.push('missing_financial_area');
  if (entry.fiscalYearId.trim() === '') problems.push('missing_fiscal_year');
  if (entry.accountingPeriodId.trim() === '')
    problems.push('missing_accounting_period');
  if (entry.voucherId.trim() === '') problems.push('missing_voucher_id');
  if (entry.voucherNumber.trim() === '')
    problems.push('missing_voucher_number');
  if (entry.voucherLineId.trim() === '')
    problems.push('missing_voucher_line_id');
  if (!Number.isInteger(entry.lineNo) || entry.lineNo < 1)
    problems.push('invalid_line_no');
  if (entry.accountId.trim() === '') problems.push('missing_account');

  const debitProblem = validateEnteredAmount(entry.debitAmount);
  const creditProblem = validateEnteredAmount(entry.creditAmount);
  if (debitProblem !== null || creditProblem !== null) {
    problems.push('invalid_amount');
  } else {
    const debitZero = isZeroAmount(entry.debitAmount);
    const creditZero = isZeroAmount(entry.creditAmount);
    if (debitZero && creditZero) problems.push('zero_line');
    if (!debitZero && !creditZero) problems.push('both_sides_set');
  }

  if (
    !(entry.documentDate instanceof Date) ||
    Number.isNaN(entry.documentDate.getTime())
  ) {
    problems.push('missing_document_date');
  }
  if (
    !(entry.postingTimestamp instanceof Date) ||
    Number.isNaN(entry.postingTimestamp.getTime())
  ) {
    problems.push('missing_posting_timestamp');
  }

  if (entry.origin !== 'manual' && entry.origin !== 'system') {
    problems.push('invalid_origin');
  } else {
    // Reuse the origin/source consistency rule from accounting-document.ts
    // but re-implemented here to keep this file self-contained and free of
    // cross-file hidden coupling — the rule is: manual has no source, system has one.
    if (entry.origin === 'manual' && entry.source !== null) {
      problems.push('source_forbidden_for_manual');
    }
    if (entry.origin === 'system' && entry.source === null) {
      problems.push('source_required_for_system');
    }
    if (entry.source !== null) {
      const src = entry.source;
      const tokenPattern = /^[a-z][a-z0-9_]{0,63}$/;
      const malformed =
        !tokenPattern.test(src.module) ||
        !tokenPattern.test(src.entityType) ||
        src.entityId.trim() === '' ||
        src.entityId.length > 128 ||
        !tokenPattern.test(src.operation) ||
        src.operation.length > 32;
      if (malformed) problems.push('malformed_source');
    }
  }

  return [...new Set(problems)];
}

/**
 * True when the ledger entry satisfies all minimum invariants.
 */
export function isValidLedgerEntry(entry: LedgerEntry): boolean {
  return checkLedgerEntry(entry).length === 0;
}
