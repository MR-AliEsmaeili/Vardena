import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import {
  businessDateFromDbDate,
  businessDateToDbDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import type { AccountingPeriod } from '../domain/accounting-period.js';
import {
  checkAccountingPeriodRange,
  isAccountingPeriodStatus,
} from '../domain/accounting-period.js';
import {
  PeriodOutsideYearError,
  PeriodOverlapError,
  PeriodTransitionConflictError,
  PeriodYearNotOpenError,
  PeriodYearNotUsableError,
  PeriodYearSealedError,
} from './accounting-calendar-errors.js';
import {
  lockAccountingPeriodRow,
  lockFiscalYearRow,
} from './accounting-locks.js';
import type {
  AccountingPeriodDelegate,
  AccountingPeriodRow,
  AccountingPeriodWhere,
  AccountingTransactionalClient,
  OrderBy,
} from './accounting-rows.js';

/**
 * Data access for `accounting.accounting_periods`.
 *
 * The `(fiscal_year_id, sequence)` unique index is authoritative for
 * duplicate detection; the service pre-checks only to produce a 409 with a
 * useful message, and the repository still surfaces the database failure
 * if two writes race.
 *
 * Every write owns ONE transaction shaped like the Inventory posting path:
 *
 *   1. lock the fiscal-year row (`SELECT … FOR UPDATE`) — the scope every
 *      period guard reads;
 *   2. re-evaluate the guard against the LOCKED rows (year usability and
 *      status, year bounds, overlap, current status),
 *   3. write.
 *
 * The year lock is always taken BEFORE the period lock (the fixed
 * area → year → period order — see `accounting-locks.ts`), so period
 * transitions serialize against the year close/seal that reads the same
 * periods: a seal either commits first and the reopen is refused against
 * the sealed year, or the reopen commits first and the seal observes the
 * open period and refuses. The pure domain checks
 * (`domain/accounting-period.ts`) are imported here for the in-transaction
 * evaluation — the `violatesNegativePolicy` precedent from Inventory.
 *
 * There is deliberately no `update` here at all: periods have no update
 * endpoint (no `Accounting.AccountingPeriod.Edit` code in contract §22),
 * so the only mutation path is the guarded `transitionChecked`.
 *
 * Task 14 adds NO lock and NO lock order to this file: the organization
 * ownership of the LOCKED year and period rows is verified inside the very
 * transaction that writes the status, so a foreign id can never become a
 * cross-organization lifecycle write even if a future caller skips the
 * service's in-scope resolution. The `status` column of the locked row
 * remains the single authority for "which lifecycle move is legal now"
 * (the plan itself is the pure `planAccountingPeriodTransition`).
 */

type Client = {
  accountingPeriod: AccountingPeriodDelegate;
};

export interface AccountingPeriodListFilter {
  /** Always set by the service: a period list is never cross-organization. */
  organizationId: string;
  financialAreaId?: string | undefined;
  fiscalYearId?: string | undefined;
  status?: string | undefined;
}

export interface CreateAccountingPeriodCheckedInput {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  sequence: number;
  title: string;
  startDate: BusinessDate;
  endDate: BusinessDate;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface TransitionAccountingPeriodCheckedInput {
  /** The caller's organization; the locked rows must belong to it. */
  organizationId: string;
  id: string;
  /** The status the caller planned from (pre-checked by the service). */
  from: string;
  /** The planned target status. */
  to: string;
  /** `close` and `reopen` are refused while the year is sealed. */
  gatesOnYearSealed: boolean;
  updatedAt: Date;
  updatedBy: string | null;
}

@Injectable()
export class AccountingPeriodsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<AccountingTransactionalClient> {
    return this.prisma.getClient<AccountingTransactionalClient>();
  }

  async findById(id: string): Promise<AccountingPeriod | null> {
    const { accountingPeriod } = await this.client();
    const row = await accountingPeriod.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findBySequence(
    fiscalYearId: string,
    sequence: number,
  ): Promise<AccountingPeriod | null> {
    const { accountingPeriod } = await this.client();
    const row = await accountingPeriod.findFirst({
      where: { fiscalYearId, sequence },
    });
    return row === null ? null : toDomain(row);
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

  async list(params: {
    where: AccountingPeriodListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: AccountingPeriod[]; total: number }> {
    const { accountingPeriod } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      accountingPeriod.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      accountingPeriod.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  /**
   * Open (create) one period, evaluating the year-usability, boundary and
   * overlap guards inside the year-locked transaction. The row is born
   * `open` with `period_kind = 'normal'` (contract §7.1/§7.2).
   *
   * The locked year must belong to the caller's organization and to the
   * financial area the period is being created under: a foreign year is a
   * boundary violation, never a lucky insert (Task 14 — the service's
   * in-scope resolution is repeated here so the guard is self-sufficient
   * inside its own transaction, the `lockScopeInTx` posture).
   *
   * @throws PeriodYearNotUsableError when the year is disabled.
   * @throws PeriodYearNotOpenError when the year is closed or sealed.
   * @throws PeriodOutsideYearError when the range leaves the year.
   * @throws PeriodOverlapError when the range overlaps a sibling period.
   */
  async createChecked(
    input: CreateAccountingPeriodCheckedInput,
  ): Promise<AccountingPeriod> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // Throws when the row is gone (a bug — the service resolves the year
      // first, and years are never deleted).
      const year = await lockFiscalYearRow(tx, input.fiscalYearId);
      if (
        year.organizationId !== input.organizationId ||
        year.financialAreaId !== input.financialAreaId
      ) {
        throw new Error(
          `Fiscal year "${year.id}" does not belong to organization "${input.organizationId}" and financial area "${input.financialAreaId}".`,
        );
      }
      if (!year.isActive) throw new PeriodYearNotUsableError();
      if (year.status !== 'open') {
        throw new PeriodYearNotOpenError(year.status);
      }

      const siblings = await tx.accountingPeriod.findMany({
        where: { fiscalYearId: input.fiscalYearId },
        orderBy: [{ id: 'asc' }],
        skip: 0,
        take: 10_000,
      });
      const check = checkAccountingPeriodRange({
        candidate: { startDate: input.startDate, endDate: input.endDate },
        year: { startDate: year.startDate, endDate: year.endDate },
        existing: siblings.map((row) => ({
          id: row.id,
          startDate: businessDateFromDbDate(row.startDate),
          endDate: businessDateFromDbDate(row.endDate),
        })),
      });
      // `invalid_range` cannot happen here — the service parses and orders
      // the dates before calling — so reaching it is a caller bug.
      if (check.problem === 'invalid_range') {
        throw new Error('Period createChecked called with end < start.');
      }
      if (check.problem === 'outside_year') throw new PeriodOutsideYearError();
      if (check.problem === 'overlapping_period') {
        throw new PeriodOverlapError(check.conflictingId ?? 'unknown');
      }

      const created = await tx.accountingPeriod.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          financialAreaId: input.financialAreaId,
          fiscalYearId: input.fiscalYearId,
          sequence: input.sequence,
          title: input.title,
          startDate: dbBusinessDate(input.startDate),
          endDate: dbBusinessDate(input.endDate),
          status: 'open',
          periodKind: 'normal',
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          createdBy: input.createdBy,
        },
      });
      return toDomain(created);
    });
  }

  /**
   * Apply one lifecycle move, verifying the locked current status, the
   * organization ownership of the locked rows and the year-level gate
   * inside the transaction. `close` and `reopen` are refused while the
   * year is sealed (contract §7.2 rule 4); `seal` is the period's own
   * finality and carries no year-status gate.
   *
   * Both rows are read FOR UPDATE before they are judged: the status this
   * transition validates is the committed one, so `close` racing the
   * finalization of a voucher dated in this period serializes on the same
   * period row the posting path locks first (see `accounting-locks.ts`).
   *
   * @throws PeriodTransitionConflictError when the period moved while the
   *   request was in flight (maps to 409, not 422).
   * @throws PeriodYearSealedError when gated by a sealed year.
   */
  async transitionChecked(
    input: TransitionAccountingPeriodCheckedInput,
  ): Promise<AccountingPeriod> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // The period row is read unlocked ONLY to route to its year: the
      // year lock below is what serializes, and the period lock after it
      // is what the status check reads.
      const { accountingPeriod } = tx;
      const routed = await accountingPeriod.findMany({
        where: { id: input.id },
        orderBy: [{ id: 'asc' }],
        skip: 0,
        take: 1,
      });
      const [route] = routed;
      if (route === undefined) {
        // A bug — the service resolves the period first, and periods are
        // never deleted.
        throw new Error(`Accounting period "${input.id}" no longer exists.`);
      }
      // Year first, then the period — the fixed order (see above).
      const year = await lockFiscalYearRow(tx, route.fiscalYearId);
      if (year.organizationId !== input.organizationId) {
        throw new Error(
          `Fiscal year "${year.id}" does not belong to organization "${input.organizationId}".`,
        );
      }
      const locked = await lockAccountingPeriodRow(tx, input.id);
      if (locked.organizationId !== input.organizationId) {
        // The service resolves the period in scope first and answers 404 for
        // a foreign id (AC-I-16); reaching this inside the transaction means
        // the row belongs to another organization, which is a boundary
        // violation, not a missing row.
        throw new Error(
          `Accounting period "${input.id}" does not belong to organization "${input.organizationId}".`,
        );
      }
      if (locked.status !== input.from) {
        throw new PeriodTransitionConflictError(locked.status);
      }
      if (input.gatesOnYearSealed && year.status === 'sealed') {
        throw new PeriodYearSealedError();
      }

      const updated = await tx.accountingPeriod.update({
        where: { id: input.id },
        data: {
          status: input.to,
          updatedAt: input.updatedAt,
          updatedBy: input.updatedBy,
        },
      });
      return toDomain(updated);
    });
  }
}

// ---- Internal helpers ----

function toWhere(filter: AccountingPeriodListFilter): AccountingPeriodWhere {
  const where: AccountingPeriodWhere = {
    organizationId: filter.organizationId,
  };
  if (filter.financialAreaId !== undefined) {
    where.financialAreaId = filter.financialAreaId;
  }
  if (filter.fiscalYearId !== undefined) {
    where.fiscalYearId = filter.fiscalYearId;
  }
  if (filter.status !== undefined) where.status = filter.status;
  return where;
}

function toDomain(row: AccountingPeriodRow): AccountingPeriod {
  if (!isAccountingPeriodStatus(row.status)) {
    throw new Error(
      `Stored accounting period "${row.id}" has an unknown status "${row.status}".`,
    );
  }
  if (row.periodKind !== 'normal') {
    throw new Error(
      `Stored accounting period "${row.id}" has an unknown kind "${row.periodKind}".`,
    );
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    financialAreaId: row.financialAreaId,
    fiscalYearId: row.fiscalYearId,
    sequence: row.sequence,
    title: row.title,
    startDate: businessDateFromDbDate(row.startDate),
    endDate: businessDateFromDbDate(row.endDate),
    status: row.status,
    periodKind: row.periodKind,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function dbBusinessDate(value: BusinessDate): Date {
  const carrier = businessDateToDbDate(value);
  if (carrier === null) {
    throw new Error(`Invalid canonical Accounting BusinessDate "${value}".`);
  }
  return carrier;
}
