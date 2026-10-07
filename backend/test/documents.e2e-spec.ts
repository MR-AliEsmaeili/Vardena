import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { generateId } from '../src/kernel/ids/ulid.js';
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
import { DocumentTypeRegistry } from '../src/modules/documents/application/document-type-registry.js';
import { NumberingService } from '../src/modules/documents/application/numbering.service.js';
import { DocumentTypeConfigsRepository } from '../src/modules/documents/data/document-type-configs.repository.js';
import { NumberingSeriesRepository } from '../src/modules/documents/data/numbering-series.repository.js';
import { NumberingAllocationsRepository } from '../src/modules/documents/data/numbering-allocations.repository.js';
import { DocumentRelationsRepository } from '../src/modules/documents/data/document-relations.repository.js';
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
import {
  createDocumentStores,
  type DocumentStores,
} from './support/document-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Document Foundation journeys (e2e, Task 8 §6/§11/§13/§20).
 *
 * Boots the real application through the production HTTP pipeline
 * (`createTestApp` → `configureApp`): real controllers, real AuthGuard +
 * AuthorizationGuard, real application services, real permission registry and
 * its startup mirror sync, real DTO validation. Only data access is faked.
 *
 * The registry starts empty (Task 8 registers no business type): the fixture
 * types are registered here through the public registry, exactly like a future
 * owning module would at startup. There is no HTTP "create a document type"
 * and no HTTP "allocate a number" — both are asserted as 404 below.
 */
describe('Document Foundation (e2e)', () => {
  let app: INestApplication;
  let stores: InMemoryStores;
  let master: MasterDataStores;
  let core: InventoryCoreStores;
  let documents: DocumentStores;
  let users: UsersService;
  let roles: RolesService;
  let userRoles: UserRolesService;

  const ROOT = { username: 'root', password: 'root-secret' };
  const LIMITED = { username: 'limited', password: 'limited-secret' };

  let root: ReturnType<typeof request.agent>;
  let limited: ReturnType<typeof request.agent>;

  const state = {
    orgId: '',
    otherOrgId: '',
    seriesId: '',
    relationId: '',
    fulfillRelationId: '',
    firstAllocationId: '',
  };

  beforeAll(async () => {
    stores = createInMemoryStores();
    master = createMasterDataStores();
    core = createInventoryCoreStores();
    documents = createDocumentStores();
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
          .useValue(core.operations)
          .overrideProvider(DocumentTypeConfigsRepository)
          .useValue(documents.typeConfigs)
          .overrideProvider(NumberingSeriesRepository)
          .useValue(documents.numberingSeries)
          .overrideProvider(NumberingAllocationsRepository)
          .useValue(documents.numberingAllocations)
          .overrideProvider(DocumentRelationsRepository)
          .useValue(documents.relations),
    });
    app = rebuilt.app;
    users = app.get(UsersService);
    roles = app.get(RolesService);
    userRoles = app.get(UserRolesService);

    // The owning modules register their types at startup. `inventory_receipt`
    // is now really owned by the Inventory module (C-58), so this suite
    // consumes that registration — re-registering a code is a fail-fast
    // programmer error. Accounting owns no document type yet, so that one
    // still stands in for a future registration.
    expect(
      app.get(DocumentTypeRegistry).get('inventory_receipt'),
    ).toBeDefined();
    app.get(DocumentTypeRegistry).register([
      {
        code: 'accounting_journal',
        module: 'accounting',
        name: 'Journal entry',
        draftCapable: false,
        entryStates: ['final'],
        deletablePhases: [],
      },
    ]);

    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code);
    expect(allCodes).toContain('Document.NumberingSeries.Create');
    expect(allCodes).toContain('Document.Relation.Delete');

    // Bootstrap administrator — system context, no HTTP request in flight.
    const rootUser = await users.createUser({
      username: ROOT.username,
      password: ROOT.password,
    });
    const rootRole = await roles.createRole({
      name: 'Root',
      description: 'Bootstrap administrator (test fixture)',
      permissionCodes: allCodes,
    });
    await userRoles.assignRoleToUser(rootRole.id, rootUser.id);

    // Read-only principal for the per-operation authorization surface.
    const limitedUser = await users.createUser({
      username: LIMITED.username,
      password: LIMITED.password,
    });
    const viewerRole = await roles.createRole({
      name: 'DocumentViewer',
      description: 'Read-only documents (test fixture)',
      permissionCodes: allCodes.filter((code) => code.endsWith('.View')),
    });
    await userRoles.assignRoleToUser(viewerRole.id, limitedUser.id);

    root = request.agent(app.getHttpServer());
    limited = request.agent(app.getHttpServer());
    await root.post('/api/v1/auth/login').send(ROOT).expect(200);
    await limited.post('/api/v1/auth/login').send(LIMITED).expect(200);

    const org = await root
      .post('/api/v1/organizations')
      .send({ code: 'ACME', name: 'Acme Industries' })
      .expect(201);
    state.orgId = org.body.id as string;
    const other = await root
      .post('/api/v1/organizations')
      .send({ code: 'OTHER', name: 'Other Co' })
      .expect(201);
    state.otherOrgId = other.body.id as string;

    // ODR-3 (Task 19): both personas are legitimate members of both
    // organizations (the cross-org assertions are data-scoped).
    master.raw.memberships.seed(rootUser.id, state.orgId);
    master.raw.memberships.seed(rootUser.id, state.otherOrgId);
    master.raw.memberships.seed(limitedUser.id, state.orgId);
    master.raw.memberships.seed(limitedUser.id, state.otherOrgId);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- security surface ----------------------------------------------------

  it('rejects anonymous calls with 401 (not 403)', async () => {
    const anonymous = request(app.getHttpServer());
    for (const path of [
      '/api/v1/documents/types',
      '/api/v1/documents/numbering-series',
      '/api/v1/documents/relations',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await anonymous.get(path).expect(401);
      expect(res.body.code).toBe('Unauthorized');
    }
  });

  it('lets a read-only principal view but not configure/create/delete (403)', async () => {
    await limited
      .get('/api/v1/documents/types')
      .query({ organizationId: state.orgId })
      .expect(200);

    const deniedConfigure = await limited
      .put('/api/v1/documents/types/inventory_receipt/configuration')
      .query({ organizationId: state.orgId })
      .send({ draftRequired: true })
      .expect(403);
    expect(deniedConfigure.body.code).toBe('PermissionDenied');

    const deniedCreate = await limited
      .post('/api/v1/documents/numbering-series')
      .send({
        organizationId: state.orgId,
        documentType: 'inventory_receipt',
        name: 'Receipts',
      })
      .expect(403);
    expect(deniedCreate.body.code).toBe('PermissionDenied');
  });

  it('exposes no generic document endpoints (Task 8 §20)', async () => {
    await root.get('/api/v1/documents').expect(404);
    await root.post('/api/v1/documents').send({}).expect(404);
    // Types are code, not data: there is no way to create one.
    await root
      .post('/api/v1/documents/types')
      .send({ code: 'invented_type', name: 'Invented' })
      .expect(404);
  });

  // ---- document types ------------------------------------------------------

  it('lists only the registered types with their configuration defaults', async () => {
    const res = await root
      .get('/api/v1/documents/types')
      .query({ organizationId: state.orgId })
      .expect(200);
    // Eight types are registered in code: the `accounting_journal`
    // placeholder, the real `accounting_voucher` aggregate (Task 10.4),
    // Material Request's own type (C-50), the three Inventory Business
    // Document types (C-58) and the two Return types (C-59D) — all six
    // Inventory ones registered for numbering only.
    expect(res.body.total).toBe(8);
    expect(res.body.items.map((item: { code: string }) => item.code)).toEqual([
      'accounting_journal',
      'accounting_voucher',
      'inventory_issue',
      'inventory_material_request',
      'inventory_purchase_return',
      'inventory_receipt',
      'inventory_sales_return',
      'inventory_transfer',
    ]);
    const receipt = res.body.items.find(
      (item: { code: string }) => item.code === 'inventory_receipt',
    );
    expect(receipt).toMatchObject({
      module: 'inventory',
      draftCapable: true,
      draftRequired: false,
      configured: false,
      entryStates: ['temporary'],
    });
  });

  it('requires organizationId on every list (no cross-tenant listing)', async () => {
    const res = await root.get('/api/v1/documents/types').expect(400);
    expect(res.body.code).toBe('ValidationFailed');
  });

  it('returns 404 for an unregistered type code', async () => {
    const res = await root
      .get('/api/v1/documents/types/nope')
      .query({ organizationId: state.orgId })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  it('configures draft_required for a draft-capable type (idempotent write)', async () => {
    const configured = await root
      .put('/api/v1/documents/types/inventory_receipt/configuration')
      .query({ organizationId: state.orgId })
      .send({ draftRequired: true })
      .expect(200);
    expect(configured.body).toMatchObject({
      code: 'inventory_receipt',
      draftRequired: true,
      configured: true,
    });

    const fetched = await root
      .get('/api/v1/documents/types/inventory_receipt')
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(fetched.body.draftRequired).toBe(true);
    expect(fetched.body.configured).toBe(true);
  });

  it('rejects draft_required for a type that is not draft-capable (422)', async () => {
    const res = await root
      .put('/api/v1/documents/types/accounting_journal/configuration')
      .query({ organizationId: state.orgId })
      .send({ draftRequired: true })
      .expect(422);
    expect(res.body.code).toBe('BusinessRuleViolation');
  });

  // ---- numbering series ----------------------------------------------------

  it('creates a numbering series for a registered type', async () => {
    const res = await root
      .post('/api/v1/documents/numbering-series')
      .send({
        organizationId: state.orgId,
        documentType: 'inventory_receipt',
        scopeKey: '',
        name: 'Default receipts',
        strategy: 'monotonic',
        width: 5,
        reusePolicy: 'never',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      documentType: 'inventory_receipt',
      scopeKey: '',
      strategy: 'monotonic',
      width: 5,
      reusePolicy: 'never',
      lastValue: '0',
      isActive: true,
    });
    expect(res.body.id).toMatch(/^[0-9A-Z]{26}$/);
    state.seriesId = res.body.id as string;
  });

  it('rejects a duplicate series for the same (org, type, scope) with 409', async () => {
    const res = await root
      .post('/api/v1/documents/numbering-series')
      .send({
        organizationId: state.orgId,
        documentType: 'inventory_receipt',
        name: 'Second receipts',
      })
      .expect(409);
    expect(res.body.code).toBe('Conflict');
  });

  it('rejects numbering an unregistered document type (404)', async () => {
    const res = await root
      .post('/api/v1/documents/numbering-series')
      .send({
        organizationId: state.orgId,
        documentType: 'sales_invoice',
        name: 'Invoices',
      })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  it('never lets the counter be edited through configuration', async () => {
    const res = await root
      .patch(`/api/v1/documents/numbering-series/${state.seriesId}`)
      .query({ organizationId: state.orgId })
      .send({ lastValue: '999999', name: 'Hacked counter' })
      .expect(400);
    expect(res.body.code).toBe('ValidationFailed');
  });

  it('edits series settings and disables the series', async () => {
    const updated = await root
      .patch(`/api/v1/documents/numbering-series/${state.seriesId}`)
      .query({ organizationId: state.orgId })
      .send({ width: 0, name: 'Renamed receipts' })
      .expect(200);
    expect(updated.body).toMatchObject({ width: 0, name: 'Renamed receipts' });

    const disabled = await root
      .patch(`/api/v1/documents/numbering-series/${state.seriesId}`)
      .query({ organizationId: state.orgId })
      .send({ isActive: false })
      .expect(200);
    expect(disabled.body.isActive).toBe(false);

    const activeList = await root
      .get('/api/v1/documents/numbering-series')
      .query({ organizationId: state.orgId, isActive: true })
      .expect(200);
    expect(activeList.body.total).toBe(0);

    // Re-enable for the allocation journey.
    await root
      .patch(`/api/v1/documents/numbering-series/${state.seriesId}`)
      .query({ organizationId: state.orgId })
      .send({ isActive: true })
      .expect(200);
  });

  it('isolates series by organization', async () => {
    const otherList = await root
      .get('/api/v1/documents/numbering-series')
      .query({ organizationId: state.otherOrgId })
      .expect(200);
    expect(otherList.body.total).toBe(0);
  });

  // ---- numbering ledger ----------------------------------------------------

  it('allocates distinct numbers through the internal service (no HTTP allocate)', async () => {
    const numbering = app.get(NumberingService);
    const first = await numbering.allocateNumber({
      organizationId: state.orgId,
      documentType: 'inventory_receipt',
      allocationKey: 'receipt-1',
      referenceModule: 'inventory',
      referenceDocumentType: 'inventory_receipt',
      referenceDocumentId: '01N1NKX0A7AAAAAAA00000000A',
    });
    const second = await numbering.allocateNumber({
      organizationId: state.orgId,
      documentType: 'inventory_receipt',
      allocationKey: 'receipt-2',
    });

    // width was reset to 0, so serials are unpadded and strictly numeric.
    expect(first.number).toBe('1');
    expect(second.number).toBe('2');
    state.firstAllocationId = first.id as string;

    const ledger = await root
      .get(`/api/v1/documents/numbering-series/${state.seriesId}/allocations`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(ledger.body.total).toBe(2);
    expect(
      ledger.body.items.map((item: { number: string }) => item.number),
    ).toEqual(['1', '2']);
  });

  it('replays the stored serial for a retried allocation key', async () => {
    const numbering = app.get(NumberingService);
    const replay = await numbering.allocateNumber({
      organizationId: state.orgId,
      documentType: 'inventory_receipt',
      allocationKey: 'receipt-1',
      referenceModule: 'inventory',
      referenceDocumentType: 'inventory_receipt',
      referenceDocumentId: '01N1NKX0A7AAAAAAA00000000A',
    });
    expect(replay.id).toBe(state.firstAllocationId);
    expect(replay.number).toBe('1');

    const ledger = await root
      .get(`/api/v1/documents/numbering-series/${state.seriesId}/allocations`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(ledger.body.total).toBe(2);
  });

  it('returns 404 for the ledger of an unknown series', async () => {
    const res = await root
      .get(
        `/api/v1/documents/numbering-series/${'01UNKNOWNSERIES000000000AA'}/allocations`,
      )
      .query({ organizationId: state.orgId })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  it('exposes no HTTP allocation endpoint (allocation is module-internal)', async () => {
    await root
      .post(`/api/v1/documents/numbering-series/${state.seriesId}/allocations`)
      .send({ allocationKey: 'nope' })
      .expect(404);
  });

  // ---- document relations --------------------------------------------------

  it('creates a document-level reference relation', async () => {
    const res = await root
      .post('/api/v1/documents/relations')
      .send({
        organizationId: state.orgId,
        source: {
          module: 'sales',
          documentType: 'sales_invoice',
          documentId: '01N1NKX0A7AAAAAAA00000000B',
        },
        target: {
          module: 'inventory',
          documentType: 'inventory_receipt',
          documentId: '01N1NKX0A7AAAAAAA00000000C',
        },
        relationKind: 'reference',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      relationKind: 'reference',
      quantity: null,
      createdByProcess: false,
    });
    expect(res.body.source.lineId).toBe(null);
    expect(res.body.target.lineId).toBe(null);
    state.relationId = res.body.id as string;
  });

  it('rejects an unknown relation kind with 400', async () => {
    const res = await root
      .post('/api/v1/documents/relations')
      .send({
        organizationId: state.orgId,
        source: {
          module: 'sales',
          documentType: 'sales_invoice',
          documentId: '01N1NKX0A7AAAAAAA00000000B',
        },
        target: {
          module: 'inventory',
          documentType: 'inventory_receipt',
          documentId: '01N1NKX0A7AAAAAAA00000000C',
        },
        relationKind: 'parent_of',
      })
      .expect(400);
    expect(res.body.code).toBe('ValidationFailed');
  });

  it('rejects a self-referencing relation (422)', async () => {
    const id = '01N1NKX0A7AAAAAAA00000000D';
    const res = await root
      .post('/api/v1/documents/relations')
      .send({
        organizationId: state.orgId,
        source: {
          module: 'sales',
          documentType: 'sales_invoice',
          documentId: id,
        },
        target: {
          module: 'sales',
          documentType: 'sales_invoice',
          documentId: id,
        },
        relationKind: 'reference',
      })
      .expect(422);
    expect(res.body.code).toBe('BusinessRuleViolation');
  });

  it('requires a quantity for the fulfill kind (422) and stores it at line level', async () => {
    const missing = await root
      .post('/api/v1/documents/relations')
      .send({
        organizationId: state.orgId,
        source: {
          module: 'sales',
          documentType: 'sales_invoice',
          documentId: '01N1NKX0A7AAAAAAA00000000B',
        },
        target: {
          module: 'sales',
          documentType: 'sales_invoice',
          documentId: '01N1NKX0A7AAAAAAA00000000E',
        },
        relationKind: 'fulfill',
      })
      .expect(422);
    expect(missing.body.code).toBe('BusinessRuleViolation');

    const linked = await root
      .post('/api/v1/documents/relations')
      .send({
        organizationId: state.orgId,
        source: {
          module: 'sales',
          documentType: 'sales_invoice',
          documentId: '01N1NKX0A7AAAAAAA00000000B',
          lineId: '01N1NKX0A7AAAAAAA00000000F',
        },
        target: {
          module: 'sales',
          documentType: 'sales_invoice',
          documentId: '01N1NKX0A7AAAAAAA00000000E',
          lineId: '01N1NKX0A7AAAAAAA000000010',
        },
        relationKind: 'fulfill',
        quantity: '12.5',
      })
      .expect(201);
    expect(linked.body.quantity).toBe('12.5');
    expect(linked.body.source.lineId).toBe('01N1NKX0A7AAAAAAA00000000F');
    state.fulfillRelationId = linked.body.id as string;
  });

  it('lists relations filtered by kind and isolated by organization', async () => {
    const fulfills = await root
      .get('/api/v1/documents/relations')
      .query({ organizationId: state.orgId, relationKind: 'fulfill' })
      .expect(200);
    expect(fulfills.body.total).toBe(1);
    expect(fulfills.body.items[0].id).toBe(state.fulfillRelationId);

    const other = await root
      .get('/api/v1/documents/relations')
      .query({ organizationId: state.otherOrgId })
      .expect(200);
    expect(other.body.total).toBe(0);
  });

  it('deletes a relation link, and it is gone (404 afterwards)', async () => {
    const deleted = await root
      .delete(`/api/v1/documents/relations/${state.relationId}`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(deleted.body.id).toBe(state.relationId);

    await root
      .get(`/api/v1/documents/relations/${state.relationId}`)
      .query({ organizationId: state.orgId })
      .expect(404);
    await root
      .delete(`/api/v1/documents/relations/${state.relationId}`)
      .query({ organizationId: state.orgId })
      .expect(404);
  });

  // ---- organization isolation on by-id access (ADR-0016) -------------------

  it("cannot read, edit, or delete another organization's records by direct id", async () => {
    // Seed the OTHER organization with its own series, ledger and relation.
    const otherSeries = await root
      .post('/api/v1/documents/numbering-series')
      .send({
        organizationId: state.otherOrgId,
        documentType: 'inventory_receipt',
        name: 'Other org receipts',
        width: 3,
      })
      .expect(201);
    const foreignSeriesId = otherSeries.body.id as string;

    const numbering = app.get(NumberingService);
    await numbering.allocateNumber({
      organizationId: state.otherOrgId,
      documentType: 'inventory_receipt',
      allocationKey: 'other-org-1',
    });

    const otherRelation = await root
      .post('/api/v1/documents/relations')
      .send({
        organizationId: state.otherOrgId,
        source: {
          module: 'sales',
          documentType: 'sales_invoice',
          documentId: generateId(),
        },
        target: {
          module: 'inventory',
          documentType: 'inventory_receipt',
          documentId: generateId(),
        },
        relationKind: 'reference',
      })
      .expect(201);
    const foreignRelationId = otherRelation.body.id as string;

    // A caller scoped to the FIRST organization must never see or touch the
    // OTHER organization's records by id — every direct access answers 404
    // (never 403), so the API does not confirm the foreign id even exists.
    for (const res of [
      await root
        .get(`/api/v1/documents/numbering-series/${foreignSeriesId}`)
        .query({ organizationId: state.orgId })
        .expect(404),
      await root
        .patch(`/api/v1/documents/numbering-series/${foreignSeriesId}`)
        .query({ organizationId: state.orgId })
        .send({ name: 'Stolen' })
        .expect(404),
      await root
        .get(
          `/api/v1/documents/numbering-series/${foreignSeriesId}/allocations`,
        )
        .query({ organizationId: state.orgId })
        .expect(404),
      await root
        .get(`/api/v1/documents/relations/${foreignRelationId}`)
        .query({ organizationId: state.orgId })
        .expect(404),
      await root
        .delete(`/api/v1/documents/relations/${foreignRelationId}`)
        .query({ organizationId: state.orgId })
        .expect(404),
    ]) {
      expect(res.body.code).toBe('EntityNotFound');
    }

    // The rows are untouched: the OTHER organization still reads its own data.
    await root
      .get(`/api/v1/documents/numbering-series/${foreignSeriesId}`)
      .query({ organizationId: state.otherOrgId })
      .expect(200);
    const stillThere = await root
      .get(`/api/v1/documents/relations/${foreignRelationId}`)
      .query({ organizationId: state.otherOrgId })
      .expect(200);
    expect(stillThere.body.id).toBe(foreignRelationId);
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
