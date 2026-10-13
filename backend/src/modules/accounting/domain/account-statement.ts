/**
 * Account Statement — the bounded, read-only account-movement inquiry
 * (Task 17B Account Statement slice, contract §19 AC-D-30/AC-D-31, §13/§15,
 * ADR-0031 §2/§4/§9; Owner decisions D1–D7 in `task-17b-prompt.md` §4).
 *
 * WHAT THIS FILE IS
 *
 * The pure statement semantics behind «این حساب چه گردشی داشته است؟»: for ONE
 * postable account, ONE fiscal year and an optional accounting period, derive
 * the debit-positive statement measures from immutable ledger facts —
 *
 *     opening + Σ(debit − credit) = net movement; opening + net = closing
 *
 * — and stamp each movement row with its net (`debit − credit`) and running
 * balance (`opening + Σ net` of every earlier row in the statement order).
 * Everything here is framework-free exact-decimal arithmetic (AR-05, §13.1/
 * §13.5): amounts are canonical decimal STRINGS summed on BigInt mantissas,
 * never JS numbers.
 *
 * WHAT IT DELIBERATELY IS NOT
 *
 * - NOT a second accounting truth. The inputs are one ledger entry per
 *   movement row plus exact aggregates the caller measured over the SAME
 *   ledger predicate. Nothing is persisted: no report snapshot, no cached
 *   balance (AC-D-31/AC-I-19).
 * - NOT the Task 17A movement source. `GET /api/v1/accounting/ledger-movements`
 *   lists raw rows; this adds the account-level calculation (opening, net,
 *   running, closing) over a FIXED one-account/one-year window.
 * - NOT a report layout or a legal book. No journal/general/subsidiary/detail
 *   column set, no captions, no grouping, no subtotals beyond the single
 *   window's totals — those stay gated by OQ-25/OQ-43 (Owner decision D3:
 *   Debit / Credit / Net only).
 * - NOT nature-aware. `account_nature` is NOT consulted: credit-nature
 *   balances appear NEGATIVE under the debit-positive convention (decision
 *   D3 excludes nature/classification presentation until OQ-25).
 * - NOT cross-year. The opening basis is intra-fiscal-year only (decision D2;
 *   ADR-0031 §9): a whole-year statement opens at `0`, a period statement
 *   opens at the exact sum of the lower-SEQUENCE periods of the SAME fiscal
 *   year. Prior-year closing, brought-forward and opening-voucher semantics
 *   are deliberately not invented (OQ-23).
 *
 * SIGN CONVENTION (Owner decision D3; `task-17b-investigation.md` Q5)
 *
 * `debit-positive`: `net = debit − credit`, `closing = opening + net`. The
 * convention is echoed on every response (`signConvention`), so a reader can
 * never mistake a credit-nature account's negative running balance for an
 * error. Rounding does not exist here: every operation is exact and every
 * result is canonical (`12.50` → `12.5`, `-0` → `0`).
 */

import type { BusinessDate } from '../../../kernel/datetime/business-date.js';
import { formatDateOnly } from './date-range.js';
import { canonicalizeAmount, subtractAmounts, sumAmounts } from './money.js';
import type { LedgerEntry } from './ledger-entry.js';
import {
  toLedgerMovementDto,
  type LedgerMovementDto,
} from './ledger-movement.js';

// ---------------------------------------------------------------------------
// Disclosures — closed, code-defined values echoed on every statement
// ---------------------------------------------------------------------------

/** `net = debit − credit`; `closing = opening + net`. Never inferred. */
export const ACCOUNT_STATEMENT_SIGN_CONVENTION = 'debit-positive';

/**
 * The opening basis, declared so a statement can never be misread as a
 * carried-forward balance (decision D2; ADR-0031 §9). A year-start opening is
 * `0` unless vouchers were posted inside that year — those appear as ordinary
 * movement rows, never as "opening".
 */
export const ACCOUNT_STATEMENT_OPENING_BASIS = 'intra-fiscal-year';

/**
 * The fixed statement order (`documentDate, voucherNumber, lineNo, id`, the
 * Task 17A legal-book default, terminated by the unique entry id). The order
 * is TOTAL and is not client-selectable: the running balance depends on it.
 */
export const ACCOUNT_STATEMENT_ORDER_BASIS =
  'documentDate,voucherNumber,lineNo,id';

// ---------------------------------------------------------------------------
// Scope echo — identity and labels only (never classification, never nature)
// ---------------------------------------------------------------------------

/** Account identity + labels from the existing chart (`code`/`title`, §8). */
export interface AccountStatementAccountRef {
  id: string;
  code: string;
  title: string;
}

/** Financial-area identity + labels (the bookkeeping scope, AC-D-02/03). */
export interface AccountStatementAreaRef {
  id: string;
  code: string;
  title: string;
}

/** Fiscal-year identity, labels, bounds and status (§6.1/§6.3). */
export interface AccountStatementYearRef {
  id: string;
  code: string;
  title: string;
  /** `YYYY-MM-DD` inclusive bound. */
  startDate: string;
  /** `YYYY-MM-DD` inclusive bound. */
  endDate: string;
  /** `open` | `closed` | `sealed` — echoed, never re-validated (decision D5). */
  status: string;
}

/** Period identity, labels, bounds and status (§7.1/§7.2). */
export interface AccountStatementPeriodRef {
  id: string;
  /** 1-based ordinal inside the year — the opening-order key (ADR-0031 §4). */
  sequence: number;
  title: string;
  /** `YYYY-MM-DD` inclusive bound. */
  startDate: string;
  /** `YYYY-MM-DD` inclusive bound. */
  endDate: string;
  /** `open` | `closed` | `sealed` — echoed, never re-validated (decision D5). */
  status: string;
}

/** The header/scope section of the statement (prompt §8 "Header / scope"). */
export interface AccountStatementScope {
  organizationId: string;
  financialArea: AccountStatementAreaRef;
  fiscalYear: AccountStatementYearRef;
  account: AccountStatementAccountRef;
  /** `null` for a whole-year statement. */
  accountingPeriod: AccountStatementPeriodRef | null;
}

// ---------------------------------------------------------------------------
// Rows and totals
// ---------------------------------------------------------------------------

/**
 * One statement movement row: the accepted Task 17A movement fields, plus the
 * two derived measures (prompt §8 "Movement rows"). `netAmount` is signed
 * (`debit − credit`); `runningBalanceAmount` is `opening + Σ net` of every
 * row up to and including this one, across the WHOLE ordered window (not just
 * the current page).
 */
export interface AccountStatementEntry extends LedgerMovementDto {
  netAmount: string;
  runningBalanceAmount: string;
}

/** The totals section (prompt §8 "Totals"). All exact decimal strings. */
export interface AccountStatementTotals {
  openingBalanceAmount: string;
  debitTotalAmount: string;
  creditTotalAmount: string;
  netChangeAmount: string;
  closingBalanceAmount: string;
}

/**
 * The bounded read model of the statement: scope echo, paginated movement
 * rows, scope-wide totals and the three disclosure constants. The totals are
 * computed over the SAME scope predicate as the rows — never over the current
 * page (prompt §13).
 */
export interface AccountStatementDto {
  scope: AccountStatementScope;
  movements: {
    items: AccountStatementEntry[];
    total: number;
    page: number;
    pageSize: number;
  };
  totals: AccountStatementTotals;
  signConvention: typeof ACCOUNT_STATEMENT_SIGN_CONVENTION;
  openingBasis: typeof ACCOUNT_STATEMENT_OPENING_BASIS;
  orderBasis: typeof ACCOUNT_STATEMENT_ORDER_BASIS;
}

// ---------------------------------------------------------------------------
// Pure derivation
// ---------------------------------------------------------------------------

/**
 * The row's net movement: `debit − credit`, exact and signed.
 *
 * Entered amounts stay non-negative (§13.2 — the side comes from the column);
 * the SIGN here is the statement presentation, not a negated posting.
 */
export function netAmountOf(debitAmount: string, creditAmount: string): string {
  return subtractAmounts(debitAmount, creditAmount);
}

/**
 * Stamp one ordered page of ledger entries with net and running balance.
 *
 * `runningBase` is `opening + Σ net` of every window row BEFORE this page
 * (the caller measures it over the same predicate and order), so a row's
 * running balance is identical no matter which page it lands on — the pages
 * of one statement read as one continuous account history.
 */
export function buildStatementEntries(
  entries: readonly LedgerEntry[],
  runningBase: string,
): AccountStatementEntry[] {
  let running = runningBase;
  return entries.map((entry) => {
    const netAmount = netAmountOf(entry.debitAmount, entry.creditAmount);
    running = sumAmounts([running, netAmount]);
    return {
      ...toLedgerMovementDto(entry),
      netAmount,
      runningBalanceAmount: running,
    };
  });
}

/**
 * Build the totals of the whole window and verify the closing identity
 * (`closing = opening + net`) exactly. The debit/credit totals are the
 * caller's exact window aggregates over the SAME predicate as the rows —
 * never a page sum (prompt §13).
 *
 * @throws Error when the identity does not hold (a programmer error in the
 *   caller's arithmetic — surfaced loudly rather than rendered).
 */
export function buildStatementTotals(input: {
  openingBalanceAmount: string;
  debitTotalAmount: string;
  creditTotalAmount: string;
}): AccountStatementTotals {
  const openingBalanceAmount = canonicalizeAmount(input.openingBalanceAmount);
  const debitTotalAmount = canonicalizeAmount(input.debitTotalAmount);
  const creditTotalAmount = canonicalizeAmount(input.creditTotalAmount);
  const netChangeAmount = netAmountOf(debitTotalAmount, creditTotalAmount);
  const closingBalanceAmount = sumAmounts([
    openingBalanceAmount,
    netChangeAmount,
  ]);
  return {
    openingBalanceAmount,
    debitTotalAmount,
    creditTotalAmount,
    netChangeAmount,
    closingBalanceAmount,
  };
}

/**
 * Assemble the complete statement (scope echo + rows + totals + disclosures).
 *
 * The closing identity and — when the page covers the whole window — the
 * last-row running balance are asserted here, so a statement can never be
 * serialized with arithmetic that disagrees with §8/§9.
 */
export function buildAccountStatement(input: {
  scope: AccountStatementScope;
  entries: readonly LedgerEntry[];
  runningBase: string;
  windowTotal: number;
  page: number;
  pageSize: number;
  openingBalanceAmount: string;
  debitTotalAmount: string;
  creditTotalAmount: string;
}): AccountStatementDto {
  const items = buildStatementEntries(input.entries, input.runningBase);
  const totals = buildStatementTotals({
    openingBalanceAmount: input.openingBalanceAmount,
    debitTotalAmount: input.debitTotalAmount,
    creditTotalAmount: input.creditTotalAmount,
  });
  const last = items[items.length - 1];
  const coversWholeWindow =
    input.entries.length > 0 && items.length === input.windowTotal;
  if (coversWholeWindow && last !== undefined) {
    if (last.runningBalanceAmount !== totals.closingBalanceAmount) {
      throw new Error(
        'Account statement closing identity failed: the last running balance ' +
          `(${last.runningBalanceAmount}) must equal the closing balance ` +
          `(${totals.closingBalanceAmount}).`,
      );
    }
  }
  return {
    scope: input.scope,
    movements: {
      items,
      total: input.windowTotal,
      page: input.page,
      pageSize: input.pageSize,
    },
    totals,
    signConvention: ACCOUNT_STATEMENT_SIGN_CONVENTION,
    openingBasis: ACCOUNT_STATEMENT_OPENING_BASIS,
    orderBasis: ACCOUNT_STATEMENT_ORDER_BASIS,
  };
}

// ---------------------------------------------------------------------------
// Scope rendering (labels and dates of existing Accounting master data only)
// ---------------------------------------------------------------------------

export function renderAreaRef(area: {
  id: string;
  code: string;
  title: string;
}): AccountStatementAreaRef {
  return { id: area.id, code: area.code, title: area.title };
}

export function renderAccountRef(account: {
  id: string;
  code: string;
  title: string;
}): AccountStatementAccountRef {
  return { id: account.id, code: account.code, title: account.title };
}

export function renderYearRef(year: {
  id: string;
  code: string;
  title: string;
  startDate: BusinessDate;
  endDate: BusinessDate;
  status: string;
}): AccountStatementYearRef {
  return {
    id: year.id,
    code: year.code,
    title: year.title,
    startDate: formatDateOnly(year.startDate),
    endDate: formatDateOnly(year.endDate),
    status: year.status,
  };
}

export function renderPeriodRef(period: {
  id: string;
  sequence: number;
  title: string;
  startDate: BusinessDate;
  endDate: BusinessDate;
  status: string;
}): AccountStatementPeriodRef {
  return {
    id: period.id,
    sequence: period.sequence,
    title: period.title,
    startDate: formatDateOnly(period.startDate),
    endDate: formatDateOnly(period.endDate),
    status: period.status,
  };
}
