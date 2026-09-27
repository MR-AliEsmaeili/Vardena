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
import { FinancialAreasRepository } from '../src/modules/accounting/data/financial-areas.repository.js';
import { FiscalYearsRepository } from '../src/modules/accounting/data/fiscal-years.repository.js';
import { AccountingPeriodsRepository } from '../src/modules/accounting/data/accounting-periods.repository.js';
import {
  createInMemoryStores,
  type InMemoryStores,
} from './support/in-memory-repositories.js';
import {
  createMasterDataStores,
  type MasterDataStores,
} from './support/master-data-repositories.js';
import {
  createAccountingStores,
  type AccountingStores,
} from './support/accounting-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Accounting foundation journeys (e2e, Task 10.2).
 *
 * Boots the real application through the production HTTP pipeline
 * (`createTestApp` → `configureApp`): real controllers, real AuthGuard +
 * AuthorizationGuard, real application services, real permission registry
 * and its startup mirror sync, real DTO validation. Only data access is
 * faked.
 *
 * The journey: login → organization → financial area → fiscal year →
 * accounting periods → lifecycle (close / reopen / seal / unseal).
 *
 * Plus the security surface: 401 before 403, per-operation permissions,
 * organization isolation over HTTP, and DTO validation before any work.
 *
 * The first administrator cannot be created over HTTP (creating a user
 * already requires a permission), so it is bootstrapped in the documented
 * *system context* — the same path an initial deployment seed uses.
 * Everything after that is HTTP.
 */
describe('Accounting foundation (e2e)', () => {
  let app: INestApplication;
  let stores: InMemoryStores;
  let master: MasterDataStores;
  let accounting: AccountingStores;
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
    areaId: '',
    yearId: '',
    periodId: '',
  };

  beforeAll(async () => {
    stores = createInMemoryStores();
    master = createMasterDataStores();
    accounting = createAccountingStores();
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
          .overrideProvider(FinancialAreasRepository)
          .useValue(accounting.areas)
          .overrideProvider(FiscalYearsRepository)
          .useValue(accounting.years)
          .overrideProvider(AccountingPeriodsRepository)
          .useValue(accounting.periods),
    });
    app = rebuilt.app;
    users = app.get(UsersService);
    roles = app.get(RolesService);
    userRoles = app.get(UserRolesService);

    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code);

    // The Accounting vocabulary must be registered at startup (AR-22):
    // a missing registration would surface here as ungrantable codes.
    for (const code of [
      'Accounting.FinancialArea.View',
      'Accounting.FinancialArea.Create',
      'Accounting.FinancialArea.Edit',
      'Accounting.FinancialArea.Enable',
      'Accounting.FinancialArea.Disable',
      'Accounting.FiscalYear.View',
      'Accounting.FiscalYear.Create',
      'Accounting.FiscalYear.Edit',
      'Accounting.FiscalYear.Close',
      'Accounting.FiscalYear.Reopen',
      'Accounting.FiscalYear.Seal',
      'Accounting.FiscalYear.Unseal',
      'Accounting.AccountingPeriod.View',
      'Accounting.AccountingPeriod.Open',
      'Accounting.AccountingPeriod.Close',
      'Accounting.AccountingPeriod.Reopen',
      'Accounting.AccountingPeriod.Seal',
    ]) {
      if (!allCodes.includes(code)) {
        throw new Error(`Accounting permission not registered: ${code}`);
      }
    }

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

    // A second principal holding ONLY read permissions, to prove
    // authorization is enforced per operation and not per module.
    const limitedUser = await users.createUser({
      username: LIMITED.username,
      password: LIMITED.password,
    });
    state.limitedId = limitedUser.id;
    const viewerRole = await roles.createRole({
      name: 'Viewer',
      description: 'Read-only (test fixture)',
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
      '/api/v1/financial-areas',
      '/api/v1/fiscal-years',
      '/api/v1/accounting-periods',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await anonymous.get(path).expect(401);
      expect(res.body.code).toBe('Unauthorized');
    }
  });

  it('requires organization scope for reads and still denies writes without permission', async () => {
    const outOfScope = await limited
      .get('/api/v1/financial-areas')
      .query({ organizationId: '01FFFFFFFFFFFFFFFFFFFFFFFF' })
      .expect(404);
    expect(outOfScope.body.code).toBe('EntityNotFound');

    const denied = await limited
      .post('/api/v1/financial-areas')
      .send({
        organizationId: '01FFFFFFFFFFFFFFFFFFFFFFFF',
        code: 'NOPE',
        title: 'Not allowed',
      })
      .expect(403);
    expect(denied.body.code).toBe('PermissionDenied');

    const yearDenied = await limited
      .post('/api/v1/fiscal-years')
      .send({
        organizationId: '01FFFFFFFFFFFFFFFFFFFFFFFF',
        financialAreaId: '01FFFFFFFFFFFFFFFFFFFFFFFF',
        code: 'NOPE',
        title: 'Not allowed',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      })
      .expect(403);
    expect(yearDenied.body.code).toBe('PermissionDenied');
  });

  it('validates request bodies and scope before any work happens', async () => {
    const blank = await root
      .post('/api/v1/financial-areas')
      .send({
        organizationId: '01FFFFFFFFFFFFFFFFFFFFFFFF',
        code: '   ',
        title: '',
      })
      .expect(400);
    expect(blank.body.code).toBe('ValidationFailed');

    const unknownField = await root
      .post('/api/v1/financial-areas')
      .send({
        organizationId: '01FFFFFFFFFFFFFFFFFFFFFFFF',
        code: 'X',
        title: 'X',
        isActive: false,
      })
      .expect(400);
    expect(unknownField.body.code).toBe('ValidationFailed');

    const badDate = await root
      .post('/api/v1/fiscal-years')
      .send({
        organizationId: '01FFFFFFFFFFFFFFFFFFFFFFFF',
        financialAreaId: '01FFFFFFFFFFFFFFFFFFFFFFFF',
        code: 'X',
        title: 'X',
        startDate: '21-03-2025',
        endDate: '2026-03-20',
      })
      .expect(400);
    expect(badDate.body.code).toBe('ValidationFailed');

    // The organization scope is mandatory on lists: never cross-org by
    // accident.
    const unscoped = await root.get('/api/v1/financial-areas').expect(400);
    expect(unscoped.body.code).toBe('ValidationFailed');
  });

  // ---- journey: organization → area → year → periods → lifecycle -----------

  it('creates an organization and a financial area under it', async () => {
    const org = await root
      .post('/api/v1/organizations')
      .send({ code: 'ACME', name: 'Acme Industries' })
      .expect(201);
    state.orgId = org.body.id;

    const other = await root
      .post('/api/v1/organizations')
      .send({ code: 'OTHER', name: 'Other Org' })
      .expect(201);
    state.otherOrgId = other.body.id;
    // ODR-3 (Task 19): organization scope is principal-bound. Both
    // personas are legitimate members of both organizations — the cross-org
    // assertions below are data-scoped (foreign rows invisible), never
    // membership-scoped.
    master.raw.memberships.seed(state.rootId, state.orgId);
    master.raw.memberships.seed(state.rootId, state.otherOrgId);
    master.raw.memberships.seed(state.limitedId, state.orgId);
    master.raw.memberships.seed(state.limitedId, state.otherOrgId);

    const res = await root
      .post('/api/v1/financial-areas')
      .send({
        organizationId: state.orgId,
        code: '  GA  ',
        title: '  General   Area  ',
      })
      .expect(201);
    state.areaId = res.body.id;

    expect(res.body).toMatchObject({
      organizationId: state.orgId,
      code: 'GA',
      title: 'General Area',
      isDefault: false,
      isActive: true,
    });
    // The API never exposes audit actor ids (AR-24).
    expect(res.body).not.toHaveProperty('createdBy');

    const duplicate = await root
      .post('/api/v1/financial-areas')
      .send({
        organizationId: state.orgId,
        code: 'GA',
        title: 'Duplicate',
      })
      .expect(409);
    expect(duplicate.body.code).toBe('Conflict');
  });

  it('reads and renames the area; the other organization sees nothing', async () => {
    const found = await root
      .get(`/api/v1/financial-areas/${state.areaId}`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(found.body.code).toBe('GA');

    // Cross-organization id: 404, never 403 (no existence leak).
    const foreign = await root
      .get(`/api/v1/financial-areas/${state.areaId}`)
      .query({ organizationId: state.otherOrgId })
      .expect(404);
    expect(foreign.body.code).toBe('EntityNotFound');

    const renamed = await root
      .patch(`/api/v1/financial-areas/${state.areaId}`)
      .query({ organizationId: state.orgId })
      .send({ title: 'General Area (renamed)', isDefault: true })
      .expect(200);
    expect(renamed.body.title).toBe('General Area (renamed)');
    expect(renamed.body.isDefault).toBe(true);

    const listing = await root
      .get('/api/v1/financial-areas')
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(listing.body.total).toBe(1);

    const foreignListing = await root
      .get('/api/v1/financial-areas')
      .query({ organizationId: state.otherOrgId })
      .expect(200);
    expect(foreignListing.body.total).toBe(0);
  });

  it('creates a fiscal year; overlaps are refused with 422', async () => {
    const res = await root
      .post('/api/v1/fiscal-years')
      .send({
        organizationId: state.orgId,
        financialAreaId: state.areaId,
        code: 'Y1404',
        title: 'Year 1404',
        startDate: '2025-03-21',
        endDate: '2026-03-20',
      })
      .expect(201);
    state.yearId = res.body.id;
    expect(res.body).toMatchObject({ status: 'open', isActive: true });
    expect(res.body).not.toHaveProperty('createdBy');

    const overlap = await root
      .post('/api/v1/fiscal-years')
      .send({
        organizationId: state.orgId,
        financialAreaId: state.areaId,
        code: 'Y-X',
        title: 'Overlap',
        startDate: '2026-03-20',
        endDate: '2027-03-20',
      })
      .expect(422);
    expect(overlap.body.code).toBe('BusinessRuleViolation');

    // Touching without sharing a day is accepted.
    const next = await root
      .post('/api/v1/fiscal-years')
      .send({
        organizationId: state.orgId,
        financialAreaId: state.areaId,
        code: 'Y1405',
        title: 'Year 1405',
        startDate: '2026-03-21',
        endDate: '2027-03-20',
        priorYearId: state.yearId,
      })
      .expect(201);
    expect(next.body.priorYearId).toBe(state.yearId);

    const inverted = await root
      .post('/api/v1/fiscal-years')
      .send({
        organizationId: state.orgId,
        financialAreaId: state.areaId,
        code: 'Y-BAD',
        title: 'Inverted',
        startDate: '2027-03-20',
        endDate: '2027-03-19',
      })
      .expect(422);
    expect(inverted.body.code).toBe('BusinessRuleViolation');
  });

  it('opens periods; containment and overlap are enforced', async () => {
    const res = await root
      .post('/api/v1/accounting-periods')
      .send({
        organizationId: state.orgId,
        fiscalYearId: state.yearId,
        sequence: 1,
        title: 'Farvardin',
        startDate: '2025-03-21',
        endDate: '2025-04-20',
      })
      .expect(201);
    state.periodId = res.body.id;
    expect(res.body).toMatchObject({ sequence: 1, status: 'open' });
    expect(res.body).not.toHaveProperty('createdBy');

    const clash = await root
      .post('/api/v1/accounting-periods')
      .send({
        organizationId: state.orgId,
        fiscalYearId: state.yearId,
        sequence: 1,
        title: 'Same sequence',
        startDate: '2025-04-21',
        endDate: '2025-05-21',
      })
      .expect(409);
    expect(clash.body.code).toBe('Conflict');

    const overlap = await root
      .post('/api/v1/accounting-periods')
      .send({
        organizationId: state.orgId,
        fiscalYearId: state.yearId,
        sequence: 2,
        title: 'Overlap',
        startDate: '2025-04-20',
        endDate: '2025-05-21',
      })
      .expect(422);
    expect(overlap.body.code).toBe('BusinessRuleViolation');

    const spill = await root
      .post('/api/v1/accounting-periods')
      .send({
        organizationId: state.orgId,
        fiscalYearId: state.yearId,
        sequence: 2,
        title: 'Spill',
        startDate: '2025-04-21',
        endDate: '2026-03-21',
      })
      .expect(422);
    expect(spill.body.code).toBe('BusinessRuleViolation');

    const listing = await root
      .get('/api/v1/accounting-periods')
      .query({ organizationId: state.orgId, fiscalYearId: state.yearId })
      .expect(200);
    expect(listing.body.total).toBe(1);
  });

  it('closes the period, then the year; sealing and reopening follow', async () => {
    const closed = await root
      .post(`/api/v1/accounting-periods/${state.periodId}/close`)
      .query({ organizationId: state.orgId })
      .send({ reason: 'Month-end close.' })
      .expect(200);
    expect(closed.body.status).toBe('closed');

    // Transitions without a reason are refused before evaluation.
    const reasonless = await root
      .post(`/api/v1/accounting-periods/${state.periodId}/reopen`)
      .query({ organizationId: state.orgId })
      .send({ reason: '  ' })
      .expect(400);
    expect(reasonless.body.code).toBe('BadRequest');

    const yearClosed = await root
      .post(`/api/v1/fiscal-years/${state.yearId}/close`)
      .query({ organizationId: state.orgId })
      .send({ reason: 'Year-end close.' })
      .expect(200);
    expect(yearClosed.body.status).toBe('closed');

    const yearSealed = await root
      .post(`/api/v1/fiscal-years/${state.yearId}/seal`)
      .query({ organizationId: state.orgId })
      .send({ reason: 'Audit sign-off.' })
      .expect(200);
    expect(yearSealed.body.status).toBe('sealed');

    // A sealed year gates period changes (reopen refused), …
    const gated = await root
      .post(`/api/v1/accounting-periods/${state.periodId}/reopen`)
      .query({ organizationId: state.orgId })
      .send({ reason: 'Too late.' })
      .expect(422);
    expect(gated.body.code).toBe('BusinessRuleViolation');

    // … but the period itself may still seal.
    const periodSealed = await root
      .post(`/api/v1/accounting-periods/${state.periodId}/seal`)
      .query({ organizationId: state.orgId })
      .send({ reason: 'Audit sign-off.' })
      .expect(200);
    expect(periodSealed.body.status).toBe('sealed');

    const yearUnsealed = await root
      .post(`/api/v1/fiscal-years/${state.yearId}/unseal`)
      .query({ organizationId: state.orgId })
      .send({ reason: 'Correction round.' })
      .expect(200);
    expect(yearUnsealed.body.status).toBe('closed');

    const yearReopened = await root
      .post(`/api/v1/fiscal-years/${state.yearId}/reopen`)
      .query({ organizationId: state.orgId })
      .send({ reason: 'Correction round.' })
      .expect(200);
    expect(yearReopened.body.status).toBe('open');

    const periodReopened = await root
      .post(`/api/v1/accounting-periods/${state.periodId}/reopen`)
      .query({ organizationId: state.orgId })
      .send({ reason: 'Correction round.' })
      .expect(200);
    expect(periodReopened.body.status).toBe('open');
  });

  it('refuses to disable the area while a year is open', async () => {
    // Y1405 is still open, so the disable must fail and change nothing.
    const blocked = await root
      .post(`/api/v1/financial-areas/${state.areaId}/disable`)
      .query({ organizationId: state.orgId })
      .expect(422);
    expect(blocked.body.code).toBe('BusinessRuleViolation');

    const years = await root
      .get('/api/v1/fiscal-years')
      .query({ organizationId: state.orgId, status: 'open' })
      .expect(200);
    for (const year of years.body.items as Array<{ id: string }>) {
      // eslint-disable-next-line no-await-in-loop
      await root
        .post(`/api/v1/fiscal-years/${year.id}/close`)
        .query({ organizationId: state.orgId })
        .send({ reason: 'Year-end close.' })
        .expect(200);
    }

    const disabled = await root
      .post(`/api/v1/financial-areas/${state.areaId}/disable`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(disabled.body.isActive).toBe(false);

    const enabled = await root
      .post(`/api/v1/financial-areas/${state.areaId}/enable`)
      .query({ organizationId: state.orgId })
      .expect(200);
    expect(enabled.body.isActive).toBe(true);
  });
});

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
