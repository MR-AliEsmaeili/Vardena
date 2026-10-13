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
import { CodingStructuresRepository } from '../src/modules/accounting/data/coding-structures.repository.js';
import { AccountingConfigurationsRepository } from '../src/modules/accounting/data/accounting-configurations.repository.js';
import { AccountsRepository } from '../src/modules/accounting/data/accounts.repository.js';
import { AccountingDocumentLinesRepository } from '../src/modules/accounting/data/accounting-document-lines.repository.js';
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
import {
  createStructureStores,
  type StructureStores,
} from './support/accounting-structure-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Coding structure + chart of accounts journeys (e2e, Task 10.3).
 *
 * Boots the real application through the production HTTP pipeline
 * (`createTestApp` → `configureApp`): real controllers, real AuthGuard +
 * AuthorizationGuard, real application services, the real permission registry
 * and its startup mirror, real DTO validation. Only data access is faked.
 *
 * The journey: organization → financial area (10.2) → coding structure
 * (draft → publish) → chart of accounts (root → child), then the refusals that
 * matter: an invalid code, a mismatched level, a duplicate code, a cycle, a
 * postable parent, and the cross-organization probes at all three levels
 * (area / coding structure / account).
 */
describe('Accounting chart foundation (e2e)', () => {
  let app: INestApplication;
  let stores: InMemoryStores;
  let master: MasterDataStores;
  let accounting: AccountingStores;
  let structure: StructureStores;
  let users: UsersService;
  let roles: RolesService;
  let userRoles: UserRolesService;

  const ROOT = { username: 'root', password: 'root-secret' };
  const VIEWER = { username: 'viewer', password: 'viewer-secret' };
  const CHARTER = { username: 'charter', password: 'charter-secret' };

  let root: ReturnType<typeof request.agent>;
  let viewer: ReturnType<typeof request.agent>;
  let charter: ReturnType<typeof request.agent>;

  const state = {
    orgA: '',
    orgB: '',
    areaA: '',
    versionA: '',
    rootAccountId: '',
    childAccountId: '',
  };

  beforeAll(async () => {
    stores = createInMemoryStores();
    master = createMasterDataStores();
    accounting = createAccountingStores();
    structure = createStructureStores();
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
          .useValue(accounting.periods)
          .overrideProvider(CodingStructuresRepository)
          .useValue(structure.structures)
          .overrideProvider(AccountingConfigurationsRepository)
          .useValue(structure.configurations)
          .overrideProvider(AccountsRepository)
          .useValue(structure.accounts)
          // AC-I-11 (Task 10.4) makes an account's structural fields
          // immutable once an `accounting_document_lines` row references it.
          // This suite exercises the chart alone, so it wires the SAME state
          // seam the structure fakes expose and answers "never referenced" —
          // the interlock itself is covered by `accounting-documents.e2e-spec`,
          // whose voucher fakes write the lines this seam counts.
          .overrideProvider(AccountingDocumentLinesRepository)
          .useValue({ countForAccount: async () => 0 }),
    });
    app = rebuilt.app;
    users = app.get(UsersService);
    roles = app.get(RolesService);
    userRoles = app.get(UserRolesService);

    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code);

    // Task 10.3's vocabulary must be registered at startup (AR-22): the
    // contract §22 rows for these two entities, and NOTHING else — no
    // `Accounting.Account.Delete`, no wildcard.
    for (const code of [
      'Accounting.CodingStructure.View',
      'Accounting.CodingStructure.Configure',
      'Accounting.Account.View',
      'Accounting.Account.Create',
      'Accounting.Account.Edit',
      'Accounting.Account.Enable',
      'Accounting.Account.Disable',
    ]) {
      if (!allCodes.includes(code)) {
        throw new Error(`Accounting permission not registered: ${code}`);
      }
    }
    if (allCodes.includes('Accounting.Account.Delete')) {
      throw new Error('Accounts must not register a Delete permission (§8.6).');
    }

    const rootUser = await users.createUser({
      username: ROOT.username,
      password: ROOT.password,
    });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Root',
          description: 'Bootstrap administrator (test fixture)',
          permissionCodes: allCodes,
        })
      ).id,
      rootUser.id,
    );
    const viewerUser = await users.createUser({
      username: VIEWER.username,
      password: VIEWER.password,
    });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Viewer',
          description: 'Read-only (test fixture)',
          permissionCodes: allCodes.filter((code) => code.endsWith('.View')),
        })
      ).id,
      viewerUser.id,
    );
    // A principal that may build the chart but must not reconfigure the
    // structure nor flip lifecycle flags.
    const charterUser = await users.createUser({
      username: CHARTER.username,
      password: CHARTER.password,
    });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Chart maintainer',
          description: 'Create + edit accounts only (test fixture)',
          permissionCodes: [
            'Accounting.Account.View',
            'Accounting.Account.Create',
            'Accounting.Account.Edit',
            'Accounting.CodingStructure.View',
          ],
        })
      ).id,
      charterUser.id,
    );

    root = request.agent(app.getHttpServer());
    viewer = request.agent(app.getHttpServer());
    charter = request.agent(app.getHttpServer());
    await root.post('/api/v1/auth/login').send(ROOT).expect(200);
    await viewer.post('/api/v1/auth/login').send(VIEWER).expect(200);
    await charter.post('/api/v1/auth/login').send(CHARTER).expect(200);

    // Journey prefix: two organizations, an area in each, a published
    // 2 + 3 structure in A and a 1 + 4 one in B.
    const orgA = await root
      .post('/api/v1/organizations')
      .send({ code: 'ACMEA', name: 'Acme A' })
      .expect(201);
    state.orgA = orgA.body.id as string;
    const orgB = await root
      .post('/api/v1/organizations')
      .send({ code: 'ACMEB', name: 'Acme B' })
      .expect(201);
    state.orgB = orgB.body.id as string;

    // ODR-3 (Task 19): every persona below is a legitimate member of both
    // organizations (the cross-org assertions are data-scoped).
    master.raw.memberships.seed(rootUser.id, state.orgA);
    master.raw.memberships.seed(rootUser.id, state.orgB);
    master.raw.memberships.seed(viewerUser.id, state.orgA);
    master.raw.memberships.seed(viewerUser.id, state.orgB);
    master.raw.memberships.seed(charterUser.id, state.orgA);
    master.raw.memberships.seed(charterUser.id, state.orgB);

    const area = await root
      .post('/api/v1/financial-areas')
      .send({ organizationId: state.orgA, code: 'GA', title: 'General Area' })
      .expect(201);
    state.areaA = area.body.id as string;

    const version = await root
      .post('/api/v1/coding-structures')
      .send({
        organizationId: state.orgA,
        code: 'DEFAULT',
        maxDepth: 2,
        separator: '-',
        levels: [
          {
            levelIndex: 1,
            title: 'گروه',
            digitLength: 2,
            defaultIsPostable: false,
            levelKind: 'group',
          },
          {
            levelIndex: 2,
            title: 'تفصیلی',
            digitLength: 3,
            defaultIsPostable: true,
            levelKind: 'detail',
          },
        ],
      })
      .expect(201);
    state.versionA = version.body.id as string;
    await root
      .post(`/api/v1/coding-structures/${state.versionA}/publish`)
      .query({ organizationId: state.orgA })
      .expect(200);

    // Task 11 D1: accounts require ACTIVE accounting configuration
    const accConfig = await root
      .post('/api/v1/accounting-configurations')
      .send({
        organizationId: state.orgA,
        code: 'DEFAULT',
        name: 'Default Accounting Config',
        levels: [
          {
            levelIndex: 1,
            title: 'گروه',
            digitLength: 2,
            defaultIsPostable: false,
            levelKind: 'group',
          },
          {
            levelIndex: 2,
            title: 'تفصیلی',
            digitLength: 3,
            defaultIsPostable: true,
            levelKind: 'detail',
          },
        ],
      })
      .expect(201);
    await root
      .post(`/api/v1/accounting-configurations/${accConfig.body.id}/publish`)
      .query({ organizationId: state.orgA })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- security surface ----------------------------------------------------

  it('rejects anonymous calls to the new endpoints with 401 (not 403)', async () => {
    const anonymous = request(app.getHttpServer());
    for (const path of ['/api/v1/coding-structures', '/api/v1/accounts']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await anonymous.get(path).expect(401);
      expect(res.body.code).toBe('Unauthorized');
    }
  });

  it('lets a read-only principal read but not write the chart', async () => {
    await viewer
      .get('/api/v1/coding-structures')
      .query({ organizationId: state.orgA })
      .expect(200);
    await viewer
      .get('/api/v1/accounts')
      .query({ organizationId: state.orgA })
      .expect(200);

    const deniedCreate = await viewer
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '99',
        title: 'Nope',
        accountNature: 'DEBIT',
      })
      .expect(403);
    expect(deniedCreate.body.code).toBe('PermissionDenied');

    const deniedConfigure = await viewer
      .post('/api/v1/coding-structures')
      .send({
        organizationId: state.orgA,
        code: 'NOPE',
        maxDepth: 1,
        levels: [
          {
            levelIndex: 1,
            title: 'A',
            digitLength: 1,
            defaultIsPostable: false,
          },
        ],
      })
      .expect(403);
    expect(deniedConfigure.body.code).toBe('PermissionDenied');

    // `Edit` on an account is a separate code from `Create`, and `Disable` is
    // its own code again (the id is arbitrary: authorization is decided before
    // any lookup happens).
    const charterDenied = await charter
      .post('/api/v1/accounts/01FAB000000000000000000000/disable')
      .query({ organizationId: state.orgA })
      .expect(403);
    expect(charterDenied.body.code).toBe('PermissionDenied');
  });

  it('validates request bodies and the mandatory scope before any work', async () => {
    const unscoped = await root.get('/api/v1/accounts').expect(400);
    expect(unscoped.body.code).toBe('ValidationFailed');

    // A code that is not digits is refused by the SERVICE rule (the DTO only
    // bounds type and width, because normalization happens first).
    const nonDigitCode = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '2-01',
        title: 'Dashed',
        accountNature: 'DEBIT',
      })
      .expect(400);
    expect(nonDigitCode.body.code).toBe('BadRequest');
    expect(nonDigitCode.body.message).toMatch(/digits/);

    const unknownField = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '99',
        title: 'Extra',
        accountNature: 'DEBIT',
        level: 7,
      })
      .expect(400);
    expect(unknownField.body.code).toBe('ValidationFailed');
    expect(unknownField.body.details[0].field).toBe('level');

    const badNature = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '99',
        title: 'Bad nature',
        accountNature: 'asset',
      })
      .expect(400);
    expect(badNature.body.code).toBe('ValidationFailed');

    const badLevel = await root
      .post('/api/v1/coding-structures')
      .send({
        organizationId: state.orgA,
        code: 'BAD',
        maxDepth: 2,
        levels: [
          {
            levelIndex: 1,
            title: 'A',
            digitLength: 0,
            defaultIsPostable: false,
          },
        ],
      })
      .expect(400);
    expect(badLevel.body.code).toBe('ValidationFailed');
  });

  // ---- coding structure journey -------------------------------------------

  it('drafts, configures and publishes a coding structure', async () => {
    const draft = await root
      .post('/api/v1/coding-structures')
      .send({
        organizationId: state.orgA,
        code: 'WIDE',
        maxDepth: 1,
        levels: [
          {
            levelIndex: 1,
            title: 'Single',
            digitLength: 4,
            defaultIsPostable: true,
          },
        ],
      })
      .expect(201);
    expect(draft.body).toMatchObject({
      code: 'WIDE',
      versionNumber: 1,
      status: 'draft',
      maxDepth: 1,
      separator: '',
      pattern: '4',
    });
    expect(draft.body.levels).toHaveLength(1);

    const widened = await root
      .patch(`/api/v1/coding-structures/${draft.body.id}`)
      .query({ organizationId: state.orgA })
      .send({
        maxDepth: 2,
        separator: '/',
        levels: [
          {
            levelIndex: 1,
            title: 'Single',
            digitLength: 4,
            defaultIsPostable: false,
          },
          {
            levelIndex: 2,
            title: 'Sub',
            digitLength: 2,
            defaultIsPostable: true,
          },
        ],
      })
      .expect(200);
    expect(widened.body).toMatchObject({ pattern: '4 + 2', separator: '/' });

    const published = await root
      .post(`/api/v1/coding-structures/${draft.body.id}/publish`)
      .query({ organizationId: state.orgA })
      .expect(200);
    expect(published.body.status).toBe('active');

    // Exactly one active version per organization: the DEFAULT version was
    // superseded by WIDE.
    const active = await root
      .get('/api/v1/coding-structures/active')
      .query({ organizationId: state.orgA })
      .expect(200);
    expect(active.body).toMatchObject({ code: 'WIDE', id: draft.body.id });
    const superseded = await root
      .get(`/api/v1/coding-structures/${state.versionA}`)
      .query({ organizationId: state.orgA })
      .expect(200);
    expect(superseded.body.status).toBe('superseded');

    // A published version is immutable: create a new version instead.
    const refused = await root
      .patch(`/api/v1/coding-structures/${draft.body.id}`)
      .query({ organizationId: state.orgA })
      .send({ maxDepth: 1 })
      .expect(422);
    expect(refused.body.code).toBe('BusinessRuleViolation');

    // An incomplete level set is refused, not silently published.
    const incomplete = await root
      .post('/api/v1/coding-structures')
      .send({
        organizationId: state.orgA,
        code: 'GAPS',
        maxDepth: 3,
        levels: [
          {
            levelIndex: 1,
            title: 'A',
            digitLength: 1,
            defaultIsPostable: false,
          },
          {
            levelIndex: 3,
            title: 'C',
            digitLength: 1,
            defaultIsPostable: false,
          },
        ],
      })
      .expect(400);
    expect(incomplete.body.code).toBe('BadRequest');
  });

  // ---- chart journey -------------------------------------------------------

  it('creates a root and a child account with derived level and pinned version', async () => {
    // Re-activate the 2 + 3 DEFAULT version so the codes below are the ones
    // the assertions describe (publishing WIDE superseded it).
    const newDefault = await root
      .post('/api/v1/coding-structures')
      .send({
        organizationId: state.orgA,
        code: 'DEFAULT',
        maxDepth: 2,
        separator: '-',
        levels: [
          {
            levelIndex: 1,
            title: 'Group',
            digitLength: 2,
            defaultIsPostable: false,
          },
          {
            levelIndex: 2,
            title: 'Detail',
            digitLength: 3,
            defaultIsPostable: true,
          },
        ],
      })
      .expect(201);
    await root
      .post(`/api/v1/coding-structures/${newDefault.body.id}/publish`)
      .query({ organizationId: state.orgA })
      .expect(200);

    const rootAccount = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '  02  ',
        title: '  Current   Assets  ',
        accountNature: 'DEBIT',
      })
      .expect(201);
    state.rootAccountId = rootAccount.body.id as string;
    // Normalization is trim-only: surrounding spaces go, nothing else changes.
    expect(rootAccount.body).toMatchObject({
      code: '02',
      title: 'Current Assets',
      level: 1,
      parentId: null,
      isPostable: false,
      accountNature: 'DEBIT',
      isActive: true,
    });
    expect(rootAccount.body.codingStructureVersionId).toBe(newDefault.body.id);
    expect(rootAccount.body).not.toHaveProperty('createdBy');

    const child = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '02003',
        title: 'Cash',
        accountNature: 'DEBIT',
        parentId: state.rootAccountId,
      })
      .expect(201);
    state.childAccountId = child.body.id as string;
    // Level 2 defaults to postable in this configuration; a leaf may opt out.
    expect(child.body).toMatchObject({ level: 2, isPostable: true });

    const listed = await root
      .get('/api/v1/accounts')
      .query({ organizationId: state.orgA, parentId: state.rootAccountId })
      .expect(200);
    expect(listed.body).toMatchObject({ total: 1 });
    const roots = await root
      .get('/api/v1/accounts')
      .query({ organizationId: state.orgA, level: 1 })
      .expect(200);
    expect(roots.body.total).toBe(1);
  });

  it('refuses the chart violations a UI would only hide', async () => {
    // (1) a code that is structurally wrong for its level.
    const wrongLength = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '0203',
        title: 'Short',
        accountNature: 'DEBIT',
        parentId: state.rootAccountId,
      })
      .expect(422);
    expect(wrongLength.body.code).toBe('BusinessRuleViolation');

    // (2) a child code that does not extend the parent code.
    const wrongPrefix = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '03003',
        title: 'Elsewhere',
        accountNature: 'DEBIT',
        parentId: state.rootAccountId,
      })
      .expect(422);
    expect(wrongPrefix.body.details).toMatchObject({
      rule: 'parent_prefix_mismatch',
    });

    // (3) a duplicate code inside the organization.
    const duplicate = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '02',
        title: 'Duplicate',
        accountNature: 'DEBIT',
      })
      .expect(409);
    expect(duplicate.body.code).toBe('Conflict');

    // (4) a third level, beyond the active structure's depth.
    const tooDeep = await root
      .patch(`/api/v1/accounts/${state.childAccountId}`)
      .query({ organizationId: state.orgA })
      .send({ isPostable: false })
      .expect(200);
    expect(tooDeep.body.isPostable).toBe(false);
    const grandchild = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '02003004',
        title: 'Too deep',
        accountNature: 'DEBIT',
        parentId: state.childAccountId,
      })
      .expect(422);
    expect(grandchild.body.details).toMatchObject({ rule: 'depth_exceeded' });

    // (5) a postable parent may not gain children.
    await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '03',
        title: 'Payable',
        accountNature: 'CREDIT',
        isPostable: true,
      })
      .expect(201);
    const underPostable = await root
      .get('/api/v1/accounts')
      .query({ organizationId: state.orgA, search: 'Payable' })
      .expect(200);
    const postableId = (underPostable.body.items[0] as { id: string }).id;
    const refused = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '03001',
        title: 'Under a postable parent',
        accountNature: 'DEBIT',
        parentId: postableId,
      })
      .expect(422);
    expect(refused.body.details).toMatchObject({ rule: 'parent_postable' });

    // (6) making an account with children postable is refused too.
    const parentTurnedPostable = await root
      .patch(`/api/v1/accounts/${state.rootAccountId}`)
      .query({ organizationId: state.orgA })
      .send({ isPostable: true })
      .expect(422);
    expect(parentTurnedPostable.body.code).toBe('BusinessRuleViolation');

    // (7) a cycle (root under its own child) is refused on the write path.
    const cycle = await root
      .patch(`/api/v1/accounts/${state.rootAccountId}`)
      .query({ organizationId: state.orgA })
      .send({ parentId: state.childAccountId })
      .expect(422);
    expect(cycle.body.details).toMatchObject({ rule: 'cycle' });
  });

  it('renames accounts and toggles lifecycle, but never edits a code', async () => {
    const renamed = await root
      .patch(`/api/v1/accounts/${state.rootAccountId}`)
      .query({ organizationId: state.orgA })
      .send({ title: 'Current Assets (bank)' })
      .expect(200);
    expect(renamed.body).toMatchObject({
      code: '02',
      title: 'Current Assets (bank)',
    });

    const disabled = await root
      .post(`/api/v1/accounts/${state.rootAccountId}/disable`)
      .query({ organizationId: state.orgA })
      .expect(200);
    expect(disabled.body.isActive).toBe(false);

    // A disabled account blocks NEW children (§8.6) …
    const blocked = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '02004',
        title: 'Blocked child',
        accountNature: 'DEBIT',
        parentId: state.rootAccountId,
      })
      .expect(422);
    expect(blocked.body.details).toMatchObject({ rule: 'parent_disabled' });
    // … while the existing subtree stays fully readable.
    await root
      .get(`/api/v1/accounts/${state.childAccountId}`)
      .query({ organizationId: state.orgA })
      .expect(200);

    await root
      .post(`/api/v1/accounts/${state.rootAccountId}/enable`)
      .query({ organizationId: state.orgA })
      .expect(200);

    // There is no DELETE route on either resource.
    await root
      .delete(`/api/v1/accounts/${state.rootAccountId}`)
      .query({ organizationId: state.orgA })
      .expect(404);
    await root
      .delete(`/api/v1/coding-structures/${state.versionA}`)
      .query({ organizationId: state.orgA })
      .expect(404);
  });

  // ---- organization isolation over HTTP -----------------------------------

  it('answers 404 (never 403) for every foreign-organization id', async () => {
    // A second organization with its own area, structure and account.
    const areaB = await root
      .post('/api/v1/financial-areas')
      .send({ organizationId: state.orgB, code: 'GA', title: 'General Area B' })
      .expect(201);
    const versionB = await root
      .post('/api/v1/coding-structures')
      .send({
        organizationId: state.orgB,
        code: 'DEFAULT',
        maxDepth: 2,
        levels: [
          {
            levelIndex: 1,
            title: 'Group',
            digitLength: 1,
            defaultIsPostable: false,
          },
          {
            levelIndex: 2,
            title: 'Detail',
            digitLength: 4,
            defaultIsPostable: true,
          },
        ],
      })
      .expect(201);
    await root
      .post(`/api/v1/coding-structures/${versionB.body.id}/publish`)
      .query({ organizationId: state.orgB })
      .expect(200);
    const accConfigB = await root
      .post('/api/v1/accounting-configurations')
      .send({
        organizationId: state.orgB,
        code: 'DEFAULT',
        name: 'Default Accounting Config B',
        levels: [
          {
            levelIndex: 1,
            title: 'Group',
            digitLength: 1,
            defaultIsPostable: false,
          },
          {
            levelIndex: 2,
            title: 'Detail',
            digitLength: 4,
            defaultIsPostable: true,
          },
        ],
      })
      .expect(201);
    await root
      .post(`/api/v1/accounting-configurations/${accConfigB.body.id}/publish`)
      .query({ organizationId: state.orgB })
      .expect(200);
    const accountB = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgB,
        code: '20001',
        title: 'B: level 2 under a 1-digit root',
        accountNature: 'DEBIT',
      })
      .expect(422);
    // Org B's structure wants a level-1 code FIRST: the same digits that are a
    // valid child in org A are not one in org B. (Proves the shape is
    // per-organization configuration, not a global constant.)
    expect(accountB.body.code).toBe('BusinessRuleViolation');
    const rootB = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgB,
        code: '2',
        title: 'B root',
        accountNature: 'DEBIT',
      })
      .expect(201);
    const childB = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgB,
        code: '20001',
        title: 'B child',
        accountNature: 'DEBIT',
        parentId: rootB.body.id,
      })
      .expect(201);

    // Every probe: the resource EXISTS in the other organization, and the
    // answer is still indistinguishable from "no such resource".
    // [resource, id, owner organization] — each is read with the OTHER
    // organization's scope: the row exists, and the answer must still be 404.
    const foreignPaths: Array<[string, string, string]> = [
      ['financial-areas', state.areaA, state.orgB],
      ['coding-structures', state.versionA as string, state.orgB],
      ['accounts', state.rootAccountId, state.orgB],
      ['accounts', state.childAccountId, state.orgB],
      ['financial-areas', areaB.body.id as string, state.orgA],
      ['coding-structures', versionB.body.id as string, state.orgA],
      ['accounts', rootB.body.id as string, state.orgA],
      ['accounts', childB.body.id as string, state.orgA],
    ];
    for (const [resource, id, wrongScope] of foreignPaths) {
      // eslint-disable-next-line no-await-in-loop
      const response = await root
        .get(`/api/v1/${resource}/${id}`)
        .query({ organizationId: wrongScope })
        .expect(404);
      expect(response.body.code).toBe('EntityNotFound');
    }
    const patched = await root
      .patch(`/api/v1/accounts/${state.rootAccountId}`)
      .query({ organizationId: state.orgB })
      .send({ title: 'Hijacked' })
      .expect(404);
    expect(patched.body.code).toBe('EntityNotFound');
    const areaStill = await root
      .get(`/api/v1/financial-areas/${state.areaA}`)
      .query({ organizationId: state.orgA })
      .expect(200);
    expect(areaStill.body.code).toBe('GA');
    const ownName = await root
      .get(`/api/v1/accounts/${state.rootAccountId}`)
      .query({ organizationId: state.orgA })
      .expect(200);
    expect(ownName.body.title).toBe('Current Assets (bank)');

    // Lists never cross organizations.
    const listB = await root
      .get('/api/v1/accounts')
      .query({ organizationId: state.orgB })
      .expect(200);
    expect(listB.body.total).toBe(2);
    const listA = await root
      .get('/api/v1/accounts')
      .query({ organizationId: state.orgA, level: 1 })
      .expect(200);
    for (const item of listA.body.items as Array<{ organizationId: string }>) {
      expect(item.organizationId).toBe(state.orgA);
    }
    // The active structure is per organization too.
    const activeB = await root
      .get('/api/v1/coding-structures/active')
      .query({ organizationId: state.orgB })
      .expect(200);
    expect(activeB.body.id).toBe(versionB.body.id);
    const noActive = await root
      .get('/api/v1/coding-structures/active')
      .query({ organizationId: '01EMPTY00000000000000000A' })
      .expect(400);
    expect(noActive.body.code).toBe('ValidationFailed');
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
