import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { describe, expect, it, vi } from 'vitest';
import { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { toBusinessDate } from '../../../kernel/datetime/business-date.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import { createInventoryCoreStores } from '../../../../test/support/inventory-core-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { BranchesService } from '../../organization/application/branches.service.js';
import { UnitsService } from './units.service.js';
import { ItemGroupsService } from './item-groups.service.js';
import { ItemsService } from './items.service.js';
import { WarehousesService } from './warehouses.service.js';
import { InventoryBalancesService } from './inventory-balances.service.js';
import type { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';

/**
 * Regression coverage for review finding #3 (PR #112): `GET
 * /inventory/balances` (`listBalances`) must honor each row's own
 * warehouse's `reservationsReduceAvailable` setting (C-50 §3.7) exactly like
 * the single-key `getAvailability` read does — the two must never disagree
 * for the same (warehouse, item) key. Before the fix, `listBalances` always
 * reported `onHand - reserved` regardless of the setting.
 */

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

async function buildFixture() {
  const stores = createMasterDataStores();
  const core = createInventoryCoreStores();
  const bus = new DomainEventBus();

  const authorization = new AuthorizationService(
    undefined as never,
    loggerStub(),
    licensingTestDouble(),
  );
  const organizations = new OrganizationsService(
    stores.organizations,
    stores.memberships,
    authorization,
    loggerStub(),
    bus,
    UNPINNED_APP_CONFIG,
    licensingTestDouble(),
  );
  const branches = new BranchesService(
    stores.branches,
    organizations,
    authorization,
    loggerStub(),
    bus,
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
  const noMovements = {
    existsForItem: async () => false,
  } as unknown as InventoryMovementsRepository;
  const noBalancesBlock = {
    hasBlockingBalanceForItem: async () => false,
    hasBlockingBalanceForWarehouse: async () => false,
  } as unknown as typeof core.balances;
  const items = new ItemsService(
    stores.items,
    organizations,
    itemGroups,
    units,
    authorization,
    loggerStub(),
    bus,
    noMovements,
    noBalancesBlock,
  );
  const warehouses = new WarehousesService(
    stores.warehouses,
    organizations,
    branches,
    authorization,
    loggerStub(),
    bus,
    noMovements,
    noBalancesBlock,
  );

  const balancesService = new InventoryBalancesService(
    core.balances,
    organizations,
    items,
    warehouses,
    stores.warehouses,
    authorization,
    loggerStub(),
  );

  const organizationId = (
    await organizations.createOrganization({ code: 'ORG-A', name: 'Org A' })
  ).id;
  const branchId = (
    await branches.createBranch({
      organizationId,
      code: 'B1',
      name: 'Branch 1',
    })
  ).id;
  const unitId = (
    await units.createUnit({ organizationId, code: 'EA', name: 'Each' })
  ).id;
  const itemId = (
    await items.createItem({
      organizationId,
      code: 'ITM-1',
      name: 'Widget',
      itemKind: 'goods',
      baseUnitId: unitId,
    })
  ).id;

  return {
    core,
    organizations,
    branches,
    warehouses,
    balancesService,
    organizationId,
    branchId,
    itemId,
  };
}

describe('InventoryBalancesService.listBalances honors reservationsReduceAvailable (C-50 §3.7)', () => {
  it('agrees with getAvailability for the same warehouse when the setting is true (default)', async () => {
    const fixture = await buildFixture();
    const warehouse = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-TRUE',
      name: 'Reduces available',
      reservationsReduceAvailable: true,
    });
    fixture.core.tables.balances.seed({
      id: 'bal-true',
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      warehouseId: warehouse.id,
      itemId: fixture.itemId,
      onHand: '10',
      reserved: '4',
      lastMovementDate: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const single = await fixture.balancesService.getAvailability({
      organizationId: fixture.organizationId,
      warehouseId: warehouse.id,
      itemId: fixture.itemId,
    });
    const list = await fixture.balancesService.listBalances({
      organizationId: fixture.organizationId,
      page: 1,
      pageSize: 20,
    });
    const row = list.items.find((item) => item.warehouseId === warehouse.id);

    expect(single.available).toBe('6');
    expect(row?.available).toBe('6');
    expect(row?.available).toBe(single.available);
    expect(row?.onHand).toBe('10');
    expect(row?.reservationsReduceAvailable).toBe(true);
  });

  it('agrees with getAvailability for the same warehouse when the setting is false — both report on-hand unchanged', async () => {
    const fixture = await buildFixture();
    const warehouse = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-FALSE',
      name: 'Does not reduce available',
      reservationsReduceAvailable: false,
    });
    fixture.core.tables.balances.seed({
      id: 'bal-false',
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      warehouseId: warehouse.id,
      itemId: fixture.itemId,
      onHand: '10',
      reserved: '4',
      lastMovementDate: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const single = await fixture.balancesService.getAvailability({
      organizationId: fixture.organizationId,
      warehouseId: warehouse.id,
      itemId: fixture.itemId,
    });
    const list = await fixture.balancesService.listBalances({
      organizationId: fixture.organizationId,
      page: 1,
      pageSize: 20,
    });
    const row = list.items.find((item) => item.warehouseId === warehouse.id);

    // Before the fix, `list.available` was unconditionally '6' here — the
    // regression this test pins.
    expect(single.available).toBe('10');
    expect(row?.available).toBe('10');
    expect(row?.available).toBe(single.available);
    expect(row?.onHand).toBe('10');
    expect(row?.reservationsReduceAvailable).toBe(false);
  });

  it('computes each row by its OWN warehouse setting when a list spans several warehouses', async () => {
    const fixture = await buildFixture();
    const reduceWarehouse = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-A',
      name: 'Reduces',
      reservationsReduceAvailable: true,
    });
    const passthroughWarehouse = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-B',
      name: 'Passthrough',
      reservationsReduceAvailable: false,
    });
    fixture.core.tables.balances.seed({
      id: 'bal-a',
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      warehouseId: reduceWarehouse.id,
      itemId: fixture.itemId,
      onHand: '20',
      reserved: '5',
      lastMovementDate: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    fixture.core.tables.balances.seed({
      id: 'bal-b',
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      warehouseId: passthroughWarehouse.id,
      itemId: fixture.itemId,
      onHand: '20',
      reserved: '5',
      lastMovementDate: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const list = await fixture.balancesService.listBalances({
      organizationId: fixture.organizationId,
      page: 1,
      pageSize: 20,
    });
    const a = list.items.find(
      (item) => item.warehouseId === reduceWarehouse.id,
    );
    const b = list.items.find(
      (item) => item.warehouseId === passthroughWarehouse.id,
    );

    expect(a?.available).toBe('15');
    expect(b?.available).toBe('20');
    // Never mutates on-hand either way.
    expect(a?.onHand).toBe('20');
    expect(b?.onHand).toBe('20');
  });
});

describe('InventoryBalancesService.rebuild calendar serialization', () => {
  it('refuses to persist an unrenderable ledger-derived date without creating a balance row', async () => {
    const fixture = await buildFixture();
    const warehouse = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-UNRENDERABLE-REBUILD',
      name: 'Unrenderable rebuild source',
    });
    const movementDate = toBusinessDate('4000-01-01');
    if (movementDate === null) throw new Error('Invalid fixture BusinessDate.');
    const now = new Date('2026-10-10T00:00:00.000Z');
    fixture.core.tables.movements.seed({
      id: 'movement-unrenderable-rebuild',
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      warehouseId: warehouse.id,
      itemId: fixture.itemId,
      movementType: 'inbound',
      quantity: '1',
      enteredUnitId: 'fixture-unit',
      baseQuantity: '1',
      baseUnitId: 'fixture-unit',
      conversionFactor: '1',
      movementDate,
      transferId: null,
      reversalOfMovementId: null,
      referenceType: null,
      referenceId: null,
      reason: null,
      operationKey: 'unrenderable-rebuild-source',
      totalCost: null,
      valuationStatus: 'unvalued',
      valuationSource: null,
      valuedAt: null,
      valuationRunId: null,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      fixture.balancesService.rebuild({
        organizationId: fixture.organizationId,
      }),
    ).rejects.toMatchObject({
      code: 'Conflict',
      details: {
        code: 'inventory.balance.rebuild.business_date_unrenderable',
        businessDate: '4000-01-01',
        calendarSystem: 'JALALI',
        completedKeys: 0,
        totalKeys: 1,
      },
    });
    await expect(
      fixture.core.balances.findByKey(
        fixture.organizationId,
        warehouse.id,
        fixture.itemId,
      ),
    ).resolves.toBeNull();
  });

  it('captures one calendar, locks each key, and reports retry-safe partial progress if a transition wins between keys', async () => {
    const fixture = await buildFixture();
    const firstWarehouse = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-REBUILD-A',
      name: 'First rebuild key',
    });
    const secondWarehouse = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-REBUILD-B',
      name: 'Second rebuild key',
    });
    const keys = [
      { warehouseId: firstWarehouse.id, itemId: fixture.itemId },
      { warehouseId: secondWarehouse.id, itemId: fixture.itemId },
    ];
    const expectedDate = toBusinessDate('2026-10-01');
    if (expectedDate === null) throw new Error('Invalid fixture BusinessDate.');

    await fixture.organizations.updateOrganization(fixture.organizationId, {
      calendarSystem: 'GREGORIAN',
    });

    const listKeys = vi
      .spyOn(fixture.core.balances, 'listStockingKeys')
      .mockResolvedValue(keys);
    const keyCalls = new Map<string, number>();
    const validatedCalendars: string[] = [];
    const rebuildKey = vi
      .spyOn(fixture.core.balances, 'rebuildKey')
      .mockImplementation(
        async (_organizationId, _branchId, key, _actorId, calendar) => {
          validatedCalendars.push(calendar);
          const count = (keyCalls.get(key.warehouseId) ?? 0) + 1;
          keyCalls.set(key.warehouseId, count);
          const firstKeyNoopOnRetry =
            key.warehouseId === firstWarehouse.id && count > 1;
          return {
            warehouseId: key.warehouseId,
            itemId: key.itemId,
            expectedOnHand: '10',
            expectedReserved: '0',
            expectedLastMovementDate: expectedDate,
            storedBefore: { onHand: count === 1 ? '99' : '10', reserved: '0' },
            action: firstKeyNoopOnRetry ? 'noop' : 'updated',
          };
        },
      );

    let lockCalls = 0;
    const originalLock = fixture.organizations.withBusinessDateWriteLock.bind(
      fixture.organizations,
    );
    const lock = vi
      .spyOn(fixture.organizations, 'withBusinessDateWriteLock')
      .mockImplementation(async (organizationId, calendarSystem, work) => {
        lockCalls += 1;
        const result = await originalLock(organizationId, calendarSystem, work);
        if (lockCalls === 1 && result.kind === 'completed') {
          // Model a real transition committed after key one's outer lock is
          // released and before key two asks for its own captured-calendar lock.
          await fixture.organizations.updateOrganization(
            organizationId,
            { calendarSystem: 'JALALI' },
            async () => null,
          );
        }
        return result;
      });

    try {
      await expect(
        fixture.balancesService.rebuild({
          organizationId: fixture.organizationId,
        }),
      ).rejects.toMatchObject({
        code: 'Conflict',
        details: {
          code: 'organization.calendar.changed_during_business_date_write',
          completedKeys: 1,
          totalKeys: 2,
          retrySafe: true,
        },
      });
      expect(keyCalls.get(firstWarehouse.id)).toBe(1);
      expect(keyCalls.has(secondWarehouse.id)).toBe(false);
      expect(validatedCalendars).toEqual(['GREGORIAN']);

      const retry = await fixture.balancesService.rebuild({
        organizationId: fixture.organizationId,
      });
      expect(retry).toMatchObject({ checked: 2, rebuilt: 1 });
      expect(retry.corrections.map((row) => row.warehouseId)).toEqual([
        secondWarehouse.id,
      ]);
      expect(validatedCalendars).toEqual(['GREGORIAN', 'JALALI', 'JALALI']);
      expect(lockCalls).toBe(4);
    } finally {
      lock.mockRestore();
      rebuildKey.mockRestore();
      listKeys.mockRestore();
    }
  });
});
