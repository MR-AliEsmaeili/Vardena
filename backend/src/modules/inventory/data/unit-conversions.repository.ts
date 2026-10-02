import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type {
  ConversionVersionProblem,
  UnitConversion,
} from '../domain/unit-conversion.js';
import { planNewVersion } from '../domain/unit-conversion.js';
import type { AuditColumns, OrderBy } from './master-data-rows.js';

/**
 * Data access for `inventory.unit_conversions` (global) and
 * `inventory.item_unit_conversions` (item-specific).
 *
 * Two tables because master-data-strategy.md §3.4 names two kinds of
 * conversion and they have different uniqueness scopes:
 * - global: `(organization_id, from_unit_id, to_unit_id, valid_from)`
 * - item-specific: `(item_id, from_unit_id, to_unit_id, valid_from)`
 *
 * Both are read through one repository so the service can treat "a conversion"
 * uniformly while the storage stays explicit and indexable.
 *
 * Version rows are never rewritten except to be **closed**: supersession sets
 * `valid_to` on the previous open-ended version, which is exactly how
 * historical meaning is preserved (D-21/D-26). There is no `delete` here at
 * all.
 *
 * **Concurrency.** A version write is read-plan-close-insert, and the plan
 * MUST be computed against locked, fresh rows — not against a snapshot read
 * outside the transaction. Two concurrent creates for one pair that each
 * planned on a stale read could otherwise both insert open-ended versions
 * (no shared row ever conflicted), leaving the pair with overlapping windows
 * the planner then rejects forever. Every create therefore takes a
 * pair-scoped `pg_advisory_xact_lock` FIRST, re-reads the versions, plans,
 * closes and inserts — exactly the serialization the posting core gets from
 * `inventory-locks.ts` (same documented concurrency-critical raw-SQL path,
 * docs/modules.md §Inventory, AR-11). The lock is a single advisory key per
 * unit pair, so there is no lock-ordering cycle with anything else.
 */

type ConversionRow = {
  id: string;
  organizationId: string;
  fromUnitId: string;
  toUnitId: string;
  /** Prisma maps `numeric(18,6)` to Decimal; the driver adapter yields a string. */
  factor: string;
  validFrom: Date;
  validTo: Date | null;
} & AuditColumns;

type ItemConversionRow = ConversionRow & { itemId: string };

/** Half-open window filter: `valid_from <= activeAt < valid_to` (or open). */
interface ActiveAtFilter {
  validFrom: { lte: Date };
  OR: Array<{ validTo: null } | { validTo: { gt: Date } }>;
}

interface GlobalWhere {
  organizationId?: string;
  fromUnitId?: string;
  toUnitId?: string;
  validFrom?: { lte: Date };
  OR?: Array<{ validTo: null } | { validTo: { gt: Date } }>;
}

interface ItemWhere extends GlobalWhere {
  itemId?: string;
}

interface GlobalCreate {
  id: string;
  organizationId: string;
  fromUnitId: string;
  toUnitId: string;
  factor: string;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

interface ItemCreate extends GlobalCreate {
  itemId: string;
}

/** The only shape a version row is ever updated with: close its window. */
interface CloseUpdate {
  validTo: Date;
  updatedAt: Date;
  updatedBy: string | null;
}

type GlobalDelegate = {
  findUnique(args: { where: { id: string } }): Promise<ConversionRow | null>;
  findMany(args: {
    where: GlobalWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<ConversionRow[]>;
  count(args: { where: GlobalWhere }): Promise<number>;
  create(args: { data: GlobalCreate }): Promise<ConversionRow>;
  update(args: {
    where: { id: string };
    data: CloseUpdate;
  }): Promise<ConversionRow>;
};

type ItemDelegate = {
  findUnique(args: {
    where: { id: string };
  }): Promise<ItemConversionRow | null>;
  findMany(args: {
    where: ItemWhere;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<ItemConversionRow[]>;
  count(args: { where: ItemWhere }): Promise<number>;
  create(args: { data: ItemCreate }): Promise<ItemConversionRow>;
  update(args: {
    where: { id: string };
    data: CloseUpdate;
  }): Promise<ItemConversionRow>;
};

type Client = {
  unitConversion: GlobalDelegate;
  itemUnitConversion: ItemDelegate;
};

type RawQuery = <T>(
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

type TxClient = Client & { $queryRaw: RawQuery };

/**
 * The version plan no longer holds against the rows re-read inside the
 * transaction (a concurrent create changed the pair first). Plain, HTTP-free
 * error — the application service maps it onto the stable 422 model, exactly
 * like the posting errors in `inventory-posting-errors.ts`. The caller's
 * whole write rolls back, so a rejected plan never half-applies.
 */
export class ConversionPlanRejectedError extends Error {
  readonly problem: ConversionVersionProblem;

  constructor(problem: ConversionVersionProblem) {
    super(`Conversion version plan rejected: ${problem}.`);
    this.name = 'ConversionPlanRejectedError';
    this.problem = problem;
  }
}

/** The version write plus the version it actually closed (for the event). */
export interface PlannedVersionWrite {
  conversion: UnitConversion;
  supersededConversionId: string | null;
}

/** Which table a conversion version lives in. */
export type ConversionScope = 'global' | 'item';

export interface StoredConversion {
  scope: ConversionScope;
  conversion: UnitConversion;
}

export interface ConversionVersionFilter {
  organizationId: string;
  fromUnitId?: string | undefined;
  toUnitId?: string | undefined;
  /** Only versions in force at this instant. */
  activeAt?: Date | undefined;
}

export interface ItemConversionVersionFilter extends ConversionVersionFilter {
  itemId: string;
}

@Injectable()
export class UnitConversionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  // ---- reads --------------------------------------------------------------

  /** All versions of one global pair, oldest first (version planning). */
  async findGlobalVersions(
    organizationId: string,
    fromUnitId: string,
    toUnitId: string,
  ): Promise<UnitConversion[]> {
    const { unitConversion } = await this.client();
    const rows = await unitConversion.findMany({
      where: { organizationId, fromUnitId, toUnitId },
      orderBy: [{ validFrom: 'asc' }],
      skip: 0,
      take: Number.MAX_SAFE_INTEGER,
    });
    return rows.map((row) => toGlobalDomain(row));
  }

  /** All versions of one item-specific pair, oldest first. */
  async findItemVersions(
    itemId: string,
    fromUnitId: string,
    toUnitId: string,
  ): Promise<UnitConversion[]> {
    const { itemUnitConversion } = await this.client();
    const rows = await itemUnitConversion.findMany({
      where: { itemId, fromUnitId, toUnitId },
      orderBy: [{ validFrom: 'asc' }],
      skip: 0,
      take: Number.MAX_SAFE_INTEGER,
    });
    return rows.map((row) => toItemDomain(row));
  }

  async findGlobalById(id: string): Promise<UnitConversion | null> {
    const { unitConversion } = await this.client();
    const row = await unitConversion.findUnique({ where: { id } });
    return row === null ? null : toGlobalDomain(row);
  }

  async findItemById(id: string): Promise<UnitConversion | null> {
    const { itemUnitConversion } = await this.client();
    const row = await itemUnitConversion.findUnique({ where: { id } });
    return row === null ? null : toItemDomain(row);
  }

  /** Global lookup that also reports which table the row came from. */
  async findStoredById(id: string): Promise<StoredConversion | null> {
    const global = await this.findGlobalById(id);
    if (global !== null) return { scope: 'global', conversion: global };
    const item = await this.findItemById(id);
    if (item !== null) return { scope: 'item', conversion: item };
    return null;
  }

  async listGlobal(params: {
    where: ConversionVersionFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: UnitConversion[]; total: number }> {
    const { unitConversion } = await this.client();
    const where = toGlobalWhere(params.where);
    const [rows, total] = await Promise.all([
      unitConversion.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      unitConversion.count({ where }),
    ]);
    return { items: rows.map(toGlobalDomain), total };
  }

  async listForItem(params: {
    where: ItemConversionVersionFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: UnitConversion[]; total: number }> {
    const { itemUnitConversion } = await this.client();
    const where: ItemWhere = {
      ...toGlobalWhere(params.where),
      itemId: params.where.itemId,
    };
    const [rows, total] = await Promise.all([
      itemUnitConversion.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      itemUnitConversion.count({ where }),
    ]);
    return { items: rows.map(toItemDomain), total };
  }

  // ---- writes -------------------------------------------------------------

  /**
   * Insert a new GLOBAL version, closing the open-ended version it supersedes
   * in the SAME transaction.
   *
   * The whole plan runs here, not in the service: the transaction first takes
   * the pair's advisory lock, so concurrent creates for the same
   * (organization, from, to) serialize; the planner then reads the committed
   * rows, so its decision can never be based on a pre-lock snapshot. A pair
   * is therefore never observable with two open-ended versions, a failed
   * close can never leave a version closed without its replacement, and a
   * supersession attempt that no longer fits throws
   * `ConversionPlanRejectedError` and rolls the insert back entirely.
   *
   * `hashtextextended(value, seed)` is deterministic within one database, so
   * every process computes the same advisory key for the same pair.
   */
  async createGlobalVersion(input: {
    create: GlobalCreate;
    closeAudit: { updatedAt: Date; updatedBy: string | null };
  }): Promise<PlannedVersionWrite> {
    const client = await this.prisma.getClient<
      Client & {
        $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
      }
    >();
    return client.$transaction(async (tx) => {
      const scoped = tx as TxClient;
      await scoped.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`unit_conversions|${input.create.organizationId}|${input.create.fromUnitId}|${input.create.toUnitId}`},
            0
          )
        )`;
      const existingRows = await scoped.unitConversion.findMany({
        where: {
          organizationId: input.create.organizationId,
          fromUnitId: input.create.fromUnitId,
          toUnitId: input.create.toUnitId,
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
        existing: existingRows.map(toGlobalDomain),
      });
      if (plan.problem !== null) {
        throw new ConversionPlanRejectedError(plan.problem);
      }
      if (plan.supersededId !== null) {
        await scoped.unitConversion.update({
          where: { id: plan.supersededId },
          data: {
            validTo: input.create.validFrom,
            updatedAt: input.closeAudit.updatedAt,
            updatedBy: input.closeAudit.updatedBy,
          },
        });
      }
      const conversion = toGlobalDomain(
        await scoped.unitConversion.create({ data: input.create }),
      );
      return { conversion, supersededConversionId: plan.supersededId };
    });
  }

  /** Item-specific counterpart of `createGlobalVersion`. */
  async createItemVersion(input: {
    create: ItemCreate;
    closeAudit: { updatedAt: Date; updatedBy: string | null };
  }): Promise<PlannedVersionWrite> {
    const client = await this.prisma.getClient<
      Client & {
        $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
      }
    >();
    const supersessionScope = `${input.create.itemId}`;
    return client.$transaction(async (tx) => {
      const scoped = tx as TxClient;
      await scoped.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`item_unit_conversions|${supersessionScope}|${input.create.fromUnitId}|${input.create.toUnitId}`},
            0
          )
        )`;
      const existingRows = await scoped.itemUnitConversion.findMany({
        where: {
          itemId: input.create.itemId,
          fromUnitId: input.create.fromUnitId,
          toUnitId: input.create.toUnitId,
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
        existing: existingRows.map(toItemDomain),
      });
      if (plan.problem !== null) {
        throw new ConversionPlanRejectedError(plan.problem);
      }
      if (plan.supersededId !== null) {
        await scoped.itemUnitConversion.update({
          where: { id: plan.supersededId },
          data: {
            validTo: input.create.validFrom,
            updatedAt: input.closeAudit.updatedAt,
            updatedBy: input.closeAudit.updatedBy,
          },
        });
      }
      const conversion = toItemDomain(
        await scoped.itemUnitConversion.create({ data: input.create }),
      );
      return { conversion, supersededConversionId: plan.supersededId };
    });
  }
}

// ---- Internal helpers ----

function toGlobalWhere(filter: ConversionVersionFilter): GlobalWhere {
  const where: GlobalWhere = { organizationId: filter.organizationId };
  if (filter.fromUnitId !== undefined) where.fromUnitId = filter.fromUnitId;
  if (filter.toUnitId !== undefined) where.toUnitId = filter.toUnitId;
  if (filter.activeAt !== undefined) {
    const activeAt: ActiveAtFilter = {
      validFrom: { lte: filter.activeAt },
      OR: [{ validTo: null }, { validTo: { gt: filter.activeAt } }],
    };
    where.validFrom = activeAt.validFrom;
    where.OR = activeAt.OR;
  }
  return where;
}

function toGlobalDomain(row: ConversionRow): UnitConversion {
  return {
    id: row.id,
    organizationId: row.organizationId,
    itemId: null,
    fromUnitId: row.fromUnitId,
    toUnitId: row.toUnitId,
    factor: String(row.factor),
    validFrom: row.validFrom,
    validTo: row.validTo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toItemDomain(row: ItemConversionRow): UnitConversion {
  return { ...toGlobalDomain(row), itemId: row.itemId };
}
