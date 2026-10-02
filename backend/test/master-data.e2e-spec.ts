import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { OrganizationMembershipsRepository } from '../src/modules/organization/data/organization-memberships.repository.js';
import { BranchesRepository } from '../src/modules/organization/data/branches.repository.js';
import { DepartmentsRepository } from '../src/modules/organization/data/departments.repository.js';
import { EmployeesRepository } from '../src/modules/organization/data/employees.repository.js';
import { PartiesRepository } from '../src/modules/organization/data/parties.repository.js';
import { UnitsRepository } from '../src/modules/inventory/data/units.repository.js';
import { ItemGroupsRepository } from '../src/modules/inventory/data/item-groups.repository.js';
import { ItemsRepository } from '../src/modules/inventory/data/items.repository.js';
import { UnitConversionsRepository } from '../src/modules/inventory/data/unit-conversions.repository.js';
import { WarehousesRepository } from '../src/modules/inventory/data/warehouses.repository.js';
import { InventoryMovementsRepository } from '../src/modules/inventory/data/inventory-movements.repository.js';
import { InventoryReservationsRepository } from '../src/modules/inventory/data/inventory-reservations.repository.js';
import { InventoryBalancesRepository } from '../src/modules/inventory/data/inventory-balances.repository.js';
import { InventoryOperationsRepository } from '../src/modules/inventory/data/inventory-operations.repository.js';
import {
  createInMemoryStores,
  type InMemoryStores,
} from './support/in-memory-repositories.js';
import {
  createMasterDataStores,
  type MasterDataStores,
} from './support/master-data-repositories.js';
import {
  createInventoryCoreStores,
  type InventoryCoreStores,
} from './support/inventory-core-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Organization + Inventory master-data journeys (e2e).
 *
 * Boots the real application through the production HTTP pipeline
 * (`createTestApp` → `configureApp`): real controllers, real AuthGuard +
 * AuthorizationGuard, real application services, real permission registry and
 * its startup mirror sync, real DTO validation. Only data access is faked.
 *
 * The three journeys required by Task 6:
 *   1. login → organization → branch → warehouse
 *   2. organization → item group → item → unit → unit conversion
 *   3. organization → party
 *
 * Plus the security surface: 401 before 403, per-operation permissions, and
 * organization isolation over HTTP.
 *
 * The first administrator cannot be created over HTTP (creating a user already
 * requires a permission), so it is bootstrapped in the documented *system
 * context* — the same path an initial deployment seed uses. Everything after
 * that is HTTP.
 */
describe('Organization + Inventory master data (e2e)', () => {
  let app: INestApplication;
  let stores: InMemoryStores;
  let master: MasterDataStores;
  let core: InventoryCoreStores;
  let users: UsersService;
  let roles: RolesService;
  let userRoles: UserRolesService;

  const ROOT = { username: 'root', password: 'root-secret' };
  const LIMITED = { username: 'limited', password: 'limited-secret' };

  let root: ReturnType<typeof request.agent>;
  let limited: ReturnType<typeof request.agent>;

  // Journey state, filled by the steps below (order matters — one scenario).
  const state = {
    rootId: '',
    limitedId: '',
    orgId: '',
    otherOrgId: '',
    branchId: '',
    otherBranchId: '',
    warehouseId: '',
    unitPcsId: '',
    unitBoxId: '',
    itemGroupId: '',
    itemId: '',
    conversionId: '',
    partyId: '',
    departmentId: '',
    employeeId: '',
  };

  beforeAll(async () => {
    stores = createInMemoryStores();
    master = createMasterDataStores();
    // Empty core tables: the freeze guards consult them on item/warehouse
    // edits and disables, and must see "no movements, no stock" here.
    core = createInventoryCoreStores();
    const rebuilt = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(PrismaService)
          .useValue(buildPrismaStub())
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
          .overrideProvider(OrganizationMembershipsRepository)
          .useValue(master.memberships)
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
          .useValue(core.operations),
    });
    app = rebuilt.app;
    users = app.get(UsersService);
    roles = app.get(RolesService);
    userRoles = app.get(UserRolesService);

    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code);

    // Bootstrap administrator — system context, no HTTP request in flight.
    const rootUser = await users.createUser({
      username: ROOT.username,
      password: ROOT.password,
    });
    state.rootId = rootUser.id;
    const rootRole = await roles.createRole({
      name: 'Root',
      description: 'Bootstrap administrator (test fixture)',
      permissionCodes: allCodes,
    });
    await userRoles.assignRoleToUser(rootRole.id, rootUser.id);

    // A second principal holding ONLY read permission on master data, to prove
    // authorization is enforced per operation and not per module.
    const limitedUser = await users.createUser({
      username: LIMITED.username,
      password: LIMITED.password,
    });
    state.limitedId = limitedUser.id;
    const viewerRole = await roles.createRole({
      name: 'MasterDataViewer',
      description: 'Read-only master data (test fixture)',
      permissionCodes: allCodes.filter((code) => code.endsWith('.View')),
    });
    await userRoles.assignRoleToUser(viewerRole.id, limitedUser.id);

    root = request.agent(app.getHttpServer());
    limited = request.agent(app.getHttpServer());
    await root.post('/api/v1/auth/login').send(ROOT).expect(200);
    await limited.post('/api/v1/auth/login').send(LIMITED).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- security surface ----------------------------------------------------

  it('rejects anonymous calls to every new endpoint with 401 (not 403)', async () => {
    const anonymous = request(app.getHttpServer());
    for (const path of [
      '/api/v1/organizations',
      '/api/v1/branches',
      '/api/v1/departments',
      '/api/v1/employees',
      '/api/v1/parties',
      '/api/v1/inventory/items',
      '/api/v1/inventory/item-groups',
      '/api/v1/inventory/units',
      '/api/v1/inventory/unit-conversions',
      '/api/v1/inventory/warehouses',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await anonymous.get(path).expect(401);
      expect(res.body.code).toBe('Unauthorized');
    }
  });

  it('lets a read-only principal list but not create (403, not 401)', async () => {
    await limited.get('/api/v1/organizations').expect(200);

    const denied = await limited
      .post('/api/v1/organizations')
      .send({ code: 'NOPE', name: 'Not allowed' })
      .expect(403);
    expect(denied.body.code).toBe('PermissionDenied');
  });

  it('validates request bodies before any work happens', async () => {
    const blank = await root
      .post('/api/v1/organizations')
      .send({ code: '   ', name: '' })
      .expect(400);
    expect(blank.body.code).toBe('ValidationFailed');

    const unknownField = await root
      .post('/api/v1/organizations')
      .send({ code: 'X', name: 'X', deletedAt: '2026-01-01T00:00:00Z' })
      .expect(400);
    expect(unknownField.body.code).toBe('ValidationFailed');

    const badUlid = await root
      .post('/api/v1/branches')
      .send({ organizationId: 'not-a-ulid', code: 'B', name: 'B' })
      .expect(400);
    expect(badUlid.body.code).toBe('ValidationFailed');
  });

  // ---- journey 1: login → organization → branch → warehouse ----------------

  it('journey 1: creates an organization', async () => {
    const res = await root
      .post('/api/v1/organizations')
      .send({ code: '  acme  ', name: '  Acme   Industries  ' })
      .expect(201);

    expect(res.body).toMatchObject({
      code: 'acme',
      name: 'Acme Industries',
      isActive: true,
    });
    // The API never exposes audit actor ids (AR-24).
    expect(res.body).not.toHaveProperty('createdBy');
    expect(res.body.id).toMatch(/^[0-9A-Z]{26}$/);
    state.orgId = res.body.id as string;

    // ODR-3 (Task 19): both personas are legitimate members (the cross-org
    // assertions later are data-scoped, not membership-scoped).
    master.raw.memberships.seed(state.rootId, state.orgId);
    master.raw.memberships.seed(state.limitedId, state.orgId);
  });

  it('requires the distinct Enable/Disable permissions, not just View', async () => {
    // `limited` holds every *.View code and nothing else, so a lifecycle
    // transition is refused with 403 — and the row is unchanged.
    const denied = await limited
      .post(`/api/v1/organizations/${state.orgId}/disable`)
      .expect(403);
    expect(denied.body.code).toBe('PermissionDenied');

    const still = await root
      .get(`/api/v1/organizations/${state.orgId}`)
      .expect(200);
    expect(still.body.isActive).toBe(true);
  });

  it('journey 1: rejects a duplicate organization code with 409', async () => {
    const res = await root
      .post('/api/v1/organizations')
      .send({ code: 'acme', name: 'Someone else' })
      .expect(409);
    expect(res.body.code).toBe('Conflict');
  });

  it('journey 1: creates a branch under it', async () => {
    const res = await root
      .post('/api/v1/branches')
      .send({
        organizationId: state.orgId,
        code: 'TEH-01',
        name: 'Tehran main branch',
      })
      .expect(201);
    expect(res.body.organizationId).toBe(state.orgId);
    state.branchId = res.body.id as string;
  });

  it('journey 1: creates a warehouse under the branch', async () => {
    const res = await root
      .post('/api/v1/inventory/warehouses')
      .send({
        organizationId: state.orgId,
        branchId: state.branchId,
        code: 'WH-TEH-01',
        name: 'Tehran central warehouse',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      branchId: state.branchId,
      organizationId: state.orgId,
    });
    state.warehouseId = res.body.id as string;
  });

  it('journey 1: reads the chain back and lists it with pagination', async () => {
    await root.get(`/api/v1/organizations/${state.orgId}`).expect(200);
    await root
      .get(`/api/v1/branches/${state.branchId}`)
      .query({ organizationId: state.orgId })
      .expect(200);
    await root
      .get(`/api/v1/inventory/warehouses/${state.warehouseId}`)
      .query({ organizationId: state.orgId })
      .expect(200);

    const list = await root
      .get('/api/v1/inventory/warehouses')
      .query({ organizationId: state.orgId, page: 1, pageSize: 10 })
      .expect(200);
    expect(list.body).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(list.body.items[0].code).toBe('WH-TEH-01');
  });

  it('journey 1: rejects a warehouse whose branch is in another organization', async () => {
    const otherOrg = await root
      .post('/api/v1/organizations')
      .send({ code: 'OTHER', name: 'Other Co' })
      .expect(201);
    state.otherOrgId = otherOrg.body.id as string;

    master.raw.memberships.seed(state.rootId, state.otherOrgId);
    master.raw.memberships.seed(state.limitedId, state.otherOrgId);
    const otherBranch = await root
      .post('/api/v1/branches')
      .send({
        organizationId: state.otherOrgId,
        code: 'MSH-01',
        name: 'Mashhad branch',
      })
      .expect(201);
    state.otherBranchId = otherBranch.body.id as string;

    // A foreign key cannot express "same organization", so the service must.
    const res = await root
      .post('/api/v1/inventory/warehouses')
      .send({
        organizationId: state.orgId,
        branchId: state.otherBranchId,
        code: 'WH-CROSS',
        name: 'Cross-org attempt',
      })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  it('rejects a duplicate warehouse code within the same organization with 409', async () => {
    const res = await root
      .post('/api/v1/inventory/warehouses')
      .send({
        organizationId: state.orgId,
        branchId: state.branchId,
        code: 'WH-TEH-01',
        name: 'Duplicate attempt',
      })
      .expect(409);
    expect(res.body.code).toBe('Conflict');
  });

  it('allows the same warehouse code in a different organization', async () => {
    const res = await root
      .post('/api/v1/inventory/warehouses')
      .send({
        organizationId: state.otherOrgId,
        branchId: state.otherBranchId,
        code: 'WH-TEH-01',
        name: 'Same code, other organization',
      })
      .expect(201);
    expect(res.body.organizationId).toBe(state.otherOrgId);
  });

  it("answers 404 (not disclosure) for another organization's warehouse by id (GET/PATCH IDOR)", async () => {
    const getRes = await root
      .get(`/api/v1/inventory/warehouses/${state.warehouseId}`)
      .query({ organizationId: state.otherOrgId })
      .expect(404);
    expect(getRes.body.code).toBe('EntityNotFound');

    const patchRes = await root
      .patch(`/api/v1/inventory/warehouses/${state.warehouseId}`)
      .query({ organizationId: state.otherOrgId })
      .send({ name: 'Hijacked' })
      .expect(404);
    expect(patchRes.body.code).toBe('EntityNotFound');

    // Unchanged: the real name is still visible from the correct organization.
    const still = await root
      .get(`/api/v1/inventory/warehouses/${state.warehouseId}`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(still.body.name).toBe('Tehran central warehouse');
  });

  it('rejects moving a warehouse to a branch owned by another organization', async () => {
    const res = await root
      .patch(`/api/v1/inventory/warehouses/${state.warehouseId}`)
      .query({ organizationId: state.orgId })
      .send({ branchId: state.otherBranchId })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  // ---- journey 2: organization → item group → item → unit → conversion -----

  it('journey 2: creates units', async () => {
    const pcs = await root
      .post('/api/v1/inventory/units')
      .send({
        organizationId: state.orgId,
        code: 'PCS',
        name: 'Piece',
        symbol: 'pc',
      })
      .expect(201);
    state.unitPcsId = pcs.body.id as string;

    const box = await root
      .post('/api/v1/inventory/units')
      .send({ organizationId: state.orgId, code: 'BOX', name: 'Box' })
      .expect(201);
    expect(box.body.symbol).toBe(null);
    state.unitBoxId = box.body.id as string;
  });

  it('journey 2: creates an item group and a child group', async () => {
    const parent = await root
      .post('/api/v1/inventory/item-groups')
      .send({
        organizationId: state.orgId,
        code: 'FASTENERS',
        name: 'Fasteners',
      })
      .expect(201);
    state.itemGroupId = parent.body.id as string;

    const child = await root
      .post('/api/v1/inventory/item-groups')
      .send({
        organizationId: state.orgId,
        parentId: parent.body.id,
        code: 'BOLTS',
        name: 'Bolts',
      })
      .expect(201);
    expect(child.body.parentId).toBe(parent.body.id);
  });

  it('journey 2: creates an item, taking capabilities from the kind', async () => {
    const res = await root
      .post('/api/v1/inventory/items')
      .send({
        organizationId: state.orgId,
        code: 'ITM-0001',
        name: 'Steel bolt M8',
        itemKind: 'goods',
        itemGroupId: state.itemGroupId,
        baseUnitId: state.unitPcsId,
        barcode: '6260000000017',
      })
      .expect(201);

    expect(res.body).toMatchObject({
      itemKind: 'goods',
      isStockable: true,
      isPurchasable: true,
      isSellable: true,
      isValued: true,
      requiresLot: false,
    });
    state.itemId = res.body.id as string;
  });

  it('journey 2: refuses an item kind that does not exist', async () => {
    const res = await root
      .post('/api/v1/inventory/items')
      .send({
        organizationId: state.orgId,
        code: 'ITM-0002',
        name: 'Mystery',
        itemKind: 'widget',
        baseUnitId: state.unitPcsId,
      })
      .expect(400);
    expect(res.body.code).toBe('ValidationFailed');
  });

  it('journey 2: refuses a capability set that contradicts the behaviour table', async () => {
    const res = await root
      .post('/api/v1/inventory/items')
      .send({
        organizationId: state.orgId,
        code: 'ITM-0003',
        name: 'Contradictory',
        itemKind: 'goods',
        baseUnitId: state.unitPcsId,
        isStockable: false,
        isValued: true,
      })
      .expect(422);
    expect(res.body.code).toBe('BusinessRuleViolation');
  });

  it('journey 2: refuses a base unit from another organization', async () => {
    const foreignUnit = await root
      .post('/api/v1/inventory/units')
      .send({ organizationId: state.otherOrgId, code: 'PCS', name: 'Piece' })
      .expect(201);

    const res = await root
      .post('/api/v1/inventory/items')
      .send({
        organizationId: state.orgId,
        code: 'ITM-0004',
        name: 'Foreign unit',
        itemKind: 'goods',
        baseUnitId: foreignUnit.body.id,
      })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  it('journey 2: creates a conversion and supersedes it with a new version', async () => {
    const first = await root
      .post('/api/v1/inventory/unit-conversions')
      .send({
        organizationId: state.orgId,
        fromUnitId: state.unitBoxId,
        toUnitId: state.unitPcsId,
        factor: '12',
        validFrom: '2026-01-01T00:00:00.000Z',
      })
      .expect(201);
    expect(first.body).toMatchObject({
      factor: '12',
      itemId: null,
      validTo: null,
    });
    state.conversionId = first.body.id as string;

    const second = await root
      .post('/api/v1/inventory/unit-conversions')
      .send({
        organizationId: state.orgId,
        fromUnitId: state.unitBoxId,
        toUnitId: state.unitPcsId,
        factor: '24',
        validFrom: '2026-02-01T00:00:00.000Z',
      })
      .expect(201);

    // The old version is CLOSED, never edited or deleted.
    const historical = await root
      .get(`/api/v1/inventory/unit-conversions/${state.conversionId}`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(historical.body.factor).toBe('12');
    expect(historical.body.validTo).toBe('2026-02-01T00:00:00.000Z');
    expect(second.body.validTo).toBe(null);
  });

  it('journey 2: has no endpoint that edits a conversion in place', async () => {
    // ADR-0020 §4: used configuration is never edited in place. The route
    // simply does not exist, so the global not-found fallback answers.
    await root
      .patch(`/api/v1/inventory/unit-conversions/${state.conversionId}`)
      .send({ factor: '99' })
      .expect(404);
  });

  it('journey 2: resolves the version in force at an instant, historically', async () => {
    const january = await root
      .get('/api/v1/inventory/unit-conversions/resolve')
      .query({
        organizationId: state.orgId,
        fromUnitId: state.unitBoxId,
        toUnitId: state.unitPcsId,
        asOf: '2026-01-15T00:00:00.000Z',
      })
      .expect(200);
    expect(january.body.conversion.factor).toBe('12');

    const current = await root
      .get('/api/v1/inventory/unit-conversions/resolve')
      .query({
        organizationId: state.orgId,
        fromUnitId: state.unitBoxId,
        toUnitId: state.unitPcsId,
        asOf: '2026-06-01T00:00:00.000Z',
      })
      .expect(200);
    expect(current.body.conversion.factor).toBe('24');
  });

  it('journey 2: returns a null conversion rather than inventing a 1:1 factor', async () => {
    const res = await root
      .get('/api/v1/inventory/unit-conversions/resolve')
      .query({
        organizationId: state.orgId,
        fromUnitId: state.unitPcsId,
        toUnitId: state.unitBoxId,
        asOf: '2026-01-15T00:00:00.000Z',
      })
      .expect(200);
    expect(res.body.conversion).toBe(null);
  });

  it('journey 2: keeps the factor a decimal string with no float drift', async () => {
    const res = await root
      .post('/api/v1/inventory/unit-conversions')
      .send({
        organizationId: state.orgId,
        itemId: state.itemId,
        fromUnitId: state.unitBoxId,
        toUnitId: state.unitPcsId,
        factor: '0.000001',
        validFrom: '2026-01-01T00:00:00.000Z',
      })
      .expect(201);
    expect(res.body.factor).toBe('0.000001');
    expect(res.body.itemId).toBe(state.itemId);

    // The item-specific version wins over the global one.
    const resolved = await root
      .get('/api/v1/inventory/unit-conversions/resolve')
      .query({
        organizationId: state.orgId,
        itemId: state.itemId,
        fromUnitId: state.unitBoxId,
        toUnitId: state.unitPcsId,
        asOf: '2026-06-01T00:00:00.000Z',
      })
      .expect(200);
    expect(resolved.body.conversion.factor).toBe('0.000001');
  });

  it('journey 2: rejects an invalid factor with 400', async () => {
    const res = await root
      .post('/api/v1/inventory/unit-conversions')
      .send({
        organizationId: state.orgId,
        fromUnitId: state.unitBoxId,
        toUnitId: state.unitPcsId,
        factor: '0',
        validFrom: '2026-01-01T00:00:00.000Z',
      })
      .expect(400);
    expect(res.body.code).toBe('BadRequest');
  });

  it('journey 2: lists items filtered by kind and capability', async () => {
    const services = await root
      .get('/api/v1/inventory/items')
      .query({ organizationId: state.orgId, itemKind: 'service' })
      .expect(200);
    expect(services.body.total).toBe(0);

    const stockable = await root
      .get('/api/v1/inventory/items')
      .query({ organizationId: state.orgId, isStockable: true })
      .expect(200);
    expect(
      stockable.body.items.map((item: { code: string }) => item.code),
    ).toEqual(['ITM-0001']);
  });

  it('journey 2: rejects an unknown sort field instead of querying with it', async () => {
    const res = await root
      .get('/api/v1/inventory/items')
      .query({ organizationId: state.orgId, sort: 'createdBy:asc' })
      .expect(400);
    expect(res.body.code).toBe('ValidationFailed');
  });

  it('journey 2: rejects a duplicate item code in one organization and allows it in another', async () => {
    const duplicate = await root
      .post('/api/v1/inventory/items')
      .send({
        organizationId: state.orgId,
        code: 'ITM-0001',
        name: 'Duplicate code',
        itemKind: 'goods',
        baseUnitId: state.unitPcsId,
      })
      .expect(409);
    expect(duplicate.body.code).toBe('Conflict');

    // The exact same code is fine in a DIFFERENT organization (a fresh one,
    // so the shared `otherOrgId` journey state stays clean). Root's
    // membership is seeded exactly like every other journey org.
    const thirdOrg = await root
      .post('/api/v1/organizations')
      .send({ code: 'ORG-MISC-2', name: 'Third org' })
      .expect(201);
    master.raw.memberships.seed(state.rootId, thirdOrg.body.id as string);
    const thirdUnit = await root
      .post('/api/v1/inventory/units')
      .send({ organizationId: thirdOrg.body.id, code: 'PCS', name: 'Piece' })
      .expect(201);
    const foreign = await root
      .post('/api/v1/inventory/items')
      .send({
        organizationId: thirdOrg.body.id,
        code: 'ITM-0001',
        name: 'ITM-0001 in another organization',
        itemKind: 'goods',
        baseUnitId: thirdUnit.body.id,
      })
      .expect(201);
    expect(foreign.body.code).toBe('ITM-0001');
  });

  it("answers 404 (not disclosure) for another organization's item by id (GET/PATCH/enable/disable IDOR)", async () => {
    const id = state.itemId;
    await root
      .get(`/api/v1/inventory/items/${id}`)
      .query({ organizationId: state.otherOrgId })
      .expect(404);
    await root
      .patch(`/api/v1/inventory/items/${id}`)
      .query({ organizationId: state.otherOrgId })
      .send({ name: 'Hijacked' })
      .expect(404);
    await root
      .post(`/api/v1/inventory/items/${id}/disable`)
      .query({ organizationId: state.otherOrgId })
      .expect(404);
    await root
      .post(`/api/v1/inventory/items/${id}/enable`)
      .query({ organizationId: state.otherOrgId })
      .expect(404);

    // Nothing about the item changed (ADR-0022 §8: probes never disclose or mutate).
    const untouched = await root
      .get(`/api/v1/inventory/items/${id}`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(untouched.body.name).toBe('Steel bolt M8');
    expect(untouched.body.isActive).toBe(true);
  });

  it('journey 2: rejects a duplicate unit code in one organization and allows it in another', async () => {
    const duplicate = await root
      .post('/api/v1/inventory/units')
      .send({ organizationId: state.orgId, code: 'BOX', name: 'Box again' })
      .expect(409);
    expect(duplicate.body.code).toBe('Conflict');

    const foreign = await root
      .post('/api/v1/inventory/units')
      .send({ organizationId: state.otherOrgId, code: 'BOX', name: 'Box (B)' })
      .expect(201);
    expect(foreign.body.code).toBe('BOX');
  });

  it('journey 2: rejects a conversion window that overlaps versions it cannot supersede', async () => {
    // State: [2026-01-01, 2026-02-01) factor 12 (closed), [2026-02-01, ∞)
    // factor 24 (open). A window spanning both cannot be resolved by closing
    // "the last open-ended one", so it is rejected with 422 — the same
    // message the single-threaded service has always given, now backed by
    // the in-transaction plan (advisory-locked) as well.
    const overlapping = await root
      .post('/api/v1/inventory/unit-conversions')
      .send({
        organizationId: state.orgId,
        fromUnitId: state.unitBoxId,
        toUnitId: state.unitPcsId,
        factor: '30',
        validFrom: '2026-01-15T00:00:00.000Z',
        validTo: '2026-02-15T00:00:00.000Z',
      })
      .expect(422);
    expect(overlapping.body.code).toBe('BusinessRuleViolation');

    // The pair's state is untouched: the two planned versions still resolve.
    const january = await root
      .get('/api/v1/inventory/unit-conversions/resolve')
      .query({
        organizationId: state.orgId,
        fromUnitId: state.unitBoxId,
        toUnitId: state.unitPcsId,
        asOf: '2026-01-20T00:00:00.000Z',
      })
      .expect(200);
    expect(january.body.conversion.factor).toBe('12');
  });

  it('answers 404 (not disclosure) for a conversion of another organization by id', async () => {
    const res = await root
      .get(`/api/v1/inventory/unit-conversions/${state.conversionId}`)
      .query({ organizationId: state.otherOrgId })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  it("refuses to resolve conversion factors through another organization's item (no-disclosure)", async () => {
    // The item belongs to the FIRST organization; resolving its factors under
    // the other organization's scope must be not-found, never the foreign
    // organization's factor. Regression for the resolve-path disclosure the
    // C-47 fix closed.
    const res = await root
      .get('/api/v1/inventory/unit-conversions/resolve')
      .query({
        organizationId: state.otherOrgId,
        itemId: state.itemId,
        fromUnitId: state.unitBoxId,
        toUnitId: state.unitPcsId,
        asOf: '2026-03-01T00:00:00.000Z',
      })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  // ---- journey 3: organization → party -------------------------------------

  it('journey 3: creates a party holding both capabilities', async () => {
    const res = await root
      .post('/api/v1/parties')
      .send({
        organizationId: state.orgId,
        code: 'C-0001',
        displayName: '  Nika   Retail  ',
        legalName: 'Nika Retail (PJSC)',
        partyType: 'organization',
        isCustomer: true,
        isSupplier: true,
        email: 'sales@nika.example',
        phone: '+98 21 0000 0000',
      })
      .expect(201);

    expect(res.body).toMatchObject({
      displayName: 'Nika Retail',
      partyType: 'organization',
      isCustomer: true,
      isSupplier: true,
    });
    state.partyId = res.body.id as string;
  });

  it('journey 3: rejects a party with no capability (422)', async () => {
    const res = await root
      .post('/api/v1/parties')
      .send({
        organizationId: state.orgId,
        code: 'C-0002',
        displayName: 'Nobody',
        partyType: 'person',
        isCustomer: false,
        isSupplier: false,
      })
      .expect(422);
    expect(res.body.code).toBe('BusinessRuleViolation');
  });

  it('journey 3: filters parties by capability', async () => {
    await root
      .post('/api/v1/parties')
      .send({
        organizationId: state.orgId,
        code: 'S-0001',
        displayName: 'Supplier only',
        partyType: 'organization',
        isCustomer: false,
        isSupplier: true,
      })
      .expect(201);

    const customers = await root
      .get('/api/v1/parties')
      .query({ organizationId: state.orgId, isCustomer: true })
      .expect(200);
    expect(
      customers.body.items.map((party: { code: string }) => party.code),
    ).toEqual(['C-0001']);

    const suppliers = await root
      .get('/api/v1/parties')
      .query({ organizationId: state.orgId, isSupplier: true })
      .expect(200);
    expect(suppliers.body.total).toBe(2);
  });

  // ---- departments + employees (structure) ---------------------------------

  it('creates a department tree and an employee in it', async () => {
    const department = await root
      .post('/api/v1/departments')
      .send({
        organizationId: state.orgId,
        code: 'ENG',
        name: 'Engineering',
      })
      .expect(201);
    state.departmentId = department.body.id as string;

    const employee = await root
      .post('/api/v1/employees')
      .send({
        organizationId: state.orgId,
        employeeCode: 'E-0001',
        firstName: 'Sara',
        lastName: 'Karimi',
        departmentId: state.departmentId,
        branchId: state.branchId,
      })
      .expect(201);
    expect(employee.body).toMatchObject({
      departmentId: state.departmentId,
      branchId: state.branchId,
    });
    state.employeeId = employee.body.id as string;
  });

  it('rejects a department cycle with 422', async () => {
    const child = await root
      .post('/api/v1/departments')
      .send({
        organizationId: state.orgId,
        parentDepartmentId: state.departmentId,
        code: 'QA',
        name: 'Quality',
      })
      .expect(201);

    const res = await root
      .patch(`/api/v1/departments/${state.departmentId}`)
      .query({ organizationId: state.orgId })
      .send({ parentDepartmentId: child.body.id })
      .expect(422);
    expect(res.body.code).toBe('BusinessRuleViolation');
  });

  it("rejects an employee referencing another organization's department", async () => {
    const foreign = await root
      .post('/api/v1/departments')
      .send({
        organizationId: state.otherOrgId,
        code: 'SALES',
        name: 'Sales',
      })
      .expect(201);

    const res = await root
      .post('/api/v1/employees')
      .send({
        organizationId: state.orgId,
        employeeCode: 'E-0002',
        firstName: 'Ali',
        lastName: 'Rezaei',
        departmentId: foreign.body.id,
      })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  // ---- organization isolation over HTTP ------------------------------------

  it("returns 404 when addressing another organization's record by id", async () => {
    // The ids exist, but every list requires an organizationId and the
    // cross-organization reference resolvers answer 404, so a tenant cannot
    // probe for the existence of another tenant's rows.
    const foreignItem = await root.post('/api/v1/inventory/items').send({
      organizationId: state.otherOrgId,
      code: 'ITM-9000',
      name: 'Other org item',
      itemKind: 'goods',
      baseUnitId: state.unitPcsId,
    });
    // The base unit belongs to the first organization, so this must fail.
    expect(foreignItem.status).toBe(404);
  });

  it('never lists records of an organization that was not asked for', async () => {
    const branches = await root
      .get('/api/v1/branches')
      .query({ organizationId: state.otherOrgId })
      .expect(200);
    expect(
      branches.body.items.map((branch: { code: string }) => branch.code),
    ).toEqual(['MSH-01']);

    const items = await root
      .get('/api/v1/inventory/items')
      .query({ organizationId: state.otherOrgId })
      .expect(200);
    expect(items.body.total).toBe(0);

    const parties = await root
      .get('/api/v1/parties')
      .query({ organizationId: state.otherOrgId })
      .expect(200);
    expect(parties.body.total).toBe(0);
  });

  it('requires organizationId on every list (no cross-tenant listing exists)', async () => {
    for (const path of [
      '/api/v1/branches',
      '/api/v1/departments',
      '/api/v1/employees',
      '/api/v1/parties',
      '/api/v1/inventory/items',
      '/api/v1/inventory/item-groups',
      '/api/v1/inventory/units',
      '/api/v1/inventory/warehouses',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await root.get(path).expect(400);
      expect(res.body.code).toBe('ValidationFailed');
    }
  });

  // ---- lifecycle ------------------------------------------------------------

  it('disables and re-enables through the lifecycle endpoints, never deleting', async () => {
    const disabled = await root
      .post(`/api/v1/inventory/warehouses/${state.warehouseId}/disable`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(disabled.body.isActive).toBe(false);

    // Still readable after being disabled — history is never hidden.
    const fetched = await root
      .get(`/api/v1/inventory/warehouses/${state.warehouseId}`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(fetched.body.isActive).toBe(false);

    const enabled = await root
      .post(`/api/v1/inventory/warehouses/${state.warehouseId}/enable`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(enabled.body.isActive).toBe(true);
  });

  it('exposes no DELETE route on any master-data resource', async () => {
    for (const path of [
      `/api/v1/organizations/${state.orgId}`,
      `/api/v1/branches/${state.branchId}`,
      `/api/v1/departments/${state.departmentId}`,
      `/api/v1/employees/${state.employeeId}`,
      `/api/v1/parties/${state.partyId}`,
      `/api/v1/inventory/items/${state.itemId}`,
      `/api/v1/inventory/item-groups/${state.itemGroupId}`,
      `/api/v1/inventory/units/${state.unitPcsId}`,
      `/api/v1/inventory/warehouses/${state.warehouseId}`,
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await root.delete(path).expect(404);
    }
    // The row survived all of those attempts.
    const still = await root
      .get(`/api/v1/inventory/items/${state.itemId}`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(still.body.code).toBe('ITM-0001');
  });

  it('blocks new records under a disabled organization', async () => {
    const scratch = await root
      .post('/api/v1/organizations')
      .send({ code: 'SCRATCH', name: 'Scratch Co' })
      .expect(201);
    // ODR-3 (Task 19): root is a legitimate member — the assertion below
    // must reach the DISABLED-organization usability rule (422), not a
    // scope refusal.
    master.raw.memberships.seed(state.rootId, scratch.body.id as string);
    await root
      .post(`/api/v1/organizations/${scratch.body.id}/disable`)
      .expect(200);

    const res = await root
      .post('/api/v1/branches')
      .send({
        organizationId: scratch.body.id,
        code: 'NOPE',
        name: 'Blocked',
      })
      .expect(422);
    expect(res.body.code).toBe('BusinessRuleViolation');
  });

  it('answers a malformed id with 404 rather than a database error', async () => {
    const res = await root.get('/api/v1/organizations/not-a-ulid').expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });
});

/** `test:e2e` points DATABASE_URL at an unreachable host on purpose. */
function buildPrismaStub(): PrismaService {
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
