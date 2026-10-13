import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { LicensingService } from '../src/modules/licensing/application/licensing.service.js';
import { UsersRepository } from '../src/modules/users/data/users.repository.js';
import { SessionsRepository } from '../src/modules/identity/data/sessions.repository.js';
import { PermissionsRepository } from '../src/modules/rbac/data/permissions.repository.js';
import { RolesRepository } from '../src/modules/rbac/data/roles.repository.js';
import { UserRolesRepository } from '../src/modules/rbac/data/user-roles.repository.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { OrganizationsRepository } from '../src/modules/organization/data/organizations.repository.js';
import { OrganizationMembershipsRepository } from '../src/modules/organization/data/organization-memberships.repository.js';
import { createInMemoryStores } from './support/in-memory-repositories.js';
import { createMasterDataStores } from './support/master-data-repositories.js';
import { licensingTestDouble } from './support/licensing.js';
import { createTestApp } from './support/test-app.js';

/**
 * Route-registration regression test for `GET /api/v1/license/current`.
 *
 * The endpoint is declared by `LicenseStateController`, which lives in the
 * Licensing module's `api/` folder and is registered by `LicensingModule`.
 * If that registration is dropped, the route disappears from the Nest router
 * and the fallback answers 404 — these two assertions fail loudly instead.
 *
 * The contract itself is unchanged: `AuthGuard` only (no RBAC permission),
 * so unauthenticated requests get the established 401 envelope and an
 * authenticated session reads the evaluated license state.
 */
describe('License state route registration (e2e)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const stores = createInMemoryStores();
    const master = createMasterDataStores();
    const fail = (): never => {
      throw new Error('Prisma must be overridden.');
    };
    const built = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(PrismaService)
          .useValue({
            getClient: fail,
            onModuleInit: async () => {},
            onModuleDestroy: async () => {},
            enableShutdownHooks: () => {},
          })
          .overrideProvider(LicensingService)
          .useValue(licensingTestDouble({ provider: 'route-test-provider' }))
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
    app = built.app;

    await app
      .get(UsersService)
      .createUser({ username: 'license-reader', password: 'secret' });
    agent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 401 (not 404) for an unauthenticated request', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/license/current')
      .expect(401);
    expect(response.body.code).toBe('Unauthorized');
  });

  it('returns the current license state for an authenticated session', async () => {
    await agent
      .post('/api/v1/auth/login')
      .send({ username: 'license-reader', password: 'secret' })
      .expect(200);

    const response = await agent.get('/api/v1/license/current').expect(200);
    expect(response.body).toMatchObject({
      status: 'ACTIVE',
      active: true,
      inactiveReason: null,
      validFrom: '2020-01-01T00:00:00.000Z',
      validUntil: null,
      organizationLimit: null,
      userLimit: null,
      provider: 'route-test-provider',
    });
    expect(response.body.entitlements).toEqual(
      expect.arrayContaining([{ kind: 'MODULE', code: 'organization' }]),
    );
  });

  it('documents the current-state 200 body as LicenseStateDto', async () => {
    const docs = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(
      docs.body.paths['/api/v1/license/current'].get.responses['200'].content[
        'application/json'
      ].schema,
    ).toEqual({ $ref: '#/components/schemas/LicenseStateDto' });
    const schema = docs.body.components.schemas.LicenseStateDto;
    expect(Object.keys(schema.properties).sort()).toEqual(
      [
        'licensed',
        'status',
        'active',
        'inactiveReason',
        'installationId',
        'customerId',
        'licenseId',
        'validFrom',
        'validUntil',
        'organizationLimit',
        'userLimit',
        'entitlements',
        'provider',
        'effectiveVersionId',
        'scheduledVersion',
        'versions',
      ].sort(),
    );
  });
});
