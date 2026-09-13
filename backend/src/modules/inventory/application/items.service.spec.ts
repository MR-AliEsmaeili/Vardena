import { beforeEach, describe, expect, it } from 'vitest';
import {
  DomainEventBus,
  type DomainEvent,
} from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { UnitsService } from './units.service.js';
import { ItemGroupsService } from './item-groups.service.js';
import { ItemsService } from './items.service.js';
import type { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import type { InventoryBalancesRepository } from '../data/inventory-balances.repository.js';
import {
  ITEM_CREATED_EVENT,
  ITEM_UPDATED_EVENT,
} from '../domain/inventory.events.js';

/**
 * `ItemsService` — the densest rule set in Task 6 (D-25,
 * master-data-strategy.md §3).
 *
 * Covered here: kind defaults resolved once at creation, the `itemKind`
 * immutability decision, capability invariants on both create and update,
 * cross-module reference resolution through the Organization/Unit services, and
 * the organization-scoped code rule.
 */

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

interface Fixture {
  organizations: OrganizationsService;
  units: UnitsService;
  itemGroups: ItemGroupsService;
  items: ItemsService;
  stores: ReturnType<typeof createMasterDataStores>;
  events: DomainEvent[];
  organizationId: string;
  unitId: string;
}

async function buildFixture(): Promise<Fixture> {
  const stores = createMasterDataStores();
  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  for (const type of [ITEM_CREATED_EVENT, ITEM_UPDATED_EVENT]) {
    bus.on(type, (event) => {
      events.push(event);
    });
  }

  // No request context → system context, so authorization is the caller's
  // concern (see AuthorizationService). Authorization itself is covered by
  // master-data-authorization.spec.ts.
  const authorization = new AuthorizationService(
    // The check short-circuits before touching the repository.
    undefined as never,
    loggerStub(),
  );

  const organizations = new OrganizationsService(
    stores.organizations,
    authorization,
    loggerStub(),
    bus,
    UNPINNED_APP_CONFIG,
  );
  const units = new UnitsService(
    stores.units,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );
  const itemGroups = new ItemGroupsService(
    stores.itemGroups,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );
  // Freeze-guard seam (ADR-0022): no movements or balances on record, so the
  // guards never fire here — they are covered by the core specs.
  const noMovements = {
    existsForItem: async () => false,
  } as unknown as InventoryMovementsRepository;
  const noBalances = {
    hasBlockingBalanceForItem: async () => false,
  } as unknown as InventoryBalancesRepository;
  const items = new ItemsService(
    stores.items,
    organizations,
    itemGroups,
    units,
    authorization,
    loggerStub(),
    bus,
    noMovements,
    noBalances,
  );

  const organizationId = (
    await organizations.createOrganization({ code: 'ORG-A', name: 'Org A' })
  ).id;
  const unitId = (
    await units.createUnit({
      organizationId,
      code: 'PCS',
      name: 'Piece',
      symbol: 'pc',
    })
  ).id;

  return {
    organizations,
    units,
    itemGroups,
    items,
    stores,
    events,
    organizationId,
    unitId,
  };
}

describe('ItemsService creation', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('fills every capability from the kind defaults when none is given', async () => {
    const item = await fixture.items.createItem({
      organizationId: fixture.organizationId,
      code: 'ITM-0001',
      name: 'Steel bolt',
      itemKind: 'goods',
      baseUnitId: fixture.unitId,
    });

    expect(item).toMatchObject({
      isStockable: true,
      isPurchasable: true,
      isSellable: true,
      isValued: true,
      requiresLot: false,
      requiresSerial: false,
      requiresExpiry: false,
    });
    expect(fixture.events.map((event) => event.type)).toEqual([
      ITEM_CREATED_EVENT,
    ]);
  });

  it('stores the NORMALIZED code, not the raw one', async () => {
    // Regression guard: the resolved capability set is spread into the insert,
    // and it must never carry the un-normalized create-input fields back in.
    const item = await fixture.items.createItem({
      organizationId: fixture.organizationId,
      code: '  itm-0002  ',
      name: '  Steel   Nut  ',
      itemKind: 'goods',
      baseUnitId: fixture.unitId,
    });
    expect(item.code).toBe('itm-0002');
    expect(item.name).toBe('Steel Nut');

    const stored = fixture.stores.raw.items.table.findById(item.id);
    expect(stored?.code).toBe('itm-0002');
    expect(stored?.name).toBe('Steel Nut');
  });

  it('lets an explicit capability override the kind default', async () => {
    const item = await fixture.items.createItem({
      organizationId: fixture.organizationId,
      code: 'ITM-0003',
      name: 'Rented drill',
      itemKind: 'goods',
      baseUnitId: fixture.unitId,
      isSellable: false,
      requiresSerial: true,
    });
    expect(item.isSellable).toBe(false);
    expect(item.requiresSerial).toBe(true);
    expect(item.isStockable).toBe(true);
  });

  it('rejects an unknown item kind', async () => {
    await expect(
      fixture.items.createItem({
        organizationId: fixture.organizationId,
        code: 'ITM-0004',
        name: 'Mystery',
        itemKind: 'widget',
        baseUnitId: fixture.unitId,
      }),
    ).rejects.toMatchObject({ code: 'BadRequest' });
  });

  it('rejects a capability combination that contradicts the behaviour table', async () => {
    await expect(
      fixture.items.createItem({
        organizationId: fixture.organizationId,
        code: 'ITM-0005',
        name: 'Non-stockable but valued',
        itemKind: 'goods',
        baseUnitId: fixture.unitId,
        isStockable: false,
        isValued: true,
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('rejects lot tracking on a service (non-stockable by default)', async () => {
    await expect(
      fixture.items.createItem({
        organizationId: fixture.organizationId,
        code: 'ITM-0006',
        name: 'Consulting hour',
        itemKind: 'service',
        baseUnitId: fixture.unitId,
        requiresLot: true,
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('accepts a sellable, non-stockable item (drop-ship/service line)', async () => {
    // Deliberately legal — master-data-strategy.md §20.
    const item = await fixture.items.createItem({
      organizationId: fixture.organizationId,
      code: 'ITM-0007',
      name: 'Drop-shipped widget',
      itemKind: 'service',
      baseUnitId: fixture.unitId,
    });
    expect(item.isSellable).toBe(true);
    expect(item.isStockable).toBe(false);
  });

  it('rejects a base unit that does not exist', async () => {
    await expect(
      fixture.items.createItem({
        organizationId: fixture.organizationId,
        code: 'ITM-0008',
        name: 'No unit',
        itemKind: 'goods',
        baseUnitId: '01NONEXISTENTUNIT000000000AA',
      }),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('rejects a duplicate code within the organization', async () => {
    await fixture.items.createItem({
      organizationId: fixture.organizationId,
      code: 'ITM-0009',
      name: 'First',
      itemKind: 'goods',
      baseUnitId: fixture.unitId,
    });
    await expect(
      fixture.items.createItem({
        organizationId: fixture.organizationId,
        code: 'ITM-0009',
        name: 'Second',
        itemKind: 'goods',
        baseUnitId: fixture.unitId,
      }),
    ).rejects.toMatchObject({ code: 'Conflict' });
  });

  it('classifies the item under an item group of the same organization', async () => {
    const group = await fixture.itemGroups.createItemGroup({
      organizationId: fixture.organizationId,
      code: 'FASTENERS',
      name: 'Fasteners',
    });
    const item = await fixture.items.createItem({
      organizationId: fixture.organizationId,
      code: 'ITM-0010',
      name: 'Grouped bolt',
      itemKind: 'goods',
      itemGroupId: group.id,
      baseUnitId: fixture.unitId,
    });
    expect(item.itemGroupId).toBe(group.id);
  });

  it('rejects an item group from another organization', async () => {
    const otherOrg = (
      await fixture.organizations.createOrganization({
        code: 'ORG-B',
        name: 'Org B',
      })
    ).id;
    const foreignGroup = await fixture.itemGroups.createItemGroup({
      organizationId: otherOrg,
      code: 'FASTENERS',
      name: 'Fasteners',
    });

    // 404 rather than 422: a cross-organization reference is reported as not
    // found so the other tenant's row is not disclosed.
    await expect(
      fixture.items.createItem({
        organizationId: fixture.organizationId,
        code: 'ITM-0011',
        name: 'Foreign group',
        itemKind: 'goods',
        itemGroupId: foreignGroup.id,
        baseUnitId: fixture.unitId,
      }),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('rejects a base unit from another organization', async () => {
    const otherOrg = (
      await fixture.organizations.createOrganization({
        code: 'ORG-B',
        name: 'Org B',
      })
    ).id;
    const foreignUnit = await fixture.units.createUnit({
      organizationId: otherOrg,
      code: 'PCS',
      name: 'Piece',
    });

    await expect(
      fixture.items.createItem({
        organizationId: fixture.organizationId,
        code: 'ITM-0012',
        name: 'Foreign unit',
        itemKind: 'goods',
        baseUnitId: foreignUnit.id,
      }),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });
});

describe('ItemsService update', () => {
  let fixture: Fixture;
  let itemId: string;

  beforeEach(async () => {
    fixture = await buildFixture();
    itemId = (
      await fixture.items.createItem({
        organizationId: fixture.organizationId,
        code: 'ITM-0100',
        name: 'Steel bolt',
        itemKind: 'goods',
        baseUnitId: fixture.unitId,
      })
    ).id;
    fixture.events.length = 0;
  });

  it('keeps the stored capability when a flag is omitted', async () => {
    const updated = await fixture.items.updateItem(fixture.organizationId, itemId, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect(updated.isStockable).toBe(true);
    expect(updated.isValued).toBe(true);
  });

  it('re-checks the invariants on the RESULTING capability set', async () => {
    await expect(
      fixture.items.updateItem(fixture.organizationId, itemId, { isStockable: false }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('accepts a consistent capability change', async () => {
    const updated = await fixture.items.updateItem(fixture.organizationId, itemId, {
      isStockable: false,
      isValued: false,
    });
    expect(updated.isStockable).toBe(false);
    expect(updated.isValued).toBe(false);
    expect(fixture.events.map((event) => event.type)).toEqual([
      ITEM_UPDATED_EVENT,
    ]);
  });

  it('does not re-apply the kind defaults on edit', async () => {
    // The stored flags are the truth: editing the name must not resurrect a
    // default the user turned off.
    await fixture.items.updateItem(fixture.organizationId, itemId, { isSellable: false });
    const renamed = await fixture.items.updateItem(fixture.organizationId, itemId, {
      name: 'Renamed again',
    });
    expect(renamed.isSellable).toBe(false);
  });

  it('cannot change itemKind: the update input has no such field', async () => {
    const before = await fixture.items.getItem(fixture.organizationId, itemId);
    const after = await fixture.items.updateItem(fixture.organizationId, itemId, {
      name: 'Still a goods item',
    });
    expect(after.itemKind).toBe(before.itemKind);
    expect(after.itemKind).toBe('goods');
  });

  it('rejects a duplicate code on rename', async () => {
    await fixture.items.createItem({
      organizationId: fixture.organizationId,
      code: 'ITM-0101',
      name: 'Other',
      itemKind: 'goods',
      baseUnitId: fixture.unitId,
    });
    await expect(
      fixture.items.updateItem(fixture.organizationId, itemId, { code: 'ITM-0101' }),
    ).rejects.toMatchObject({ code: 'Conflict' });
  });

  it('allows renaming to its own current code', async () => {
    const updated = await fixture.items.updateItem(fixture.organizationId, itemId, {
      code: 'ITM-0100',
      name: 'Unchanged code',
    });
    expect(updated.code).toBe('ITM-0100');
  });

  it('re-validates the base unit only when it actually changes', async () => {
    // A reference that was valid when set is not re-litigated on an unrelated
    // edit (master-data-strategy.md §7.4): the item keeps its base unit even
    // after that unit is disabled.
    await fixture.units.disableUnit(fixture.organizationId, fixture.unitId);
    const renamed = await fixture.items.updateItem(fixture.organizationId, itemId, {
      name: 'Still ok',
    });
    expect(renamed.name).toBe('Still ok');
    expect(renamed.baseUnitId).toBe(fixture.unitId);

    // Re-asserting the SAME unit is not a change, so it is a no-op rather than
    // an error — nothing about the item's references moved.
    const reassigned = await fixture.items.updateItem(fixture.organizationId, itemId, {
      baseUnitId: fixture.unitId,
    });
    expect(reassigned.baseUnitId).toBe(fixture.unitId);

    // Moving it to a DIFFERENT disabled unit IS a change, and is refused.
    const otherUnit = await fixture.units.createUnit({
      organizationId: fixture.organizationId,
      code: 'BOX',
      name: 'Box',
    });
    await fixture.units.disableUnit(fixture.organizationId, otherUnit.id);
    await expect(
      fixture.items.updateItem(fixture.organizationId, itemId, { baseUnitId: otherUnit.id }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('clears the item group when set to null', async () => {
    const group = await fixture.itemGroups.createItemGroup({
      organizationId: fixture.organizationId,
      code: 'FASTENERS',
      name: 'Fasteners',
    });
    await fixture.items.updateItem(fixture.organizationId, itemId, { itemGroupId: group.id });
    const cleared = await fixture.items.updateItem(fixture.organizationId, itemId, {
      itemGroupId: null,
    });
    expect(cleared.itemGroupId).toBe(null);
  });

  it('reads an item of another organization as not found', async () => {
    const otherOrg = (
      await fixture.organizations.createOrganization({
        code: 'ORG-B',
        name: 'Org B',
      })
    ).id;
    await expect(
      fixture.items.requireUsableItemInOrganization(itemId, otherOrg),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      fixture.items.requireUsableItemInOrganization(
        itemId,
        fixture.organizationId,
      ),
    ).resolves.toMatchObject({ id: itemId });
  });
});

describe('ItemsService listing', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await buildFixture();
    await fixture.items.createItem({
      organizationId: fixture.organizationId,
      code: 'ITM-A',
      name: 'Alpha',
      itemKind: 'goods',
      baseUnitId: fixture.unitId,
    });
    await fixture.items.createItem({
      organizationId: fixture.organizationId,
      code: 'ITM-B',
      name: 'Beta',
      itemKind: 'service',
      baseUnitId: fixture.unitId,
    });
  });

  it('never returns items of another organization', async () => {
    const otherOrg = (
      await fixture.organizations.createOrganization({
        code: 'ORG-B',
        name: 'Org B',
      })
    ).id;
    const listed = await fixture.items.listItems({
      organizationId: otherOrg,
      page: 1,
      pageSize: 10,
    });
    expect(listed.total).toBe(0);
    expect(listed.items).toEqual([]);
  });

  it('filters by kind, capability and active state', async () => {
    const services = await fixture.items.listItems({
      organizationId: fixture.organizationId,
      page: 1,
      pageSize: 10,
      itemKind: 'service',
    });
    expect(services.items.map((item) => item.code)).toEqual(['ITM-B']);

    const stockable = await fixture.items.listItems({
      organizationId: fixture.organizationId,
      page: 1,
      pageSize: 10,
      isStockable: true,
    });
    expect(stockable.items.map((item) => item.code)).toEqual(['ITM-A']);
  });

  it('paginates with an accurate total', async () => {
    const page2 = await fixture.items.listItems({
      organizationId: fixture.organizationId,
      page: 2,
      pageSize: 1,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.total).toBe(2);
    expect(page2.page).toBe(2);
    expect(page2.pageSize).toBe(1);
  });

  it('rejects an unknown sort field', async () => {
    await expect(
      fixture.items.listItems({
        organizationId: fixture.organizationId,
        page: 1,
        pageSize: 10,
        sort: 'itemKind:asc,name:sideways',
      }),
    ).rejects.toMatchObject({ code: 'ValidationFailed' });
  });
});
