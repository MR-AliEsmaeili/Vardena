import type { ItemKind } from './item-kind.js';
import type { ItemCapabilities } from './item-capabilities.js';

/**
 * Item — the single item master (D-25, master-data-strategy.md §3, OQ-33).
 *
 * Goods, services, consumables and assets are all Items. They differ by
 * `itemKind` (which supplies defaults) and by the stored capability flags
 * (which are the truth), never by table. There is deliberately no `Product`,
 * `Service`, `Material`, `Good`, `StockItem` or `SellableItem` entity, no EAV
 * attribute table and no free-form JSONB attributes (options I-3/I-4/I-5 are
 * evaluated and rejected in master-data-strategy.md §3.1).
 *
 * Group relationship: **one item → at most one item group** (`itemGroupId`).
 * That is what master-data-strategy.md §3.2 specifies; a many-to-many
 * classification was not approved and would make "the group of an item"
 * ambiguous for reporting and defaults. Groups supply creation-time defaults
 * only and never override an existing item at runtime (§7.2).
 *
 * Lifecycle: `isActive` (disable blocks new usage; historical documents keep
 * resolving the item — §7.4/§7.8). No delete in Task 6 (OQ-36).
 *
 * Framework-free (AR-05).
 */

export interface Item extends ItemCapabilities {
  id: string;
  organizationId: string;
  /** Business key, unique within the organization. */
  code: string;
  name: string;
  description: string | null;
  /** Closed, code-defined; see `item-kind.ts`. */
  itemKind: ItemKind;
  itemGroupId: string | null;
  /** The unit every quantity for this item is stored in (§3.4). */
  baseUnitId: string;
  /**
   * Item-level override of the warehouse negative-stock policy (D-07,
   * ADR-0022). `null` (the default) means "follow the warehouse"; an explicit
   * true/false wins.
   */
  allowNegativeStock: boolean | null;
  barcode: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ItemDto extends ItemCapabilities {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  description: string | null;
  itemKind: ItemKind;
  itemGroupId: string | null;
  baseUnitId: string;
  allowNegativeStock: boolean | null;
  barcode: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toItemDto(item: Item): ItemDto {
  return {
    id: item.id,
    organizationId: item.organizationId,
    code: item.code,
    name: item.name,
    description: item.description,
    itemKind: item.itemKind,
    itemGroupId: item.itemGroupId,
    baseUnitId: item.baseUnitId,
    allowNegativeStock: item.allowNegativeStock,
    isStockable: item.isStockable,
    isPurchasable: item.isPurchasable,
    isSellable: item.isSellable,
    isValued: item.isValued,
    requiresLot: item.requiresLot,
    requiresSerial: item.requiresSerial,
    requiresExpiry: item.requiresExpiry,
    barcode: item.barcode,
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
