import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type { ConversionVersionProblem } from '../domain/unit-conversion.js';
import { planNewVersion } from '../domain/unit-conversion.js';
import type { ItemValuationMethodVersion } from '../domain/valuation-method.js';
import { isValuationMethod } from '../domain/valuation-method.js';
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
  /** Only versions in force at this instant. */
  activeAt?: Date | undefined;
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

  /** All versions for one item, oldest first (resolution + planning). */
  async findVersions(
    organizationId: string,
    itemId: string,
  ): Promise<ItemValuationMethodVersion[]> {
    const { itemValuationMethod } = await this.client();
    const rows = await itemValuationMethod.findMany({
      where: { organizationId, itemId },
      orderBy: [{ validFrom: 'asc' }],
      skip: 0,
      take: Number.MAX_SAFE_INTEGER,
    });
    return rows.map(toDomain);
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
            validTo: input.create.validFrom,
            updatedAt: input.closeAudit.updatedAt,
            updatedBy: input.closeAudit.updatedBy,
          },
        });
      }
      const version = toDomain(
        await scoped.itemValuationMethod.create({ data: input.create }),
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
    where.validFrom = { lte: filter.activeAt };
    where.OR = [{ validTo: null }, { validTo: { gt: filter.activeAt } }];
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
    validFrom: row.validFrom,
    validTo: row.validTo,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
