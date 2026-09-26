import type { INestApplication } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { UsersRepository } from '../src/modules/users/data/users.repository.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { SessionsRepository } from '../src/modules/identity/data/sessions.repository.js';
import { PermissionsRepository } from '../src/modules/rbac/data/permissions.repository.js';
import { RolesRepository } from '../src/modules/rbac/data/roles.repository.js';
import { UserRolesRepository } from '../src/modules/rbac/data/user-roles.repository.js';
import { PermissionRegistry } from '../src/modules/rbac/application/permission-registry.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { OrganizationsRepository } from '../src/modules/organization/data/organizations.repository.js';
import { BranchesRepository } from '../src/modules/organization/data/branches.repository.js';
import { DepartmentsRepository } from '../src/modules/organization/data/departments.repository.js';
import { EmployeesRepository } from '../src/modules/organization/data/employees.repository.js';
import { PartiesRepository } from '../src/modules/organization/data/parties.repository.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { BranchesService } from '../src/modules/organization/application/branches.service.js';
import { UnitsRepository } from '../src/modules/inventory/data/units.repository.js';
import { ItemGroupsRepository } from '../src/modules/inventory/data/item-groups.repository.js';
import { ItemsRepository } from '../src/modules/inventory/data/items.repository.js';
import { UnitConversionsRepository } from '../src/modules/inventory/data/unit-conversions.repository.js';
import { WarehousesRepository } from '../src/modules/inventory/data/warehouses.repository.js';
import { InventoryMovementsRepository } from '../src/modules/inventory/data/inventory-movements.repository.js';
import { InventoryReservationsRepository } from '../src/modules/inventory/data/inventory-reservations.repository.js';
import { InventoryBalancesRepository } from '../src/modules/inventory/data/inventory-balances.repository.js';
import { InventoryOperationsRepository } from '../src/modules/inventory/data/inventory-operations.repository.js';
import { UnitsService } from '../src/modules/inventory/application/units.service.js';
import { createInMemoryStores } from './support/in-memory-repositories.js';
import { createMasterDataStores } from './support/master-data-repositories.js';
import { createInventoryCoreStores } from './support/inventory-core-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Deployment organization pin (ADR-0025) — the missing principal →
 * organization binding for single-organization deployments.
 *
 * The suite boots the real HTTP stack TWICE over the same in-memory tables:
 *   1. an unpinned app that seeds the pinned organization AND a second,
 *      foreign organization with a foreign branch (rows that genuinely exist
 *      but must become unreachable after pinning);
 *   2. a pinned app (APP_CONFIG.deploymentOrganizationId set) that must
 *      confine every organization-naming request to the one organization.
 *
 * The un-pinned behaviour is covered by master-data.e2e-spec.ts; this file
 * only proves what changes once the pin is configured.
 */
describe('Deployment organization pin (e2e)', () => {
  let app: INestApplication;

  let orgId = '';
  let otherOrgId = '';
  let branchId = '';
  let foreignBranchId = '';
  let unitId = '';

  const ROOT = { username: 'pin-root', password: 'pin-root-secret' };
  let root: ReturnType<typeof request.agent>;

  function prismaStub(): PrismaService {
    const fail = (): never => {
      throw new Error('PrismaService must not be touched in e2e tests.');
    };
    return {
      getClient: fail,
      onModuleInit: async () => {},
      onModuleDestroy: async () => {},
      enableShutdownHooks: () => {},
    } as unknown as PrismaService;
  }

  beforeAll(async () => {
    const stores = createInMemoryStores();
    const master = createMasterDataStores();
    const core = createInventoryCoreStores();

    const withRepositories = (
      builder: TestingModuleBuilder,
    ): TestingModuleBuilder =>
      builder
        .overrideProvider(PrismaService)
        .useValue(prismaStub())
        .overrideProvider(UsersRepository)
        .useValue(stores.users)
        .overrideProvider(SessionsRepository)
        .useValue(stores.sessions)
        .overrideProvider(PermissionsRepository)
        .useValue(stores.permissions)
        .overrideProvider(RolesRepository)
        .useValue(stores.roles)
        .overrideProvider(UserRolesRepository)
        .useValue(stores.userRoles)
        .overrideProvider(OrganizationsRepository)
        .useValue(master.organizations)
        .overrideProvider(BranchesRepository)
        .useValue(master.branches)
        .overrideProvider(DepartmentsRepository)
        .useValue(master.departments)
        .overrideProvider(EmployeesRepository)
        .useValue(master.employees)
        .overrideProvider(PartiesRepository)
        .useValue(master.parties)
        .overrideProvider(UnitsRepository)
        .useValue(master.units)
        .overrideProvider(ItemGroupsRepository)
        .useValue(master.itemGroups)
        .overrideProvider(ItemsRepository)
        .useValue(master.items)
        .overrideProvider(UnitConversionsRepository)
        .useValue(master.unitConversions)
        .overrideProvider(WarehousesRepository)
        .useValue(master.warehouses)
        .overrideProvider(InventoryMovementsRepository)
        .useValue(core.movements)
        .overrideProvider(InventoryReservationsRepository)
        .useValue(core.reservations)
        .overrideProvider(InventoryBalancesRepository)
        .useValue(core.balances)
        .overrideProvider(InventoryOperationsRepository)
        .useValue(core.operations);

    // ---- Phase 1: un-pinned seed app --------------------------------------
    // The seed app is owned by this hook: close it in `finally` so a failing
    // seed step can never orphan it (the E2E hang class fixed in PR #14 —
    // see docs/testing/e2e-hang-root-cause.md).
    const seeded = await createTestApp({ override: withRepositories });
    const seedApp = seeded.app;
    try {
      const users = seedApp.get(UsersService);
      const roles = seedApp.get(RolesService);
      const userRoles = seedApp.get(UserRolesService);
      const allCodes = seedApp
        .get(PermissionRegistry)
        .all()
        .map((definition) => definition.code);
      const rootUser = await users.createUser({
        username: ROOT.username,
        password: ROOT.password,
      });
      const rootRole = await roles.createRole({
        name: 'Pin Root',
        description: 'Bootstrap administrator (test fixture)',
        permissionCodes: allCodes,
      });
      await userRoles.assignRoleToUser(rootRole.id, rootUser.id);

      const organizations = seedApp.get(OrganizationsService);
      orgId = (
        await organizations.createOrganization({
          code: 'PIN',
          name: 'Pinned Co',
        })
      ).id;
      otherOrgId = (
        await organizations.createOrganization({
          code: 'OTHER',
          name: 'Other Co',
        })
      ).id;

      const branches = seedApp.get(BranchesService);
      branchId = (
        await branches.createBranch({
          organizationId: orgId,
          code: 'MAIN',
          name: 'Main branch',
        })
      ).id;
      foreignBranchId = (
        await branches.createBranch({
          organizationId: otherOrgId,
          code: 'MAIN',
          name: 'Foreign main branch',
        })
      ).id;

      const units = seedApp.get(UnitsService);
      unitId = (
        await units.createUnit({
          organizationId: orgId,
          code: 'PCS',
          name: 'Piece',
        })
      ).id;
    } finally {
      await seedApp.close();
    }

    // ---- Phase 2: pinned app over the same tables -------------------------
    const pinned = await createTestApp({
      override: (builder) =>
        withRepositories(builder)
          .overrideProvider(APP_CONFIG)
          .useValue({
            ...loadAppConfig(),
            deploymentOrganizationId: orgId,
          }),
    });
    app = pinned.app;
    root = request.agent(app.getHttpServer());
    await root.post('/api/v1/auth/login').send(ROOT).expect(200);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lists exactly the pinned organization, never another', async () => {
    const res = await root.get('/api/v1/organizations').expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      orgId,
    ]);

    // Search/isActive filters cannot widen the pin.
    const all = await root
      .get('/api/v1/organizations')
      .query({ search: 'Other' })
      .expect(200);
    expect(all.body.total).toBe(0);
  });

  it('refuses to create another organization while pinned (422)', async () => {
    const res = await root
      .post('/api/v1/organizations')
      .send({ code: 'THIRD', name: 'Third Co' })
      .expect(422);
    expect(res.body.code).toBe('BusinessRuleViolation');
  });

  it('confines by-id organization routes to the pin (404, never 403)', async () => {
    await root.get(`/api/v1/organizations/${orgId}`).expect(200);
    const foreign = await root
      .get(`/api/v1/organizations/${otherOrgId}`)
      .expect(404);
    expect(foreign.body.code).toBe('EntityNotFound');

    const disable = await root
      .post(`/api/v1/organizations/${otherOrgId}/disable`)
      .expect(404);
    expect(disable.body.code).toBe('EntityNotFound');
  });

  it('rejects writes that name another organization in the body (guard)', async () => {
    const branch = await root
      .post('/api/v1/branches')
      .send({ organizationId: otherOrgId, code: 'X', name: 'X' })
      .expect(404);
    expect(branch.body.code).toBe('EntityNotFound');

    const unit = await root
      .post('/api/v1/inventory/units')
      .send({ organizationId: otherOrgId, code: 'BOX', name: 'Box' })
      .expect(404);
    expect(unit.body.code).toBe('EntityNotFound');

    // The posting channel is confined too (finding 1, not just master data).
    const movement = await root
      .post('/api/v1/inventory/movements')
      .send({
        organizationId: otherOrgId,
        operationKey: '01SHOULDNEVERPOST0000000000001',
        warehouseId: '01WAREHOUSE0000000000001',
        itemId: '01ITEM00000000000000000001',
        movementType: 'inbound',
        quantity: '1',
        unitId,
      })
      .expect(404);
    expect(movement.body.code).toBe('EntityNotFound');
  });

  it('rejects lists and scoped reads that name another organization', async () => {
    const list = await root
      .get('/api/v1/branches')
      .query({ organizationId: otherOrgId })
      .expect(404);
    expect(list.body.code).toBe('EntityNotFound');

    // The foreign branch ROW exists (seeded in phase 1); it must be
    // unreadable both ways around.
    const foreignByPin = await root
      .get(`/api/v1/branches/${foreignBranchId}`)
      .query({ organizationId: orgId })
      .expect(404);
    expect(foreignByPin.body.code).toBe('EntityNotFound');

    const ownByForeign = await root
      .get(`/api/v1/branches/${branchId}`)
      .query({ organizationId: otherOrgId })
      .expect(404);
    expect(ownByForeign.body.code).toBe('EntityNotFound');
  });

  it('keeps the pinned organization fully usable', async () => {
    const own = await root
      .get(`/api/v1/branches/${branchId}`)
      .query({ organizationId: orgId })
      .expect(200);
    expect(own.body.id).toBe(branchId);

    const list = await root
      .get('/api/v1/branches')
      .query({ organizationId: orgId })
      .expect(200);
    expect(list.body.total).toBe(1);

    const unit = await root
      .get(`/api/v1/inventory/units/${unitId}`)
      .query({ organizationId: orgId })
      .expect(200);
    expect(unit.body.id).toBe(unitId);
  });

  it('requires the scope query on by-id routes (400 when omitted)', async () => {
    const res = await root.get(`/api/v1/branches/${branchId}`).expect(400);
    expect(res.body.code).toBe('ValidationFailed');
  });

  it('confines every by-id lifecycle and update verb (404 for foreign scope)', async () => {
    const foreignPatch = await root
      .patch(`/api/v1/branches/${branchId}`)
      .query({ organizationId: otherOrgId })
      .send({ name: 'Hijacked' })
      .expect(404);
    expect(foreignPatch.body.code).toBe('EntityNotFound');

    const foreignDisable = await root
      .post(`/api/v1/branches/${branchId}/disable`)
      .query({ organizationId: otherOrgId })
      .expect(404);
    expect(foreignDisable.body.code).toBe('EntityNotFound');

    const foreignRowUpdate = await root
      .patch(`/api/v1/branches/${foreignBranchId}`)
      .query({ organizationId: orgId })
      .send({ name: 'Hijacked' })
      .expect(404);
    expect(foreignRowUpdate.body.code).toBe('EntityNotFound');
  });

  it('leaves organization-less endpoints (login, health) untouched', async () => {
    // The guard passes through routes that name no organization; auth still
    // works (the login in beforeAll is the first proof).
    await root.get('/api/v1/health/live').expect(200);
  });
});
