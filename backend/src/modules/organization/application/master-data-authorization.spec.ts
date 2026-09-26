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
import { INVENTORY_PERMISSION_DEFINITIONS } from '../../inventory/domain/inventory-permissions.js';
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
  );

  const organizations = new OrganizationsService(
    masterStores.organizations,
    masterStores.memberships,
    authorization,
    loggerStub(),
    bus,
    UNPINNED_APP_CONFIG,
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
