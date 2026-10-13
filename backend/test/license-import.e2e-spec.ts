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
  /**
   * One installation belongs to one commercial customer, and a renewal keeps
   * the license identity (Owner decisions 2026-10-12: Q4, Q3). Every document
   * this suite issues is therefore for the SAME customer and the SAME license
   * unless a test explicitly overrides them to exercise the refusal paths.
   */
  const CUSTOMER = '01K7E2ECUSTOMER000000000000';
  const LICENSE = '01K7E2ELICENSE000000000000000';

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

  /**
   * Seed §8.6 usage through the in-memory master-data stores (L-04): the
   * capacity checks count REAL organizations and active users, so a
   * reduction test states its usage by creating exactly that many. Fixture
   * writes only — the conflict flow itself runs over the real HTTP pipeline.
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
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: null,
      });
    }
    for (let i = 0; i < activeUsers; i += 1) {
      await stores.users.create({
        id: `01K7E2EUSER${String(i).padStart(15, '0')}`,
        username: `usage-user-${i}`,
        passwordHash: 'argon2id:unused',
        isActive: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: null,
      });
    }
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

  /**
   * `issueLicenseFile` with the suite's stable commercial identity. Explicit
   * `customerId`/`licenseId` in `options` still win, which is how the negative
   * cases (another customer, another license) are constructed.
   */
  function licenseFile(
    options: Parameters<typeof issueLicenseFile>[0],
    key: Parameters<typeof issueLicenseFile>[1] = authority.privateKey,
  ): ReturnType<typeof issueLicenseFile> {
    return issueLicenseFile(
      { customerId: CUSTOMER, licenseId: LICENSE, ...options },
      key,
    );
  }

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
    const { file, payload } = licenseFile(
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

  it('documents the import response body in the OpenAPI contract, matching the real response', async () => {
    // Contract check (ADR-0014: DTOs are the OpenAPI contract): the 200 body of
    // the import route must be a described schema whose property names are
    // exactly the names a real response carries, so generated clients are not
    // left with `content?: never`.
    const installationId = (await state()).installationId as string;
    const { file } = licenseFile(
      { installationId, customerName: 'Contract customer' },
      authority.privateKey,
    );
    const response = await importDocument(file).expect(200);

    const docs = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const operation = docs.body.paths['/api/v1/license/import'].post;
    expect(
      operation.responses['200'].content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/LicenseImportResultDto' });
    expect(operation.responses['409']).toBeDefined();
    expect(operation.responses['422']).toBeDefined();

    const result = docs.body.components.schemas.LicenseImportResultDto;
    expect(Object.keys(result.properties).sort()).toEqual(
      Object.keys(response.body).sort(),
    );
    const summary = docs.body.components.schemas.LicenseVersionSummaryDto;
    expect(Object.keys(summary.properties).sort()).toEqual(
      Object.keys(response.body.versions[0]).sort(),
    );
    expect(result.properties.outcome.enum).toEqual(['APPLIED', 'UNCHANGED']);
    expect(result.properties.versions.items).toEqual({
      $ref: '#/components/schemas/LicenseVersionSummaryDto',
    });

    const activateOp = docs.body.paths['/api/v1/license/activate'].post;
    expect(
      activateOp.responses['200'].content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/LicenseImportResultDto' });
    const currentOp = docs.body.paths['/api/v1/license/current'].get;
    expect(
      currentOp.responses['200'].content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/LicenseStateDto' });
    const stateSchema = docs.body.components.schemas.LicenseStateDto;
    expect(stateSchema.properties.outcome).toBeUndefined();
    expect(Object.keys(stateSchema.properties).sort()).toEqual(
      Object.keys(response.body)
        .filter((k) => k !== 'changed' && k !== 'outcome')
        .sort(),
    );
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
      licenseFile(
        {
          installationId,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2027-01-01T00:00:00.000Z'),
        },
        authority.privateKey,
      ).file,
    ).expect(200);

    const renewal = licenseFile(
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
    const { file } = licenseFile({ installationId }, authority.privateKey);
    await importDocument(file).expect(200);

    const response = await importDocument(file).expect(409);

    expect(response.body).toMatchObject({ code: 'Conflict' });
    expect(String(response.body.message)).toMatch(
      /already been imported|already imported/,
    );
    expect(licensing.versions).toHaveLength(1);
    expect((await state()).active).toBe(true);
  });

  it('refuses an overlap whose start cannot take precedence (OQ-80 Option B)', async () => {
    const installationId = (await state()).installationId as string;
    const first = licenseFile(
      {
        installationId,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2034-01-01T00:00:00.000Z'),
      },
      authority.privateKey,
    );
    await importDocument(first.file).expect(200);

    // Same start, same window: no later start can decide which version governs
    // the overlap, so the ambiguity is refused rather than guessed — and
    // nothing is written.
    const sameStart = licenseFile(
      {
        installationId,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2034-06-01T00:00:00.000Z'),
      },
      authority.privateKey,
    );
    const rejected = await importDocument(sameStart.file).expect(409);
    expect(String(rejected.body.message)).toMatch(
      /overlaps a retained version/,
    );
    expect(licensing.versions).toHaveLength(1);
  });

  it('hands over to a later-starting version without an explicit supersession (OQ-80 Option B)', async () => {
    const installationId = (await state()).installationId as string;
    const first = licenseFile(
      {
        installationId,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2034-01-01T00:00:00.000Z'),
      },
      authority.privateKey,
    );
    await importDocument(first.file).expect(200);

    // The later start governs in the overlap: the document declares no
    // supersession and is applied as the hand-over, stamped and audited.
    const successor = licenseFile(
      {
        installationId,
        validFrom: new Date('2033-06-01T00:00:00.000Z'),
        validUntil: new Date('2034-06-01T00:00:00.000Z'),
      },
      authority.privateKey,
    );
    const applied = await importDocument(successor.file).expect(200);

    expect(applied.body).toMatchObject({ outcome: 'APPLIED', active: true });
    expect(licensing.versions).toHaveLength(2);
    expect(licensing.versions[0]).toMatchObject({
      versionId: (
        await app.get(LicensesRepository).findVersion(installationId, {
          operationId: first.payload.operationId,
        })
      )?.versionId,
      supersededAt: expect.any(Date),
      // The hand-over instant is the successor's own start, and the government
      // of the predecessor ends exactly there (it still governs until then).
      governsUntil: new Date('2033-06-01T00:00:00.000Z'),
    });
    expect(applied.body.scheduledVersion).toMatchObject({
      licenseId: successor.payload.licenseId,
      validFrom: '2033-06-01T00:00:00.000Z',
      effective: false,
    });
  });

  it('retires a version explicitly when the document names it', async () => {
    const installationId = (await state()).installationId as string;
    const first = licenseFile(
      {
        installationId,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2034-01-01T00:00:00.000Z'),
      },
      authority.privateKey,
    );
    await importDocument(first.file).expect(200);

    // An explicit, signed supersession stays the Operator's own instruction:
    // the hand-over is the successor's own start, so the retained version keeps
    // governing until it comes.
    const superseding = licenseFile(
      {
        installationId,
        validFrom: new Date('2033-06-01T00:00:00.000Z'),
        validUntil: new Date('2034-06-01T00:00:00.000Z'),
        supersedesOperationId: first.payload.operationId,
      },
      authority.privateKey,
    );
    const applied = await importDocument(superseding.file).expect(200);

    expect(applied.body).toMatchObject({ outcome: 'APPLIED', active: true });
    expect(licensing.versions).toHaveLength(2);
    expect(licensing.versions[0]).toMatchObject({
      supersededAt: expect.any(Date),
      governsUntil: new Date('2033-06-01T00:00:00.000Z'),
    });
    expect(applied.body.scheduledVersion).toMatchObject({
      licenseId: superseding.payload.licenseId,
      validFrom: '2033-06-01T00:00:00.000Z',
      effective: false,
    });
    // The explicit hand-over carries no implicit-precedence classifier.
    const supersededEvent = licensing.auditEvents.find(
      (event) => event.eventType === 'license.version.superseded',
    );
    expect(supersededEvent?.reason).toBeNull();
  });

  it('refuses a supersession that would take over before the import instant', async () => {
    const installationId = (await state()).installationId as string;
    // A start in the past is fine for a document that retires nothing (the
    // ordinary "the subscription began in January" case) …
    const governing = licenseFile(
      {
        installationId,
        validFrom: new Date('2020-01-01T00:00:00.000Z'),
        validUntil: new Date('2035-01-01T00:00:00.000Z'),
      },
      authority.privateKey,
    );
    await importDocument(governing.file).expect(200);
    const before = await state();

    // … but a supersession may not retire it from an instant that is already
    // past: that would rewrite which version governed then (fail-closed until
    // the Owner settles the question; OQ-86).
    const backdated = licenseFile(
      {
        installationId,
        validFrom: new Date('2021-01-01T00:00:00.000Z'),
        validUntil: new Date('2035-06-01T00:00:00.000Z'),
        supersedesOperationId: governing.payload.operationId,
      },
      authority.privateKey,
    );
    const refused = await importDocument(backdated.file).expect(422);

    expect(refused.body).toMatchObject({ code: 'BusinessRuleViolation' });
    expect(refused.body.details).toMatchObject({
      reason: 'backdated-supersession',
    });
    expect(String(refused.body.message)).toMatch(/already in the past/);
    expect(licensing.versions).toHaveLength(1);
    expect(licensing.versions[0]).toMatchObject({
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });
    // Nothing changed: the same governing version, the same projection.
    expect(await state()).toEqual(before);
  });

  it('refuses an explicit supersession that reduces capacity or entitlements (PDR-11 §8.6)', async () => {
    const installationId = (await state()).installationId as string;
    // Current usage above every shrunk limit: 5 organizations and 20 active
    // users, so each shrink below really conflicts with current usage.
    await seedUsage(5, 20);
    const governing = licenseFile(
      {
        installationId,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2034-01-01T00:00:00.000Z'),
        organizationLimit: 5,
        userLimit: 20,
        moduleEntitlements: ['accounting', 'documents'],
      },
      authority.privateKey,
    );
    await importDocument(governing.file).expect(200);
    const before = await state();

    // Every one of these names the version it retires — and every one of them
    // takes capacity or a module away. Naming the version is a statement about
    // WHICH version is replaced; it is not the resolution §8.6 requires, so the
    // import is refused and nothing is written.
    const reducing = [
      { organizationLimit: 4, userLimit: 20 },
      { organizationLimit: 5, userLimit: 19 },
      {
        organizationLimit: 5,
        userLimit: 20,
        moduleEntitlements: ['accounting'],
      },
    ];
    for (const shrink of reducing) {
      const successor = licenseFile(
        {
          installationId,
          validFrom: new Date('2033-01-01T00:00:00.000Z'),
          validUntil: new Date('2034-06-01T00:00:00.000Z'),
          supersedesOperationId: governing.payload.operationId,
          ...shrink,
        },
        authority.privateKey,
      );

      const refused = await importDocument(successor.file).expect(409);
      expect(refused.body.details).toMatchObject({
        reason: 'reduction-requires-resolution',
      });
      expect(String(refused.body.message)).toMatch(
        /reduces the modules or capacity/,
      );
    }

    // No version was retained for the refused documents, the governing version
    // was never retired, and the effective state is exactly what it was.
    expect(licensing.versions).toHaveLength(1);
    expect(licensing.versions[0]).toMatchObject({
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });
    expect(await state()).toEqual(before);

    // A successor that keeps the capacity and the modules is still applied: the
    // guard is a reduction check, not a ban on explicit supersession.
    const keeping = licenseFile(
      {
        installationId,
        validFrom: new Date('2033-01-01T00:00:00.000Z'),
        validUntil: new Date('2034-06-01T00:00:00.000Z'),
        organizationLimit: 5,
        userLimit: 20,
        moduleEntitlements: ['accounting', 'documents'],
        supersedesOperationId: governing.payload.operationId,
      },
      authority.privateKey,
    );
    const applied = await importDocument(keeping.file).expect(200);

    expect(applied.body).toMatchObject({ outcome: 'APPLIED' });
    expect(licensing.versions).toHaveLength(2);
    expect(licensing.versions[0]).toMatchObject({
      governsUntil: new Date('2033-01-01T00:00:00.000Z'),
    });
  });

  it('applies an explicit signed supersession that ends a perpetual grant (OD-LIC-01)', async () => {
    const installationId = (await state()).installationId as string;
    // Usage at the successor's own limits: the capacity reduction below
    // conflicts with current usage, the term-only change does not.
    await seedUsage(5, 20);
    // A perpetual version is never handed over by precedence (see the OQ-80
    // Option B case) — only a document that NAMES it may change its term, and
    // that is the Owner's decision of 2026-10-12 (PDR-12).
    const perpetual = licenseFile(
      {
        installationId,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: null,
        organizationLimit: 5,
        userLimit: 20,
      },
      authority.privateKey,
    );
    await importDocument(perpetual.file).expect(200);

    // The same term change with a capacity reduction stays refused — attempted
    // first, while the perpetual version is still eligible to be named.
    const reducing = licenseFile(
      {
        installationId,
        validFrom: new Date('2033-01-01T00:00:00.000Z'),
        validUntil: new Date('2034-01-01T00:00:00.000Z'),
        organizationLimit: 4,
        userLimit: 20,
        supersedesOperationId: perpetual.payload.operationId,
      },
      authority.privateKey,
    );
    const refused = await importDocument(reducing.file).expect(409);
    expect(refused.body.details).toMatchObject({
      reason: 'reduction-requires-resolution',
    });
    expect(licensing.versions).toHaveLength(1);
    expect(licensing.versions[0]).toMatchObject({ supersededAt: null });

    const timeLimited = licenseFile(
      {
        installationId,
        validFrom: new Date('2033-01-01T00:00:00.000Z'),
        validUntil: new Date('2034-01-01T00:00:00.000Z'),
        organizationLimit: 5,
        userLimit: 20,
        supersedesOperationId: perpetual.payload.operationId,
      },
      authority.privateKey,
    );
    const applied = await importDocument(timeLimited.file).expect(200);

    expect(applied.body).toMatchObject({ outcome: 'APPLIED', active: true });
    expect(licensing.versions).toHaveLength(2);
    // The perpetual version governs up to the hand-over and no further: its
    // recorded window ends at the named successor's start.
    expect(licensing.versions[0]).toMatchObject({
      validUntil: null,
      governsUntil: new Date('2033-01-01T00:00:00.000Z'),
      supersededAt: expect.any(Date),
    });
    expect(applied.body.scheduledVersion).toMatchObject({
      validFrom: '2033-01-01T00:00:00.000Z',
      validUntil: '2034-01-01T00:00:00.000Z',
      effective: false,
    });

    // A blocked reduction wrote nothing: the refused document left no version
    // behind, so the two retained rows are the perpetual and its successor.
    expect(
      licensing.versions.some(
        (version) => version.operationId === reducing.payload.operationId,
      ),
    ).toBe(false);
  });

  it('rejects a document issued for another installation or signed by a stranger', async () => {
    const installationId = (await state()).installationId as string;

    const foreign = licenseFile(
      { installationId: '01K7OTHERINSTALLATION0000' },
      authority.privateKey,
    );
    const foreignResponse = await importDocument(foreign.file).expect(422);
    expect(String(foreignResponse.body.message)).toMatch(
      /different Vardena installation/,
    );

    const forged = licenseFile({ installationId }, stranger.privateKey);
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
    const { file } = licenseFile({ installationId }, authority.privateKey);

    const anonymous = await request(app.getHttpServer())
      .post('/api/v1/license/import')
      .send({ document: file })
      .expect(401);
    expect(anonymous.body.code).toBe('Unauthorized');

    // An ordinary user without the permission is refused; a valid license
    // first, because a second active user needs one.
    await importDocument(
      licenseFile({ installationId }, authority.privateKey).file,
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
    // The legacy alias keeps its documented L-02 lifecycle; the identity is
    // the suite's stable customer/license, as for the signed documents.
    const { code } = issueLicenseCode(
      {
        customerId: CUSTOMER,
        licenseId: LICENSE,
        installationId,
        organizationLimit: 4,
      },
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
    const predecessor = licenseFile(
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
    const successor = licenseFile(
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
    ).find((version) => version['validFrom'] === '2026-01-01T00:00:00.000Z');
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
    const { file } = licenseFile(
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
