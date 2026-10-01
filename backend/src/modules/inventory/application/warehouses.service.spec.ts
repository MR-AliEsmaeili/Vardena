import { licensingTestDouble } from '../../../../test/support/licensing.js';
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
import { BranchesService } from '../../organization/application/branches.service.js';
import { WarehousesService } from './warehouses.service.js';
import type { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import type { InventoryBalancesRepository } from '../data/inventory-balances.repository.js';
import {
  WAREHOUSE_CREATED_EVENT,
  WAREHOUSE_DISABLED_EVENT,
  WAREHOUSE_ENABLED_EVENT,
  WAREHOUSE_UPDATED_EVENT,
} from '../domain/inventory.events.js';

/**
 * `WarehousesService` — Task 33 (Inventory / Warehouse Master Completion)
 * regression coverage.
 *
 * This is NOT a redesign: the service under test is unchanged. These specs
 * close the pre-existing gap where `WarehousesService` had no dedicated unit
 * suite (only a handful of cross-module isolation cases lived in
 * `organization/application/master-data-authorization.spec.ts`), and the two
 * lifecycle freeze guards (branch-change-after-movements,
 * disable-while-holding-stock) had no test anywhere that ever drove them into
 * their blocking branch.
 *
 * System context (no request context in flight): `AuthorizationService` and
 * `OrganizationsService.assertOrganizationInScope` both no-op, exactly like
 * every other direct-service-call spec in this module (see
 * `items.service.spec.ts`). The authorization/organization-isolation surface
 * itself is covered by `master-data-authorization.spec.ts`, which drives the
 * real `AuthorizationService` through a request context; duplicating that
 * machinery here would test the same chokepoint twice for no benefit.
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
  branches: BranchesService;
  warehouses: WarehousesService;
  events: DomainEvent[];
  organizationId: string;
  otherOrganizationId: string;
  branchId: string;
  otherBranchOfSameOrgId: string;
  otherOrgBranchId: string;
  /** Mutable so individual tests can flip the freeze guards on. */
  movementsExist: { value: boolean };
  balanceBlocks: { value: boolean };
}

async function buildFixture(): Promise<Fixture> {
  const stores = createMasterDataStores();
  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  for (const type of [
    WAREHOUSE_CREATED_EVENT,
    WAREHOUSE_UPDATED_EVENT,
    WAREHOUSE_ENABLED_EVENT,
    WAREHOUSE_DISABLED_EVENT,
  ]) {
    bus.on(type, (event) => {
      events.push(event);
    });
  }

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

  // Controllable freeze-guard seam (ADR-0022): a plain object so tests can
  // flip `.value` after the service is built, instead of rebuilding the whole
  // fixture per guard scenario.
  const movementsExist = { value: false };
  const balanceBlocks = { value: false };
  const movements = {
    existsForWarehouse: async () => movementsExist.value,
  } as unknown as InventoryMovementsRepository;
  const balances = {
    hasBlockingBalanceForWarehouse: async () => balanceBlocks.value,
  } as unknown as InventoryBalancesRepository;

  const warehouses = new WarehousesService(
    stores.warehouses,
    organizations,
    branches,
    authorization,
    loggerStub(),
    bus,
    movements,
    balances,
  );

  const organizationId = (
    await organizations.createOrganization({ code: 'ORG-A', name: 'Org A' })
  ).id;
  const otherOrganizationId = (
    await organizations.createOrganization({ code: 'ORG-B', name: 'Org B' })
  ).id;
  const branchId = (
    await branches.createBranch({
      organizationId,
      code: 'B1',
      name: 'Branch 1',
    })
  ).id;
  const otherBranchOfSameOrgId = (
    await branches.createBranch({
      organizationId,
      code: 'B2',
      name: 'Branch 2',
    })
  ).id;
  const otherOrgBranchId = (
    await branches.createBranch({
      organizationId: otherOrganizationId,
      code: 'B1',
      name: 'Other org branch',
    })
  ).id;

  return {
    organizations,
    branches,
    warehouses,
    events,
    organizationId,
    otherOrganizationId,
    branchId,
    otherBranchOfSameOrgId,
    otherOrgBranchId,
    movementsExist,
    balanceBlocks,
  };
}

describe('WarehousesService', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  // ---- create ---------------------------------------------------------

  it('creates a warehouse with normalized code/name and publishes Warehouse.Created', async () => {
    const warehouse = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: '  wh-01  ',
      name: '  Main   warehouse  ',
    });

    expect(warehouse.code).toBe('wh-01');
    expect(warehouse.name).toBe('Main warehouse');
    expect(warehouse.allowNegativeStock).toBe(false);
    expect(warehouse.isActive).toBe(true);
    expect(
      fixture.events.filter((e) => e.type === WAREHOUSE_CREATED_EVENT),
    ).toHaveLength(1);
  });

  it('honors an explicit allowNegativeStock=true on create', async () => {
    const warehouse = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-NEG',
      name: 'Negative-allowed warehouse',
      allowNegativeStock: true,
    });
    expect(warehouse.allowNegativeStock).toBe(true);
  });

  it('rejects a blank code or name', async () => {
    await expect(
      fixture.warehouses.createWarehouse({
        organizationId: fixture.organizationId,
        branchId: fixture.branchId,
        code: '   ',
        name: 'Valid name',
      }),
    ).rejects.toMatchObject({ code: 'BadRequest' });

    await expect(
      fixture.warehouses.createWarehouse({
        organizationId: fixture.organizationId,
        branchId: fixture.branchId,
        code: 'VALID',
        name: '   ',
      }),
    ).rejects.toMatchObject({ code: 'BadRequest' });
  });

  it('rejects a duplicate code within the same organization with 409', async () => {
    await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'First',
    });

    await expect(
      fixture.warehouses.createWarehouse({
        organizationId: fixture.organizationId,
        branchId: fixture.branchId,
        code: 'WH-01',
        name: 'Second',
      }),
    ).rejects.toMatchObject({ code: 'Conflict' });
  });

  it('allows the same code in a different organization (scoped uniqueness, not global)', async () => {
    await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Org A warehouse',
    });

    const inOther = await fixture.warehouses.createWarehouse({
      organizationId: fixture.otherOrganizationId,
      branchId: fixture.otherOrgBranchId,
      code: 'WH-01',
      name: 'Org B warehouse',
    });
    expect(inOther.code).toBe('WH-01');
  });

  it('rejects a branch that belongs to a different organization', async () => {
    await expect(
      fixture.warehouses.createWarehouse({
        organizationId: fixture.organizationId,
        branchId: fixture.otherOrgBranchId,
        code: 'WH-CROSS',
        name: 'Cross-org attempt',
      }),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  // ---- update -----------------------------------------------------------

  it('updates code/name and emits Warehouse.Updated', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });

    const updated = await fixture.warehouses.updateWarehouse(
      fixture.organizationId,
      created.id,
      { code: 'WH-02', name: 'Renamed' },
    );
    expect(updated.code).toBe('WH-02');
    expect(updated.name).toBe('Renamed');
    expect(
      fixture.events.filter((e) => e.type === WAREHOUSE_UPDATED_EVENT),
    ).toHaveLength(1);
  });

  it('rejects renaming to a code already used by another warehouse in the organization', async () => {
    await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'First',
    });
    const second = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-02',
      name: 'Second',
    });

    await expect(
      fixture.warehouses.updateWarehouse(fixture.organizationId, second.id, {
        code: 'WH-01',
      }),
    ).rejects.toMatchObject({ code: 'Conflict' });
  });

  it('allows an update that keeps the same code (no self-conflict)', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });

    const updated = await fixture.warehouses.updateWarehouse(
      fixture.organizationId,
      created.id,
      { code: 'WH-01', name: 'Original renamed' },
    );
    expect(updated.name).toBe('Original renamed');
  });

  it('rejects moving a warehouse to a branch of another organization', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });

    await expect(
      fixture.warehouses.updateWarehouse(fixture.organizationId, created.id, {
        branchId: fixture.otherOrgBranchId,
      }),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('allows moving a warehouse to another branch of the SAME organization when no movements exist', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });

    const updated = await fixture.warehouses.updateWarehouse(
      fixture.organizationId,
      created.id,
      { branchId: fixture.otherBranchOfSameOrgId },
    );
    expect(updated.branchId).toBe(fixture.otherBranchOfSameOrgId);
  });

  it('blocks a branch change once inventory movements exist for the warehouse (freeze guard)', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });
    fixture.movementsExist.value = true;

    await expect(
      fixture.warehouses.updateWarehouse(fixture.organizationId, created.id, {
        branchId: fixture.otherBranchOfSameOrgId,
      }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

    // The row must be untouched — a rejected write must not partially apply.
    const unchanged = await fixture.warehouses.getWarehouse(
      fixture.organizationId,
      created.id,
    );
    expect(unchanged.branchId).toBe(fixture.branchId);
  });

  it('does NOT re-validate or freeze the branch when it is not being changed', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });
    // Movements exist, but the branch is left exactly as it was: the guard
    // must only fire on an actual change (master-data-strategy.md §7.4).
    fixture.movementsExist.value = true;

    const updated = await fixture.warehouses.updateWarehouse(
      fixture.organizationId,
      created.id,
      { branchId: fixture.branchId, name: 'Still fine' },
    );
    expect(updated.name).toBe('Still fine');
    expect(updated.branchId).toBe(fixture.branchId);
  });

  it('rejects a blank code or name on update', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });

    await expect(
      fixture.warehouses.updateWarehouse(fixture.organizationId, created.id, {
        name: '   ',
      }),
    ).rejects.toMatchObject({ code: 'BadRequest' });
  });

  it('answers not-found when updating a warehouse of another organization', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });

    await expect(
      fixture.warehouses.updateWarehouse(
        fixture.otherOrganizationId,
        created.id,
        {
          name: 'Hijacked',
        },
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  // ---- lifecycle ----------------------------------------------------------

  it('is idempotent on enable/disable and only emits an event on a real change', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });

    // Already enabled: enabling again is a no-op, no event.
    await fixture.warehouses.enableWarehouse(
      fixture.organizationId,
      created.id,
    );
    expect(
      fixture.events.filter((e) => e.type === WAREHOUSE_ENABLED_EVENT),
    ).toHaveLength(0);

    const disabled = await fixture.warehouses.disableWarehouse(
      fixture.organizationId,
      created.id,
    );
    expect(disabled.isActive).toBe(false);
    expect(
      fixture.events.filter((e) => e.type === WAREHOUSE_DISABLED_EVENT),
    ).toHaveLength(1);

    // Already disabled: disabling again is a no-op, no second event.
    await fixture.warehouses.disableWarehouse(
      fixture.organizationId,
      created.id,
    );
    expect(
      fixture.events.filter((e) => e.type === WAREHOUSE_DISABLED_EVENT),
    ).toHaveLength(1);

    const enabled = await fixture.warehouses.enableWarehouse(
      fixture.organizationId,
      created.id,
    );
    expect(enabled.isActive).toBe(true);
    expect(
      fixture.events.filter((e) => e.type === WAREHOUSE_ENABLED_EVENT),
    ).toHaveLength(1);
  });

  it('blocks disabling a warehouse that still holds stock (freeze guard)', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });
    fixture.balanceBlocks.value = true;

    await expect(
      fixture.warehouses.disableWarehouse(fixture.organizationId, created.id),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

    const unchanged = await fixture.warehouses.getWarehouse(
      fixture.organizationId,
      created.id,
    );
    expect(unchanged.isActive).toBe(true);
  });

  it('allows disabling once the blocking balance clears', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });
    fixture.balanceBlocks.value = true;
    await expect(
      fixture.warehouses.disableWarehouse(fixture.organizationId, created.id),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

    fixture.balanceBlocks.value = false;
    const disabled = await fixture.warehouses.disableWarehouse(
      fixture.organizationId,
      created.id,
    );
    expect(disabled.isActive).toBe(false);
  });

  // ---- reference resolution (requireUsableWarehouseInOrganization) --------

  it('requireUsableWarehouseInOrganization: not-found across organizations', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });

    await expect(
      fixture.warehouses.requireUsableWarehouseInOrganization(
        created.id,
        fixture.otherOrganizationId,
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('requireUsableWarehouseInOrganization: a disabled warehouse is unusable by default but readable with allowInactive', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });
    await fixture.warehouses.disableWarehouse(
      fixture.organizationId,
      created.id,
    );

    await expect(
      fixture.warehouses.requireUsableWarehouseInOrganization(
        created.id,
        fixture.organizationId,
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

    const usable =
      await fixture.warehouses.requireUsableWarehouseInOrganization(
        created.id,
        fixture.organizationId,
        { allowInactive: true },
      );
    expect(usable.id).toBe(created.id);
  });

  // ---- list ---------------------------------------------------------------

  it('lists only the warehouses of the requested organization, filterable by branch/active/search', async () => {
    const whA1 = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'ALPHA',
      name: 'Alpha store',
    });
    const whA2 = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.otherBranchOfSameOrgId,
      code: 'BETA',
      name: 'Beta store',
    });
    await fixture.warehouses.disableWarehouse(fixture.organizationId, whA2.id);
    await fixture.warehouses.createWarehouse({
      organizationId: fixture.otherOrganizationId,
      branchId: fixture.otherOrgBranchId,
      code: 'ALPHA',
      name: 'Other org alpha',
    });

    const all = await fixture.warehouses.listWarehouses({
      organizationId: fixture.organizationId,
      page: 1,
      pageSize: 10,
    });
    expect(all.total).toBe(2);
    expect(all.items.map((w) => w.code).sort()).toEqual(['ALPHA', 'BETA']);

    const byBranch = await fixture.warehouses.listWarehouses({
      organizationId: fixture.organizationId,
      page: 1,
      pageSize: 10,
      branchId: fixture.branchId,
    });
    expect(byBranch.items.map((w) => w.id)).toEqual([whA1.id]);

    const onlyActive = await fixture.warehouses.listWarehouses({
      organizationId: fixture.organizationId,
      page: 1,
      pageSize: 10,
      isActive: true,
    });
    expect(onlyActive.items.map((w) => w.id)).toEqual([whA1.id]);

    const search = await fixture.warehouses.listWarehouses({
      organizationId: fixture.organizationId,
      page: 1,
      pageSize: 10,
      search: 'beta',
    });
    expect(search.items.map((w) => w.id)).toEqual([whA2.id]);
  });

  it('rejects an unknown sort field instead of applying it to the query', async () => {
    await expect(
      fixture.warehouses.listWarehouses({
        organizationId: fixture.organizationId,
        page: 1,
        pageSize: 10,
        sort: 'createdBy:asc',
      }),
    ).rejects.toMatchObject({ code: 'ValidationFailed' });
  });

  it('sorts deterministically by code by default', async () => {
    await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'ZETA',
      name: 'Last',
    });
    await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'ALPHA',
      name: 'First',
    });

    const result = await fixture.warehouses.listWarehouses({
      organizationId: fixture.organizationId,
      page: 1,
      pageSize: 10,
    });
    expect(result.items.map((w) => w.code)).toEqual(['ALPHA', 'ZETA']);
  });

  it('answers not-found when reading a warehouse of another organization', async () => {
    const created = await fixture.warehouses.createWarehouse({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      code: 'WH-01',
      name: 'Original',
    });

    await expect(
      fixture.warehouses.getWarehouse(fixture.otherOrganizationId, created.id),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });
});
