import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { RECALCULATION_MOVEMENT_LIMIT } from '../src/modules/inventory/data/inventory-valuation.repository.js';
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
import { InventoryValuationRepository } from '../src/modules/inventory/data/inventory-valuation.repository.js';
import { ItemValuationMethodsRepository } from '../src/modules/inventory/data/item-valuation-methods.repository.js';
import { MOVEMENT_PERMISSIONS } from '../src/modules/inventory/domain/inventory-core-permissions.js';
import { VALUATION_PERMISSIONS } from '../src/modules/inventory/domain/inventory-valuation-permissions.js';
import { createInMemoryStores } from './support/in-memory-repositories.js';
import { createMasterDataStores } from './support/master-data-repositories.js';
import { createInventoryCoreStores } from './support/inventory-core-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Inventory valuation journey (e2e, in-memory data doubles — PDR-05).
 *
 * This suite exists to prove the claims the slice is actually making, over
 * the FULL HTTP stack (controllers, guards, real services, real permission
 * registry), not just in the pure strategy:
 *
 *   1. a warehouse receipt and a warehouse issue post with NO monetary field
 *      anywhere in the request, and the resulting stock is visibly
 *      "waiting for a cost" instead of silently valued at zero;
 *   2. the valuation method is resolved by configuration + effective date,
 *      and a method nobody implemented is refused rather than offered;
 *   3. a backdated document is refused TWICE — once for the confirmation,
 *      once for the repricing decision — and "skip" honestly leaves the key
 *      marked inconsistent;
 *   4. a recalculation is explicit, bounded to one item in one warehouse,
 *      audited, and idempotent;
 *   5. money is a separate authority: a user without `Valuation.View` reads
 *      the same movements with the monetary fields blanked;
 *   6. none of it crosses an organization boundary.
 *
 * Real row locks stay with the opt-in live suite; everything asserted here
 * is behaviour the in-memory doubles reproduce faithfully (they run the same
 * pure valuation strategy the repositories do).
 */
describe('Inventory valuation (e2e)', () => {
  let app: INestApplication;
  let root: ReturnType<typeof request.agent>;
  /** A warehouse persona: may post quantities, may not see money. */
  let operator: ReturnType<typeof request.agent>;
  /**
   * The in-memory inventory stores. Held so ONE test can seed a historical
   * method version the configuration endpoint (correctly) refuses to create —
   * a test-only configuration boundary, used to prove the replay resolves a
   * method per movement date without implementing a second engine.
   */
  let core: ReturnType<typeof createInventoryCoreStores>;

  const state = {
    orgId: '',
    otherOrgId: '',
    branchId: '',
    warehouseId: '',
    secondWarehouseId: '',
    unitId: '',
    itemId: '',
    otherItemId: '',
    datedItemId: '',
    seriesItemId: '',
    denseItemId: '',
    limitItemId: '',
    denserThanLimitItemId: '',
    uncostedReceiptId: '',
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
    core = createInventoryCoreStores();
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
          .useValue(core.operations)
          .overrideProvider(InventoryValuationRepository)
          .useValue(core.valuation)
          .overrideProvider(ItemValuationMethodsRepository)
          .useValue(core.valuationMethods),
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
      username: 'valuation-root',
      password: 'valuation-root-secret',
    });
    const rootRole = await roles.createRole({
      name: 'Valuation Root',
      description: 'All permissions (test fixture)',
      permissionCodes: allCodes,
    });
    await userRoles.assignRoleToUser(rootRole.id, rootUser.id);

    // The warehouse persona: everything EXCEPT the valuation codes, so the
    // cost-redaction assertions exercise the real guard, not a mock.
    const operatorUser = await users.createUser({
      username: 'valuation-operator',
      password: 'valuation-operator-secret',
    });
    const operatorRole = await roles.createRole({
      name: 'Warehouse Operator',
      description: 'Quantities, never money (test fixture)',
      permissionCodes: allCodes.filter(
        (code) => !code.startsWith('Inventory.Valuation.'),
      ),
    });
    await userRoles.assignRoleToUser(operatorRole.id, operatorUser.id);

    root = request.agent(app.getHttpServer());
    await root
      .post('/api/v1/auth/login')
      .send({ username: 'valuation-root', password: 'valuation-root-secret' })
      .expect(200);
    operator = request.agent(app.getHttpServer());
    await operator
      .post('/api/v1/auth/login')
      .send({
        username: 'valuation-operator',
        password: 'valuation-operator-secret',
      })
      .expect(200);

    const org = await root
      .post('/api/v1/organizations')
      .send({ code: 'VAL', name: 'Valuation Co' })
      .expect(201);
    state.orgId = org.body.id as string;
    const otherOrg = await root
      .post('/api/v1/organizations')
      .send({ code: 'VAL-OTHER', name: 'Other Valuation Co' })
      .expect(201);
    state.otherOrgId = otherOrg.body.id as string;
    for (const user of [rootUser, operatorUser]) {
      master.raw.memberships.seed(user.id, state.orgId);
      master.raw.memberships.seed(user.id, state.otherOrgId);
    }

    const branch = await root
      .post('/api/v1/branches')
      .send({ organizationId: state.orgId, code: 'B1', name: 'Branch 1' })
      .expect(201);
    state.branchId = branch.body.id as string;
    const wh1 = await root
      .post('/api/v1/inventory/warehouses')
      .send({
        organizationId: state.orgId,
        branchId: state.branchId,
        code: 'WH1',
        name: 'Warehouse 1',
      })
      .expect(201);
    state.warehouseId = wh1.body.id as string;
    const wh2 = await root
      .post('/api/v1/inventory/warehouses')
      .send({
        organizationId: state.orgId,
        branchId: state.branchId,
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
        code: 'ITM-VAL',
        name: 'Valued Bolt',
        itemKind: 'goods',
        baseUnitId: state.unitId,
      })
      .expect(201);
    state.itemId = item.body.id as string;
    const otherItem = await root
      .post('/api/v1/inventory/items')
      .send({
        organizationId: state.orgId,
        code: 'ITM-VAL-2',
        name: 'Second Bolt',
        itemKind: 'goods',
        baseUnitId: state.unitId,
      })
      .expect(201);
    state.otherItemId = otherItem.body.id as string;
    const datedItem = await root
      .post('/api/v1/inventory/items')
      .send({
        organizationId: state.orgId,
        code: 'ITM-VAL-3',
        name: 'Effective-dated Bolt',
        itemKind: 'goods',
        baseUnitId: state.unitId,
      })
      .expect(201);
    state.datedItemId = datedItem.body.id as string;
    const seriesItem = await root
      .post('/api/v1/inventory/items')
      .send({
        organizationId: state.orgId,
        code: 'ITM-VAL-4',
        name: 'Long Policy History Bolt',
        itemKind: 'goods',
        baseUnitId: state.unitId,
      })
      .expect(201);
    state.seriesItemId = seriesItem.body.id as string;
    const denseItem = await root
      .post('/api/v1/inventory/items')
      .send({
        organizationId: state.orgId,
        code: 'ITM-VAL-5',
        name: 'Sparse Movement Dense Policy Bolt',
        itemKind: 'goods',
        baseUnitId: state.unitId,
      })
      .expect(201);
    state.denseItemId = denseItem.body.id as string;
    const limitItem = await root
      .post('/api/v1/inventory/items')
      .send({
        organizationId: state.orgId,
        code: 'ITM-VAL-6',
        name: 'Movement Limit Bolt',
        itemKind: 'goods',
        baseUnitId: state.unitId,
      })
      .expect(201);
    state.limitItemId = limitItem.body.id as string;
    const denserItem = await root
      .post('/api/v1/inventory/items')
      .send({
        organizationId: state.orgId,
        code: 'ITM-VAL-7',
        name: 'Configuration Denser Than Limit Bolt',
        itemKind: 'goods',
        baseUnitId: state.unitId,
      })
      .expect(201);
    state.denserThanLimitItemId = denserItem.body.id as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  function post(body: Record<string, unknown>) {
    return root.post('/api/v1/inventory/movements').send({
      organizationId: state.orgId,
      warehouseId: state.warehouseId,
      itemId: state.itemId,
      unitId: state.unitId,
      ...body,
    });
  }

  function stateOf(warehouseId = state.warehouseId, itemId = state.itemId) {
    return root.get('/api/v1/inventory/valuation/states/current').query({
      organizationId: state.orgId,
      warehouseId,
      itemId,
    });
  }

  // ---- 1. cost-optional warehouse operations -------------------------------

  it('posts a receipt with NO cost and reports the stock as waiting for a cost', async () => {
    const receipt = await post({
      operationKey: 'val-receipt-uncosted',
      movementType: 'inbound',
      quantity: '10',
    }).expect(201);

    state.uncostedReceiptId = receipt.body.id as string;
    expect(receipt.body.totalCost).toBeNull();
    expect(receipt.body.valuationStatus).toBe('unvalued');

    const valuation = await stateOf().expect(200);
    expect(valuation.body.uncostedQuantity).toBe('10');
    expect(valuation.body.valuedQuantity).toBe('0');
    expect(valuation.body.totalValue).toBe('0');
    expect(valuation.body.status).toBe('pending_cost');
    // Invariant (1): the value projection agrees with the quantity ledger.
    const balance = await root
      .get('/api/v1/inventory/balances')
      .query({
        organizationId: state.orgId,
        warehouseId: state.warehouseId,
        itemId: state.itemId,
        page: 1,
        pageSize: 10,
      })
      .expect(200);
    expect(balance.body.items[0].onHand).toBe('10');
    expect(valuation.body.totalQuantity).toBe('10');
  });

  it('posts an ISSUE with no cost, consuming uncosted stock first', async () => {
    const issue = await post({
      operationKey: 'val-issue-uncosted',
      movementType: 'outbound',
      quantity: '4',
    }).expect(201);

    expect(issue.body.totalCost).toBeNull();
    expect(issue.body.valuationStatus).toBe('unvalued');

    const valuation = await stateOf().expect(200);
    expect(valuation.body.uncostedQuantity).toBe('6');
    expect(valuation.body.status).toBe('pending_cost');
  });

  it('rejects an issue that would drive the stock negative (quantity rule intact)', async () => {
    const rejected = await post({
      operationKey: 'val-issue-negative',
      movementType: 'outbound',
      quantity: '999',
    }).expect(422);

    expect(String(rejected.body.message)).toMatch(/stock|negative/i);
  });

  it('accepts a cost ON a receipt when the caller may price stock', async () => {
    const receipt = await post({
      operationKey: 'val-receipt-costed',
      movementType: 'inbound',
      quantity: '10',
      unitCost: '100.00',
    }).expect(201);

    expect(receipt.body.totalCost).toBe('1000');
    expect(receipt.body.valuationStatus).toBe('valued');
    expect(receipt.body.valuationSource).toBe('entered');

    const valuation = await stateOf().expect(200);
    expect(valuation.body.valuedQuantity).toBe('10');
    expect(valuation.body.uncostedQuantity).toBe('6');
    expect(valuation.body.totalValue).toBe('1000');
    expect(valuation.body.averageUnitCost).toBe('100');
    expect(valuation.body.status).toBe('pending_cost');
  });

  it('refuses a cost on an ISSUE (outbound value comes from the method)', async () => {
    await post({
      operationKey: 'val-issue-costed',
      movementType: 'outbound',
      quantity: '1',
      totalCost: '50.00',
    }).expect(400);
  });

  it('refuses both unitCost and totalCost on one posting', async () => {
    await post({
      operationKey: 'val-receipt-ambiguous',
      movementType: 'inbound',
      quantity: '1',
      unitCost: '10.00',
      totalCost: '10.00',
    }).expect(400);
  });

  it('rejects an entered amount that would have to be rounded', async () => {
    await post({
      operationKey: 'val-receipt-precision',
      movementType: 'inbound',
      quantity: '1',
      totalCost: '10.005',
    }).expect(400);
  });

  // ---- 2. method configuration ---------------------------------------------

  it('resolves the MVP default method before anything is configured, and says it is a default', async () => {
    const resolved = await root
      .get('/api/v1/inventory/valuation/methods/resolve')
      .query({ organizationId: state.orgId, itemId: state.otherItemId })
      .expect(200);

    expect(resolved.body.method).toBe('moving_weighted_average');
    expect(resolved.body.source).toBe('default');
    expect(resolved.body.configurationId).toBeNull();
    expect(resolved.body.active).toBe(true);
  });

  it('refuses to configure a method nobody implemented (no fake options)', async () => {
    const rejected = await root
      .post('/api/v1/inventory/valuation/methods')
      .send({
        organizationId: state.orgId,
        itemId: state.itemId,
        method: 'fifo',
      })
      .expect(422);

    expect(String(rejected.body.message)).toContain('moving_weighted_average');

    const stillDefault = await root
      .get('/api/v1/inventory/valuation/methods/resolve')
      .query({ organizationId: state.orgId, itemId: state.itemId })
      .expect(200);
    expect(stillDefault.body.source).toBe('default');
  });

  it('configures an effective-dated method version and resolves it historically', async () => {
    const created = await root
      .post('/api/v1/inventory/valuation/methods')
      .send({
        organizationId: state.orgId,
        itemId: state.itemId,
        method: 'moving_weighted_average',
        validFrom: '2026-01-01T00:00:00.000Z',
        note: 'MVP policy',
      })
      .expect(201);

    expect(created.body.validFrom).toBe('2026-01-01T00:00:00.000Z');
    expect(created.body.validTo).toBeNull();

    const inForce = await root
      .get('/api/v1/inventory/valuation/methods/resolve')
      .query({
        organizationId: state.orgId,
        itemId: state.itemId,
        asOf: '2026-06-01T00:00:00.000Z',
      })
      .expect(200);
    expect(inForce.body.source).toBe('configured');
    expect(inForce.body.configurationId).toBe(created.body.id);

    // A date before the version exists resolves to the default, not to a
    // configuration that had not been decided yet.
    const before = await root
      .get('/api/v1/inventory/valuation/methods/resolve')
      .query({
        organizationId: state.orgId,
        itemId: state.itemId,
        asOf: '2025-06-01T00:00:00.000Z',
      })
      .expect(200);
    expect(before.body.source).toBe('default');
  });

  it('supersedes the open version instead of editing it', async () => {
    await root
      .post('/api/v1/inventory/valuation/methods')
      .send({
        organizationId: state.orgId,
        itemId: state.itemId,
        method: 'moving_weighted_average',
        validFrom: '2027-01-01T00:00:00.000Z',
      })
      .expect(201);

    const versions = await root
      .get('/api/v1/inventory/valuation/methods')
      .query({
        organizationId: state.orgId,
        itemId: state.itemId,
        page: 1,
        pageSize: 10,
      })
      .expect(200);

    expect(versions.body.total).toBe(2);
    const closed = versions.body.items.find(
      (version: { validFrom: string }) =>
        version.validFrom === '2026-01-01T00:00:00.000Z',
    );
    expect(closed.validTo).toBe('2027-01-01T00:00:00.000Z');
  });

  // ---- 3. backdating -------------------------------------------------------

  it('previews what a backdated posting would disturb, in counts, before anything is committed', async () => {
    const check = await root
      .get('/api/v1/inventory/valuation/backdate-check')
      .query({
        organizationId: state.orgId,
        warehouseId: state.warehouseId,
        itemId: state.itemId,
        movementDate: '2020-01-01T00:00:00.000Z',
      })
      .expect(200);

    expect(check.body.backdated).toBe(true);
    expect(check.body.affectedMovements).toBeGreaterThan(0);
    expect(check.body.confirmationRequired).toBe(true);
    expect(check.body.repricingChoiceRequired).toBe(true);
    expect(check.body.code).toBe('inventory.backdated_document');
  });

  it('refuses a backdated posting that is not confirmed', async () => {
    const rejected = await post({
      operationKey: 'val-backdated-unconfirmed',
      movementType: 'inbound',
      quantity: '5',
      totalCost: '250.00',
      movementDate: '2020-01-01T00:00:00.000Z',
    }).expect(422);

    expect(rejected.body.details.code).toBe('inventory.backdated_document');
    expect(rejected.body.details.affectedMovements).toBeGreaterThan(0);
    // The message explains the consequence rather than asking "are you sure?".
    expect(String(rejected.body.message)).toContain('later movement');
  });

  it('refuses a CONFIRMED backdated posting that made no repricing choice', async () => {
    const rejected = await post({
      operationKey: 'val-backdated-nochoice',
      movementType: 'inbound',
      quantity: '5',
      totalCost: '250.00',
      movementDate: '2020-01-01T00:00:00.000Z',
      backdateConfirmed: true,
    }).expect(422);

    expect(rejected.body.details.code).toBe(
      'inventory.repricing_choice_required',
    );
  });

  it('rejects an unknown repricing answer instead of defaulting it', async () => {
    await post({
      operationKey: 'val-backdated-badchoice',
      movementType: 'inbound',
      quantity: '5',
      totalCost: '250.00',
      movementDate: '2020-01-01T00:00:00.000Z',
      backdateConfirmed: true,
      repricing: 'whatever',
    }).expect(400);
  });

  it('honours "skip": the posting commits and the key is HONESTLY marked inconsistent', async () => {
    const posted = await post({
      operationKey: 'val-backdated-skip',
      movementType: 'inbound',
      quantity: '5',
      totalCost: '250.00',
      movementDate: '2020-01-01T00:00:00.000Z',
      backdateConfirmed: true,
      repricing: 'skip',
    }).expect(201);

    expect(posted.body.totalCost).toBe('250');

    const valuation = await stateOf().expect(200);
    expect(valuation.body.status).toBe('stale');
    expect(valuation.body.staleSince).not.toBeNull();

    // Nothing was recalculated behind the operator's back.
    const runs = await root
      .get('/api/v1/inventory/valuation/recalculations')
      .query({
        organizationId: state.orgId,
        warehouseId: state.warehouseId,
        itemId: state.itemId,
        page: 1,
        pageSize: 10,
      })
      .expect(200);
    expect(runs.body.total).toBe(0);
  });

  // ---- 4. explicit, bounded recalculation ----------------------------------

  it('repairs the stale key only when a recalculation is explicitly commanded', async () => {
    const recalculated = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        organizationId: state.orgId,
        operationKey: 'val-recalc-1',
        warehouseId: state.warehouseId,
        itemId: state.itemId,
        reason: 'Repair after the backdated receipt.',
      })
      .expect(201);

    expect(recalculated.body.run.trigger).toBe('manual');
    expect(recalculated.body.run.movementsExamined).toBeGreaterThan(0);
    expect(recalculated.body.run.operationKey).toBe('val-recalc-1');
    // The key is no longer stale; it is still waiting for the cost of the
    // uncosted receipt, and says exactly that.
    expect(recalculated.body.state.status).toBe('pending_cost');
    expect(recalculated.body.state.staleSince).toBeNull();

    const audited = await root
      .get('/api/v1/inventory/valuation/recalculations')
      .query({
        organizationId: state.orgId,
        warehouseId: state.warehouseId,
        itemId: state.itemId,
        page: 1,
        pageSize: 10,
      })
      .expect(200);
    expect(audited.body.total).toBe(1);
  });

  it('is idempotent: a second recalculation changes nothing and says so', async () => {
    const again = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        organizationId: state.orgId,
        operationKey: 'val-recalc-2',
        warehouseId: state.warehouseId,
        itemId: state.itemId,
      })
      .expect(201);

    expect(again.body.run.movementsRevalued).toBe(0);
    expect(again.body.state.status).toBe('pending_cost');
  });

  it('replays a retried recalculation key instead of running a second one', async () => {
    const replayed = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        organizationId: state.orgId,
        operationKey: 'val-recalc-2',
        warehouseId: state.warehouseId,
        itemId: state.itemId,
      })
      .expect(201);

    const runs = await root
      .get('/api/v1/inventory/valuation/recalculations')
      .query({
        organizationId: state.orgId,
        warehouseId: state.warehouseId,
        itemId: state.itemId,
        page: 1,
        pageSize: 10,
      })
      .expect(200);

    expect(runs.body.total).toBe(2);
    expect(
      runs.body.items.some(
        (run: { id: string }) => run.id === replayed.body.run.id,
      ),
    ).toBe(true);
  });

  it('replays each movement under the method effective AT ITS OWN DATE, not the one in force today', async () => {
    const key = {
      organizationId: state.orgId,
      warehouseId: state.warehouseId,
      itemId: state.datedItemId,
    };
    const receipt = (
      operationKey: string,
      movementDate: string,
      totalCost: string,
    ) =>
      root
        .post('/api/v1/inventory/movements')
        .send({
          ...key,
          unitId: state.unitId,
          operationKey,
          movementType: 'inbound',
          quantity: '10',
          totalCost,
          movementDate,
          backdateConfirmed: true,
          repricing: 'skip',
        })
        .expect(201);

    // Two receipts in ascending date order: one in the earlier period, one in
    // the later period.
    const early = await receipt(
      'val-dated-1',
      '2026-01-10T00:00:00.000Z',
      '1000.00',
    );
    const late = await receipt(
      'val-dated-2',
      '2026-02-10T00:00:00.000Z',
      '1200.00',
    );

    // Both periods are Moving Weighted Average today, so the whole history is
    // executable and the recalculation succeeds.
    const ok = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        ...key,
        operationKey: 'val-dated-recalc-ok',
        reason: 'Baseline before the historical method changes.',
      })
      .expect(201);
    expect(ok.body.run.movementsExamined).toBe(2);
    expect(ok.body.state.totalValue).toBe('2200');

    // TEST-ONLY configuration boundary: the configuration endpoint refuses to
    // store a method nobody implemented (proved by its own test), so the only
    // way a FIFO period can exist today is to seed it. That is exactly the
    // history a future release — or a data migration — can produce, and the
    // replay must not paper over it.
    core.tables.valuationMethods.insert({
      id: 'seeded-fifo-window',
      organizationId: state.orgId,
      itemId: state.datedItemId,
      method: 'fifo',
      validFrom: new Date('2026-02-01T00:00:00.000Z'),
      validTo: new Date('2026-03-01T00:00:00.000Z'),
      note: 'Seeded by the test: a period configured with a method the MVP cannot execute.',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    // The method in force TODAY is still the default Moving Weighted Average,
    // so a run that resolved one method for the whole history would happily
    // revalue the February movement with it. It must not: that movement's own
    // date falls in the FIFO window.
    const resolvedNow = await root
      .get('/api/v1/inventory/valuation/methods/resolve')
      .query({
        organizationId: state.orgId,
        itemId: state.datedItemId,
        asOf: new Date().toISOString(),
      })
      .expect(200);
    expect(resolvedNow.body.method).toBe('moving_weighted_average');

    const refused = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        ...key,
        operationKey: 'val-dated-recalc-refused',
        reason: 'Must refuse: February was configured with FIFO.',
      })
      .expect(422);
    expect(refused.body.details.code).toBe(
      'inventory.valuation_method_not_implemented',
    );
    expect(refused.body.details.method).toBe('fifo');
    expect(refused.body.details.movementId).toBe(late.body.id);
    // The honest refusal leaves the earlier, executable period untouched
    // rather than half-rewritten.
    const unchanged = await root
      .get('/api/v1/inventory/valuation/states/current')
      .query(key)
      .expect(200);
    expect(unchanged.body.totalValue).toBe('2200');
    expect(early.body.id).not.toBe(late.body.id);

    // Narrow the FIFO window to a period that holds no movement: every fact
    // resolves to an executable method again and the replay runs.
    core.tables.valuationMethods.patch('seeded-fifo-window', {
      validFrom: new Date('2026-05-01T00:00:00.000Z'),
      validTo: new Date('2026-06-01T00:00:00.000Z'),
    });
    const recovered = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        ...key,
        operationKey: 'val-dated-recalc-recovered',
        reason: 'The unexecutable period no longer contains any movement.',
      })
      .expect(201);
    expect(recovered.body.run.movementsExamined).toBe(2);
    expect(recovered.body.state.totalValue).toBe('2200');
  });

  it('resolves and replays a long method history, reading only the versions the replayed period can use', async () => {
    const key = {
      organizationId: state.orgId,
      warehouseId: state.warehouseId,
      itemId: state.seriesItemId,
    };

    // A realistic policy history: four consecutive effective-dated versions,
    // each superseding the previous open-ended one through the real API.
    const months = [
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
    ];
    const versionIds: string[] = [];
    for (const validFrom of months) {
      const created = await root
        .post('/api/v1/inventory/valuation/methods')
        .send({
          organizationId: state.orgId,
          itemId: state.seriesItemId,
          method: 'moving_weighted_average',
          validFrom,
          note: `Policy from ${validFrom}`,
        })
        .expect(201);
      versionIds.push(created.body.id as string);
    }
    const listed = await root
      .get('/api/v1/inventory/valuation/methods')
      .query({
        organizationId: state.orgId,
        itemId: state.seriesItemId,
        page: 1,
        pageSize: 10,
      })
      .expect(200);
    expect(listed.body.total).toBe(4);

    // Each date resolves ITS OWN version — the bounded single-row lookup must
    // not drift to the newest one.
    const resolveAt = async (asOf: string) =>
      (
        await root
          .get('/api/v1/inventory/valuation/methods/resolve')
          .query({
            organizationId: state.orgId,
            itemId: state.seriesItemId,
            asOf,
          })
          .expect(200)
      ).body;
    expect((await resolveAt('2026-01-15T00:00:00.000Z')).configurationId).toBe(
      versionIds[0],
    );
    expect((await resolveAt('2026-02-15T00:00:00.000Z')).configurationId).toBe(
      versionIds[1],
    );
    expect((await resolveAt('2026-03-15T00:00:00.000Z')).configurationId).toBe(
      versionIds[2],
    );
    expect((await resolveAt('2026-09-15T00:00:00.000Z')).configurationId).toBe(
      versionIds[3],
    );
    // Before the first version there is no configuration at all.
    expect((await resolveAt('2025-06-01T00:00:00.000Z')).source).toBe(
      'default',
    );

    // Two movements, both inside the FIRST TWO windows: the replay horizon is
    // [2026-01-15, 2026-02-15], so versions three and four cannot apply to
    // either of them.
    for (const [index, movementDate] of [
      '2026-01-15T00:00:00.000Z',
      '2026-02-15T00:00:00.000Z',
    ].entries()) {
      await root
        .post('/api/v1/inventory/movements')
        .send({
          ...key,
          unitId: state.unitId,
          operationKey: `val-series-${index}`,
          movementType: 'inbound',
          quantity: '4',
          totalCost: '400.00',
          movementDate,
          backdateConfirmed: true,
          repricing: 'skip',
        })
        .expect(201);
    }

    const replayed = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        ...key,
        operationKey: 'val-series-recalc',
        reason: 'Replay across a multi-version policy history.',
      })
      .expect(201);
    expect(replayed.body.run.movementsExamined).toBe(2);
    expect(replayed.body.state.totalValue).toBe('800');
    expect(replayed.body.state.valuedQuantity).toBe('8');

    // A method nobody implemented, configured to take effect in the FUTURE
    // (seeded: the configuration endpoint rightly refuses to create one, and
    // superseding the open version is how a real future-dated policy change
    // would look). It is outside the replay horizon, so it cannot reach
    // these 2026-01/02 movements and the recalculation still runs.
    //
    // The window starts strictly after "now" so the key's CURRENT method is
    // still the executable one — the separate, pre-existing rule that a key
    // whose method in force today is unimplemented cannot be recalculated at
    // all stays untouched and is not what this case probes.
    const futureFrom = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    core.tables.valuationMethods.patch(versionIds[3] as string, {
      validTo: futureFrom,
    });
    core.tables.valuationMethods.insert({
      id: 'seeded-future-fifo',
      organizationId: state.orgId,
      itemId: state.seriesItemId,
      method: 'fifo',
      validFrom: futureFrom,
      validTo: null,
      note: 'Seeded: a future period the MVP cannot execute.',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Sanity: today still resolves to the executable policy.
    expect((await resolveAt(new Date().toISOString())).method).toBe(
      'moving_weighted_average',
    );
    const afterFuture = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        ...key,
        operationKey: 'val-series-recalc-future',
        reason: 'A future unsupported policy must not touch 2026-01/02.',
      })
      .expect(201);
    expect(afterFuture.body.run.movementsExamined).toBe(2);
    expect(afterFuture.body.state.totalValue).toBe('800');
    expect(afterFuture.body.run.movementsRevalued).toBe(0);

    // Move that same unsupported window INTO the horizon — mid-February, so
    // the second movement falls inside it and the series stays gapless and
    // non-overlapping — and the replay must refuse. The only thing that
    // changed is whether a replayed movement falls in the unsupported
    // period.
    core.tables.valuationMethods.patch(versionIds[1] as string, {
      validTo: new Date('2026-02-10T00:00:00.000Z'),
    });
    core.tables.valuationMethods.patch('seeded-future-fifo', {
      validFrom: new Date('2026-02-10T00:00:00.000Z'),
      validTo: new Date('2026-03-01T00:00:00.000Z'),
    });
    const refused = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        ...key,
        operationKey: 'val-series-recalc-inside',
        reason: 'Now a replayed movement falls in the unsupported window.',
      })
      .expect(422);
    expect(refused.body.details.code).toBe(
      'inventory.valuation_method_not_implemented',
    );
    expect(refused.body.details.method).toBe('fifo');
  });

  it('replays two movements that span a year of monthly policy versions', async () => {
    // The configuration-density case: 12 effective-dated versions, 2
    // movements. The replay must read the versions in force ON THOSE TWO
    // DATES and must not be refused for a limit that counts movements.
    const key = {
      organizationId: state.orgId,
      warehouseId: state.warehouseId,
      itemId: state.denseItemId,
    };
    const iso = (month: number, day: number) =>
      new Date(Date.UTC(2025, month - 1, day)).toISOString();

    for (let month = 1; month <= 12; month += 1) {
      await root
        .post('/api/v1/inventory/valuation/methods')
        .send({
          organizationId: state.orgId,
          itemId: state.denseItemId,
          method: 'moving_weighted_average',
          validFrom: iso(month, 1),
          note: `Policy for 2025-${String(month).padStart(2, '0')}`,
        })
        .expect(201);
    }
    const configured = await root
      .get('/api/v1/inventory/valuation/methods')
      .query({
        organizationId: state.orgId,
        itemId: state.denseItemId,
        page: 1,
        pageSize: 50,
      })
      .expect(200);
    expect(configured.body.total).toBe(12);

    // Only two movements, eleven months apart.
    for (const [index, movementDate] of [iso(1, 1), iso(12, 29)].entries()) {
      await root
        .post('/api/v1/inventory/movements')
        .send({
          ...key,
          unitId: state.unitId,
          operationKey: `val-dense-${index}`,
          movementType: 'inbound',
          quantity: '5',
          totalCost: '250.00',
          movementDate,
          backdateConfirmed: true,
          repricing: 'skip',
        })
        .expect(201);
    }

    const replayed = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        ...key,
        operationKey: 'val-dense-recalc',
        reason: 'Two movements across twelve monthly policy versions.',
      })
      .expect(201);
    expect(replayed.body.run.movementsExamined).toBe(2);
    expect(replayed.body.state.valuedQuantity).toBe('10');
    expect(replayed.body.state.totalValue).toBe('500');

    // Deterministic: replaying again changes nothing.
    const again = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        ...key,
        operationKey: 'val-dense-recalc-2',
        reason: 'Determinism check.',
      })
      .expect(201);
    expect(again.body.run.movementsRevalued).toBe(0);
    expect(again.body.state.totalValue).toBe('500');

    // A version taking effect after both movements stays irrelevant to them.
    await root
      .post('/api/v1/inventory/valuation/methods')
      .send({
        organizationId: state.orgId,
        itemId: state.denseItemId,
        method: 'moving_weighted_average',
        validFrom: new Date(
          Date.now() + 365 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        note: 'Future policy.',
      })
      .expect(201);
    const afterFuture = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        ...key,
        operationKey: 'val-dense-recalc-3',
        reason: 'A future policy must not disturb the 2025 replay.',
      })
      .expect(201);
    expect(afterFuture.body.run.movementsRevalued).toBe(0);
    expect(afterFuture.body.state.totalValue).toBe('500');
  });

  it('replays two movements even when the item has MORE configuration versions than the movement limit', async () => {
    // The exact shape the movement-count ceiling got wrong: configuration
    // density far above the movement limit, movement count far below it.
    // The replay needs two versions — one per movement date — so the number
    // of versions in between must not matter at all.
    const key = {
      organizationId: state.orgId,
      warehouseId: state.warehouseId,
      itemId: state.denserThanLimitItemId,
    };
    const yearStart = Date.UTC(2025, 0, 1);
    const lastMovement = Date.UTC(2025, 11, 29);
    const versionCount = RECALCULATION_MOVEMENT_LIMIT + 1;
    // Every window opens on or before the LAST movement, so all of them are
    // in force somewhere inside the replayed period. That is what makes this
    // a regression test: the previous horizon read returned all
    // `RECALCULATION_MOVEMENT_LIMIT + 1` of them and refused the replay,
    // even though only two of them govern a movement.
    const step = Math.floor((lastMovement - yearStart) / versionCount);
    // Contiguous half-open windows: dense, but never overlapping. Seeded
    // rather than inserted because the per-row uniqueness scan is O(n) and
    // this fixture is deliberately large; the windows are distinct by
    // construction, so the guard has nothing to catch.
    for (let index = 0; index < versionCount; index += 1) {
      const validFrom = new Date(yearStart + index * step);
      core.tables.valuationMethods.seed({
        id: `dense-${index}`,
        organizationId: state.orgId,
        itemId: state.denserThanLimitItemId,
        method: 'moving_weighted_average',
        validFrom,
        validTo:
          index === versionCount - 1
            ? null
            : new Date(yearStart + (index + 1) * step),
        note: null,
        createdAt: validFrom,
        updatedAt: validFrom,
      });
    }

    for (const [index, movementDate] of [
      new Date(Date.UTC(2025, 0, 1)).toISOString(),
      new Date(Date.UTC(2025, 11, 29)).toISOString(),
    ].entries()) {
      await root
        .post('/api/v1/inventory/movements')
        .send({
          ...key,
          unitId: state.unitId,
          operationKey: `val-denser-${index}`,
          movementType: 'inbound',
          quantity: '3',
          totalCost: '90.00',
          movementDate,
          backdateConfirmed: true,
          repricing: 'skip',
        })
        .expect(201);
    }

    const replayed = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        ...key,
        operationKey: 'val-denser-recalc',
        reason: 'Two movements, more policy versions than the movement limit.',
      })
      .expect(201);
    expect(replayed.body.run.movementsExamined).toBe(2);
    expect(replayed.body.state.valuedQuantity).toBe('6');
    expect(replayed.body.state.totalValue).toBe('180');
  });

  it('still refuses a key with more movements than the recalculation limit', async () => {
    // The movement limit must keep limiting MOVEMENTS. One real posting
    // establishes the balance and state; the rest of the history is seeded
    // directly because the point is the row count, not the HTTP path.
    const key = {
      organizationId: state.orgId,
      warehouseId: state.warehouseId,
      itemId: state.limitItemId,
    };
    await root
      .post('/api/v1/inventory/movements')
      .send({
        ...key,
        unitId: state.unitId,
        operationKey: 'val-limit-seed',
        movementType: 'inbound',
        quantity: '1',
        totalCost: '10.00',
      })
      .expect(201);

    const base = new Date('2025-01-01T00:00:00.000Z').getTime();
    for (let index = 0; index < RECALCULATION_MOVEMENT_LIMIT; index += 1) {
      core.tables.movements.insert({
        id: `seeded-limit-${index}`,
        organizationId: state.orgId,
        branchId: state.branchId,
        warehouseId: state.warehouseId,
        itemId: state.limitItemId,
        movementType: 'inbound',
        quantity: '1',
        enteredUnitId: state.unitId,
        baseQuantity: '1',
        baseUnitId: state.unitId,
        conversionFactor: '1',
        movementDate: new Date(base + index * 1000),
        transferId: null,
        reversalOfMovementId: null,
        referenceType: null,
        referenceId: null,
        reason: null,
        operationKey: `seeded-limit-${index}`,
        totalCost: null,
        valuationStatus: 'unvalued',
        valuationSource: null,
        valuedAt: null,
        valuationRunId: null,
        createdAt: new Date(base + index * 1000),
        updatedAt: new Date(base + index * 1000),
      });
    }

    const refused = await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        ...key,
        operationKey: 'val-limit-recalc',
        reason: 'More movements than one command may replay.',
      })
      .expect(422);
    expect(refused.body.details.code).toBe('inventory.recalculation_too_large');
    expect(refused.body.details.limit).toBe(RECALCULATION_MOVEMENT_LIMIT);
  });

  it('refuses a recalculation without a key (there is no "recalculate everything")', async () => {
    await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        organizationId: state.orgId,
        operationKey: 'val-recalc-unbounded',
        itemId: state.itemId,
      })
      .expect(400);
  });

  // ---- 5. late pricing ------------------------------------------------------

  it('prices a receipt that was posted without a cost, and reprices the key on request', async () => {
    const assigned = await root
      .post(
        `/api/v1/inventory/valuation/movements/${state.uncostedReceiptId}/cost`,
      )
      .send({
        organizationId: state.orgId,
        operationKey: 'val-assign-1',
        totalCost: '600.00',
        repricing: 'recalculate',
        reason: 'Supplier invoice arrived.',
      })
      .expect(201);

    expect(assigned.body.movement.totalCost).toBe('600');
    expect(assigned.body.movement.valuationSource).toBe('entered');
    expect(assigned.body.run.trigger).toBe('cost_assignment');
    // Every unit now carries a value: nothing is waiting for a cost and
    // nothing is inconsistent.
    expect(assigned.body.state.status).toBe('valued');
    expect(assigned.body.state.uncostedQuantity).toBe('0');
  });

  it('refuses to overwrite a cost that already exists (correct by reversal)', async () => {
    await root
      .post(
        `/api/v1/inventory/valuation/movements/${state.uncostedReceiptId}/cost`,
      )
      .send({
        organizationId: state.orgId,
        operationKey: 'val-assign-2',
        totalCost: '700.00',
        repricing: 'recalculate',
      })
      .expect(409);
  });

  it('requires an explicit repricing choice when pricing a late cost', async () => {
    const receipt = await post({
      operationKey: 'val-receipt-late',
      movementType: 'inbound',
      quantity: '2',
    }).expect(201);

    await root
      .post(`/api/v1/inventory/valuation/movements/${receipt.body.id}/cost`)
      .send({
        organizationId: state.orgId,
        operationKey: 'val-assign-nochoice',
        totalCost: '100.00',
      })
      .expect(400);

    // …and "skip" records the cost while leaving the key marked inconsistent.
    const skipped = await root
      .post(`/api/v1/inventory/valuation/movements/${receipt.body.id}/cost`)
      .send({
        organizationId: state.orgId,
        operationKey: 'val-assign-skip',
        totalCost: '100.00',
        repricing: 'skip',
      })
      .expect(201);

    expect(skipped.body.run).toBeNull();
    expect(skipped.body.state.status).toBe('stale');
  });

  // ---- 6. transfers and reversals keep the two ledgers in step --------------

  it('moves value with a transfer without inventing or destroying any', async () => {
    const before = await stateOf().expect(200);

    await root
      .post('/api/v1/inventory/transfers')
      .send({
        organizationId: state.orgId,
        operationKey: 'val-transfer-1',
        sourceWarehouseId: state.warehouseId,
        destinationWarehouseId: state.secondWarehouseId,
        itemId: state.itemId,
        quantity: '5',
        unitId: state.unitId,
      })
      .expect(201);

    const source = await stateOf().expect(200);
    const destination = await stateOf(state.secondWarehouseId).expect(200);
    const moved =
      Number(before.body.totalValue) - Number(source.body.totalValue);

    expect(moved).toBeGreaterThan(0);
    expect(Number(destination.body.totalValue)).toBeCloseTo(moved, 2);
  });

  // ---- 7. money is a separate authority ------------------------------------

  it('blanks the monetary fields for a user without Inventory.Valuation.View', async () => {
    const visible = await root
      .get(`/api/v1/inventory/movements/${state.uncostedReceiptId}`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(visible.body.totalCost).toBe('600');

    const redacted = await operator
      .get(`/api/v1/inventory/movements/${state.uncostedReceiptId}`)
      .query({ organizationId: state.orgId })
      .expect(200);

    expect(redacted.body.totalCost).toBeNull();
    expect(redacted.body.valuationSource).toBeNull();
    // The physical record is unchanged — same id, same quantity.
    expect(redacted.body.id).toBe(visible.body.id);
    expect(redacted.body.baseQuantity).toBe(visible.body.baseQuantity);
  });

  it('keeps the warehouse persona able to POST without any cost', async () => {
    const posted = await operator
      .post('/api/v1/inventory/movements')
      .send({
        organizationId: state.orgId,
        operationKey: 'val-operator-receipt',
        warehouseId: state.warehouseId,
        itemId: state.otherItemId,
        unitId: state.unitId,
        movementType: 'inbound',
        quantity: '3',
      })
      .expect(201);

    expect(posted.body.valuationStatus).toBe('unvalued');
    expect(posted.body.totalCost).toBeNull();
  });

  it('forbids the warehouse persona from entering a cost or repricing', async () => {
    await operator
      .post('/api/v1/inventory/movements')
      .send({
        organizationId: state.orgId,
        operationKey: 'val-operator-costed',
        warehouseId: state.warehouseId,
        itemId: state.otherItemId,
        unitId: state.unitId,
        movementType: 'inbound',
        quantity: '3',
        totalCost: '30.00',
      })
      .expect(403);

    await operator
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        organizationId: state.orgId,
        operationKey: 'val-operator-recalc',
        warehouseId: state.warehouseId,
        itemId: state.otherItemId,
      })
      .expect(403);

    await operator
      .get('/api/v1/inventory/valuation/states')
      .query({ organizationId: state.orgId, page: 1, pageSize: 10 })
      .expect(403);
  });

  it('still lets the warehouse persona preview a backdated posting (they must see the consequence)', async () => {
    const check = await operator
      .get('/api/v1/inventory/valuation/backdate-check')
      .query({
        organizationId: state.orgId,
        warehouseId: state.warehouseId,
        itemId: state.itemId,
        movementDate: '2020-01-01T00:00:00.000Z',
      })
      .expect(200);

    expect(check.body.backdated).toBe(true);
    // Counts and dates only — the preview never leaks an amount.
    expect(Object.keys(check.body)).not.toContain('totalValue');
  });

  // ---- 8. organization isolation -------------------------------------------

  it('never returns another organization\u2019s valuation state', async () => {
    await root
      .get('/api/v1/inventory/valuation/states/current')
      .query({
        organizationId: state.otherOrgId,
        warehouseId: state.warehouseId,
        itemId: state.itemId,
      })
      .expect(404);

    const foreignList = await root
      .get('/api/v1/inventory/valuation/states')
      .query({ organizationId: state.otherOrgId, page: 1, pageSize: 10 })
      .expect(200);
    expect(foreignList.body.total).toBe(0);

    const foreignRuns = await root
      .get('/api/v1/inventory/valuation/recalculations')
      .query({ organizationId: state.otherOrgId, page: 1, pageSize: 10 })
      .expect(200);
    expect(foreignRuns.body.total).toBe(0);
  });

  it('never prices or reprices across an organization boundary', async () => {
    await root
      .post(
        `/api/v1/inventory/valuation/movements/${state.uncostedReceiptId}/cost`,
      )
      .send({
        organizationId: state.otherOrgId,
        operationKey: 'val-assign-cross-org',
        totalCost: '1.00',
        repricing: 'skip',
      })
      .expect(404);

    await root
      .post('/api/v1/inventory/valuation/recalculations')
      .send({
        organizationId: state.otherOrgId,
        operationKey: 'val-recalc-cross-org',
        warehouseId: state.warehouseId,
        itemId: state.itemId,
      })
      .expect(404);
  });

  it('registers exactly the four valuation permissions it implements', async () => {
    const codes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code)
      .filter((code) => code.startsWith('Inventory.Valuation.'));

    expect(codes.sort()).toEqual(
      [
        VALUATION_PERMISSIONS.ASSIGN_COST,
        VALUATION_PERMISSIONS.CONFIGURE,
        VALUATION_PERMISSIONS.RECALCULATE,
        VALUATION_PERMISSIONS.VIEW,
      ].sort(),
    );
    // The backdate preview deliberately rides on the posting permission.
    expect(MOVEMENT_PERMISSIONS.CREATE).toBe('Inventory.Movement.Create');
  });
});
