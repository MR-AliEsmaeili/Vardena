/**
 * Ledger movement — the REPORTING-facing shape of an immutable ledger entry
 * (Task 17A, contract §19.1/§19.2 AC-D-30, §13, §15.2).
 *
 * WHAT THIS FILE IS
 *
 * The pure projection of one `LedgerEntry` onto the read-source contract that
 * Accounting exposes to future reports: account ledger / general ledger /
 * subsidiary ledger / account-movement inquiries, and — later, separately
 * authorized — trial-balance inputs.
 *
 * WHAT IT DELIBERATELY IS NOT
 *
 * - NOT a second accounting truth. A movement is 1:1 with a ledger entry: no
 *   derived row, no book entry, no aggregation, no snapshot table. Nothing here
 *   can disagree with the ledger, because there is nothing to disagree with.
 * - NOT a report layout. No journal/general/subsidiary/detail legal-book
 *   column set, no grouping, no subtotals, no statement classification: those
 *   are gated by OQ-25/OQ-43 and are not this slice's authority to invent.
 * - NOT a join surface. The row carries ledger-native columns only; account
 *   code/title, fiscal-year/period codes, the voucher header's correction
 *   linkage and every other entity stay OUT (their IDs are returned, so a
 *   consumer can resolve them through the owning read API without this source
 *   re-deriving anything). No account classification is inferred, because the
 *   current chart carries no authoritative one (§8.3: `account_type` /
 *   `is_temporary` are OQ-25-gated and NOT stored).
 * - NOT multi-currency. No currency/rate/exchange column exists yet (§24.1,
 *   OQ-03 → base-currency-only `numeric(18,2)` amounts), so no currency field
 *   is invented here.
 * - NOT a balance. Running balances and opening/closing are the Task 12
 *   projection's / the consumer's concern (§19.3 AC-D-31), never a column of
 *   the immutable ledger row.
 *
 * POSTED-ONLY BY CONSTRUCTION (contract §15.1/§15.2, AC-I-05/06)
 *
 * There is no "posted" flag to filter on and no draft movement to exclude:
 * `accounting.ledger_entries` rows are materialized ONLY by
 * `finalizeChecked`, inside the same transaction that moves the voucher to
 * `final`. A `draft` or `temporary` voucher therefore has zero entries, and
 * the movement source reads the immutable posted evidence only. A source
 * `status` filter would have to invent a lifecycle the ledger does not have.
 *
 * DECIMAL EXACTNESS (§13.1/§13.5, AC-I-07)
 *
 * Debit and credit travel as canonical decimal STRINGS taken from the stored
 * `numeric(18,2)` — the same representation the domain already guarantees for
 * every ledger entry. Nothing in this file parses, rounds, sums or converts
 * them to a JS number: float arithmetic on money is forbidden in this
 * repository, and a movement list has no authority to compute anyway.
 *
 * Framework-free (AR-05): pure types and functions, no Nest, no Prisma, no HTTP.
 */

import { formatDateOnly } from './date-range.js';
import { canonicalizeAmount } from './money.js';
import type { LedgerEntry } from './ledger-entry.js';

/**
 * One posted ledger movement as the read source returns it.
 *
 * Identity: `id` is the ledger entry's own immutable ULID (never the voucher's
 * and never the posting-operation's). Traceability: `voucherId` +
 * `voucherLineId` (the 1:1 key) + `voucherNumber` + `lineNo` let any consumer
 * reach the originating voucher and line without re-reading mutable state.
 */
export interface LedgerMovementDto {
  /** Ledger entry identity (immutable ULID). */
  id: string;
  /** Tenant scope (AC-I-01) — always the requested, authorized organization. */
  organizationId: string;
  /** Bookkeeping scope (AC-D-02/03). */
  financialAreaId: string;
  /** Stored fiscal-year resolution (AC-I-14 — never recomputed from a date). */
  fiscalYearId: string;
  /** Stored accounting-period resolution (AC-I-14). */
  accountingPeriodId: string;
  /** Source voucher identity (AC-I-14). */
  voucherId: string;
  /** Numeric-only serial snapshot, immutable after final (§18, AC-I-22). */
  voucherNumber: string;
  /** Source voucher line identity — the 1:1 traceability key. */
  voucherLineId: string;
  /** 1-based dense rendering order inside the voucher (§12.5). */
  lineNo: number;
  /** Postable account reference (AC-I-09). */
  accountId: string;
  /** Non-negative exact decimal string, `numeric(18,2)` (§13.1). */
  debitAmount: string;
  /** Non-negative exact decimal string, `numeric(18,2)` (§13.1). */
  creditAmount: string;
  /** Optional line narration (the header narration is NOT copied here). */
  description: string | null;
  /** Business/occurrence date, `YYYY-MM-DD` (date-only, §12.3). */
  documentDate: string;
  /**
   * System timestamp of the posting act (when the voucher became final,
   * §15.5) — distinct from the business date, never a substitute for it.
   */
  postingTimestamp: string;
  /** `manual` | `system` (closed code-defined list, §16.1/AC-D-24). */
  origin: string;
  /** System-origin source identity snapshot (§16.3); null for `manual`. */
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  sourceOperation: string | null;
}

/**
 * Map one ledger entry to the movement row.
 *
 * The mapping is a projection, not a recalculation: amounts are canonicalized
 * (the existing domain rule, `numeric(18,2)` → trim trailing zeros the way
 * every Accounting read does) and dates are rendered with the module's
 * date-only rule (`formatDateOnly`, UTC — never a local-time accessor).
 */
export function toLedgerMovementDto(entry: LedgerEntry): LedgerMovementDto {
  return {
    id: entry.id,
    organizationId: entry.organizationId,
    financialAreaId: entry.financialAreaId,
    fiscalYearId: entry.fiscalYearId,
    accountingPeriodId: entry.accountingPeriodId,
    voucherId: entry.voucherId,
    voucherNumber: entry.voucherNumber,
    voucherLineId: entry.voucherLineId,
    lineNo: entry.lineNo,
    accountId: entry.accountId,
    debitAmount: canonicalizeAmount(entry.debitAmount),
    creditAmount: canonicalizeAmount(entry.creditAmount),
    description: entry.description,
    documentDate: formatDateOnly(entry.documentDate),
    postingTimestamp: entry.postingTimestamp.toISOString(),
    origin: entry.origin,
    sourceModule: entry.source?.module ?? null,
    sourceEntityType: entry.source?.entityType ?? null,
    sourceEntityId: entry.source?.entityId ?? null,
    sourceOperation: entry.source?.operation ?? null,
  };
}
