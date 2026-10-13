/**
 * The two dedicated licensing operations over the real HTTP pipeline (L-04,
 * OQ-87 Option B / PDR-13):
 *
 * - `POST /api/v1/license/gap-recovery` — the ONLY path that may apply a new
 *   license identity after the retained coverage has ended;
 * - `POST /api/v1/license/reduction-resolution` — the ONLY path that may
 *   apply a version whose reduction conflicts with current usage.
 *
 * The whole application boots through the production pipeline; only the
 * repositories are in memory. Nothing weakens authentication or RBAC: the
 * routes carry the dedicated permissions, the ordinary import operator holds
 * exactly ONE permission (so every 403 is the real guard deciding), and the
 * dedicated operators are real users with real roles.
 *
 * TIME is controlled, never slept through: `Date` (only `Date`) is pinned
 * while the lapsed license is imported while active, then moved past its end
 * — which is what makes a lapse reproducible without waiting for one.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { InstallationsRepository } from '../src/modules/licensing/data/installations.repository.js';
import { LicensesRepository } from '../src/modules/licensing/data/licenses.repository.js';
import { LICENSING_PERMISSIONS } from '../src/modules/licensing/domain/licensing-permissions.js';
import { OrganizationMembershipsRepository } from '../src/modules/organization/data/organization-memberships.repository.js';
import { OrganizationsRepository } from '../src/modules/organization/data/organizations.repository.js';
import { PermissionsRepository } from '../src/modules/rbac/data/permissions.repository.js';
import { RolesRepository } from '../src/modules/rbac/data/roles.repository.js';
import { UserRolesRepository } from '../src/modules/rbac/data/user-roles.repository.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { SessionsRepository } from '../src/modules/identity/data/sessions.repository.js';
import { UsersRepository } from '../src/modules/users/data/users.repository.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { createInMemoryStores } from './support/in-memory-repositories.js';
import { createLicensingStores } from './support/licensing-repositories.js';
import { createMasterDataStores } from './support/master-data-repositories.js';
import { createTestApp } from './support/test-app.js';
import {
  generateAuthorityKeyPair,
  issueLicenseFile,
} from '../src/tools/development-license-authority.js';

describe('License gap recovery and reduction resolution (e2e)', () => {
  const authority = generateAuthorityKeyPair();

  let licensing: ReturnType<typeof createLicensingStores>;
  let stores: ReturnType<typeof createInMemoryStores>;
  let master: ReturnType<typeof createMasterDataStores>;
  let app: INestApplication;

  const PASSWORD = 'dedicated-operation-password';
  /**
   * One installation belongs to one commercial customer, and a recovery never
   * transfers: the recovery document names the SAME customer as the lapsed
   * license. The resolution document keeps the license identity.
   */
  const CUSTOMER = '01K7E2ECUSTOMER000000000000';
  const LICENSE = '01K7E2ELICENSE000000000000000';
  /** The NEW identity a recovery brings in. */
  const RECOVERY_LICENSE = '01K7E2ERECOVERY0000000000000';
  /** The import instant: every document is imported while active. */
  const T0 = new Date('2026-06-01T00:00:00.000Z');
  /** The lapsed license's coverage ends here… */
  const LAPSE_END = new Date('2027-01-01T00:00:00.000Z');
  /** …and the clock moves here, with nothing governing any more. */
  const AFTER_LAPSE = new Date('2027-06-01T00:00:00.000Z');
  /** A future-dated supersession instant for the resolution flow. */
  const HANDOVER = new Date('2033-01-01T00:00:00.000Z');
  /** Where the L-05 renewal becomes contiguous with the governing license. */
  const RENEWAL_START = new Date('2034-01-01T00:00:00.000Z');
  const RECOVERY_REASON =
    'Renewal order 2026-1182 arrived after the previous contract had expired.';
  const RESOLUTION_REASON =
    'Customer confirmed the reduction; unused seats were revoked first.';

  async function boot(): Promise<INestApplication> {
    const built = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(APP_CONFIG)
          .useValue({
            ...loadAppConfig(),
            licensing: {
              ...loadAppConfig().licensing,
              provider: 'persistent',
              // The real trust list: the test authority's PUBLIC key only.
              signingPublicKeys: [authority.publicKey],
            },
          })
          .overrideProvider(PrismaService)
          .useValue({
            getClient: () => {
              throw new Error('Prisma must be overridden.');
            },
            onModuleInit: async () => {},
            onModuleDestroy: async () => {},
            enableShutdownHooks: () => {},
          })
          .overrideProvider(InstallationsRepository)
          .useValue(licensing.installations)
          .overrideProvider(LicensesRepository)
          .useValue(licensing.licenses)
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
          .useValue(master.memberships),
    });
    return built.app;
  }

  async function login(
    username: string,
    instance: INestApplication = app,
  ): Promise<ReturnType<typeof request.agent>> {
    const session = request.agent(instance.getHttpServer());
    await session
      .post('/api/v1/auth/login')
      .send({ username, password: PASSWORD })
      .expect(200);
    return session;
  }

  /** A real second operator holding ACTIVATE plus one dedicated permission. */
  async function createOperatorWith(
    username: string,
    permission: string,
  ): Promise<ReturnType<typeof request.agent>> {
    const user = await app
      .get(UsersService)
      .createUser({ username, password: PASSWORD });
    const role = await app.get(RolesService).createRole({
      name: `${username} role`,
      permissionCodes: [LICENSING_PERMISSIONS.LICENSE_ACTIVATE, permission],
    });
    await app.get(UserRolesService).assignRoleToUser(role.id, user.id);
    return login(username);
  }

  /**
   * Seed §8.6 usage through the in-memory master-data stores: the capacity
   * checks count REAL organizations and active users, so a reduction test
   * states its usage by creating exactly that many. Fixture writes only —
   * the operations themselves run over the HTTP pipeline.
   */
  async function seedUsage(
    organizations: number,
    activeUsers: number,
  ): Promise<void> {
    for (let i = 0; i < organizations; i += 1) {
      await master.organizations.create({
        id: `01K7E2EORG${String(i).padStart(16, '0')}`,
        code: `org-${i}`,
        name: `Organization ${i}`,
        isActive: true,
        timeZone: 'Asia/Tehran',
        createdAt: T0,
        updatedAt: T0,
        createdBy: null,
      });
    }
    for (let i = 0; i < activeUsers; i += 1) {
      await stores.users.create({
        id: `01K7E2EUSER${String(i).padStart(15, '0')}`,
        username: `usage-user-${i}`,
        passwordHash: 'argon2id:unused',
        isActive: true,
        createdAt: T0,
        updatedAt: T0,
        createdBy: null,
      });
    }
  }

  /** `issueLicenseFile` with the suite's stable commercial identity. */
  function licenseFile(
    options: Parameters<typeof issueLicenseFile>[0],
    key: Parameters<typeof issueLicenseFile>[1] = authority.privateKey,
  ): ReturnType<typeof issueLicenseFile> {
    return issueLicenseFile(
      { customerId: CUSTOMER, licenseId: LICENSE, ...options },
      key,
    );
  }

  const importDocument =
    (session: ReturnType<typeof request.agent>) =>
    (document: string): request.Test =>
      session.post('/api/v1/license/import').send({ document });

  /** The evaluated current state — also where the installation id comes from. */
  async function state(
    session: ReturnType<typeof request.agent>,
  ): Promise<Record<string, unknown>> {
    const response = await session.get('/api/v1/license/current').expect(200);
    return response.body as Record<string, unknown>;
  }

  beforeEach(async () => {
    licensing = createLicensingStores();
    stores = createInMemoryStores();
    master = createMasterDataStores();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    app = await boot();
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  beforeAll(() => {});
  afterAll(() => {});

  it('refuses the plain import of a post-gap document with a stable 409, and nothing is written', async () => {
    const operator = await app
      .get(UsersService)
      .createUser({ username: 'license-operator', password: PASSWORD });
    const role = await app.get(RolesService).createRole({
      name: 'License operator',
      permissionCodes: [LICENSING_PERMISSIONS.LICENSE_ACTIVATE],
    });
    await app.get(UserRolesService).assignRoleToUser(role.id, operator.id);
    const agent = await login('license-operator');
    const importAs = importDocument(agent);
    const installationId = (await state(agent)).installationId as string;

    // The license is imported while ACTIVE; then coverage lapses.
    const lapsed = licenseFile({
      installationId,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: LAPSE_END,
      organizationLimit: 5,
      userLimit: 20,
    });
    await importAs(lapsed.file).expect(200);
    vi.setSystemTime(AFTER_LAPSE);
    // The clock jump expired the T0 session: a fresh login, AT the lapsed
    // instant, is the operator that continues.
    const lapsedAgent = await login('license-operator');

    // A NEW identity, starting after the lapse: the ordinary import is NOT a
    // permitted post-gap recovery path.
    const recovery = licenseFile({
      installationId,
      licenseId: RECOVERY_LICENSE,
      validFrom: AFTER_LAPSE,
      validUntil: new Date('2029-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
    });
    const refused = await importDocument(lapsedAgent)(recovery.file).expect(
      409,
    );
    expect(refused.body.code).toBe('Conflict');
    expect(String(refused.body.message)).toMatch(
      /dedicated recovery operation/,
    );

    // Nothing was written: the lapsed state is exactly what it was, and no
    // recovery event exists.
    expect(licensing.versions).toHaveLength(1);
    expect(
      licensing.auditEvents.some(
        (event) => event.eventType === 'license.import.recovered',
      ),
    ).toBe(false);
    expect(licensing.auditEvents.at(-1)).toMatchObject({
      eventType: 'license.import.rejected',
      outcome: 'REJECTED',
      reason: 'post-gap-recovery-requires-dedicated-operation',
    });
  });

  it('walks the full recovery flow: route 403, validated reason, applied 200 with the lapse receipt', async () => {
    const operator = await app
      .get(UsersService)
      .createUser({ username: 'license-operator', password: PASSWORD });
    const operatorRole = await app.get(RolesService).createRole({
      name: 'License operator',
      permissionCodes: [LICENSING_PERMISSIONS.LICENSE_ACTIVATE],
    });
    await app
      .get(UserRolesService)
      .assignRoleToUser(operatorRole.id, operator.id);
    const agent = await login('license-operator');
    const importAs = importDocument(agent);
    const installationId = (await state(agent)).installationId as string;

    const lapsed = licenseFile({
      installationId,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: LAPSE_END,
      organizationLimit: 5,
      userLimit: 20,
    });
    await importAs(lapsed.file).expect(200);

    // The second operator is created while coverage is ACTIVE (the bootstrap
    // allowance is spent), and holds the dedicated permission. Their session
    // is created fresh at the lapsed instant below (the clock jump expires
    // any T0 session, so the agent is taken there).
    await createOperatorWith(
      'recovery-operator',
      LICENSING_PERMISSIONS.INSTALLATION_RECOVER_AFTER_GAP,
    );

    vi.setSystemTime(AFTER_LAPSE);
    // Fresh sessions at the lapsed instant (the clock jump expired the T0
    // ones).
    const lateOperator = await login('license-operator');
    const lateRecoveryAgent = await login('recovery-operator');
    const recovery = licenseFile({
      installationId,
      licenseId: RECOVERY_LICENSE,
      validFrom: AFTER_LAPSE,
      validUntil: new Date('2029-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
    });

    // The ROUTE guard refuses the operator who holds only ACTIVATE — before
    // any licensing work happens.
    const denied = await lateOperator
      .post('/api/v1/license/gap-recovery')
      .send({ document: recovery.file, reason: RECOVERY_REASON })
      .expect(403);
    expect(denied.body.code).toBe('PermissionDenied');

    // The reason is validated at the boundary, before anything is written.
    await lateRecoveryAgent
      .post('/api/v1/license/gap-recovery')
      .send({ document: recovery.file, reason: 'ab' })
      .expect(400);
    await lateRecoveryAgent
      .post('/api/v1/license/gap-recovery')
      .send({ document: recovery.file })
      .expect(400);
    const minimumReason = 'abc';
    await lateRecoveryAgent
      .post('/api/v1/license/gap-recovery')
      .send({ document: recovery.file, reason: 'R'.repeat(501) })
      .expect(400);
    expect(licensing.versions).toHaveLength(1);

    // Through the dedicated operation: applied with the exact three-character
    // minimum, and the lapse receipt read from the same transaction as audit.
    const applied = await lateRecoveryAgent
      .post('/api/v1/license/gap-recovery')
      .send({ document: recovery.file, reason: minimumReason })
      .expect(200);
    expect(applied.body).toMatchObject({
      outcome: 'APPLIED',
      changed: true,
      lapsedLicenseId: LICENSE,
      coverageEnd: LAPSE_END.toISOString(),
      active: true,
    });
    expect(licensing.versions).toHaveLength(2);
    const recovered = licensing.auditEvents.find(
      (event) => event.eventType === 'license.import.recovered',
    );
    expect(recovered).toMatchObject({
      outcome: 'APPLIED',
      previousLicenseId: LICENSE,
      licenseId: RECOVERY_LICENSE,
      source: 'file',
    });
    expect(String(recovered?.detail)).toContain(minimumReason);

    // A deterministic retry: the same recovery request again is a stable 409
    // (the applied operation is retained — a replay is refused as a
    // duplicate), and the audit trail keeps exactly one recovery event.
    const retried = await lateRecoveryAgent
      .post('/api/v1/license/gap-recovery')
      .send({ document: recovery.file, reason: minimumReason })
      .expect(409);
    expect(retried.body.details).toMatchObject({
      reason: 'duplicate-operation',
    });
    expect(
      licensing.auditEvents.filter(
        (event) => event.eventType === 'license.import.recovered',
      ),
    ).toHaveLength(1);
  });

  it('walks the full resolution flow: explained 409, route 403, applied 200 with the authorized conflicts', async () => {
    const operator = await app
      .get(UsersService)
      .createUser({ username: 'license-operator', password: PASSWORD });
    const operatorRole = await app.get(RolesService).createRole({
      name: 'License operator',
      permissionCodes: [LICENSING_PERMISSIONS.LICENSE_ACTIVATE],
    });
    await app
      .get(UserRolesService)
      .assignRoleToUser(operatorRole.id, operator.id);
    const agent = await login('license-operator');
    const importAs = importDocument(agent);
    const installationId = (await state(agent)).installationId as string;

    // The module set explicitly includes `users` — the operators below are
    // created under THIS license, and the resolution document must keep the
    // entitlement set unchanged (only the capacity shrinks).
    const governing = licenseFile({
      installationId,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2034-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
      moduleEntitlements: ['accounting', 'documents', 'users'],
    });
    await importAs(governing.file).expect(200);

    // The second operator is created while the license covers active users.
    const resolveAgent = await createOperatorWith(
      'resolve-operator',
      LICENSING_PERMISSIONS.LICENSE_RESOLVE_REDUCTION,
    );

    // Current usage above the successor's shrunk limit: 5 organizations and
    // 21 active users (20 seeded + the operators).
    await seedUsage(5, 19);

    const reducing = licenseFile({
      installationId,
      validFrom: HANDOVER,
      validUntil: new Date('2034-06-01T00:00:00.000Z'),
      organizationLimit: 3,
      userLimit: 20,
      moduleEntitlements: ['accounting', 'documents', 'users'],
      supersedesOperationId: governing.payload.operationId,
    });

    // The ordinary import refuses the reduction and EXPLAINS it: which
    // dimension, which limit, which counted usage.
    const refused = await importAs(reducing.file).expect(409);
    expect(refused.body.details).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        conflicts: [
          { kind: 'organization-capacity', limit: 3, currentUsage: 5 },
        ],
      },
    });
    expect(licensing.versions).toHaveLength(1);

    // The route guard refuses the operator who holds only ACTIVATE.
    const denied = await agent
      .post('/api/v1/license/reduction-resolution')
      .send({ document: reducing.file, reason: RESOLUTION_REASON })
      .expect(403);
    expect(denied.body.code).toBe('PermissionDenied');

    // The reason is validated at the boundary, before anything is written.
    await resolveAgent
      .post('/api/v1/license/reduction-resolution')
      .send({ document: reducing.file, reason: 'ab' })
      .expect(400);
    await resolveAgent
      .post('/api/v1/license/reduction-resolution')
      .send({ document: reducing.file })
      .expect(400);
    const minimumReason = 'abc';
    await resolveAgent
      .post('/api/v1/license/reduction-resolution')
      .send({ document: reducing.file, reason: 'R'.repeat(501) })
      .expect(400);
    expect(licensing.versions).toHaveLength(1);

    // Through the dedicated operation: applied with the exact three-character
    // minimum and conflicts recomputed under the locks in the receipt.
    const applied = await resolveAgent
      .post('/api/v1/license/reduction-resolution')
      .send({ document: reducing.file, reason: minimumReason })
      .expect(200);
    expect(applied.body).toMatchObject({
      outcome: 'APPLIED',
      changed: true,
      resolvedConflicts: [
        { kind: 'organization-capacity', limit: 3, currentUsage: 5 },
      ],
    });
    expect(applied.body.resolvedPredecessorVersionId).toBe(
      licensing.versions[0]?.versionId,
    );
    expect(licensing.versions).toHaveLength(2);
    const resolved = licensing.auditEvents.find(
      (event) => event.eventType === 'license.import.reduction-resolved',
    );
    expect(resolved).toMatchObject({
      outcome: 'APPLIED',
      licenseId: LICENSE,
      source: 'file',
    });
    expect(String(resolved?.detail)).toMatch(
      /resolved reduction of version .+ \[organization-capacity\]/,
    );
    expect(String(resolved?.detail)).toContain(minimumReason);

    // Retrying the same document through the resolution route is a stable
    // 409 — the applied operation is retained, so the replay is refused as a
    // duplicate; retrying is never a resolution.
    const retried = await resolveAgent
      .post('/api/v1/license/reduction-resolution')
      .send({ document: reducing.file, reason: minimumReason })
      .expect(409);
    expect(retried.body.details).toMatchObject({
      reason: 'duplicate-operation',
    });
    expect(
      licensing.auditEvents.filter(
        (event) => event.eventType === 'license.import.reduction-resolved',
      ),
    ).toHaveLength(1);
  });

  it('resolves a reduction on a renewal that retires nothing (L-05): the baseline is audited, never stamped', async () => {
    const operator = await app
      .get(UsersService)
      .createUser({ username: 'license-operator', password: PASSWORD });
    const operatorRole = await app.get(RolesService).createRole({
      name: 'License operator',
      permissionCodes: [LICENSING_PERMISSIONS.LICENSE_ACTIVATE],
    });
    await app
      .get(UserRolesService)
      .assignRoleToUser(operatorRole.id, operator.id);
    const agent = await login('license-operator');
    const importAs = importDocument(agent);
    const installationId = (await state(agent)).installationId as string;

    // The governing license ends at RENEWAL_START; the renewal is contiguous
    // and retires nothing — before L-05 this path had no reduction check.
    const governing = licenseFile({
      installationId,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: RENEWAL_START,
      organizationLimit: 5,
      userLimit: 20,
      moduleEntitlements: ['accounting', 'documents', 'users'],
    });
    await importAs(governing.file).expect(200);

    const resolveAgent = await createOperatorWith(
      'resolve-renewal-operator',
      LICENSING_PERMISSIONS.LICENSE_RESOLVE_REDUCTION,
    );
    await seedUsage(5, 19);

    const renewal = licenseFile({
      installationId,
      validFrom: RENEWAL_START,
      validUntil: new Date('2035-01-01T00:00:00.000Z'),
      organizationLimit: 3,
      userLimit: 20,
      moduleEntitlements: ['accounting', 'documents', 'users'],
    });

    // The ordinary import refuses the renewal and explains it against the
    // continuation baseline — the governing version, named in the payload.
    const refused = await importAs(renewal.file).expect(409);
    expect(refused.body.details).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        predecessorVersionId: licensing.versions[0]?.versionId,
        conflicts: [
          { kind: 'organization-capacity', limit: 3, currentUsage: 5 },
        ],
      },
    });
    expect(licensing.versions).toHaveLength(1);
    expect(licensing.versions[0]).toMatchObject({
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });

    // The route guard refuses the operator who holds only ACTIVATE.
    const denied = await agent
      .post('/api/v1/license/reduction-resolution')
      .send({ document: renewal.file, reason: RESOLUTION_REASON })
      .expect(403);
    expect(denied.body.code).toBe('PermissionDenied');

    // Through the dedicated operation: applied in one transaction, the
    // receipt names the baseline, and the baseline is NOT stamped — a
    // resolution authorizes a reduction, it does not retire the version it
    // is measured against.
    const applied = await resolveAgent
      .post('/api/v1/license/reduction-resolution')
      .send({ document: renewal.file, reason: RESOLUTION_REASON })
      .expect(200);
    expect(applied.body).toMatchObject({
      outcome: 'APPLIED',
      changed: true,
      resolvedConflicts: [
        { kind: 'organization-capacity', limit: 3, currentUsage: 5 },
      ],
    });
    expect(applied.body.resolvedPredecessorVersionId).toBe(
      licensing.versions[0]?.versionId,
    );
    expect(licensing.versions).toHaveLength(2);
    expect(licensing.versions[0]).toMatchObject({
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });
    expect(licensing.versions[1]?.supersedesVersionId).toBeNull();
    const resolved = licensing.auditEvents.find(
      (event) => event.eventType === 'license.import.reduction-resolved',
    );
    expect(String(resolved?.detail)).toContain(
      `resolved reduction of version ${licensing.versions[0]?.versionId} [organization-capacity]`,
    );

    // Retrying the applied renewal is a stable replay refusal.
    const retried = await resolveAgent
      .post('/api/v1/license/reduction-resolution')
      .send({ document: renewal.file, reason: RESOLUTION_REASON })
      .expect(409);
    expect(retried.body.details).toMatchObject({
      reason: 'duplicate-operation',
    });

    // A renewal that does NOT conflict has nothing to resolve.
    const nonConflicting = licenseFile({
      installationId,
      validFrom: new Date('2035-01-01T00:00:00.000Z'),
      validUntil: new Date('2036-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
      moduleEntitlements: ['accounting', 'documents', 'users'],
    });
    const notApplicable = await resolveAgent
      .post('/api/v1/license/reduction-resolution')
      .send({ document: nonConflicting.file, reason: RESOLUTION_REASON })
      .expect(409);
    expect(notApplicable.body.details).toMatchObject({
      reason: 'resolution-not-applicable',
    });
    expect(licensing.versions).toHaveLength(2);
  });

  it('keeps a within-usage reduction on the ordinary import path (no resolution involved)', async () => {
    const operator = await app
      .get(UsersService)
      .createUser({ username: 'license-operator', password: PASSWORD });
    const role = await app.get(RolesService).createRole({
      name: 'License operator',
      permissionCodes: [LICENSING_PERMISSIONS.LICENSE_ACTIVATE],
    });
    await app.get(UserRolesService).assignRoleToUser(role.id, operator.id);
    const agent = await login('license-operator');
    const importAs = importDocument(agent);
    const installationId = (await state(agent)).installationId as string;

    const governing = licenseFile({
      installationId,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2034-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
    });
    await importAs(governing.file).expect(200);

    // Usage WITHIN the new limit: the shrink does not conflict with current
    // usage, so the ordinary import applies it — §8.6 requires a check
    // against the resulting state, not a freeze on shrinks.
    await seedUsage(2, 1);
    const shrunk = licenseFile({
      installationId,
      validFrom: HANDOVER,
      validUntil: new Date('2034-06-01T00:00:00.000Z'),
      organizationLimit: 3,
      userLimit: 20,
      supersedesOperationId: governing.payload.operationId,
    });
    const applied = await importAs(shrunk.file).expect(200);
    expect(applied.body).toMatchObject({ outcome: 'APPLIED' });
    expect(licensing.versions).toHaveLength(2);
    expect(
      licensing.auditEvents.some((event) =>
        event.eventType.startsWith('license.import.reduction'),
      ),
    ).toBe(false);
  });
});
