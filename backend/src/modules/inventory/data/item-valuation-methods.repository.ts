import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import {
  businessDateFromDbDate,
  businessDateToDbDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import type { ConversionVersionProblem } from '../domain/unit-conversion.js';
import { planNewVersion } from '../domain/unit-conversion.js';
import type { ItemValuationMethodVersion } from '../domain/valuation-method.js';
import { isValuationMethod } from '../domain/valuation-method.js';
import { AmbiguousValuationMethodError } from '../domain/valuation-replay.js';
import type {
  CoreClient,
  ItemValuationMethodCreate,
  ItemValuationMethodRow,
  ItemValuationMethodWhere,
} from './inventory-core-rows.js';
import type { OrderBy } from './master-data-rows.js';

/**
 * Data access for `inventory.item_valuation_methods` — the effective-dated
 * valuation-method configuration (PDR-05 OD-VAL-03/OD-VAL-14, D-21).
 *
 * This is the SAME effective-dating mechanism `unit_conversions` uses, down
 * to reusing its planner (`planNewVersion`): a new version is inserted and
 * the previous open-ended one is CLOSED at the new `validFrom`; nothing is
 * ever edited in place and nothing is ever deleted. That is what keeps a
 * historical valuation reproducible — a recalculation of last quarter
 * resolves the method that was configured then, not the one configured now.
 *
 * **Concurrency.** A version write is read-plan-close-insert, so the plan
 * must be computed against locked, fresh rows. Two concurrent creates for
 * one item that each planned on a stale read could otherwise both insert
 * open-ended versions — no shared row ever conflicts — leaving the item with
 * overlapping windows the planner would then reject forever. Every create
 * therefore takes an item-scoped `pg_advisory_xact_lock` FIRST, re-reads,
 * plans, closes and inserts, exactly like `unit-conversions.repository.ts`.
 * The advisory key is a single value per item, so there is no lock-ordering
 * cycle with the posting locks.
 */

/** The plan no longer holds against the rows re-read inside the transaction. */
export class ValuationMethodPlanRejectedError extends Error {
  readonly problem: ConversionVersionProblem;

  constructor(problem: ConversionVersionProblem) {
    super(`Valuation method version plan rejected: ${problem}.`);
    this.name = 'ValuationMethodPlanRejectedError';
    this.problem = problem;
  }
}

export interface PlannedMethodWrite {
  version: ItemValuationMethodVersion;
  supersededVersionId: string | null;
}

export interface ValuationMethodFilter {
  organizationId: string;
  itemId?: string | undefined;
  /** Only versions in force on this business date. */
  activeAt?: BusinessDate | undefined;
}

type RawExecute = (
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<number>;

// `$executeRaw` on purpose: `pg_advisory_xact_lock` returns `void`, which
// `$queryRaw` cannot deserialize (CI live-suite finding, documented in
// `unit-conversions.repository.ts`).
type TxClient = CoreClient & { $executeRaw: RawExecute };

@Injectable()
export class ItemValuationMethodsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<CoreClient> {
    return this.prisma.getClient<CoreClient>();
  }

  // ---- reads --------------------------------------------------------------

  /**
   * The ONE version in force for an item on a business date, or `null` when none
   * is (the caller then applies the code-defined default).
   *
   * Bounded by construction: the window predicate is evaluated by
   * PostgreSQL and only the version in force is transferred. Both read paths
   * map their result through the single domain function
   * `resolveValuationMethodFrom`, so they cannot disagree, and both refuse
   * to resolve a business date covered by more than one version.
   *
   * This replaces a full-series read: resolving one date never needed the
   * whole configuration history, and the posting path runs this query on
   * every costed movement.
   */
  async findEffectiveVersionAt(
    organizationId: string,
    itemId: string,
    asOf: BusinessDate,
  ): Promise<ItemValuationMethodVersion | null> {
    const { itemValuationMethod } = await this.client();
    // Two rows, not one: asking for a single row would silently pick a
    // winner if stored data ever held two versions in force on the same
    // business date. Reading one more makes that visible, so this path fails
    // closed exactly like the replay does instead of preferring whichever
    // version sorted first.
    const rows = await itemValuationMethod.findMany({
      where: toWhere({ organizationId, itemId, activeAt: asOf }),
      orderBy: [{ validFrom: 'desc' }],
      skip: 0,
      take: 2,
    });
    if (rows.length > 1) {
      throw new AmbiguousValuationMethodError(
        itemId,
        asOf,
        rows.map((row) => row.id).sort(),
      );
    }
    const row = rows[0];
    return row === undefined ? null : toDomain(row);
  }

  async findById(id: string): Promise<ItemValuationMethodVersion | null> {
    const { itemValuationMethod } = await this.client();
    const row = await itemValuationMethod.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    where: ValuationMethodFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: ItemValuationMethodVersion[]; total: number }> {
    const { itemValuationMethod } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      itemValuationMethod.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      itemValuationMethod.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  // ---- writes -------------------------------------------------------------

  /**
   * Insert a new version, closing the open-ended version it supersedes in
   * the SAME transaction. See the class comment for why the advisory lock is
   * the first statement.
   */
  async createVersion(input: {
    create: ItemValuationMethodCreate;
    closeAudit: { updatedAt: Date; updatedBy: string | null };
  }): Promise<PlannedMethodWrite> {
    const client = await this.prisma.getClient<
      CoreClient & {
        $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
      }
    >();
    return client.$transaction(async (tx) => {
      const scoped = tx as TxClient;
      await scoped.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`item_valuation_methods|${input.create.organizationId}|${input.create.itemId}`},
            0
          )
        )`;
      // UNBOUNDED ON PURPOSE — and the only read in this module that is.
      // `planNewVersion` decides by testing the candidate against EVERY
      // existing window (`overlapping = existing.filter(windowsOverlap)`); a
      // truncated series would make it miss an overlap and admit two
      // versions covering the same business date, which would make historical
      // resolution ambiguous forever. The set is one (organization, item)
      // pair's configuration history — created only by explicit
      // `POST /inventory/valuation/methods` calls, never by data volume or
      // user traffic — and this read runs once per configuration write,
      // under the item-scoped advisory lock taken above. Same shape as the
      // accepted `unit-conversions.repository.ts` write path (C-47).
      const existingRows = await scoped.itemValuationMethod.findMany({
        where: {
          organizationId: input.create.organizationId,
          itemId: input.create.itemId,
        },
        orderBy: [{ validFrom: 'asc' }],
        skip: 0,
        take: Number.MAX_SAFE_INTEGER,
      });
      const plan = planNewVersion({
        candidate: {
          validFrom: input.create.validFrom,
          validTo: input.create.validTo,
        },
        existing: existingRows.map(toDomain),
      });
      if (plan.problem !== null) {
        throw new ValuationMethodPlanRejectedError(plan.problem);
      }
      if (plan.supersededId !== null) {
        await scoped.itemValuationMethod.update({
          where: { id: plan.supersededId },
          data: {
            validTo: dbBusinessDate(input.create.validFrom),
            updatedAt: input.closeAudit.updatedAt,
            updatedBy: input.closeAudit.updatedBy,
          },
        });
      }
      const version = toDomain(
        await scoped.itemValuationMethod.create({
          data: toCreateData(input.create),
        }),
      );
      return { version, supersededVersionId: plan.supersededId };
    });
  }
}

function toWhere(filter: ValuationMethodFilter): ItemValuationMethodWhere {
  const where: ItemValuationMethodWhere = {
    organizationId: filter.organizationId,
  };
  if (filter.itemId !== undefined) where.itemId = filter.itemId;
  if (filter.activeAt !== undefined) {
    const activeAt = dbBusinessDate(filter.activeAt);
    where.validFrom = { lte: activeAt };
    where.OR = [{ validTo: null }, { validTo: { gt: activeAt } }];
  }
  return where;
}

function toDomain(row: ItemValuationMethodRow): ItemValuationMethodVersion {
  if (!isValuationMethod(row.method)) {
    throw new Error(
      `Stored valuation method version "${row.id}" has an unknown method "${row.method}".`,
    );
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    itemId: row.itemId,
    method: row.method,
    validFrom: businessDateFromDbDate(row.validFrom),
    validTo: row.validTo === null ? null : businessDateFromDbDate(row.validTo),
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function dbBusinessDate(value: BusinessDate): Date {
  const carrier = businessDateToDbDate(value);
  if (carrier === null) {
    throw new Error(`Invalid canonical Inventory BusinessDate "${value}".`);
  }
  return carrier;
}

function toCreateData(
  input: ItemValuationMethodCreate,
): import('./inventory-core-rows.js').ItemValuationMethodCreateData {
  return {
    ...input,
    validFrom: dbBusinessDate(input.validFrom),
    validTo: input.validTo === null ? null : dbBusinessDate(input.validTo),
  };
}
