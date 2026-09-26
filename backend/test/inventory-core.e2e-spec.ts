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
import { createInMemoryStores } from './support/in-memory-repositories.js';
import { createMasterDataStores } from './support/master-data-repositories.js';
import { createInventoryCoreStores } from './support/inventory-core-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Inventory Core posting journey (e2e, in-memory data doubles).
 *
 * Task 9.6 exists because this surface had two correctness gaps:
 *   1. the idempotency hash included the server-defaulted business date, so a
 *      dateless RETRY of the same operation key hashed differently and was
 *      rejected with 409 instead of replaying (the double-posting failure the
 *      ledger exists to prevent) — the replay tests below pin that behaviour;
 *   2. by-id ledger routes had no organization scope, so a guessed id could
 *      be read or reversed across organizations — the scoping tests below.
 *
 * Real row locks and unique-race behaviour stay with the opt-in live suite;
 * the in-memory doubles honour replay-or-reject and atomicity.
 */
describe('Inventory Core posting (e2e)', () => {
  let app: INestApplication;
  let root: ReturnType<typeof request.agent>;

  const state = {
    orgId: '',
    otherOrgId: '',
    warehouseId: '',
    secondWarehouseId: '',
    unitId: '',
    itemId: '',
    inboundId: '',
    outboundId: '',
    transferOutLegId: '',
    reversalId: '',
    reservationId: '',
  };

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
    const built = await createTestApp({
      override: (builder) =>
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
    app = built.app;
    const users = app.get(UsersService);
    const roles = app.get(RolesService);
    const userRoles = app.get(UserRolesService);
    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code);
    const rootUser = await users.createUser({
      username: 'core-root',
      password: 'core-root-secret',
    });
    const role = await roles.createRole({
      name: 'Core Root',
      description: 'All permissions (test fixture)',
      permissionCodes: allCodes,
    });
    await userRoles.assignRoleToUser(role.id, rootUser.id);

    root = request.agent(app.getHttpServer());
    await root
      .post('/api/v1/auth/login')
      .send({ username: 'core-root', password: 'core-root-secret' })
      .expect(200);

    // Master data for the journeys (system-context services are fine for
    // setup; the assertions below all go over HTTP).
    const org = await root
      .post('/api/v1/organizations')
      .send({ code: 'CORE', name: 'Core Co' })
      .expect(201);
    state.orgId = org.body.id as string;
    const otherOrg = await root
      .post('/api/v1/organizations')
      .send({ code: 'CORE-OTHER', name: 'Other Co' })
      .expect(201);
    state.otherOrgId = otherOrg.body.id as string;
    // ODR-3 (Task 19): the sole persona is a legitimate member of both
    // organizations (the cross-org assertions are data-scoped).
    master.raw.memberships.seed(rootUser.id, state.orgId);
    master.raw.memberships.seed(rootUser.id, state.otherOrgId);

    const branch = await root
      .post('/api/v1/branches')
      .send({ organizationId: state.orgId, code: 'B1', name: 'Branch 1' })
      .expect(201);
    const wh1 = await root
      .post('/api/v1/inventory/warehouses')
      .send({
        organizationId: state.orgId,
        branchId: branch.body.id,
        code: 'WH1',
        name: 'Warehouse 1',
      })
      .expect(201);
    state.warehouseId = wh1.body.id as string;
    const wh2 = await root
      .post('/api/v1/inventory/warehouses')
      .send({
        organizationId: state.orgId,
        branchId: branch.body.id,
        code: 'WH2',
        name: 'Warehouse 2',
      })
      .expect(201);
    state.secondWarehouseId = wh2.body.id as string;

    const unit = await root
      .post('/api/v1/inventory/units')
      .send({ organizationId: state.orgId, code: 'PCS', name: 'Piece' })
      .expect(201);
    state.unitId = unit.body.id as string;
    const item = await root
      .post('/api/v1/inventory/items')
      .send({
        organizationId: state.orgId,
        code: 'ITM-1',
        name: 'Bolt',
        itemKind: 'goods',
        baseUnitId: state.unitId,
      })
      .expect(201);
    state.itemId = item.body.id as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  function inbound(operationKey: string, quantity: string) {
    return {
      organizationId: state.orgId,
      operationKey,
      warehouseId: state.warehouseId,
      itemId: state.itemId,
      movementType: 'inbound',
      quantity,
      unitId: state.unitId,
    };
  }

  it('replays a dateless inbound retry with the same movement instead of 409 (deterministic idempotency)', async () => {
    const first = await root
      .post('/api/v1/inventory/movements')
      .send(inbound('post-inbound-1', '10'))
      .expect(201);
    state.inboundId = first.body.id as string;

    // The retried request arrives later (its effective `new Date()` differs)
    // but names no business date; idempotency must hash client intent only.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const retry = await root
      .post('/api/v1/inventory/movements')
      .send(inbound('post-inbound-1', '10'))
      .expect(201);
    expect(retry.body.id).toBe(state.inboundId);

    const list = await root
      .get('/api/v1/inventory/movements')
      .query({ organizationId: state.orgId, page: 1, pageSize: 50 })
      .expect(200);
    expect(list.body.total).toBe(1);
  });

  it('rejects the same key with different intent with 409 (and applies nothing)', async () => {
    const conflict = await root
      .post('/api/v1/inventory/movements')
      .send(inbound('post-inbound-1', '11'))
      .expect(409);
    expect(conflict.body.code).toBe('Conflict');

    const list = await root
      .get('/api/v1/inventory/movements')
      .query({ organizationId: state.orgId, page: 1, pageSize: 50 })
      .expect(200);
    expect(list.body.total).toBe(1);
  });

  it('requires an operationKey (400, not a silent double posting)', async () => {
    const body = inbound('', '1');
    delete (body as { operationKey?: string }).operationKey;
    const res = await root
      .post('/api/v1/inventory/movements')
      .send(body)
      .expect(400);
    expect(res.body.code).toBe('ValidationFailed');
  });

  it('replays a dateless outbound retry', async () => {
    const first = await root
      .post('/api/v1/inventory/movements')
      .send({
        ...inbound('post-outbound-1', '4'),
        movementType: 'outbound',
      })
      .expect(201);
    state.outboundId = first.body.id as string;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const retry = await root
      .post('/api/v1/inventory/movements')
      .send({
        ...inbound('post-outbound-1', '4'),
        movementType: 'outbound',
      })
      .expect(201);
    expect(retry.body.id).toBe(state.outboundId);
  });

  it('replays a dateless transfer retry with the same two legs', async () => {
    const payload = {
      organizationId: state.orgId,
      operationKey: 'post-transfer-1',
      sourceWarehouseId: state.warehouseId,
      destinationWarehouseId: state.secondWarehouseId,
      itemId: state.itemId,
      quantity: '1',
      unitId: state.unitId,
    };
    const first = await root
      .post('/api/v1/inventory/transfers')
      .send(payload)
      .expect(201);
    state.transferOutLegId = first.body.outLeg?.id as string;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const retry = await root
      .post('/api/v1/inventory/transfers')
      .send(payload)
      .expect(201);
    expect(retry.body.outLeg?.id).toBe(state.transferOutLegId);
    expect(retry.body.inLeg?.id).toBe(first.body.inLeg?.id);

    const legs = await root
      .get('/api/v1/inventory/movements')
      .query({
        organizationId: state.orgId,
        transferId: first.body.transferId,
        page: 1,
        pageSize: 10,
      })
      .expect(200);
    expect(legs.body.total).toBe(2);
  });

  it('replays a dateless reversal retry with the same mirror movement', async () => {
    const first = await root
      .post(`/api/v1/inventory/movements/${state.outboundId}/reverse`)
      .query({ organizationId: state.orgId })
      .send({ operationKey: 'post-reversal-1' })
      .expect(201);
    state.reversalId = first.body.id as string;
    expect(first.body.reversalOfMovementId).toBe(state.outboundId);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const retry = await root
      .post(`/api/v1/inventory/movements/${state.outboundId}/reverse`)
      .query({ organizationId: state.orgId })
      .send({ operationKey: 'post-reversal-1' })
      .expect(201);
    expect(retry.body.id).toBe(state.reversalId);
  });

  it('creates and releases reservations with dateless key replay', async () => {
    const payload = {
      organizationId: state.orgId,
      operationKey: 'reservation-create-1',
      warehouseId: state.warehouseId,
      itemId: state.itemId,
      quantity: '2',
      unitId: state.unitId,
    };
    const first = await root
      .post('/api/v1/inventory/reservations')
      .send(payload)
      .expect(201);
    state.reservationId = first.body.id as string;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const retry = await root
      .post('/api/v1/inventory/reservations')
      .send(payload)
      .expect(201);
    expect(retry.body.id).toBe(state.reservationId);

    const releasePayload = { operationKey: 'reservation-release-1' };
    const released = await root
      .post(`/api/v1/inventory/reservations/${state.reservationId}/release`)
      .query({ organizationId: state.orgId })
      .send(releasePayload)
      .expect(200);
    expect(released.body.status).toBe('released');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const releasedRetry = await root
      .post(`/api/v1/inventory/reservations/${state.reservationId}/release`)
      .query({ organizationId: state.orgId })
      .send(releasePayload)
      .expect(200);
    expect(releasedRetry.body.id).toBe(state.reservationId);
  });

  it('scopes by-id movement reads and reversals to the named organization (404, never cross-org)', async () => {
    const owned = await root
      .get(`/api/v1/inventory/movements/${state.inboundId}`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(owned.body.id).toBe(state.inboundId);

    const foreign = await root
      .get(`/api/v1/inventory/movements/${state.inboundId}`)
      .query({ organizationId: state.otherOrgId })
      .expect(404);
    expect(foreign.body.code).toBe('EntityNotFound');

    const missingScope = await root
      .get(`/api/v1/inventory/movements/${state.inboundId}`)
      .expect(400);
    expect(missingScope.body.code).toBe('ValidationFailed');

    const foreignReverse = await root
      .post(`/api/v1/inventory/movements/${state.inboundId}/reverse`)
      .query({ organizationId: state.otherOrgId })
      .send({ operationKey: 'never-applied-foreign-reversal' })
      .expect(404);
    expect(foreignReverse.body.code).toBe('EntityNotFound');
  });

  it('scopes by-id reservation reads and releases to the named organization', async () => {
    const owned = await root
      .get(`/api/v1/inventory/reservations/${state.reservationId}`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(owned.body.id).toBe(state.reservationId);

    const foreign = await root
      .get(`/api/v1/inventory/reservations/${state.reservationId}`)
      .query({ organizationId: state.otherOrgId })
      .expect(404);
    expect(foreign.body.code).toBe('EntityNotFound');

    const missingScope = await root
      .get(`/api/v1/inventory/reservations/${state.reservationId}`)
      .expect(400);
    expect(missingScope.body.code).toBe('ValidationFailed');
  });

  it('rejects a posting whose references belong to a different organization', async () => {
    // The organization exists and is active; the warehouse does not belong to
    // it, so the reference resolves as not found (ADR-0021 §4).
    const res = await root
      .post('/api/v1/inventory/movements')
      .send({
        ...inbound('foreign-warehouse-post', '1'),
        organizationId: state.otherOrgId,
      })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });
});
