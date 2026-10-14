import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { InstallationsRepository } from '../src/modules/licensing/data/installations.repository.js';
import { LicensesRepository } from '../src/modules/licensing/data/licenses.repository.js';
import { LICENSING_PERMISSIONS } from '../src/modules/licensing/domain/licensing-permissions.js';
import { UsersRepository } from '../src/modules/users/data/users.repository.js';
import { SessionsRepository } from '../src/modules/identity/data/sessions.repository.js';
import { PermissionsRepository } from '../src/modules/rbac/data/permissions.repository.js';
import { RolesRepository } from '../src/modules/rbac/data/roles.repository.js';
import { UserRolesRepository } from '../src/modules/rbac/data/user-roles.repository.js';
import { OrganizationsRepository } from '../src/modules/organization/data/organizations.repository.js';
import { OrganizationMembershipsRepository } from '../src/modules/organization/data/organization-memberships.repository.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import {
  generateAuthorityKeyPair,
  issueLicenseCode,
} from '../src/tools/development-license-authority.js';
import { createInMemoryStores } from './support/in-memory-repositories.js';
import { createLicensingStores } from './support/licensing-repositories.js';
import { createMasterDataStores } from './support/master-data-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Persistent installation identity + persistent license activation (L-02).
 *
 * The whole application boots through the production pipeline; only the
 * repositories are in memory. Crucially the licensing stores OUTLIVE the Nest
 * application, so closing the app and building a new one over the same stores
 * is a faithful restart: same database, new process.
 *
 * Nothing here weakens authentication or RBAC — the suite logs in with real
 * credentials, and the activating user holds exactly one granted permission.
 */
describe('Installation identity and license activation (e2e)', () => {
  const authority = generateAuthorityKeyPair();
  const stranger = generateAuthorityKeyPair();

  let licensing: ReturnType<typeof createLicensingStores>;
  let stores: ReturnType<typeof createInMemoryStores>;
  let master: ReturnType<typeof createMasterDataStores>;
  let app: INestApplication;
  let agent: ReturnType<typeof request.agent>;
  let plainAgent: ReturnType<typeof request.agent>;

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
              // Explicit selection: the real persisted authority, with the
              // test authority's PUBLIC key only. No private key ever
              // reaches the application.
              provider: 'persistent',
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

    // The operator: an ordinary user holding exactly ONE permission — the
    // narrow licensing one. No admin role, no wildcard.
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

  /**
   * A second, ordinary user. An unlicensed installation may hold exactly one
   * active user (the bootstrap allowance), so this is only possible once a
   * license is active — which is itself part of the contract under test.
   */
  async function ordinaryUser(): Promise<ReturnType<typeof request.agent>> {
    await app
      .get(UsersService)
      .createUser({ username: 'ordinary-user', password: PASSWORD });
    plainAgent = await login(app, 'ordinary-user');
    return plainAgent;
  }

  afterEach(async () => {
    await app.close();
  });

  const installationId = async (session = agent): Promise<string> => {
    const response = await session.get('/api/v1/license/current').expect(200);
    return response.body.installationId as string;
  };

  const DEFAULT_CUSTOMER = '01K7ACTIVATIONCUSTOMER0000';
  const issue = (
    overrides: Partial<Parameters<typeof issueLicenseCode>[0]> & {
      installationId: string;
    },
    key = authority.privateKey,
  ): string => {
    const customerId =
      overrides.customer?.customerId ??
      overrides.customerId ??
      DEFAULT_CUSTOMER;
    return issueLicenseCode(
      {
        customerId,
        customerCode:
          overrides.customer?.customerCode ??
          overrides.customerCode ??
          `CUST-${customerId.replace(/[^A-Za-z0-9]/g, '').slice(-12)}`,
        ...overrides,
      },
      key,
    ).code;
  };

  const activate = (code: string, session = agent): request.Test =>
    session.post('/api/v1/license/activate').send({ code });

  // -- A, D: the unlicensed baseline and the identity that exists without it

  it('A fresh installation is UNLICENSED but already has a stable identity', async () => {
    const response = await agent.get('/api/v1/license/current').expect(200);

    expect(response.body).toMatchObject({
      licensed: false,
      status: 'UNLICENSED',
      active: false,
      inactiveReason: 'unlicensed',
      licenseId: null,
      customerId: null,
      validFrom: null,
      organizationLimit: null,
      entitlements: [],
      provider: 'persistent',
    });
    expect(response.body.installationId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(licensing.self()?.installationId).toBe(response.body.installationId);
  });

  it('D the installation identity is unchanged after a restart', async () => {
    const before = await installationId();
    await app.close();

    app = await boot();
    const after = await (
      await login(app, 'license-operator')
    )
      .get('/api/v1/license/current')
      .expect(200);

    expect(after.body.installationId).toBe(before);
    expect(after.body.status).toBe('UNLICENSED');
  });

  // -- B, E, N, S, C: activation, binding, idempotency, persistence

  it('B/E activates a valid license issued for this installation', async () => {
    const id = await installationId();
    const response = await activate(
      issue({
        installationId: id,
        customerName: 'Acme Holding',
        organizationLimit: 2,
        userLimit: 10,
        moduleEntitlements: ['organization', 'users', 'rbac'],
      }),
    ).expect(200);

    expect(response.body).toMatchObject({
      changed: true,
      licensed: true,
      status: 'ACTIVE',
      active: true,
      inactiveReason: null,
      installationId: id,
      organizationLimit: 2,
      userLimit: 10,
      provider: 'persistent',
    });
    expect(response.body.entitlements).toEqual(
      expect.arrayContaining([{ kind: 'MODULE', code: 'organization' }]),
    );
    await expect(
      agent.get('/api/v1/license/current').expect(200),
    ).resolves.toMatchObject({ body: { status: 'ACTIVE', active: true } });
  });

  it('persists only the SHA-256 of the code, never the code itself', async () => {
    const id = await installationId();
    const code = issue({ installationId: id, customerName: 'Acme Holding' });

    const response = await activate(code).expect(200);

    // C: the hash is persisted and identifies this exact code.
    const row = licensing.versions.at(-1);
    expect(row?.documentHash).toBe(
      createHash('sha256').update(code, 'utf8').digest('hex'),
    );

    // B: nothing in the persisted row is (or contains) the raw code. The
    // column is gone from the schema, so this is the repository-contract
    // proof that no value carries it either — including any reversible
    // encoding of it.
    expect(Object.keys(row ?? {})).not.toContain('code');
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(code);
    expect(serialized).not.toContain(code.split('.')[1] ?? 'payload');
    expect(serialized).not.toContain(
      Buffer.from(code, 'utf8').toString('base64'),
    );

    // H: and the API never echoes the code or its hash back to the client.
    expect(JSON.stringify(response.body)).not.toContain(code);
    expect(response.body).not.toHaveProperty('code');
    expect(response.body).not.toHaveProperty('codeHash');
    expect(response.body).not.toHaveProperty('documentHash');

    const current = await agent.get('/api/v1/license/current').expect(200);
    expect(JSON.stringify(current.body)).not.toContain(code);
    expect(current.body).not.toHaveProperty('codeHash');
  });

  it('N re-activating the same code is idempotent and writes nothing new', async () => {
    const code = issue({ installationId: await installationId() });
    await activate(code).expect(200);
    const second = await activate(code).expect(200);

    expect(second.body).toMatchObject({ changed: false, active: true });
    expect(licensing.versions).toHaveLength(1);
  });

  it('C/S the persisted license survives a restart without re-entering the code', async () => {
    const id = await installationId();
    await activate(issue({ installationId: id, organizationLimit: 4 })).expect(
      200,
    );
    await app.close();

    app = await boot();
    const after = await (
      await login(app, 'license-operator')
    )
      .get('/api/v1/license/current')
      .expect(200);

    expect(after.body).toMatchObject({
      licensed: true,
      status: 'ACTIVE',
      active: true,
      installationId: id,
      organizationLimit: 4,
    });
  });

  it('refuses a backdated replacement of a valid license and keeps the history', async () => {
    const id = await installationId();
    // One installation, one commercial customer (Owner decision 2026-10-12,
    // Q4): both codes name the same customer, so the refusal under test is the
    // temporal one and not the customer-binding rule.
    const customer = '01K7ACTIVATIONCUSTOMER0000';
    await activate(
      issue({
        installationId: id,
        customerId: customer,
        organizationLimit: 1,
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
      }),
    ).expect(200);
    // The replacement starts LATER than the version it would take over (the
    // legacy transport's only hand-over shape) but before the import instant:
    // retiring the governing version there would rewrite which version
    // governed 2026-01-01 → now, so it is refused and nothing is written.
    const refused = await activate(
      issue({
        installationId: id,
        customerId: customer,
        organizationLimit: 7,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).expect(422);

    // A second code cannot take over from the version that governs now without
    // rewriting which version governed before it was imported (OQ-86): the
    // refusal writes nothing, and the retained history is exactly the one
    // version that is in force. The renewal shapes that remain — a code
    // starting at the end of the version it follows, and the signed transport —
    // are covered on a pinned clock in `license-import.service.spec.ts`.
    expect(refused.body).toMatchObject({ code: 'BusinessRuleViolation' });
    expect(refused.body.details).toMatchObject({
      reason: 'backdated-supersession',
    });
    expect(String(refused.body.message)).toMatch(/already in the past/);
    expect(licensing.versions).toHaveLength(1);
    expect(licensing.versions[0]).toMatchObject({
      supersededAt: null,
      governsUntil: null,
    });
    await agent
      .get('/api/v1/license/current')
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          active: true,
          organizationLimit: 1,
        });
      });
  });

  // -- F, G, H, I, J, K, L, M: every rejection path

  it('F rejects a license issued for another installation', async () => {
    const response = await activate(
      issue({ installationId: '01K7OTHERINSTALLATION0000' }),
    ).expect(422);

    expect(response.body.message).toMatch(/different Vardena installation/);
    expect(licensing.versions).toHaveLength(0);
  });

  it('G rejects a malformed license code', async () => {
    await activate('not-a-license-code').expect(422);
    await activate('VLIC1.abc').expect(422);
    await agent.post('/api/v1/license/activate').send({}).expect(400);
    await agent
      .post('/api/v1/license/activate')
      .send({ code: 'VLIC1.a.b', status: 'ACTIVE', organizationLimit: 99 })
      .expect(400);
    expect(licensing.versions).toHaveLength(0);
  });

  it('H rejects a tampered license code', async () => {
    const id = await installationId();
    const code = issue({ installationId: id, organizationLimit: 1 });
    const [prefix, body, signature] = code.split('.');
    const decoded = JSON.parse(
      Buffer.from(body!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    decoded['organizationLimit'] = 999_999;
    const forged = [
      prefix,
      Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url'),
      signature,
    ].join('.');

    const response = await activate(forged).expect(422);
    expect(response.body.message).toMatch(/signature is not valid/);
    expect(licensing.versions).toHaveLength(0);
  });

  it('H rejects a license signed by an unknown authority', async () => {
    const code = issue(
      { installationId: await installationId() },
      stranger.privateKey,
    );
    await activate(code).expect(422);
    expect(licensing.versions).toHaveLength(0);
  });

  it('I rejects an expired license', async () => {
    const response = await activate(
      issue({
        installationId: await installationId(),
        validFrom: new Date('2020-01-01T00:00:00.000Z'),
        validUntil: new Date('2021-01-01T00:00:00.000Z'),
      }),
    ).expect(422);

    expect(response.body.message).toMatch(/expired/);
    expect(licensing.versions).toHaveLength(0);
  });

  it('K rejects a license that is not valid yet', async () => {
    const response = await activate(
      issue({
        installationId: await installationId(),
        validFrom: new Date(Date.now() + 86_400_000),
      }),
    ).expect(422);

    expect(response.body.message).toMatch(/not valid yet/);
  });

  it('J rejects a suspended license', async () => {
    const response = await activate(
      issue({ installationId: await installationId(), status: 'SUSPENDED' }),
    ).expect(422);

    expect(response.body.message).toMatch(/suspended or revoked/);
    expect(licensing.versions).toHaveLength(0);
  });

  it('M rejects a license naming an unknown module entitlement', async () => {
    // The authority itself refuses to issue it, so the rejection is proved
    // against a hand-signed code that bypasses the issuing helper.
    const id = await installationId();
    const valid = issue({ installationId: id });
    const [prefix, body] = valid.split('.');
    const decoded = JSON.parse(
      Buffer.from(body!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    decoded['modules'] = ['telepathy'];
    const payload = Buffer.from(JSON.stringify(decoded), 'utf8');
    // Signed with the real authority key: authentic, but semantically invalid.
    const { createSign: _unused } = await import('node:crypto');
    const { sign } = await import('node:crypto');
    const { parsePrivateKey } =
      await import('../src/modules/licensing/domain/license-code.js');
    const signature = sign(
      null,
      payload,
      parsePrivateKey(authority.privateKey),
    ).toString('base64url');

    const response = await activate(
      `${prefix}.${payload.toString('base64url')}.${signature}`,
    ).expect(422);
    expect(response.body.message).toMatch(/unknown module entitlement/);
  });

  // -- O: an invalid activation never destroys a valid license

  it('O an invalid activation leaves the existing valid license untouched', async () => {
    const id = await installationId();
    await activate(issue({ installationId: id, organizationLimit: 3 })).expect(
      200,
    );

    await activate('VLIC1.garbage.garbage').expect(422);
    await activate(
      issue({ installationId: '01K7OTHERINSTALLATION0000' }),
    ).expect(422);
    await activate(issue({ installationId: id, status: 'SUSPENDED' })).expect(
      422,
    );

    const current = await agent.get('/api/v1/license/current').expect(200);
    expect(current.body).toMatchObject({
      active: true,
      status: 'ACTIVE',
      organizationLimit: 3,
    });
    expect(licensing.versions).toHaveLength(1);
  });

  // -- P, Q, R: authorization of the activation endpoint

  it('P an unauthenticated activation is 401 and changes nothing', async () => {
    const code = issue({ installationId: await installationId() });
    const response = await request(app.getHttpServer())
      .post('/api/v1/license/activate')
      .send({ code })
      .expect(401);

    expect(response.body.code).toBe('Unauthorized');
    expect(licensing.versions).toHaveLength(0);
  });

  it('Q an ordinary authenticated user cannot activate a license', async () => {
    const id = await installationId();
    await activate(issue({ installationId: id })).expect(200);
    const ordinary = await ordinaryUser();

    const response = await activate(
      issue({ installationId: id, organizationLimit: 5 }),
      ordinary,
    ).expect(403);

    expect(response.body.code).toBe('PermissionDenied');
    // The valid license is still the one the operator activated.
    expect(licensing.versions).toHaveLength(1);
    expect(licensing.versions[0]?.organizationLimit).toBeNull();
  });

  it('an unlicensed installation holds only the bootstrap administrator', async () => {
    await expect(
      app
        .get(UsersService)
        .createUser({ username: 'second-user', password: PASSWORD }),
    ).rejects.toThrow(/active-user limit has been reached/);
  });

  it('R the holder of Licensing.License.Activate can activate', async () => {
    const code = issue({ installationId: await installationId() });
    await activate(code, agent).expect(200);
    expect(licensing.versions).toHaveLength(1);
    expect(licensing.versions[0]?.importedAt).not.toBeNull();
    expect(licensing.versions[0]?.source).toBe('legacy-code');
  });

  // -- T: entitlement and permission stay separate facts

  it('T a module entitlement is not an RBAC permission', async () => {
    const id = await installationId();
    await activate(
      issue({
        installationId: id,
        moduleEntitlements: ['organization', 'users', 'rbac'],
      }),
    ).expect(200);

    // The license entitles the organization module, but neither user holds
    // an organization permission: an entitlement never grants access.
    const ordinary = await ordinaryUser();
    await ordinary.get('/api/v1/organizations').expect(403);
    await agent.get('/api/v1/organizations').expect(403);

    const effective = await agent
      .get('/api/v1/permissions/effective')
      .expect(200);
    // The operator's effective set is exactly its ONE granted permission —
    // the licensed modules add nothing to it.
    expect(effective.body.permissions).toEqual([
      LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
    ]);
  });
});
