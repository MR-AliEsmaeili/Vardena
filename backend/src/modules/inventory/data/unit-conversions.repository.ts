import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type { UnitConversion } from '../domain/unit-conversion.js';
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
 * Version rows are never rewritten except to be **closed**: `closeVersion`
 * sets `valid_to` on the superseded version, which is exactly how historical
 * meaning is preserved (D-21/D-26). There is no `delete` here at all.
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
   * Insert a new GLOBAL version and, when it supersedes one, close the previous
   * version in the SAME transaction. A pair is therefore never observable with
   * two open-ended versions, and a failed close can never leave a version
   * closed without its replacement.
   */
  async createGlobalVersion(input: {
    create: GlobalCreate;
    supersededId: string | null;
    close: CloseUpdate;
  }): Promise<UnitConversion> {
    const client = await this.prisma.getClient<
      Client & {
        $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
      }
    >();
    return client.$transaction(async (tx) => {
      const scoped = tx as Client;
      if (input.supersededId !== null) {
        await scoped.unitConversion.update({
          where: { id: input.supersededId },
          data: input.close,
        });
      }
      return toGlobalDomain(
        await scoped.unitConversion.create({ data: input.create }),
      );
    });
  }

  /** Item-specific counterpart of `createGlobalVersion`. */
  async createItemVersion(input: {
    create: ItemCreate;
    supersededId: string | null;
    close: CloseUpdate;
  }): Promise<UnitConversion> {
    const client = await this.prisma.getClient<
      Client & {
        $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
      }
    >();
    return client.$transaction(async (tx) => {
      const scoped = tx as Client;
      if (input.supersededId !== null) {
        await scoped.itemUnitConversion.update({
          where: { id: input.supersededId },
          data: input.close,
        });
      }
      return toItemDomain(
        await scoped.itemUnitConversion.create({ data: input.create }),
      );
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
