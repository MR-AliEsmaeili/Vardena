import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { ItemsRepository } from '../data/items.repository.js';
import { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import { InventoryBalancesRepository } from '../data/inventory-balances.repository.js';
import type { Item, ItemDto } from '../domain/item.js';
import { toItemDto } from '../domain/item.js';
import { ITEM_KINDS, isItemKind, type ItemKind } from '../domain/item-kind.js';
import {
  capabilityProblemMessage,
  findCapabilityProblem,
  resolveCapabilities,
  type CapabilityOverrides,
  type ItemCapabilities,
} from '../domain/item-capabilities.js';
import {
  isNonBlank,
  MAX_BARCODE_LENGTH,
  normalizeCode,
  normalizeName,
} from '../domain/master-data.js';
import { ITEM_PERMISSIONS } from '../domain/inventory-permissions.js';
import {
  ITEM_CREATED_EVENT,
  ITEM_DISABLED_EVENT,
  ITEM_ENABLED_EVENT,
  ITEM_UPDATED_EVENT,
} from '../domain/inventory.events.js';
import {
  assertCodeAndName,
  assertUsable,
  publishEvent,
  resolveSort,
} from './master-data-support.js';
import { ItemGroupsService } from './item-groups.service.js';
import { UnitsService } from './units.service.js';

const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  name: 'name',
  itemKind: 'itemKind',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

/** `items.description` has no column width (text); this is an API guard only. */
const MAX_DESCRIPTION_LENGTH = 2000;

export interface ListItemsQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  isActive?: boolean | undefined;
  itemKind?: ItemKind | undefined;
  itemGroupId?: string | undefined;
  isStockable?: boolean | undefined;
  isSellable?: boolean | undefined;
  isPurchasable?: boolean | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreateItemInput extends CapabilityOverrides {
  organizationId: string;
  code: string;
  name: string;
  description?: string | null | undefined;
  itemKind: string;
  itemGroupId?: string | null | undefined;
  baseUnitId: string;
  /** Item-level negative-stock override; omit to follow the warehouse. */
  allowNegativeStock?: boolean | undefined;
  barcode?: string | null | undefined;
}

export interface UpdateItemInput extends CapabilityOverrides {
  code?: string | undefined;
  name?: string | undefined;
  description?: string | null | undefined;
  itemGroupId?: string | null | undefined;
  baseUnitId?: string | undefined;
  /** Set `null` to clear the override and follow the warehouse again. */
  allowNegativeStock?: boolean | null | undefined;
  barcode?: string | null | undefined;
}

/**
 * Item administration — the single item master (D-25,
 * master-data-strategy.md §3, OQ-33).
 *
 * Model in one paragraph: ONE entity, a closed code-defined `itemKind` that
 * supplies capability defaults **at creation**, and seven stored capability
 * booleans that are the truth afterwards. Goods and services are the same
 * entity with different flags (`service`: stockable=false, sellable=true;
 * stocked good: stockable=true, sellable=true). There is no Product/Service/
 * StockItem table, no EAV, and no JSONB attribute bag.
 *
 * Organization consistency is enforced here, not assumed: the item group and
 * the base unit must both belong to the item's organization. A foreign key
 * cannot express that, so it lives in this service.
 *
 * `itemKind` is immutable after creation. Kind only supplies defaults
 * (master-data-strategy.md §7.2), so changing it would raise the question of
 * whether to re-apply those defaults over flags the user may have set
 * deliberately — a rule nobody has approved. An item created with the wrong
 * kind is disabled and replaced. Recorded in
 * docs/architecture/domain/organization-master-data.md.
 *
 * `baseUnitId` is frozen once movements exist (Task 6 left it editable because
 * nothing referenced it yet; the freeze guards below close that gap):
 * historical quantities are stored in the original base unit, so changing it
 * would silently reinterpret history (D-21, ADR-0022). The same freeze
 * applies to turning `isStockable` off with movements on record, and to
 * disabling an item that still holds stock — all three would strand or
 * orphan quantities the ledger already facts about.
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly repository: ItemsRepository,
    private readonly organizations: OrganizationsService,
    private readonly itemGroups: ItemGroupsService,
    private readonly units: UnitsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
    private readonly movements: InventoryMovementsRepository,
    private readonly balances: InventoryBalancesRepository,
  ) {}

  async listItems(query: ListItemsQuery): Promise<PaginatedResult<ItemDto>> {
    await this.authorization.requireAllPermissions([ITEM_PERMISSIONS.VIEW]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        isActive: query.isActive,
        itemKind: query.itemKind,
        itemGroupId: query.itemGroupId,
        isStockable: query.isStockable,
        isSellable: query.isSellable,
        isPurchasable: query.isPurchasable,
        search: query.search,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [{ code: 'asc' }]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toItemDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getItem(id: string): Promise<ItemDto> {
    await this.authorization.requireAllPermissions([ITEM_PERMISSIONS.VIEW]);
    return toItemDto(await this.mustFind(id));
  }

  async createItem(input: CreateItemInput): Promise<ItemDto> {
    await this.authorization.requireAllPermissions([ITEM_PERMISSIONS.CREATE]);

    const code = normalizeCode(input.code);
    const name = normalizeName(input.name);
    const description = normalizeOptional(input.description);
    const barcode = normalizeOptional(input.barcode);
    const itemKind = requireItemKind(input.itemKind);
    assertCodeAndName(code, name);
    assertOptionalText('Description', description, MAX_DESCRIPTION_LENGTH);
    assertOptionalText('Barcode', barcode, MAX_BARCODE_LENGTH);

    await this.organizations.requireUsableOrganization(input.organizationId);

    const itemGroupId = input.itemGroupId ?? null;
    if (itemGroupId !== null) {
      // Cross-organization groups are rejected here (404 — see the note in
      // `ItemGroupsService.requireUsableItemGroupInOrganization`).
      await this.itemGroups.requireUsableItemGroupInOrganization(
        itemGroupId,
        input.organizationId,
      );
    }
    await this.units.requireUsableUnitInOrganization(
      input.baseUnitId,
      input.organizationId,
    );

    // Kind supplies defaults; the caller's explicit flags win. Resolved ONCE,
    // here — nothing re-derives capabilities later (master-data-strategy §7.2).
    const capabilities = resolveCapabilities(itemKind, input);
    assertCapabilities(capabilities);

    const existing = await this.repository.findByCode(
      input.organizationId,
      code,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'An item with that code already exists in this organization.',
      );
    }

    const now = new Date();
    let created: Item;
    try {
      created = await this.repository.create({
        id: generateId(),
        organizationId: input.organizationId,
        code,
        name,
        description,
        itemKind,
        itemGroupId,
        baseUnitId: input.baseUnitId,
        ...capabilities,
        allowNegativeStock: input.allowNegativeStock ?? null,
        barcode,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: getPrincipal()?.userId ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'An item with that code already exists in this organization.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: ITEM_CREATED_EVENT,
      aggregateType: 'Item',
      aggregateId: created.id,
      payload: {
        id: created.id,
        organizationId: created.organizationId,
        code: created.code,
      },
    });
    this.logger.log(
      'Item created',
      {
        itemId: created.id,
        organizationId: created.organizationId,
        itemKind: created.itemKind,
      },
      ItemsService.name,
    );
    return toItemDto(created);
  }

  async updateItem(id: string, input: UpdateItemInput): Promise<ItemDto> {
    await this.authorization.requireAllPermissions([ITEM_PERMISSIONS.EDIT]);
    const current = await this.mustFind(id);

    const code =
      input.code === undefined ? undefined : normalizeCode(input.code);
    const name =
      input.name === undefined ? undefined : normalizeName(input.name);
    const description =
      input.description === undefined
        ? undefined
        : normalizeOptional(input.description);
    const barcode =
      input.barcode === undefined
        ? undefined
        : normalizeOptional(input.barcode);
    assertCodeAndName(code ?? current.code, name ?? current.name);
    assertOptionalText(
      'Description',
      description === undefined ? current.description : description,
      MAX_DESCRIPTION_LENGTH,
    );
    assertOptionalText(
      'Barcode',
      barcode === undefined ? current.barcode : barcode,
      MAX_BARCODE_LENGTH,
    );

    if (code !== undefined && code !== current.code) {
      const taken = await this.repository.findByCodeExcludingId(
        current.organizationId,
        code,
        id,
      );
      if (taken !== null) {
        throw AppException.conflict(
          'An item with that code already exists in this organization.',
        );
      }
    }

    // The stored flags are the truth; an edit changes them directly and the
    // invariants are re-checked on the resulting set. The kind is NOT
    // re-applied, so an edit never silently rewrites flags the user set.
    const capabilities: ItemCapabilities = {
      isStockable: input.isStockable ?? current.isStockable,
      isPurchasable: input.isPurchasable ?? current.isPurchasable,
      isSellable: input.isSellable ?? current.isSellable,
      isValued: input.isValued ?? current.isValued,
      requiresLot: input.requiresLot ?? current.requiresLot,
      requiresSerial: input.requiresSerial ?? current.requiresSerial,
      requiresExpiry: input.requiresExpiry ?? current.requiresExpiry,
    };
    assertCapabilities(capabilities);

    // Freeze guards (ADR-0022): with movements on record, the item's stock
    // identity is facts the ledger owns — turning stockable off would orphan
    // that history and trap any remaining quantities (new movements for a
    // non-stockable item are rejected).
    if (current.isStockable && !capabilities.isStockable) {
      if (await this.movements.existsForItem(id)) {
        throw AppException.businessRule(
          'This item cannot be made non-stockable: inventory movements already exist for it.',
        );
      }
    }

    // The capability flags are declared on the patch type rather than smuggled
    // in by the spread: TypeScript does not excess-property-check spreads, so
    // an undeclared field here would compile while the type claimed it was not
    // being written.
    const patch: ItemCapabilities & {
      code?: string;
      name?: string;
      description?: string | null;
      itemGroupId?: string | null;
      baseUnitId?: string;
      allowNegativeStock?: boolean | null;
      barcode?: string | null;
      updatedAt: Date;
      updatedBy: string | null;
    } = {
      ...capabilities,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    };
    if (code !== undefined) patch.code = code;
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (barcode !== undefined) patch.barcode = barcode;
    if (input.allowNegativeStock !== undefined) {
      patch.allowNegativeStock = input.allowNegativeStock;
    }

    // Organization consistency is re-checked only when the reference changes:
    // an item whose group or base unit was disabled afterwards stays editable.
    if (
      input.itemGroupId !== undefined &&
      input.itemGroupId !== current.itemGroupId
    ) {
      const itemGroupId = input.itemGroupId;
      patch.itemGroupId = itemGroupId;
      if (itemGroupId !== null) {
        await this.itemGroups.requireUsableItemGroupInOrganization(
          itemGroupId,
          current.organizationId,
        );
      }
    }
    if (
      input.baseUnitId !== undefined &&
      input.baseUnitId !== current.baseUnitId
    ) {
      // Freeze guard (ADR-0022): every movement snapshots this unit, so a
      // change would reinterpret recorded history (D-21).
      if (await this.movements.existsForItem(id)) {
        throw AppException.businessRule(
          'The base unit cannot be changed once inventory movements exist for this item.',
        );
      }
      patch.baseUnitId = input.baseUnitId;
      await this.units.requireUsableUnitInOrganization(
        input.baseUnitId,
        current.organizationId,
      );
    }

    const updated = await this.repository.update(id, patch);
    if (updated === null) throw AppException.notFound('Item', id);

    await publishEvent(this.events, {
      type: ITEM_UPDATED_EVENT,
      aggregateType: 'Item',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toItemDto(updated);
  }

  async enableItem(id: string): Promise<ItemDto> {
    return this.setActive(id, true, ITEM_PERMISSIONS.ENABLE);
  }

  async disableItem(id: string): Promise<ItemDto> {
    return this.setActive(id, false, ITEM_PERMISSIONS.DISABLE);
  }

  /**
   * Reference resolution for the future Inventory/Sales/Purchasing flows: a
   * document line's item is resolved through this method (AR-07).
   *
   * Note the deliberate asymmetry with the lifecycle rule: a *disabled* item
   * must stay resolvable so historical documents keep rendering
   * (master-data-strategy.md §7.4 "keeps history readable and reportable").
   * Callers creating new documents pass `allowInactive: false`; callers reading
   * history pass `allowInactive: true`.
   */
  async requireUsableItemInOrganization(
    id: string,
    organizationId: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<Item> {
    const item = await this.repository.findById(id);
    if (item === null || item.organizationId !== organizationId) {
      throw AppException.notFound('Item', id);
    }
    assertUsable('Item', item.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return item;
  }

  // ---- internals ----------------------------------------------------------

  private async setActive(
    id: string,
    isActive: boolean,
    permission: string,
  ): Promise<ItemDto> {
    await this.authorization.requireAllPermissions([permission]);
    const current = await this.mustFind(id);
    if (current.isActive === isActive) return toItemDto(current);

    // Freeze guard (ADR-0022): disabling blocks new movements, so disabling
    // an item that still holds stock would trap those quantities forever.
    if (!isActive && (await this.balances.hasBlockingBalanceForItem(id))) {
      throw AppException.businessRule(
        'This item cannot be disabled while it still holds stock. Move or adjust the remaining quantities first.',
      );
    }

    const updated = await this.repository.update(id, {
      isActive,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null) throw AppException.notFound('Item', id);

    await publishEvent(this.events, {
      type: isActive ? ITEM_ENABLED_EVENT : ITEM_DISABLED_EVENT,
      aggregateType: 'Item',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    this.logger.log(
      isActive ? 'Item enabled' : 'Item disabled',
      { itemId: updated.id, organizationId: updated.organizationId },
      ItemsService.name,
    );
    return toItemDto(updated);
  }

  private async mustFind(id: string): Promise<Item> {
    const item = await this.repository.findById(id);
    if (item === null) throw AppException.notFound('Item', id);
    return item;
  }
}

// ---- Internal helpers ----

/**
 * The kind list is closed and code-defined: anything else is a malformed
 * request, not a domain-rule violation. Adding a kind is a code change
 * (`domain/item-kind.ts`) plus a migration, never data entry.
 */
function requireItemKind(value: string): ItemKind {
  if (!isItemKind(value)) {
    throw AppException.badRequest(
      `Item kind must be one of: ${ITEM_KINDS.join(', ')}.`,
    );
  }
  return value;
}

function assertCapabilities(capabilities: ItemCapabilities): void {
  const problem = findCapabilityProblem(capabilities);
  if (problem !== null) {
    throw AppException.businessRule(capabilityProblemMessage(problem));
  }
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function assertOptionalText(
  label: string,
  value: string | null,
  maxLength: number,
): void {
  if (value !== null && (!isNonBlank(value) || value.length > maxLength)) {
    throw AppException.badRequest(
      `${label} must be at most ${maxLength} characters.`,
    );
  }
}
