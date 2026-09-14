/**
 * In-memory stand-ins for the Accounting foundation repositories (test
 * support).
 *
 * Same purpose as the master-data fakes in `master-data-repositories.ts`:
 * the e2e suite runs the FULL HTTP stack — controllers, guards, real
 * application services, the real permission registry and its startup sync
 * — with no Postgres, no Docker and no Prisma codegen.
 *
 * What is faked and what is not:
 * - faked: the three accounting repositories and `PrismaService`;
 * - NOT faked: authorization checks, organization scoping, reference
 *   resolution, code/sequence uniqueness handling, date-range rules,
 *   lifecycle planning.
 *
 * The fakes honour the contracts the real repositories guarantee:
 * - the database failures the services map (unique violation `P2002`,
 *   missing row `P2025`);
 * - the guarded-transaction methods (`createChecked`, `updateChecked`,
 *   `transitionChecked`, `setDefaultChecked`, `disableChecked`) mirror the
 *   real transactions' observable effect and throw the SAME plain
 *   calendar errors, so one service mapping covers both paths. Locking has
 *   no observable effect in a single-threaded fake: what matters is that
 *   the guard evaluates against the committed rows and the write applies
 *   atomically, which a synchronous fake gives for free. True lock
 *   contention is covered by the live-database suite instead.
 *
 * Ordering is number-aware (period `sequence` sorts numerically, like the
 * database) and `search` mirrors the repositories' case-insensitive
 * `contains` clauses on code/title.
 */
import type { FinancialArea } from '../../src/modules/accounting/domain/financial-area.js';
import type { FiscalYear } from '../../src/modules/accounting/domain/fiscal-year.js';
import { checkFiscalYearRange } from '../../src/modules/accounting/domain/fiscal-year.js';
import type { AccountingPeriod } from '../../src/modules/accounting/domain/accounting-period.js';
import { checkAccountingPeriodRange } from '../../src/modules/accounting/domain/accounting-period.js';
import { dateOnlyRangeWithin } from '../../src/modules/accounting/domain/date-range.js';
import {
  AreaDisabledError,
  AreaHasOpenYearsError,
  FiscalYearNotEditableError,
  FiscalYearOverlapError,
  FiscalYearRangeExcludesPeriodsError,
  FiscalYearSealBlockedError,
  FiscalYearTransitionConflictError,
  PeriodOutsideYearError,
  PeriodOverlapError,
  PeriodTransitionConflictError,
  PeriodYearNotOpenError,
  PeriodYearNotUsableError,
  PeriodYearSealedError,
} from '../../src/modules/accounting/data/accounting-calendar-errors.js';
import type { FinancialAreasRepository } from '../../src/modules/accounting/data/financial-areas.repository.js';
import type { FiscalYearsRepository } from '../../src/modules/accounting/data/fiscal-years.repository.js';
import type { AccountingPeriodsRepository } from '../../src/modules/accounting/data/accounting-periods.repository.js';
import {
  InMemoryTable,
  type Row,
} from './master-data-repositories.js';
import { uniqueViolation } from './in-memory-repositories.js';

export type AccountingOrderBy = Array<Record<string, 'asc' | 'desc'>>;

interface ListParams {
  where: Record<string, unknown>;
  orderBy: AccountingOrderBy;
  skip: number;
  take: number;
}

/** The three tables in one state object: guards read across tables. */
export interface AccountingState {
  areas: InMemoryTable<FinancialArea>;
  years: InMemoryTable<FiscalYear>;
  periods: InMemoryTable<AccountingPeriod>;
}

export function createAccountingState(): AccountingState {
  return {
    areas: new InMemoryTable<FinancialArea>([['organizationId', 'code']]),
    years: new InMemoryTable<FiscalYear>([
      ['organizationId', 'financialAreaId', 'code'],
    ]),
    periods: new InMemoryTable<AccountingPeriod>([
      ['fiscalYearId', 'sequence'],
    ]),
  };
}

function matchesAccountingSearch(
  row: Record<string, unknown>,
  search: string,
): boolean {
  const needle = search.toLowerCase();
  return ['code', 'title'].some((field) => {
    const value = row[field];
    return typeof value === 'string' && value.toLowerCase().includes(needle);
  });
}

function compareValues(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left ?? '').localeCompare(String(right ?? ''));
}

/**
 * Equality-filter a table the way the repositories' `where` objects do,
 * then sort and page. `undefined` means "not filtered"; `search` is the
 * case-insensitive code/title substring match.
 */
function listPage<TRow extends Row>(
  table: InMemoryTable<TRow>,
  params: ListParams,
): { items: TRow[]; total: number } {
  const filtered = table.findMany((row) => {
    const record = row as unknown as Record<string, unknown>;
    for (const [key, expected] of Object.entries(params.where)) {
      if (expected === undefined) continue;
      if (key === 'search') {
        if (typeof expected === 'string' && expected !== '') {
          if (!matchesAccountingSearch(record, expected)) return false;
        }
        continue;
      }
      if (record[key] !== expected) return false;
    }
    return true;
  });
  const ordered = [...filtered].sort((a, b) => {
    for (const clause of params.orderBy) {
      const entry = Object.entries(clause)[0];
      if (entry === undefined) continue;
      const [field, direction] = entry;
      const comparison = compareValues(
        (a as Record<string, unknown>)[field],
        (b as Record<string, unknown>)[field],
      );
      if (comparison !== 0) return direction === 'desc' ? -comparison : comparison;
    }
    return 0;
  });
  return {
    items: ordered.slice(params.skip, params.skip + params.take),
    total: filtered.length,
  };
}

function clone<T>(row: T): T {
  return structuredClone(row);
}

// ---------------------------------------------------------------------------
// Financial areas
// ---------------------------------------------------------------------------

export class InMemoryFinancialAreasRepository {
  constructor(private readonly state: AccountingState) {}

  get table(): InMemoryTable<FinancialArea> {
    return this.state.areas;
  }

  async findById(id: string): Promise<FinancialArea | null> {
    return this.state.areas.findById(id);
  }

  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<FinancialArea | null> {
    return this.state.areas.findOne(
      (row) => row.organizationId === organizationId && row.code === code,
    );
  }

  async findByCodeExcludingId(
    organizationId: string,
    code: string,
    excludeId: string,
  ): Promise<FinancialArea | null> {
    const existing = await this.findByCode(organizationId, code);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(
    params: ListParams,
  ): Promise<{ items: FinancialArea[]; total: number }> {
    return listPage(this.state.areas, params);
  }

  async create(input: FinancialArea): Promise<FinancialArea> {
    return this.state.areas.insert(clone(input));
  }

  async update(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<FinancialArea | null> {
    return this.state.areas.patch(id, patch);
  }

  /**
   * Mirrors the real default transaction: clear the previous default of
   * the organization and flag the new one, atomically.
   */
  async setDefaultChecked(input: {
    id: string;
    organizationId: string;
    updatedAt: Date;
    updatedBy: string | null;
  }): Promise<{ area: FinancialArea; clearedId: string | null }> {
    const target = this.state.areas.findById(input.id);
    if (target === null) {
      throw new Error(`Financial area "${input.id}" no longer exists.`);
    }
    const previous = this.state.areas.findOne(
      (row) =>
        row.organizationId === input.organizationId && row.isDefault === true,
    );
    const clearedId =
      previous !== null && previous.id !== input.id ? previous.id : null;
    if (clearedId !== null) {
      this.state.areas.patch(clearedId, {
        isDefault: false,
        updatedAt: input.updatedAt,
        updatedBy: input.updatedBy,
      });
    }
    const area = this.state.areas.patch(input.id, {
      isDefault: true,
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
    });
    if (area === null) throw new Error(`Financial area "${input.id}" no longer exists.`);
    return { area, clearedId };
  }

  /**
   * Mirrors the real disable transaction: refuse while an open year of
   * the area exists, then disable.
   */
  async disableChecked(input: {
    id: string;
    updatedAt: Date;
    updatedBy: string | null;
  }): Promise<FinancialArea> {
    const target = this.state.areas.findById(input.id);
    if (target === null) {
      throw new Error(`Financial area "${input.id}" no longer exists.`);
    }
    const openYear = this.state.years.findOne(
      (row) => row.financialAreaId === input.id && row.status === 'open',
    );
    if (openYear !== null) throw new AreaHasOpenYearsError(openYear.id);
    const updated = this.state.areas.patch(input.id, {
      isActive: false,
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
    });
    if (updated === null) {
      throw new Error(`Financial area "${input.id}" no longer exists.`);
    }
    return updated;
  }
}

// ---------------------------------------------------------------------------
// Fiscal years
// ---------------------------------------------------------------------------

export class InMemoryFiscalYearsRepository {
  constructor(private readonly state: AccountingState) {}

  get table(): InMemoryTable<FiscalYear> {
    return this.state.years;
  }

  async findById(id: string): Promise<FiscalYear | null> {
    return this.state.years.findById(id);
  }

  async findByCode(
    organizationId: string,
    financialAreaId: string,
    code: string,
  ): Promise<FiscalYear | null> {
    return this.state.years.findOne(
      (row) =>
        row.organizationId === organizationId &&
        row.financialAreaId === financialAreaId &&
        row.code === code,
    );
  }

  async findByCodeExcludingId(
    organizationId: string,
    financialAreaId: string,
    code: string,
    excludeId: string,
  ): Promise<FiscalYear | null> {
    const existing = await this.findByCode(
      organizationId,
      financialAreaId,
      code,
    );
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(
    params: ListParams,
  ): Promise<{ items: FiscalYear[]; total: number }> {
    return listPage(this.state.years, params);
  }

  /** Mirrors the real create transaction: area guard + overlap + insert. */
  async createChecked(input: {
    id: string;
    organizationId: string;
    financialAreaId: string;
    code: string;
    title: string;
    startDate: Date;
    endDate: Date;
    priorYearId: string | null;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
  }): Promise<FiscalYear> {
    const area = this.state.areas.findById(input.financialAreaId);
    if (area === null) {
      throw new Error(
        `Financial area "${input.financialAreaId}" no longer exists.`,
      );
    }
    if (!area.isActive) throw new AreaDisabledError();
    const siblings = this.state.years.findMany(
      (row) =>
        row.organizationId === input.organizationId &&
        row.financialAreaId === input.financialAreaId,
    );
    const check = checkFiscalYearRange({
      candidate: { startDate: input.startDate, endDate: input.endDate },
      existing: siblings,
    });
    if (check.problem === 'invalid_range') {
      throw new Error('Fiscal year createChecked called with end < start.');
    }
    if (check.problem === 'overlapping_year') {
      throw new FiscalYearOverlapError(check.conflictingId ?? 'unknown');
    }
    return this.state.years.insert({
      ...clone(input),
      status: 'open',
      isActive: true,
      updatedBy: null,
    } as FiscalYear);
  }

  /** Mirrors the real update transaction: guards + patch. */
  async updateChecked(input: {
    id: string;
    code?: string | undefined;
    title?: string | undefined;
    startDate?: Date | undefined;
    endDate?: Date | undefined;
    isActive?: boolean | undefined;
    priorYearId?: string | null | undefined;
    updatedAt: Date;
    updatedBy: string | null;
  }): Promise<FiscalYear> {
    const locked = this.state.years.findById(input.id);
    if (locked === null) {
      throw new Error(`Fiscal year "${input.id}" no longer exists.`);
    }
    const datesChanging =
      input.startDate !== undefined || input.endDate !== undefined;
    if (datesChanging && locked.status !== 'open') {
      throw new FiscalYearNotEditableError(locked.status);
    }
    const patch: Record<string, unknown> = {
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
    };
    if (input.code !== undefined) patch['code'] = input.code;
    if (input.title !== undefined) patch['title'] = input.title;
    if (input.isActive !== undefined) patch['isActive'] = input.isActive;
    if (input.priorYearId !== undefined) patch['priorYearId'] = input.priorYearId;
    if (datesChanging) {
      const startDate = input.startDate ?? locked.startDate;
      const endDate = input.endDate ?? locked.endDate;
      patch['startDate'] = startDate;
      patch['endDate'] = endDate;
      const siblings = this.state.years.findMany(
        (row) =>
          row.organizationId === locked.organizationId &&
          row.financialAreaId === locked.financialAreaId,
      );
      const check = checkFiscalYearRange({
        candidate: { startDate, endDate },
        existing: siblings,
        excludeId: input.id,
      });
      if (check.problem === 'invalid_range') {
        throw new Error('Fiscal year updateChecked called with end < start.');
      }
      if (check.problem === 'overlapping_year') {
        throw new FiscalYearOverlapError(check.conflictingId ?? 'unknown');
      }
      const periods = this.state.periods.findMany(
        (row) => row.fiscalYearId === input.id,
      );
      for (const period of periods) {
        if (!dateOnlyRangeWithin(period, { startDate, endDate })) {
          throw new FiscalYearRangeExcludesPeriodsError(period.id);
        }
      }
    }
    const updated = this.state.years.patch(input.id, patch);
    if (updated === null) {
      throw new Error(`Fiscal year "${input.id}" no longer exists.`);
    }
    return updated;
  }

  /** Mirrors the real transition transaction: status verify + cascade/seal. */
  async transitionChecked(input: {
    id: string;
    from: string;
    to: string;
    updatedAt: Date;
    updatedBy: string | null;
  }): Promise<{
    year: FiscalYear;
    cascadedPeriods: Array<{ id: string; sequence: number }>;
  }> {
    const locked = this.state.years.findById(input.id);
    if (locked === null) {
      throw new Error(`Fiscal year "${input.id}" no longer exists.`);
    }
    if (locked.status !== input.from) {
      throw new FiscalYearTransitionConflictError(locked.status);
    }
    let cascadedPeriods: Array<{ id: string; sequence: number }> = [];
    if (input.to === 'closed') {
      const open = this.state.periods
        .findMany(
          (row) => row.fiscalYearId === input.id && row.status === 'open',
        )
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const period of open) {
        this.state.periods.patch(period.id, {
          status: 'closed',
          updatedAt: input.updatedAt,
          updatedBy: input.updatedBy,
        });
      }
      cascadedPeriods = open.map((period) => ({
        id: period.id,
        sequence: period.sequence,
      }));
    }
    if (input.to === 'sealed') {
      const blocking = this.state.periods.findOne(
        (row) => row.fiscalYearId === input.id && row.status === 'open',
      );
      if (blocking !== undefined && blocking !== null) {
        throw new FiscalYearSealBlockedError(blocking.id);
      }
    }
    const updated = this.state.years.patch(input.id, {
      status: input.to,
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
    });
    if (updated === null) {
      throw new Error(`Fiscal year "${input.id}" no longer exists.`);
    }
    return { year: updated, cascadedPeriods };
  }
}

// ---------------------------------------------------------------------------
// Accounting periods
// ---------------------------------------------------------------------------

export class InMemoryAccountingPeriodsRepository {
  constructor(private readonly state: AccountingState) {}

  get table(): InMemoryTable<AccountingPeriod> {
    return this.state.periods;
  }

  async findById(id: string): Promise<AccountingPeriod | null> {
    return this.state.periods.findById(id);
  }

  async findBySequence(
    fiscalYearId: string,
    sequence: number,
  ): Promise<AccountingPeriod | null> {
    return this.state.periods.findOne(
      (row) => row.fiscalYearId === fiscalYearId && row.sequence === sequence,
    );
  }

  async findBySequenceExcludingId(
    fiscalYearId: string,
    sequence: number,
    excludeId: string,
  ): Promise<AccountingPeriod | null> {
    const existing = await this.findBySequence(fiscalYearId, sequence);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(
    params: ListParams,
  ): Promise<{ items: AccountingPeriod[]; total: number }> {
    return listPage(this.state.periods, params);
  }

  /** Mirrors the real open transaction: year guards + range + insert. */
  async createChecked(input: {
    id: string;
    organizationId: string;
    financialAreaId: string;
    fiscalYearId: string;
    sequence: number;
    title: string;
    startDate: Date;
    endDate: Date;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
  }): Promise<AccountingPeriod> {
    const year = this.state.years.findById(input.fiscalYearId);
    if (year === null) {
      throw new Error(`Fiscal year "${input.fiscalYearId}" no longer exists.`);
    }
    if (!year.isActive) throw new PeriodYearNotUsableError();
    if (year.status !== 'open') throw new PeriodYearNotOpenError(year.status);
    const siblings = this.state.periods.findMany(
      (row) => row.fiscalYearId === input.fiscalYearId,
    );
    const check = checkAccountingPeriodRange({
      candidate: { startDate: input.startDate, endDate: input.endDate },
      year: { startDate: year.startDate, endDate: year.endDate },
      existing: siblings,
    });
    if (check.problem === 'invalid_range') {
      throw new Error('Period createChecked called with end < start.');
    }
    if (check.problem === 'outside_year') throw new PeriodOutsideYearError();
    if (check.problem === 'overlapping_period') {
      throw new PeriodOverlapError(check.conflictingId ?? 'unknown');
    }
    return this.state.periods.insert({
      ...clone(input),
      status: 'open',
      periodKind: 'normal',
      updatedBy: null,
    } as AccountingPeriod);
  }

  /** Mirrors the real transition transaction: status + year-seal gate. */
  async transitionChecked(input: {
    id: string;
    from: string;
    to: string;
    gatesOnYearSealed: boolean;
    updatedAt: Date;
    updatedBy: string | null;
  }): Promise<AccountingPeriod> {
    const route = this.state.periods.findById(input.id);
    if (route === null) {
      throw new Error(`Accounting period "${input.id}" no longer exists.`);
    }
    const year = this.state.years.findById(route.fiscalYearId);
    if (year === null) {
      throw new Error(
        `Fiscal year "${route.fiscalYearId}" no longer exists.`,
      );
    }
    if (route.status !== input.from) {
      throw new PeriodTransitionConflictError(route.status);
    }
    if (input.gatesOnYearSealed && year.status === 'sealed') {
      throw new PeriodYearSealedError();
    }
    const updated = this.state.periods.patch(input.id, {
      status: input.to,
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
    });
    if (updated === null) {
      throw new Error(`Accounting period "${input.id}" no longer exists.`);
    }
    return updated;
  }
}

// ---------------------------------------------------------------------------
// Store bundle
// ---------------------------------------------------------------------------

export interface AccountingStores {
  /** Handles typed as the real repositories — safe for `overrideProvider`. */
  areas: FinancialAreasRepository;
  years: FiscalYearsRepository;
  periods: AccountingPeriodsRepository;
  /** Concrete stores for assertions and direct manipulation. */
  raw: {
    areas: InMemoryFinancialAreasRepository;
    years: InMemoryFiscalYearsRepository;
    periods: InMemoryAccountingPeriodsRepository;
    state: AccountingState;
  };
}

/**
 * Build one coherent in-memory "database" for the Accounting foundation.
 * The three tables share one state object because the guards read across
 * tables (years check their area, periods check their year) — as the real
 * transactions do.
 */
export function createAccountingStores(): AccountingStores {
  const state = createAccountingState();
  const areas = new InMemoryFinancialAreasRepository(state);
  const years = new InMemoryFiscalYearsRepository(state);
  const periods = new InMemoryAccountingPeriodsRepository(state);
  return {
    areas: areas as unknown as FinancialAreasRepository,
    years: years as unknown as FiscalYearsRepository,
    periods: periods as unknown as AccountingPeriodsRepository,
    raw: { areas, years, periods, state },
  };
}

/** Re-exported for specs that assert the P2002 path explicitly. */
export { uniqueViolation };
