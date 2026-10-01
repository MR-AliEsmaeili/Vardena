import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { LicensingService } from '../src/modules/licensing/application/licensing.service.js';
import type { InstallationLicense } from '../src/modules/licensing/domain/license.js';
import { UsersRepository } from '../src/modules/users/data/users.repository.js';
import { SessionsRepository } from '../src/modules/identity/data/sessions.repository.js';
import { PermissionsRepository } from '../src/modules/rbac/data/permissions.repository.js';
import { RolesRepository } from '../src/modules/rbac/data/roles.repository.js';
import { UserRolesRepository } from '../src/modules/rbac/data/user-roles.repository.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { OrganizationsRepository } from '../src/modules/organization/data/organizations.repository.js';
import { OrganizationMembershipsRepository } from '../src/modules/organization/data/organization-memberships.repository.js';
import { createInMemoryStores } from './support/in-memory-repositories.js';
import { createMasterDataStores } from './support/master-data-repositories.js';
import { createTestApp } from './support/test-app.js';

describe('Licensing capability gate (e2e)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof request.agent>;
  let targetRoleId: string;
  const state: InstallationLicense = {
    customerId: 'customer-a',
    installationId: 'installation-a',
    licenseId: 'license-a',
    status: 'ACTIVE',
    validFrom: new Date('2020-01-01T00:00:00Z'),
    validUntil: null,
    organizationLimit: 1,
    userLimit: null,
    provider: 'e2e-provider',
    entitlements: ['organization', 'rbac', 'users'].map((code) => ({
      kind: 'MODULE' as const,
      code,
    })),
  };

  beforeAll(async () => {
    const stores = createInMemoryStores();
    const master = createMasterDataStores();
    const licensing = new LicensingService({ getLicense: async () => state });
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
          .useValue(licensing)
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

    const user = await app
      .get(UsersService)
      .createUser({ username: 'license-admin', password: 'secret' });
    const adminRole = await app.get(RolesService).createRole({
      name: 'License admin',
      permissionCodes: [
        'Organization.Organization.Create',
        'Rbac.RolePermission.Assign',
      ],
    });
    await app.get(UserRolesService).assignRoleToUser(adminRole.id, user.id);
    const target = await app.get(RolesService).createRole({ name: 'Target' });
    targetRoleId = target.id;
    agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ username: 'license-admin', password: 'secret' })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('login → active license validation → licensed organization creation', async () => {
    const current = await agent.get('/api/v1/license/current').expect(200);
    expect(current.body).toMatchObject({
      active: true,
      status: 'ACTIVE',
      organizationLimit: 1,
    });
    await agent
      .post('/api/v1/organizations')
      .send({ code: 'ONE', name: 'First' })
      .expect(201);
  });

  it('enforces the organization limit while preserving ordinary RBAC checks', async () => {
    const response = await agent
      .post('/api/v1/organizations')
      .send({ code: 'TWO', name: 'Second' })
      .expect(422);
    expect(response.body.code).toBe('BusinessRuleViolation');
  });

  it('rejects a registered permission from an unlicensed module', async () => {
    const response = await agent
      .post(`/api/v1/roles/${targetRoleId}/permissions`)
      .send({ code: 'Inventory.Item.View' })
      .expect(422);
    expect(response.body.code).toBe('BusinessRuleViolation');
  });

  it('suspended license remains inspectable but makes stale RBAC grants ineffective', async () => {
    state.status = 'SUSPENDED';
    const current = await agent.get('/api/v1/license/current').expect(200);
    expect(current.body).toMatchObject({ active: false, status: 'SUSPENDED' });
    await agent
      .post('/api/v1/organizations')
      .send({ code: 'THREE', name: 'Third' })
      .expect(403);
  });
});
