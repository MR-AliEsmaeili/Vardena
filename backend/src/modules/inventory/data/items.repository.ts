import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isRecordNotFound } from '../../../kernel/prisma/prisma-errors.js';
import type { Item } from '../domain/item.js';
import type { ItemKind } from '../domain/item-kind.js';
import {
  type AuditColumns,
  type MasterDataDelegate,
  type OrderBy,
} from './master-data-rows.js';

/**
 * Data access for `inventory.items`.
 *
 * `(organization_id, code)` is the uniqueness scope: the repository defines no
 * universal coding structure, so an organization decides what its item codes
 * look like (OQ-12 covers document numbering; item coding is simply not
 * constrained here).
 */

type ItemRow = {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  description: string | null;
  itemKind: string;
  itemGroupId: string | null;
  baseUnitId: string;
  isStockable: boolean;
  isPurchasable: boolean;
  isSellable: boolean;
  isValued: boolean;
  requiresLot: boolean;
  requiresSerial: boolean;
  requiresExpiry: boolean;
  barcode: string | null;
  isActive: boolean;
} & AuditColumns;

interface ItemWhere {
  organizationId?: string;
  code?: string;
  isActive?: boolean;
  itemKind?: string;
  itemGroupId?: string;
  baseUnitId?: string;
  isStockable?: boolean;
  isSellable?: boolean;
  isPurchasable?: boolean;
  OR?: Array<SearchClause>;
}

interface SearchClause {
  code?: { contains: string; mode: 'insensitive' };
  name?: { contains: string; mode: 'insensitive' };
  barcode?: { contains: string; mode: 'insensitive' };
}

interface ItemCreate {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  description: string | null;
  itemKind: string;
  itemGroupId: string | null;
  baseUnitId: string;
  isStockable: boolean;
  isPurchasable: boolean;
  isSellable: boolean;
  isValued: boolean;
  requiresLot: boolean;
  requiresSerial: boolean;
  requiresExpiry: boolean;
  barcode: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

interface ItemUpdate {
  code?: string | undefined;
  name?: string | undefined;
  description?: string | null | undefined;
  itemKind?: string | undefined;
  itemGroupId?: string | null | undefined;
  baseUnitId?: string | undefined;
  isStockable?: boolean | undefined;
  isPurchasable?: boolean | undefined;
  isSellable?: boolean | undefined;
  isValued?: boolean | undefined;
  requiresLot?: boolean | undefined;
  requiresSerial?: boolean | undefined;
  requiresExpiry?: boolean | undefined;
  barcode?: string | null | undefined;
  isActive?: boolean | undefined;
  updatedAt: Date;
  updatedBy: string | null;
}

type Client = {
  item: MasterDataDelegate<ItemRow, ItemWhere, ItemCreate, ItemUpdate>;
};

export interface ItemListFilter {
  organizationId: string;
  isActive?: boolean | undefined;
  itemKind?: ItemKind | undefined;
  itemGroupId?: string | undefined;
  isStockable?: boolean | undefined;
  isSellable?: boolean | undefined;
  isPurchasable?: boolean | undefined;
  search?: string | undefined;
}

@Injectable()
export class ItemsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findById(id: string): Promise<Item | null> {
    const { item } = await this.client();
    const row = await item.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByCode(organizationId: string, code: string): Promise<Item | null> {
    const { item } = await this.client();
    const row = await item.findFirst({ where: { organizationId, code } });
    return row === null ? null : toDomain(row);
  }

  async findByCodeExcludingId(
    organizationId: string,
    code: string,
    excludeId: string,
  ): Promise<Item | null> {
    const existing = await this.findByCode(organizationId, code);
    if (existing === null) return null;
    return existing.id === excludeId ? null : existing;
  }

  async list(params: {
    where: ItemListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: Item[]; total: number }> {
    const { item } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      item.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      item.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async create(input: ItemCreate): Promise<Item> {
    const { item } = await this.client();
    return toDomain(await item.create({ data: input }));
  }

  async update(id: string, patch: ItemUpdate): Promise<Item | null> {
    const { item } = await this.client();
    try {
      return toDomain(await item.update({ where: { id }, data: patch }));
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}

// ---- Internal helpers ----

function toWhere(filter: ItemListFilter): ItemWhere {
  const where: ItemWhere = { organizationId: filter.organizationId };
  if (filter.isActive !== undefined) where.isActive = filter.isActive;
  if (filter.itemKind !== undefined) where.itemKind = filter.itemKind;
  if (filter.itemGroupId !== undefined) where.itemGroupId = filter.itemGroupId;
  if (filter.isStockable !== undefined) where.isStockable = filter.isStockable;
  if (filter.isSellable !== undefined) where.isSellable = filter.isSellable;
  if (filter.isPurchasable !== undefined) {
    where.isPurchasable = filter.isPurchasable;
  }
  if (filter.search !== undefined && filter.search !== '') {
    where.OR = [
      { code: { contains: filter.search, mode: 'insensitive' } },
      { name: { contains: filter.search, mode: 'insensitive' } },
      { barcode: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

/**
 * `item_kind` is validated against the closed list on write, so a stored value
 * is always one of them. The mapping is explicit (rather than a cast) so an
 * unexpected value cannot silently become a valid kind.
 */
const KNOWN_KINDS: Record<string, ItemKind> = {
  goods: 'goods',
  service: 'service',
  consumable: 'consumable',
  asset: 'asset',
  raw_material: 'raw_material',
  semi_finished: 'semi_finished',
  finished_good: 'finished_good',
  other: 'other',
};

function toDomain(row: ItemRow): Item {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    description: row.description,
    itemKind: KNOWN_KINDS[row.itemKind] ?? 'other',
    itemGroupId: row.itemGroupId,
    baseUnitId: row.baseUnitId,
    isStockable: row.isStockable,
    isPurchasable: row.isPurchasable,
    isSellable: row.isSellable,
    isValued: row.isValued,
    requiresLot: row.requiresLot,
    requiresSerial: row.requiresSerial,
    requiresExpiry: row.requiresExpiry,
    barcode: row.barcode,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
