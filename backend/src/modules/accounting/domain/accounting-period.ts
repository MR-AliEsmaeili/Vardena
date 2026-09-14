import {
  dateOnlyRangesOverlap,
  dateOnlyRangeWithin,
  formatDateOnly,
  isValidDateOnlyRange,
  type DateOnlyRange,
} from './date-range.js';

/**
 * Accounting Period — an explicit dated row inside exactly one fiscal year
 * (contract §7, AC-I-03/AC-I-04, ADR-0026 §2).
 *
 * Periods are rows, not computed months: the layout (12 monthly, 13, 4-4-5,
 * quarterly, a stub period) is data, and the layout policy is
 * expert-gated (OQ-23) — so Task 10.2 creates periods explicitly and builds
 * NO layout generator. Periods of one year never overlap and always lie
 * inside the year's range; gaps are permitted by the model (a date that
 * resolves to no period is refused at posting — and posting is out of
 * scope here).
 *
 * Several periods of one year may be open simultaneously: posting
 * validation checks the *resolved* period's status only, and "close all
 * periods" is the explicit year-level close, not an implicit side effect.
 *
 * Framework-free (AR-05): pure rules, unit-tested.
 */

/** Closed code-defined list (contract §7.1); stored as TEXT. */
export const ACCOUNTING_PERIOD_STATUSES = ['open', 'closed', 'sealed'] as const;

export type AccountingPeriodStatus =
  (typeof ACCOUNTING_PERIOD_STATUSES)[number];

export function isAccountingPeriodStatus(
  value: string,
): value is AccountingPeriodStatus {
  return (ACCOUNTING_PERIOD_STATUSES as readonly string[]).includes(value);
}

/**
 * v1 vocabulary: `normal` only. An adjustment/special period is an
 * EXPERT-GATED addition (OQ-23, contract §7.1) — the seam exists, the
 * value does not. Task 10.2 accepts no other value.
 */
export const ACCOUNTING_PERIOD_KINDS = ['normal'] as const;

export type AccountingPeriodKind = (typeof ACCOUNTING_PERIOD_KINDS)[number];

export interface AccountingPeriod {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  /** 1-based ordinal inside the year; unique per year. */
  sequence: number;
  title: string;
  startDate: Date;
  endDate: Date;
  status: AccountingPeriodStatus;
  periodKind: AccountingPeriodKind;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountingPeriodDto {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  sequence: number;
  title: string;
  startDate: string;
  endDate: string;
  status: AccountingPeriodStatus;
  periodKind: AccountingPeriodKind;
  createdAt: string;
  updatedAt: string;
}

export function toAccountingPeriodDto(
  period: AccountingPeriod,
): AccountingPeriodDto {
  return {
    id: period.id,
    organizationId: period.organizationId,
    financialAreaId: period.financialAreaId,
    fiscalYearId: period.fiscalYearId,
    sequence: period.sequence,
    title: period.title,
    startDate: formatDateOnly(period.startDate),
    endDate: formatDateOnly(period.endDate),
    status: period.status,
    periodKind: period.periodKind,
    createdAt: period.createdAt.toISOString(),
    updatedAt: period.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Date-range rules (pure, unit-tested)
// ---------------------------------------------------------------------------

export type AccountingPeriodRangeProblem =
  /** `endDate` is before `startDate`. */
  | 'invalid_range'
  /** The range is not fully inside the owning year's range. */
  | 'outside_year'
  /** The range overlaps another period of the same year. */
  | 'overlapping_period';

export interface AccountingPeriodRangeCheck {
  problem: AccountingPeriodRangeProblem | null;
  /** The conflicting period, when the problem is `overlapping_period`. */
  conflictingId: string | null;
}

/**
 * Decide whether a candidate period range fits its year.
 *
 * Rules, in order (contract §7.2, AC-I-03):
 * 1. `endDate` must be on or after `startDate`.
 * 2. The range must lie fully inside the owning year's range (bounds
 *    included — a period may start on the year's first day and end on
 *    its last day).
 * 3. The range must not overlap any existing period of the year.
 */
export function checkAccountingPeriodRange(params: {
  candidate: DateOnlyRange;
  year: DateOnlyRange;
  existing: ReadonlyArray<{ id: string } & DateOnlyRange>;
}): AccountingPeriodRangeCheck {
  const { candidate, year, existing } = params;
  if (!isValidDateOnlyRange(candidate)) {
    return { problem: 'invalid_range', conflictingId: null };
  }
  if (!dateOnlyRangeWithin(candidate, year)) {
    return { problem: 'outside_year', conflictingId: null };
  }
  for (const period of existing) {
    if (dateOnlyRangesOverlap(candidate, period)) {
      return { problem: 'overlapping_period', conflictingId: period.id };
    }
  }
  return { problem: null, conflictingId: null };
}

// ---------------------------------------------------------------------------
// Lifecycle rules (pure, unit-tested)
// ---------------------------------------------------------------------------

/** The three explicit period operations (contract §7.2, §22). */
export type AccountingPeriodTransition = 'close' | 'reopen' | 'seal';

export interface AccountingPeriodTransitionPlan {
  /** The status the transition moves to — `null` when refused. */
  to: AccountingPeriodStatus | null;
}

/**
 * Plan one lifecycle step. Only these moves exist (contract §7.2):
 *
 *   close:  open   → closed
 *   reopen: closed → open, sealed → open
 *   seal:   closed → sealed
 *
 * Notes on the two non-obvious cells:
 * - `sealed → open` via reopen is the operation contract §7.2 rule 4 names
 *   ("a period reopen … unless the year is unsealed first"): the year-level
 *   gate (refused while the year is sealed) lives in the application
 *   transaction, not here — this function decides the single-row move only.
 * - `open → sealed` does not exist: a period is closed before it is sealed,
 *   one explicit operation at a time.
 */
export function planAccountingPeriodTransition(
  from: AccountingPeriodStatus,
  transition: AccountingPeriodTransition,
): AccountingPeriodTransitionPlan {
  switch (transition) {
    case 'close':
      return { to: from === 'open' ? 'closed' : null };
    case 'reopen':
      return { to: from === 'open' ? null : 'open' };
    case 'seal':
      return { to: from === 'closed' ? 'sealed' : null };
  }
}
