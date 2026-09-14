import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type { FiscalYear } from '../domain/fiscal-year.js';
import {
  checkFiscalYearRange,
  isFiscalYearStatus,
} from '../domain/fiscal-year.js';
import { dateOnlyRangeWithin } from '../domain/date-range.js';
import {
  AreaDisabledError,
  FiscalYearNotEditableError,
  FiscalYearOverlapError,
  FiscalYearRangeExcludesPeriodsError,
  FiscalYearSealBlockedError,
  FiscalYearTransitionConflictError,
} from './accounting-calendar-errors.js';
import {
  lockFinancialAreaRow,
  lockFiscalYearRow,
  lockOpenPeriodsOfYear,
} from './accounting-locks.js';
import type {
  AccountingTransactionalClient,
  FiscalYearDelegate,
  FiscalYearRow,
  FiscalYearUpdate,
  FiscalYearWhere,
  OrderBy,
} from './accounting-rows.js';

/**
 * Data access for `accounting.fiscal_years`.
 *
 * The `(organization_id, financial_area_id, code)` unique index is
 * authoritative for duplicate detection; the service pre-checks only to
 * produce a 409 with a useful message, and the repository still surfaces
 * the database failure if two writes race.
 *
 * Every write owns ONE transaction shaped like the Inventory posting path:
 *
 *   1. lock the parent row (`SELECT … FOR UPDATE` on the area for
 *      create/update, on the year itself for transitions),
 *   2. re-evaluate the guard against the LOCKED rows (area usability,
 *      overlap, year bounds, current status),
 *   3. write.
 *
 * The guard inside the transaction (never before it) is what makes
 * concurrent writes race-safe: two writers for one area serialize on the
 * area lock, and the loser evaluates against the winner's committed rows
 * (AC-I-03). The pure domain checks (`domain/fiscal-year.ts`,
 * `domain/date-range.ts`) are imported here for the in-transaction
 * evaluation — the `violatesNegativePolicy` precedent from Inventory.
 */

type Client = {
  fiscalYear: FiscalYearDelegate;
};

export interface FiscalYearListFilter {
  /** Always set by the service: a year list is never cross-organization. */
  organizationId: string;
  financialAreaId?: string | undefined;
  status?: string | undefined;
  isActive?: boolean | undefined;
  search?: string | undefined;
}

export interface CreateFiscalYearCheckedInput {
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
}

export interface UpdateFiscalYearCheckedInput {
  id: string;
  code?: string | undefined;
  title?: string | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  isActive?: boolean | undefined;
  priorYearId?: string | null | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface TransitionFiscalYearCheckedInput {
  id: string;
  /** The status the caller planned from (pre-checked by the service). */
  from: string;
  /** The planned target status. */
  to: string;
  updatedAt: Date;
  updatedBy: string | null;
}

@Injectable()
export class FiscalYearsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<AccountingTransactionalClient> {
    return this.prisma.getClient<AccountingTransactionalClient>();
  }

  async findById(id: string): Promise<FiscalYear | null> {
    const { fiscalYear } = await this.client();
    const row = await fiscalYear.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(
    organizationId: string,
    financialAreaId: string,
    code: string,
  ): Promise<FiscalYear | null> {
    const { fiscalYear } = await this.client();
    const row = await fiscalYear.findFirst({
      where: { organizationId, financialAreaId, code },
    });
    return row === null ? null : toDomain(row);
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

  async list(params: {
    where: FiscalYearListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: FiscalYear[]; total: number }> {
    const { fiscalYear } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      fiscalYear.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      fiscalYear.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  /**
   * Create one year, evaluating the area-usability and overlap guards
   * inside the area-locked transaction.
   *
   * @throws AreaDisabledError when the area is disabled.
   * @throws FiscalYearOverlapError when the range overlaps a sibling year.
   */
  async createChecked(
    input: CreateFiscalYearCheckedInput,
  ): Promise<FiscalYear> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // Throws when the row is gone (a bug — the service resolves the area
      // first, and areas are never deleted).
      const area = await lockFinancialAreaRow(tx, input.financialAreaId);
      if (!area.isActive) throw new AreaDisabledError();

      const siblings = await tx.fiscalYear.findMany({
        where: {
          organizationId: input.organizationId,
          financialAreaId: input.financialAreaId,
        },
        orderBy: [{ id: 'asc' }],
        skip: 0,
        take: 10_000,
      });
      const check = checkFiscalYearRange({
        candidate: { startDate: input.startDate, endDate: input.endDate },
        existing: siblings,
      });
      // `invalid_range` cannot happen here — the service parses and orders
      // the dates before calling — but fail closed rather than trust it.
      if (check.problem === 'invalid_range' || check.conflictingId === null) {
        if (check.problem === 'overlapping_year') {
          throw new FiscalYearOverlapError('unknown');
        }
        throw new FiscalYearOverlapError('unknown');
      }
      if (check.problem === 'overlapping_year') {
        throw new FiscalYearOverlapError(check.conflictingId);
      }

      const created = await tx.fiscalYear.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          financialAreaId: input.financialAreaId,
          code: input.code,
          title: input.title,
          startDate: input.startDate,
          endDate: input.endDate,
          status: 'open',
          isActive: true,
          priorYearId: input.priorYearId,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          createdBy: input.createdBy,
        },
      });
      return toDomain(created);
    });
  }

  /**
   * Update one year, re-evaluating the overlap and period-containment
   * guards inside the area-locked transaction. Date changes additionally
   * require the year to be open (fail closed — a closed/sealed year is a
   * finished book, contract §6.3).
   *
   * @throws FiscalYearNotEditableError for a date change on a non-open year.
   * @throws FiscalYearOverlapError when the new range overlaps a sibling.
   * @throws FiscalYearRangeExcludesPeriodsError when a period would fall
   *   outside the new range.
   */
  async updateChecked(
    input: UpdateFiscalYearCheckedInput,
  ): Promise<FiscalYear> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // Throws when the row is gone (same bug posture as above).
      const locked = await lockFiscalYearRow(tx, input.id);
      const datesChanging =
        input.startDate !== undefined || input.endDate !== undefined;
      if (datesChanging && locked.status !== 'open') {
        throw new FiscalYearNotEditableError(locked.status);
      }

      const patch: FiscalYearUpdate = {
        updatedAt: input.updatedAt,
        updatedBy: input.updatedBy,
      };
      if (input.code !== undefined) patch.code = input.code;
      if (input.title !== undefined) patch.title = input.title;
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      if (input.priorYearId !== undefined) {
        patch.priorYearId = input.priorYearId;
      }

      if (datesChanging) {
        const startDate = input.startDate ?? locked.startDate;
        const endDate = input.endDate ?? locked.endDate;
        patch.startDate = startDate;
        patch.endDate = endDate;

        const siblings = await tx.fiscalYear.findMany({
          where: {
            organizationId: locked.organizationId,
            financialAreaId: locked.financialAreaId,
          },
          orderBy: [{ id: 'asc' }],
          skip: 0,
          take: 10_000,
        });
        const check = checkFiscalYearRange({
          candidate: { startDate, endDate },
          existing: siblings,
          excludeId: input.id,
        });
        if (check.problem === 'invalid_range') {
          // The service orders the dates before calling; a bug if reached.
          throw new Error('Fiscal year updateChecked called with end < start.');
        }
        if (check.problem === 'overlapping_year') {
          throw new FiscalYearOverlapError(check.conflictingId ?? 'unknown');
        }

        const periods = await tx.accountingPeriod.findMany({
          where: { fiscalYearId: input.id },
          orderBy: [{ id: 'asc' }],
          skip: 0,
          take: 10_000,
        });
        const newRange = { startDate, endDate };
        for (const period of periods) {
          // Every period must stay inside the NEW range, not the stored one.
          if (!dateOnlyRangeWithin(period, newRange)) {
            throw new FiscalYearRangeExcludesPeriodsError(period.id);
          }
        }
      }

      const updated = await tx.fiscalYear.update({
        where: { id: input.id },
        data: patch,
      });
      return toDomain(updated);
    });
  }

  /**
   * Apply one lifecycle move, verifying the locked current status inside
   * the transaction:
   * - `→ closed` also closes the year's open periods in the same
   *   transaction (contract §7.2 rule 6) and returns their ids for events;
   * - `→ sealed` refuses while an open period exists (contract §6.4, fail
   *   closed: the "sealing closes them" half of the fork is OQ-23).
   *
   * @throws FiscalYearTransitionConflictError when the year moved while
   *   the request was in flight (maps to 409, not 422).
   * @throws FiscalYearSealBlockedError when sealing with an open period.
   */
  async transitionChecked(
    input: TransitionFiscalYearCheckedInput,
  ): Promise<{
    year: FiscalYear;
    cascadedPeriods: Array<{ id: string; sequence: number }>;
  }> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // Throws when the row is gone (same bug posture as above).
      const locked = await lockFiscalYearRow(tx, input.id);
      if (locked.status !== input.from) {
        throw new FiscalYearTransitionConflictError(locked.status);
      }

      let cascadedPeriods: Array<{ id: string; sequence: number }> = [];
      if (input.to === 'closed') {
        cascadedPeriods = await lockOpenPeriodsOfYear(tx, input.id);
        if (cascadedPeriods.length > 0) {
          await tx.accountingPeriod.updateMany({
            where: { fiscalYearId: input.id, status: 'open' },
            data: {
              status: 'closed',
              updatedAt: input.updatedAt,
              updatedBy: input.updatedBy,
            },
          });
        }
      }
      if (input.to === 'sealed') {
        const open = await tx.accountingPeriod.findMany({
          where: { fiscalYearId: input.id, status: 'open' },
          orderBy: [{ id: 'asc' }],
          skip: 0,
          take: 1,
        });
        const [blocking] = open;
        if (blocking !== undefined) {
          throw new FiscalYearSealBlockedError(blocking.id);
        }
      }

      const updated = await tx.fiscalYear.update({
        where: { id: input.id },
        data: {
          status: input.to,
          updatedAt: input.updatedAt,
          updatedBy: input.updatedBy,
        },
      });
      return { year: toDomain(updated), cascadedPeriods };
    });
  }

}

// ---- Internal helpers ----

function toWhere(filter: FiscalYearListFilter): FiscalYearWhere {
  const where: FiscalYearWhere = { organizationId: filter.organizationId };
  if (filter.financialAreaId !== undefined) {
    where.financialAreaId = filter.financialAreaId;
  }
  if (filter.status !== undefined) where.status = filter.status;
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { code: { contains: filter.search, mode: 'insensitive' } },
      { title: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

function toDomain(row: FiscalYearRow): FiscalYear {
  const status = isFiscalYearStatus(row.status) ? row.status : 'open';
  return {
    id: row.id,
    organizationId: row.organizationId,
    financialAreaId: row.financialAreaId,
    code: row.code,
    title: row.title,
    startDate: row.startDate,
    endDate: row.endDate,
    status,
    isActive: row.isActive,
    priorYearId: row.priorYearId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
