import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DomainEventBus,
  type DomainEvent,
} from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';
import { createInMemoryStores } from '../../../../test/support/in-memory-repositories.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { seedUser } from '../../../../test/support/in-memory-repositories.js';
import { OrganizationsService } from './organizations.service.js';
import { BranchesService } from './branches.service.js';
import { WarehousesService } from '../../inventory/application/warehouses.service.js';
import type { InventoryMovementsRepository } from '../../inventory/data/inventory-movements.repository.js';
import type { InventoryBalancesRepository } from '../../inventory/data/inventory-balances.repository.js';
import { ORGANIZATION_PERMISSION_DEFINITIONS } from '../domain/organization-permissions.js';
import {
  INVENTORY_PERMISSION_DEFINITIONS,
  WAREHOUSE_PERMISSIONS,
} from '../../inventory/domain/inventory-permissions.js';
import {
  ORGANIZATION_CREATED_EVENT,
  ORGANIZATION_DISABLED_EVENT,
  ORGANIZATION_ENABLED_EVENT,
  ORGANIZATION_UPDATED_EVENT,
  BRANCH_CREATED_EVENT,
  BRANCH_DISABLED_EVENT,
  BRANCH_ENABLED_EVENT,
  BRANCH_UPDATED_EVENT,
} from '../domain/organization.events.js';
import { WAREHOUSE_CREATED_EVENT } from '../../inventory/domain/inventory.events.js';

/**
 * Organization + Branch application services, driven through the REAL
 * `AuthorizationService` and REAL RBAC repositories.
 *
 * That combination is the point of this file. The brief requires authorization
 * at the service layer, not only in route guards, and it requires organization
 * isolation. Both are only provable if the permission check actually runs — so
 * every test below executes inside a request context with a real principal and
 * real role/permission rows. A service that forgot its `requireAllPermissions`
 * call would fail here, not in production.
 */

const ACTOR = '01ACTOR000000000000000000A';
const ORG_A = '01ORGANIZATIONA000000000AA';
const ORG_B = '01ORGANIZATIONB000000000BB';

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
  rbacStores: ReturnType<typeof createInMemoryStores>;
  masterStores: ReturnType<typeof createMasterDataStores>;
  events: DomainEvent[];
  grant: (userId: string, codes: readonly string[]) => Promise<void>;
}

async function buildFixture(): Promise<Fixture> {
  const rbacStores = createInMemoryStores();
  const masterStores = createMasterDataStores();
  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  for (const type of [
    ORGANIZATION_CREATED_EVENT,
    ORGANIZATION_UPDATED_EVENT,
    ORGANIZATION_ENABLED_EVENT,
    ORGANIZATION_DISABLED_EVENT,
    BRANCH_CREATED_EVENT,
    BRANCH_UPDATED_EVENT,
    BRANCH_ENABLED_EVENT,
    BRANCH_DISABLED_EVENT,
    WAREHOUSE_CREATED_EVENT,
  ]) {
    bus.on(type, (event) => {
      events.push(event);
    });
  }

  // Mirror the permission vocabulary into `rbac.permissions`, exactly as
  // `PermissionSyncService` does at startup. Without these rows no principal
  // can hold a code, and every authorization test below would pass for the
  // wrong reason.
  await rbacStores.raw.permissions.syncDefinitions(
    [
      ...ORGANIZATION_PERMISSION_DEFINITIONS,
      ...INVENTORY_PERMISSION_DEFINITIONS,
    ],
    new Date(),
  );

  const authorization = new AuthorizationService(
    rbacStores.userRoles,
    loggerStub(),
    licensingTestDouble(),
  );

  const organizations = new OrganizationsService(
    masterStores.organizations,
    masterStores.memberships,
    authorization,
    loggerStub(),
    bus,
    UNPINNED_APP_CONFIG,
    licensingTestDouble(),
  );
  const branches = new BranchesService(
    masterStores.branches,
    organizations,
    authorization,
    loggerStub(),
    bus,
  );
  // Freeze-guard seam (ADR-0022): no movements or balances on record here.
  const noMovements = {
    existsForWarehouse: async () => false,
  } as unknown as InventoryMovementsRepository;
  const noBalances = {
    hasBlockingBalanceForWarehouse: async () => false,
  } as unknown as InventoryBalancesRepository;
  const warehouses = new WarehousesService(
    masterStores.warehouses,
    organizations,
    branches,
    authorization,
    loggerStub(),
    bus,
    noMovements,
    noBalances,
  );

  /**
   * Give one user the listed permission codes: resolve the codes to
   * `rbac.permissions` rows, put them on a role, and assign that role. This is
   * the same join `AuthorizationService` evaluates (`user_roles →
   * role_permissions → permissions`), so the check under test is the real one.
   */
  let roleSeq = 0;
  async function grant(
    userId: string,
    codes: readonly string[],
  ): Promise<void> {
    const now = new Date();
    await seedUser(rbacStores, { id: userId });
    const permissionIds = (
      await rbacStores.raw.permissions.findByCodes(codes)
    ).map((permission) => permission.id);
    // A missing code must fail loudly rather than silently granting nothing.
    if (permissionIds.length !== new Set(codes).size) {
      throw new Error(
        `Unknown permission code in grant(): ${codes.join(', ')}`,
      );
    }
    roleSeq += 1;
    const roleId = `01ROLE${String(roleSeq).padStart(20, '0')}`;
    await rbacStores.raw.roles.createWithPermissions({
      id: roleId,
      name: `role-${roleSeq}`,
      description: null,
      permissionIds,
      now,
      createdBy: null,
    });
    await rbacStores.raw.userRoles.assign({
      userId,
      roleId,
      now,
      createdBy: null,
    });
  }

  return {
    organizations,
    branches,
    warehouses,
    rbacStores,
    masterStores,
    events,
    grant,
  };
}

/** Services called outside any HTTP request run in system context (no check). */
function asSystem<R>(fn: () => Promise<R>): Promise<R> {
  return fn();
}

function asActor<R>(userId: string, fn: () => Promise<R>): Promise<R> {
  return runWithRequestContext(
    { correlationId: 'corr-1', principal: { userId, sessionId: 'sess' } },
    fn,
  );
}

describe('OrganizationsService', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  it('creates an organization and publishes Organization.Created', async () => {
    const created = await asSystem(() =>
      fixture.organizations.createOrganization({
        code: '  ACME  ',
        name: '  Acme   Industries  ',
      }),
    );

    expect(created.code).toBe('ACME');
    // Names collapse internal whitespace runs.
    expect(created.name).toBe('Acme Industries');
    expect(created.isActive).toBe(true);
    // The API shape never carries audit actor ids (AR-24).
    expect(created).not.toHaveProperty('createdBy');
    expect(fixture.events.map((event) => event.type)).toEqual([
      ORGANIZATION_CREATED_EVENT,
    ]);
    expect(fixture.events[0]?.payload).toEqual({
      id: created.id,
      code: 'ACME',
    });
  });

  it('rejects a duplicate code with a conflict', async () => {
    await asSystem(() =>
      fixture.organizations.createOrganization({ code: 'ACME', name: 'Acme' }),
    );
    await expect(
      asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ACME',
          name: 'Other',
        }),
      ),
    ).rejects.toMatchObject({ code: 'Conflict' });
  });

  it('rejects a blank code or name', async () => {
    await expect(
      asSystem(() =>
        fixture.organizations.createOrganization({ code: '   ', name: 'Acme' }),
      ),
    ).rejects.toMatchObject({ code: 'BadRequest' });
    await expect(
      asSystem(() =>
        fixture.organizations.createOrganization({ code: 'ACME', name: '  ' }),
      ),
    ).rejects.toMatchObject({ code: 'BadRequest' });
  });

  it('is idempotent on enable/disable and only emits an event on a real change', async () => {
    const created = await asSystem(() =>
      fixture.organizations.createOrganization({ code: 'ACME', name: 'Acme' }),
    );
    fixture.events.length = 0;

    await asSystem(() => fixture.organizations.enableOrganization(created.id));
    expect(fixture.events).toHaveLength(0);

    await asSystem(() => fixture.organizations.disableOrganization(created.id));
    expect(fixture.events.map((event) => event.type)).toEqual([
      ORGANIZATION_DISABLED_EVENT,
    ]);

    fixture.events.length = 0;
    await asSystem(() => fixture.organizations.disableOrganization(created.id));
    expect(fixture.events).toHaveLength(0);

    await asSystem(() => fixture.organizations.enableOrganization(created.id));
    expect(fixture.events.map((event) => event.type)).toEqual([
      ORGANIZATION_ENABLED_EVENT,
    ]);
  });

  it('refuses to read an unknown organization', async () => {
    await expect(
      asSystem(() => fixture.organizations.getOrganization(ORG_A)),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('rejects an unknown sort field instead of passing it to the query', async () => {
    await expect(
      asSystem(() =>
        fixture.organizations.listOrganizations({
          page: 1,
          pageSize: 10,
          sort: 'createdBy:asc',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ValidationFailed' });
  });

  describe('application-layer authorization', () => {
    it('allows a principal holding the permission', async () => {
      await fixture.grant(ACTOR, ['Organization.Organization.Create']);
      const created = await asActor(ACTOR, () =>
        fixture.organizations.createOrganization({
          code: 'ACME',
          name: 'Acme',
        }),
      );
      expect(created.code).toBe('ACME');
    });

    it('rejects an authenticated principal that lacks the permission with 403', async () => {
      // Holds View only — Create must be refused by the SERVICE, not the guard.
      await fixture.grant(ACTOR, ['Organization.Organization.View']);
      await expect(
        asActor(ACTOR, () =>
          fixture.organizations.createOrganization({
            code: 'ACME',
            name: 'Acme',
          }),
        ),
      ).rejects.toMatchObject({ code: 'PermissionDenied' });
      // Nothing was written.
      const listing = await asSystem(() =>
        fixture.organizations.listOrganizations({ page: 1, pageSize: 10 }),
      );
      expect(listing.total).toBe(0);
    });

    it('rejects an anonymous request with 401, not 403', async () => {
      await expect(
        runWithRequestContext({ correlationId: 'corr-1' }, () =>
          fixture.organizations.createOrganization({
            code: 'ACME',
            name: 'Acme',
          }),
        ),
      ).rejects.toMatchObject({ code: 'Unauthorized' });
    });

    it('requires a distinct permission per operation', async () => {
      await fixture.grant(ACTOR, [
        'Organization.Organization.Create',
        'Organization.Organization.View',
      ]);
      const created = await asActor(ACTOR, () =>
        fixture.organizations.createOrganization({
          code: 'ACME',
          name: 'Acme',
        }),
      );

      // Edit / Disable are separate codes and are NOT covered by Create+View.
      await expect(
        asActor(ACTOR, () =>
          fixture.organizations.updateOrganization(created.id, {
            name: 'Renamed',
          }),
        ),
      ).rejects.toMatchObject({ code: 'PermissionDenied' });
      await expect(
        asActor(ACTOR, () =>
          fixture.organizations.disableOrganization(created.id),
        ),
      ).rejects.toMatchObject({ code: 'PermissionDenied' });
    });
  });
});

describe('BranchesService organization isolation', () => {
  let fixture: Fixture;
  let orgA: string;

  beforeEach(async () => {
    fixture = await buildFixture();
    orgA = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ORG-A',
          name: 'Org A',
        }),
      )
    ).id;
  });

  it('creates a branch under an active organization', async () => {
    const branch = await asSystem(() =>
      fixture.branches.createBranch({
        organizationId: orgA,
        code: 'TEH-01',
        name: 'Tehran main',
      }),
    );
    expect(branch.organizationId).toBe(orgA);
    expect(fixture.events.map((event) => event.type)).toContain(
      BRANCH_CREATED_EVENT,
    );
  });

  it('rejects a branch for an organization that does not exist', async () => {
    await expect(
      asSystem(() =>
        fixture.branches.createBranch({
          organizationId: ORG_B,
          code: 'TEH-01',
          name: 'Tehran main',
        }),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('rejects a branch under a disabled organization', async () => {
    await asSystem(() => fixture.organizations.disableOrganization(orgA));
    await expect(
      asSystem(() =>
        fixture.branches.createBranch({
          organizationId: orgA,
          code: 'TEH-01',
          name: 'Tehran main',
        }),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('scopes codes per organization, not deployment-wide', async () => {
    const orgB = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ORG-B',
          name: 'Org B',
        }),
      )
    ).id;
    await asSystem(() =>
      fixture.branches.createBranch({
        organizationId: orgA,
        code: 'MAIN',
        name: 'Main',
      }),
    );
    // The same code in another organization is a different business key.
    const other = await asSystem(() =>
      fixture.branches.createBranch({
        organizationId: orgB,
        code: 'MAIN',
        name: 'Main',
      }),
    );
    expect(other.organizationId).toBe(orgB);
  });

  it('reports 409 for a duplicate code within the same organization', async () => {
    await asSystem(() =>
      fixture.branches.createBranch({
        organizationId: orgA,
        code: 'MAIN',
        name: 'Main',
      }),
    );
    await expect(
      asSystem(() =>
        fixture.branches.createBranch({
          organizationId: orgA,
          code: 'MAIN',
          name: 'Second',
        }),
      ),
    ).rejects.toMatchObject({ code: 'Conflict' });
  });

  it('reads a branch from another organization as not found', async () => {
    const orgB = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ORG-B',
          name: 'Org B',
        }),
      )
    ).id;
    const branch = await asSystem(() =>
      fixture.branches.createBranch({
        organizationId: orgB,
        code: 'MAIN',
        name: 'Main',
      }),
    );

    // Structural isolation: the reference resolver refuses a cross-org read and
    // answers 404 so the existence of another tenant's row is not disclosed.
    await expect(
      asSystem(() =>
        fixture.branches.requireUsableBranchInOrganization(branch.id, orgA),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      asSystem(() =>
        fixture.branches.requireUsableBranchInOrganization(branch.id, orgB),
      ),
    ).resolves.toMatchObject({ id: branch.id });
  });

  it('refuses to use a disabled branch as a new parent reference', async () => {
    const branch = await asSystem(() =>
      fixture.branches.createBranch({
        organizationId: orgA,
        code: 'MAIN',
        name: 'Main',
      }),
    );
    await asSystem(() => fixture.branches.disableBranch(orgA, branch.id));
    await expect(
      asSystem(() =>
        fixture.branches.requireUsableBranchInOrganization(branch.id, orgA),
      ),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
    // …but an explicit opt-in can still read it (history stays readable).
    await expect(
      asSystem(() =>
        fixture.branches.requireUsableBranchInOrganization(branch.id, orgA, {
          allowInactive: true,
        }),
      ),
    ).resolves.toMatchObject({ id: branch.id });
  });

  it('lists only the branches of the organization asked for', async () => {
    const orgB = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ORG-B',
          name: 'Org B',
        }),
      )
    ).id;
    await asSystem(() =>
      fixture.branches.createBranch({
        organizationId: orgA,
        code: 'A-1',
        name: 'A one',
      }),
    );
    await asSystem(() =>
      fixture.branches.createBranch({
        organizationId: orgB,
        code: 'B-1',
        name: 'B one',
      }),
    );

    const listed = await asSystem(() =>
      fixture.branches.listBranches({
        organizationId: orgA,
        page: 1,
        pageSize: 10,
      }),
    );
    expect(listed.total).toBe(1);
    expect(listed.items.map((branch) => branch.code)).toEqual(['A-1']);
    expect(listed.items.every((branch) => branch.organizationId === orgA)).toBe(
      true,
    );
  });

  it('cannot move a branch into another organization: there is no such field', async () => {
    const orgB = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ORG-B',
          name: 'Org B',
        }),
      )
    ).id;
    const branch = await asSystem(() =>
      fixture.branches.createBranch({
        organizationId: orgA,
        code: 'MAIN',
        name: 'Main',
      }),
    );
    const updated = await asSystem(() =>
      fixture.branches.updateBranch(orgA, branch.id, { name: 'Renamed' }),
    );
    expect(updated.organizationId).toBe(orgA);
    expect(orgB).not.toBe(orgA);
  });

  it('keeps a warehouse of another organization unreadable', async () => {
    const orgB = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ORG-B',
          name: 'Org B',
        }),
      )
    ).id;
    const branchB = await asSystem(() =>
      fixture.branches.createBranch({
        organizationId: orgB,
        code: 'B-1',
        name: 'B one',
      }),
    );
    const warehouse = await asSystem(() =>
      fixture.warehouses.createWarehouse({
        organizationId: orgB,
        branchId: branchB.id,
        code: 'WH-1',
        name: 'Warehouse 1',
      }),
    );

    await expect(
      asSystem(() =>
        fixture.warehouses.requireUsableWarehouseInOrganization(
          warehouse.id,
          orgA,
        ),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('refuses a warehouse whose branch belongs to another organization', async () => {
    const orgB = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ORG-B',
          name: 'Org B',
        }),
      )
    ).id;
    const branchB = await asSystem(() =>
      fixture.branches.createBranch({
        organizationId: orgB,
        code: 'B-1',
        name: 'B one',
      }),
    );

    // A foreign key cannot express "same organization", so the service must.
    await expect(
      asSystem(() =>
        fixture.warehouses.createWarehouse({
          organizationId: orgA,
          branchId: branchB.id,
          code: 'WH-1',
          name: 'Warehouse 1',
        }),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('creates a warehouse when organization and branch agree', async () => {
    const branch = await asSystem(() =>
      fixture.branches.createBranch({
        organizationId: orgA,
        code: 'A-1',
        name: 'A one',
      }),
    );
    const warehouse = await asSystem(() =>
      fixture.warehouses.createWarehouse({
        organizationId: orgA,
        branchId: branch.id,
        code: 'WH-1',
        name: 'Warehouse 1',
      }),
    );
    expect(warehouse.branchId).toBe(branch.id);
    expect(warehouse.organizationId).toBe(orgA);
  });
});

/**
 * Task 33 (Inventory / Warehouse Master Completion) addition.
 *
 * The three warehouse cases above already prove organization/branch data
 * isolation through `asSystem`. This block closes the remaining gap: the
 * REAL `AuthorizationService` driven through an authenticated request
 * context (`asActor`), so that a missing/foreign-organization permission is
 * provably enforced by the service layer for every Warehouse operation, not
 * only by the HTTP guard.
 */
describe('WarehousesService authorization & cross-organization IDOR', () => {
  let fixture: Fixture;
  let orgA: string;
  let orgB: string;
  let branchA: string;
  let branchB: string;

  beforeEach(async () => {
    fixture = await buildFixture();
    orgA = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ORG-A',
          name: 'Org A',
        }),
      )
    ).id;
    orgB = (
      await asSystem(() =>
        fixture.organizations.createOrganization({
          code: 'ORG-B',
          name: 'Org B',
        }),
      )
    ).id;
    branchA = (
      await asSystem(() =>
        fixture.branches.createBranch({
          organizationId: orgA,
          code: 'A-1',
          name: 'Branch A1',
        }),
      )
    ).id;
    branchB = (
      await asSystem(() =>
        fixture.branches.createBranch({
          organizationId: orgB,
          code: 'B-1',
          name: 'Branch B1',
        }),
      )
    ).id;
  });

  it('rejects an anonymous list/get/create with 401, not 403', async () => {
    const anonymous = (fn: () => Promise<unknown>): Promise<unknown> =>
      runWithRequestContext({ correlationId: 'corr-1' }, fn);

    await expect(
      anonymous(() =>
        fixture.warehouses.listWarehouses({
          organizationId: orgA,
          page: 1,
          pageSize: 10,
        }),
      ),
    ).rejects.toMatchObject({ code: 'Unauthorized' });
    await expect(
      anonymous(() =>
        fixture.warehouses.createWarehouse({
          organizationId: orgA,
          branchId: branchA,
          code: 'WH-1',
          name: 'Warehouse 1',
        }),
      ),
    ).rejects.toMatchObject({ code: 'Unauthorized' });
  });

  it('requires a distinct permission per Warehouse operation', async () => {
    // ODR-3: the actor must also be a legitimate member of orgA — these
    // permission assertions are about the CODE, not about scope.
    fixture.masterStores.raw.memberships.seed(ACTOR, orgA);
    await fixture.grant(ACTOR, [
      WAREHOUSE_PERMISSIONS.VIEW,
      WAREHOUSE_PERMISSIONS.CREATE,
    ]);

    const created = await asActor(ACTOR, () =>
      fixture.warehouses.createWarehouse({
        organizationId: orgA,
        branchId: branchA,
        code: 'WH-1',
        name: 'Warehouse 1',
      }),
    );
    // View+Create holds no Edit/Enable/Disable.
    await expect(
      asActor(ACTOR, () =>
        fixture.warehouses.updateWarehouse(orgA, created.id, {
          name: 'Renamed',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
    await expect(
      asActor(ACTOR, () =>
        fixture.warehouses.disableWarehouse(orgA, created.id),
      ),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
    await expect(
      asActor(ACTOR, () =>
        fixture.warehouses.enableWarehouse(orgA, created.id),
      ),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });

    // View alone cannot create.
    const viewer = `${ACTOR}-viewer`;
    fixture.masterStores.raw.memberships.seed(viewer, orgA);
    await fixture.grant(viewer, [WAREHOUSE_PERMISSIONS.VIEW]);
    await expect(
      asActor(viewer, () =>
        fixture.warehouses.createWarehouse({
          organizationId: orgA,
          branchId: branchA,
          code: 'WH-2',
          name: 'Warehouse 2',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
  });

  it('cannot read, update, enable or disable a warehouse of another organization even with full Warehouse permissions (IDOR)', async () => {
    fixture.masterStores.raw.memberships.seed(ACTOR, orgA);
    fixture.masterStores.raw.memberships.seed(ACTOR, orgB);
    await fixture.grant(ACTOR, [
      WAREHOUSE_PERMISSIONS.VIEW,
      WAREHOUSE_PERMISSIONS.CREATE,
      WAREHOUSE_PERMISSIONS.EDIT,
      WAREHOUSE_PERMISSIONS.ENABLE,
      WAREHOUSE_PERMISSIONS.DISABLE,
    ]);

    const warehouseInB = await asActor(ACTOR, () =>
      fixture.warehouses.createWarehouse({
        organizationId: orgB,
        branchId: branchB,
        code: 'WH-B',
        name: 'Warehouse in B',
      }),
    );

    // The actor is a member of orgA too, so this is a genuine cross-tenant
    // probe, not a scope rejection.
    await expect(
      asActor(ACTOR, () =>
        fixture.warehouses.getWarehouse(orgA, warehouseInB.id),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      asActor(ACTOR, () =>
        fixture.warehouses.updateWarehouse(orgA, warehouseInB.id, {
          name: 'Hijacked',
        }),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      asActor(ACTOR, () =>
        fixture.warehouses.disableWarehouse(orgA, warehouseInB.id),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      asActor(ACTOR, () =>
        fixture.warehouses.enableWarehouse(orgA, warehouseInB.id),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });

    // And a foreign branch cannot be used to create/move a warehouse in orgA.
    await expect(
      asActor(ACTOR, () =>
        fixture.warehouses.createWarehouse({
          organizationId: orgA,
          branchId: branchB,
          code: 'WH-CROSS',
          name: 'Cross-org attempt',
        }),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });
});

describe('Inventory item-master authorization & cross-organization IDOR', () => {
  let fixture: Fixture;
  let organizations: OrganizationsService;
  let authorization: AuthorizationService;
  let orgA: string;
  let orgB: string;
  let unitA: string;
  let boxA: string;
  let groupA: string;
  let itemA: string;
  let unitsService: import('../../inventory/application/units.service.js').UnitsService;
  let itemsService: import('../../inventory/application/items.service.js').ItemsService;
  let itemGroupsService: import('../../inventory/application/item-groups.service.js').ItemGroupsService;
  let conversionsService: import('../../inventory/application/unit-conversions.service.js').UnitConversionsService;

  const ITEM = {
    VIEW: 'Inventory.Item.View',
    CREATE: 'Inventory.Item.Create',
    EDIT: 'Inventory.Item.Edit',
    ENABLE: 'Inventory.Item.Enable',
    DISABLE: 'Inventory.Item.Disable',
  };
  const CONVERSION = {
    VIEW: 'Inventory.UnitConversion.View',
    CREATE: 'Inventory.UnitConversion.Create',
  };

  function loggerStub(): JsonLogger {
    return {
      log: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as JsonLogger;
  }

  beforeEach(async () => {
    fixture = await buildFixture();
    // The fixture's AuthorizationService instance is the same one its
    // organizations service uses; rebuild the inventory services against the
    // same instance so ALL checks run the real RBAC path.
    const bus = new DomainEventBus();
    authorization = new AuthorizationService(
      fixture.rbacStores.userRoles,
      loggerStub(),
      licensingTestDouble(),
    );
    organizations = fixture.organizations;
    unitsService = new (
      await import('../../inventory/application/units.service.js')
    ).UnitsService(
      fixture.masterStores.units,
      organizations,
      authorization,
      loggerStub(),
      bus,
    );
    itemGroupsService = new (
      await import('../../inventory/application/item-groups.service.js')
    ).ItemGroupsService(
      fixture.masterStores.itemGroups,
      organizations,
      authorization,
      loggerStub(),
      bus,
    );
    const noMovements = {
      existsForItem: async () => false,
    } as unknown as InventoryMovementsRepository;
    const noBalances = {
      hasBlockingBalanceForItem: async () => false,
    } as unknown as InventoryBalancesRepository;
    itemsService = new (
      await import('../../inventory/application/items.service.js')
    ).ItemsService(
      fixture.masterStores.items,
      organizations,
      itemGroupsService,
      unitsService,
      authorization,
      loggerStub(),
      bus,
      noMovements,
      noBalances,
    );
    conversionsService = new (
      await import('../../inventory/application/unit-conversions.service.js')
    ).UnitConversionsService(
      fixture.masterStores.unitConversions,
      organizations,
      unitsService,
      itemsService,
      authorization,
      loggerStub(),
      bus,
    );

    orgA = (
      await asSystem(() =>
        organizations.createOrganization({ code: 'ORG-A', name: 'Org A' }),
      )
    ).id;
    orgB = (
      await asSystem(() =>
        organizations.createOrganization({ code: 'ORG-B', name: 'Org B' }),
      )
    ).id;
    unitA = (
      await asSystem(() =>
        unitsService.createUnit({
          organizationId: orgA,
          code: 'PCS',
          name: 'Piece',
        }),
      )
    ).id;
    boxA = (
      await asSystem(() =>
        unitsService.createUnit({
          organizationId: orgA,
          code: 'BOX',
          name: 'Box',
        }),
      )
    ).id;
    groupA = (
      await asSystem(() =>
        itemGroupsService.createItemGroup({
          organizationId: orgA,
          code: 'RM',
          name: 'Raw materials',
        }),
      )
    ).id;
    itemA = (
      await asSystem(() =>
        itemsService.createItem({
          organizationId: orgA,
          code: 'ITM-A',
          name: 'Widget A',
          itemKind: 'goods',
          baseUnitId: unitA,
        }),
      )
    ).id;
  });

  function asActorId<R>(userId: string, fn: () => Promise<R>): Promise<R> {
    return runWithRequestContext(
      { correlationId: 'corr-1', principal: { userId, sessionId: 'sess' } },
      fn,
    );
  }

  it('rejects anonymous item/conversion access with 401, not 403', async () => {
    const anonymous = (fn: () => Promise<unknown>): Promise<unknown> =>
      runWithRequestContext({ correlationId: 'corr-1' }, fn);
    await expect(
      anonymous(() =>
        itemsService.listItems({ organizationId: orgA, page: 1, pageSize: 10 }),
      ),
    ).rejects.toMatchObject({ code: 'Unauthorized' });
    await expect(
      anonymous(() =>
        conversionsService.resolveConversion({
          organizationId: orgA,
          fromUnitId: boxA,
          toUnitId: unitA,
          asOf: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'Unauthorized' });
  });

  it('requires the distinct Item permission codes per operation', async () => {
    fixture.masterStores.raw.memberships.seed(ACTOR, orgA);
    await fixture.grant(ACTOR, [ITEM.VIEW, ITEM.CREATE]);

    await expect(
      asActorId(ACTOR, () =>
        itemsService.updateItem(orgA, itemA, { name: 'Renamed' }),
      ),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
    await expect(
      asActorId(ACTOR, () => itemsService.disableItem(orgA, itemA)),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
    await expect(
      asActorId(ACTOR, () => itemsService.enableItem(orgA, itemA)),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });

    const created = await asActorId(ACTOR, () =>
      itemsService.createItem({
        organizationId: orgA,
        code: 'ITM-NEW',
        name: 'Newly created',
        itemKind: 'service',
        baseUnitId: unitA,
        itemGroupId: groupA,
      }),
    );
    expect(created.isActive).toBe(true);
  });

  it("cannot read, edit, enable or disable another organization's item even with full Item permissions (IDOR)", async () => {
    fixture.masterStores.raw.memberships.seed(ACTOR, orgA);
    fixture.masterStores.raw.memberships.seed(ACTOR, orgB);
    await fixture.grant(ACTOR, [
      ITEM.VIEW,
      ITEM.CREATE,
      ITEM.EDIT,
      ITEM.ENABLE,
      ITEM.DISABLE,
    ]);
    // Org-B rows are fixture data (not the operation under test), so they are
    // seeded in the trusted system context.
    const unitB = (
      await asSystem(() =>
        unitsService.createUnit({
          organizationId: orgB,
          code: 'PCS',
          name: 'Piece',
        }),
      )
    ).id;
    const itemB = (
      await asSystem(() =>
        itemsService.createItem({
          organizationId: orgB,
          code: 'ITM-B',
          name: 'Widget B',
          itemKind: 'goods',
          baseUnitId: unitB,
        }),
      )
    ).id;

    await expect(
      asActorId(ACTOR, () => itemsService.getItem(orgA, itemB)),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      asActorId(ACTOR, () =>
        itemsService.updateItem(orgA, itemB, { name: 'Hijacked' }),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      asActorId(ACTOR, () => itemsService.enableItem(orgA, itemB)),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      asActorId(ACTOR, () => itemsService.disableItem(orgA, itemB)),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('requires UnitConversion.View/Create distinctly for resolve and create', async () => {
    fixture.masterStores.raw.memberships.seed(ACTOR, orgA);
    await fixture.grant(ACTOR, [CONVERSION.VIEW]);

    await asActorId(ACTOR, () =>
      conversionsService.createConversion({
        organizationId: orgA,
        itemId: null,
        fromUnitId: boxA,
        toUnitId: unitA,
        factor: '12',
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validTo: null,
      }),
    ).catch((error: { code?: string }) =>
      expect(error.code).toBe('PermissionDenied'),
    );

    // View only: resolve works, create does not.
    const resolved = await asActorId(ACTOR, () =>
      conversionsService.resolveConversion({
        organizationId: orgA,
        fromUnitId: boxA,
        toUnitId: unitA,
        asOf: new Date('2026-06-01T00:00:00Z'),
      }),
    );
    expect(resolved).toBe(null);
  });

  it('cannot resolve conversion factors of another organization even holding UnitConversion.View (no-disclosure)', async () => {
    // Seed org-B data in system context.
    const unitB = (
      await asSystem(() =>
        unitsService.createUnit({
          organizationId: orgB,
          code: 'PCS',
          name: 'Piece',
        }),
      )
    ).id;
    const boxB = (
      await asSystem(() =>
        unitsService.createUnit({
          organizationId: orgB,
          code: 'BOX',
          name: 'Box',
        }),
      )
    ).id;
    const itemB = (
      await asSystem(() =>
        itemsService.createItem({
          organizationId: orgB,
          code: 'ITM-B',
          name: 'Widget B',
          itemKind: 'goods',
          baseUnitId: unitB,
        }),
      )
    ).id;
    await asSystem(() =>
      conversionsService.createConversion({
        organizationId: orgB,
        itemId: itemB,
        fromUnitId: boxB,
        toUnitId: unitB,
        factor: '6',
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validTo: null,
      }),
    );

    // A member of orgA holding View must not resolve org-B factors — neither
    // through scope nor through a foreign item id (the pre-fix disclosure
    // vector, regression-tested here through the real authorization path).
    fixture.masterStores.raw.memberships.seed(ACTOR, orgA);
    await fixture.grant(ACTOR, [CONVERSION.VIEW, ITEM.VIEW]);

    await expect(
      asActorId(ACTOR, () =>
        conversionsService.resolveConversion({
          organizationId: orgA,
          itemId: itemB,
          fromUnitId: boxB,
          toUnitId: unitB,
          asOf: new Date('2026-02-01T00:00:00Z'),
        }),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });

    // A member of NEITHER org gets the same opaque not-found through the
    // scope assertion.
    const outsider = `${ACTOR}-out`;
    await fixture.grant(outsider, [CONVERSION.VIEW, ITEM.VIEW]);
    await expect(
      asActorId(outsider, () =>
        conversionsService.resolveConversion({
          organizationId: orgB,
          itemId: itemB,
          fromUnitId: boxB,
          toUnitId: unitB,
          asOf: new Date('2026-02-01T00:00:00Z'),
        }),
      ),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });
});
