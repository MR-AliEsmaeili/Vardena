import type { BusinessDate } from '../../../kernel/datetime/business-date.js';
import {
  dateOnlyRangesOverlap,
  formatDateOnly,
  isValidDateOnlyRange,
  type DateOnlyRange,
} from './date-range.js';

/**
 * Fiscal Year — an explicit dated year inside one financial area
 * (contract §6, AC-I-03/AC-I-04, ADR-0026 §2).
 *
 * A year is a configured row with explicit inclusive dates — never a
 * computed calendar year. Contiguity is NOT required (shortened,
 * 16-month and non-calendar-aligned years are expressible); non-overlap
 * within one (organization, area) IS required and is refused with 422.
 *
 * Lifecycle (contract §6.3): `open → closed → sealed`, with explicit
 * `reopen` (closed → open) and `unseal` (sealed → closed) operations.
 * There is no `initial` and no `void` state. Status changes are explicit,
 * permission-gated, reasoned and audited operations — never side effects
 * of posting and never derived from period statuses.
 *
 * Framework-free (AR-05): pure rules, unit-tested.
 */

/** Closed code-defined list (contract §6.1); stored as TEXT. */
export const FISCAL_YEAR_STATUSES = ['open', 'closed', 'sealed'] as const;

export type FiscalYearStatus = (typeof FISCAL_YEAR_STATUSES)[number];

export function isFiscalYearStatus(value: string): value is FiscalYearStatus {
  return (FISCAL_YEAR_STATUSES as readonly string[]).includes(value);
}

export interface FiscalYear {
  id: string;
  organizationId: string;
  financialAreaId: string;
  code: string;
  title: string;
  startDate: BusinessDate;
  endDate: BusinessDate;
  status: FiscalYearStatus;
  isActive: boolean;
  priorYearId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FiscalYearDto {
  id: string;
  organizationId: string;
  financialAreaId: string;
  code: string;
  title: string;
  startDate: string;
  endDate: string;
  status: FiscalYearStatus;
  isActive: boolean;
  priorYearId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toFiscalYearDto(year: FiscalYear): FiscalYearDto {
  return {
    id: year.id,
    organizationId: year.organizationId,
    financialAreaId: year.financialAreaId,
    code: year.code,
    title: year.title,
    startDate: formatDateOnly(year.startDate),
    endDate: formatDateOnly(year.endDate),
    status: year.status,
    isActive: year.isActive,
    priorYearId: year.priorYearId,
    createdAt: year.createdAt.toISOString(),
    updatedAt: year.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Date-range rules (pure, unit-tested)
// ---------------------------------------------------------------------------

export type FiscalYearRangeProblem =
  /** `endDate` is before `startDate`. */
  | 'invalid_range'
  /** The range overlaps another year of the same (organization, area). */
  | 'overlapping_year';

export interface FiscalYearRangeCheck {
  problem: FiscalYearRangeProblem | null;
  /** The conflicting year, when the problem is `overlapping_year`. */
  conflictingId: string | null;
}

/**
 * Decide whether a candidate year range fits the existing years of the
 * same (organization, area).
 *
 * Rules, in order (contract §6.2, AC-I-03):
 * 1. `endDate` must be on or after `startDate` (inclusive bounds — a
 *    zero-length year is well-formed, if unusual).
 * 2. The range must not overlap any existing year of the scope. Touching
 *    ranges do not overlap (inclusive test in `date-range.ts`).
 *
 * `excludeId` skips one year (the date edit path re-validates the edited
 * year against its siblings, never against itself).
 */
export function checkFiscalYearRange(params: {
  candidate: DateOnlyRange;
  existing: ReadonlyArray<{ id: string } & DateOnlyRange>;
  excludeId?: string | null;
}): FiscalYearRangeCheck {
  const { candidate, existing } = params;
  const excludeId = params.excludeId ?? null;
  if (!isValidDateOnlyRange(candidate)) {
    return { problem: 'invalid_range', conflictingId: null };
  }
  for (const year of existing) {
    if (excludeId !== null && year.id === excludeId) continue;
    if (dateOnlyRangesOverlap(candidate, year)) {
      return { problem: 'overlapping_year', conflictingId: year.id };
    }
  }
  return { problem: null, conflictingId: null };
}

// ---------------------------------------------------------------------------
// Lifecycle rules (pure, unit-tested)
// ---------------------------------------------------------------------------

/** The four explicit year operations (contract §6.3/§6.6). */
export type FiscalYearTransition = 'close' | 'reopen' | 'seal' | 'unseal';

export interface FiscalYearTransitionPlan {
  /** The status the transition moves to — `null` when refused. */
  to: FiscalYearStatus | null;
}

/**
 * Plan one lifecycle step. Only these moves exist (contract §6.3):
 *
 *   close:  open   → closed
 *   reopen: closed → open
 *   seal:   closed → sealed
 *   unseal: sealed → closed
 *
 * Anything else (open → sealed, sealed → open, any step from/to the same
 * status) is refused — there is no skipping, no reopen-to-sealed, and no
 * automatic transition. Cross-row guards (seal requires no open periods,
 * close cascades to open periods) live in the application transaction, not
 * here: this function decides the single-row move only.
 */
export function planFiscalYearTransition(
  from: FiscalYearStatus,
  transition: FiscalYearTransition,
): FiscalYearTransitionPlan {
  switch (transition) {
    case 'close':
      return { to: from === 'open' ? 'closed' : null };
    case 'reopen':
      return { to: from === 'closed' ? 'open' : null };
    case 'seal':
      return { to: from === 'closed' ? 'sealed' : null };
    case 'unseal':
      return { to: from === 'sealed' ? 'closed' : null };
  }
}
