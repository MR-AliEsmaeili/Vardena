import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { InstallationsRepository } from '../src/modules/licensing/data/installations.repository.js';
import { LicensesRepository } from '../src/modules/licensing/data/licenses.repository.js';
import { LICENSING_PERMISSIONS } from '../src/modules/licensing/domain/licensing-permissions.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { UsersRepository } from '../src/modules/users/data/users.repository.js';
import { SessionsRepository } from '../src/modules/identity/data/sessions.repository.js';
import { PermissionsRepository } from '../src/modules/rbac/data/permissions.repository.js';
import { RolesRepository } from '../src/modules/rbac/data/roles.repository.js';
import { UserRolesRepository } from '../src/modules/rbac/data/user-roles.repository.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { OrganizationsRepository } from '../src/modules/organization/data/organizations.repository.js';
import { OrganizationMembershipsRepository } from '../src/modules/organization/data/organization-memberships.repository.js';
import {
  generateAuthorityKeyPair,
  issueLicenseCode,
  issueLicenseDocument,
  issueLicenseFile,
} from '../src/tools/development-license-authority.js';
import { createInMemoryStores } from './support/in-memory-repositories.js';
import { createLicensingStores } from './support/licensing-repositories.js';
import { createMasterDataStores } from './support/master-data-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Signed license document import over the real HTTP pipeline (L-03).
 *
 * The whole application boots through the production pipeline; only the
 * repositories are in memory. The licensing stores OUTLIVE the Nest
 * application, so closing the app and building a new one over the same stores
 * is a faithful restart: same database, new process.
 *
 * Nothing here weakens authentication or RBAC — the suite logs in with real
 * credentials and the importing user holds exactly one granted permission.
 */
describe('License document import (e2e)', () => {
  const authority = generateAuthorityKeyPair();
  const stranger = generateAuthorityKeyPair();

  let licensing: ReturnType<typeof createLicensingStores>;
  let stores: ReturnType<typeof createInMemoryStores>;
  let master: ReturnType<typeof createMasterDataStores>;
  let app: INestApplication;
  let agent: ReturnType<typeof request.agent>;

  const PASSWORD = 'license-operator-password';

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
    instance: INestApplication,
    username: string,
  ): Promise<ReturnType<typeof request.agent>> {
    const session = request.agent(instance.getHttpServer());
    await session
      .post('/api/v1/auth/login')
      .send({ username, password: PASSWORD })
      .expect(200);
    return session;
  }

  beforeEach(async () => {
    licensing = createLicensingStores();
    stores = createInMemoryStores();
    master = createMasterDataStores();
    app = await boot();

    const operator = await app
      .get(UsersService)
      .createUser({ username: 'license-operator', password: PASSWORD });
    const role = await app.get(RolesService).createRole({
      name: 'License operator',
      permissionCodes: [LICENSING_PERMISSIONS.LICENSE_ACTIVATE],
    });
    await app.get(UserRolesService).assignRoleToUser(role.id, operator.id);

    agent = await login(app, 'license-operator');
  });

  afterEach(async () => {
    await app.close();
  });

  const importDocument = (document: string, session = agent): request.Test =>
    session.post('/api/v1/license/import').send({ document });

  async function state(): Promise<Record<string, unknown>> {
    const response = await agent.get('/api/v1/license/current').expect(200);
    return response.body as Record<string, unknown>;
  }

  it('starts unlicensed with no retained versions and no identity leak', async () => {
    const body = await state();

    expect(body).toMatchObject({
      licensed: false,
      status: 'UNLICENSED',
      active: false,
      effectiveVersionId: null,
      scheduledVersion: null,
      versions: [],
      provider: 'persistent',
    });
    expect(body.installationId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('imports a signed file and reports the effective version', async () => {
    const installationId = (await state()).installationId as string;
    const { file, payload } = issueLicenseFile(
      {
        installationId,
        customerName: 'Acme Holding',
        organizationLimit: 2,
        userLimit: 10,
        moduleEntitlements: ['organization', 'users', 'rbac'],
      },
      authority.privateKey,
    );

    const response = await importDocument(file).expect(200);

    expect(response.body).toMatchObject({
      changed: true,
      outcome: 'APPLIED',
      licensed: true,
      status: 'ACTIVE',
      active: true,
      inactiveReason: null,
      installationId,
      organizationLimit: 2,
      userLimit: 10,
    });
    expect(response.body.effectiveVersionId).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{26}$/,
    );
    expect(response.body.versions).toHaveLength(1);
    expect(response.body.versions[0]).toMatchObject({
      licenseId: payload.licenseId,
      effective: true,
      supersededAt: null,
      source: 'file',
    });

    // The API never echoes the document, its signature, its hash or the key.
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(file);
    expect(serialized).not.toContain(payload.operationId);
    expect(response.body).not.toHaveProperty('documentHash');
    expect(response.body).not.toHaveProperty('document');
    expect((await state()).active).toBe(true);
  });

  it('accepts the same artifact as text and retains it identically', async () => {
    const installationId = (await state()).installationId as string;
    const { document } = issueLicenseDocument(
      { installationId, customerName: 'Acme Holding' },
      authority.privateKey,
    );

    const response = await importDocument(document).expect(200);

    expect(response.body).toMatchObject({ outcome: 'APPLIED', active: true });
    expect(licensing.versions[0]).toMatchObject({
      source: 'text',
      documentVersion: 2,
      keyId: expect.stringMatching(/^sha256-/),
    });
  });

  it('retains a future-dated renewal without deactivating the current license', async () => {
    const installationId = (await state()).installationId as string;
    await importDocument(
      issueLicenseFile(
        {
          installationId,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2027-01-01T00:00:00.000Z'),
        },
        authority.privateKey,
      ).file,
    ).expect(200);

    const renewal = issueLicenseFile(
      {
        installationId,
        validFrom: new Date('2027-01-01T00:00:00.000Z'),
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
      },
      authority.privateKey,
    );
    const response = await importDocument(renewal.file).expect(200);

    expect(response.body).toMatchObject({ outcome: 'APPLIED', active: true });
    expect(response.body.versions).toHaveLength(2);
    expect(response.body.scheduledVersion).toMatchObject({
      licenseId: renewal.payload.licenseId,
      validFrom: '2027-01-01T00:00:00.000Z',
      effective: false,
    });
    expect(response.body.scheduledVersion.versionId).not.toBe(
      response.body.effectiveVersionId,
    );
  });

  it('refuses a duplicate operation with a conflict and changes nothing', async () => {
    const installationId = (await state()).installationId as string;
    const { file } = issueLicenseFile({ installationId }, authority.privateKey);
    await importDocument(file).expect(200);

    const response = await importDocument(file).expect(409);

    expect(response.body).toMatchObject({ code: 'Conflict' });
    expect(String(response.body.message)).toMatch(
      /already been imported|already imported/,
    );
    expect(licensing.versions).toHaveLength(1);
    expect((await state()).active).toBe(true);
  });

  it('refuses an overlapping version unless it retires the retained one', async () => {
    const installationId = (await state()).installationId as string;
    const first = issueLicenseFile(
      {
        installationId,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
      },
      authority.privateKey,
    );
    await importDocument(first.file).expect(200);

    const overlap = issueLicenseFile(
      {
        installationId,
        validFrom: new Date('2026-06-01T00:00:00.000Z'),
        validUntil: new Date('2027-06-01T00:00:00.000Z'),
      },
      authority.privateKey,
    );
    const rejected = await importDocument(overlap.file).expect(409);
    expect(String(rejected.body.message)).toMatch(
      /overlaps a retained version/,
    );

    const superseding = issueLicenseFile(
      {
        installationId,
        validFrom: new Date('2026-06-01T00:00:00.000Z'),
        validUntil: new Date('2027-06-01T00:00:00.000Z'),
        supersedesOperationId: first.payload.operationId,
      },
      authority.privateKey,
    );
    const applied = await importDocument(superseding.file).expect(200);

    expect(applied.body).toMatchObject({ outcome: 'APPLIED', active: true });
    expect(licensing.versions).toHaveLength(2);
    expect(licensing.versions[0]?.supersededAt).not.toBeNull();
    expect(applied.body.effectiveVersionId).toBe(
      licensing.versions[1]?.versionId,
    );
  });

  it('rejects a document issued for another installation or signed by a stranger', async () => {
    const installationId = (await state()).installationId as string;

    const foreign = issueLicenseFile(
      { installationId: '01K7OTHERINSTALLATION0000' },
      authority.privateKey,
    );
    const foreignResponse = await importDocument(foreign.file).expect(422);
    expect(String(foreignResponse.body.message)).toMatch(
      /different Vardena installation/,
    );

    const forged = issueLicenseFile({ installationId }, stranger.privateKey);
    const forgedResponse = await importDocument(forged.file).expect(422);
    expect(String(forgedResponse.body.message)).toMatch(
      /signature is not valid/,
    );

    expect(licensing.versions).toHaveLength(0);
  });

  it('rejects malformed input and unknown body fields', async () => {
    await importDocument('not a license').expect(422);
    await importDocument('{"format":"vardena-license"}').expect(422);
    await importDocument('').expect(400);
    await agent
      .post('/api/v1/license/import')
      .send({ document: 'x', userLimit: 999 })
      .expect(400);
    await agent.post('/api/v1/license/import').send({}).expect(400);
  });

  it('requires authentication and the activation permission', async () => {
    const installationId = (await state()).installationId as string;
    const { file } = issueLicenseFile({ installationId }, authority.privateKey);

    const anonymous = await request(app.getHttpServer())
      .post('/api/v1/license/import')
      .send({ document: file })
      .expect(401);
    expect(anonymous.body.code).toBe('Unauthorized');

    // An ordinary user without the permission is refused; a valid license
    // first, because a second active user needs one.
    await importDocument(
      issueLicenseFile({ installationId }, authority.privateKey).file,
    ).expect(200);
    // A second ordinary user needs an active license (the unlicensed
    // bootstrap allowance is one active user), so it is created after the
    // first import above.
    await app
      .get(UsersService)
      .createUser({ username: 'ordinary-user', password: PASSWORD });
    const ordinary = await login(app, 'ordinary-user');

    const denied = await importDocument(file, ordinary).expect(403);
    expect(denied.body.code).toBe('PermissionDenied');
  });

  it('keeps the L-02 activation alias working through the same pipeline', async () => {
    const installationId = (await state()).installationId as string;
    const { code } = issueLicenseCode(
      { installationId, organizationLimit: 4 },
      authority.privateKey,
    );

    const applied = await agent
      .post('/api/v1/license/activate')
      .send({ code })
      .expect(200);

    expect(applied.body).toMatchObject({
      changed: true,
      outcome: 'APPLIED',
      active: true,
      organizationLimit: 4,
    });
    expect(applied.body.versions).toHaveLength(1);

    const unchanged = await agent
      .post('/api/v1/license/activate')
      .send({ code })
      .expect(200);
    expect(unchanged.body).toMatchObject({
      changed: false,
      outcome: 'UNCHANGED',
    });
    expect(licensing.versions).toHaveLength(1);
  });

  it('keeps the governing license effective while a future-dated successor waits (CF-1)', async () => {
    const installationId = (await state()).installationId as string;
    const predecessor = issueLicenseFile(
      {
        installationId,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        organizationLimit: 5,
      },
      authority.privateKey,
    );
    await importDocument(predecessor.file).expect(200);

    // Far-future on purpose: the hand-over is asserted with a pinned clock in
    // the service spec; here it only has to be in the future for any runner.
    const successor = issueLicenseFile(
      {
        installationId,
        validFrom: new Date('2033-01-01T00:00:00.000Z'),
        validUntil: new Date('2034-01-01T00:00:00.000Z'),
        organizationLimit: 9,
        supersedesOperationId: predecessor.payload.operationId,
      },
      authority.privateKey,
    );
    const response = await importDocument(successor.file).expect(200);

    // The AUTHORITATIVE backend evaluation still reports the predecessor: a
    // recorded supersession with a future hand-over does not invalidate it.
    expect(response.body).toMatchObject({
      outcome: 'APPLIED',
      licensed: true,
      active: true,
      organizationLimit: 5,
      inactiveReason: null,
    });
    expect(response.body.versions).toHaveLength(2);

    const predecessorVersion = (
      response.body.versions as Array<Record<string, unknown>>
    ).find((version) => version['licenseId'] === predecessor.payload.licenseId);
    expect(predecessorVersion).toMatchObject({
      effective: true,
      supersededAt: expect.any(String),
      governsUntil: '2033-01-01T00:00:00.000Z',
    });
    expect(predecessorVersion?.['supersededAt']).not.toBe(
      predecessorVersion?.['governsUntil'],
    );
    expect(response.body.scheduledVersion).toMatchObject({
      licenseId: successor.payload.licenseId,
      validFrom: '2033-01-01T00:00:00.000Z',
      effective: false,
    });

    // The same verdict on a plain read, and the retired predecessor does not
    // come back once the successor's own window ends.
    expect(await state()).toMatchObject({ active: true, organizationLimit: 5 });
    expect(licensing.versions).toHaveLength(2);
    expect(licensing.versions[0]?.supersededAt).not.toBeNull();
    expect(licensing.versions[0]?.governsUntil?.toISOString()).toBe(
      '2033-01-01T00:00:00.000Z',
    );
  });

  it('persists across a restart and never re-enters the document', async () => {
    const installationId = (await state()).installationId as string;
    const { file } = issueLicenseFile(
      { installationId, organizationLimit: 6 },
      authority.privateKey,
    );
    await importDocument(file).expect(200);
    await app.close();

    app = await boot();
    agent = await login(app, 'license-operator');
    const after = await state();

    expect(after).toMatchObject({
      licensed: true,
      active: true,
      organizationLimit: 6,
      installationId,
    });
    expect(after.versions).toHaveLength(1);
  });
});
