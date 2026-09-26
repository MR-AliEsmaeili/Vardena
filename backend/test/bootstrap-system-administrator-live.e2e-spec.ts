import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import {
  BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
  SystemAdministratorBootstrapService,
} from '../src/bootstrap/system-administrator-bootstrap.service.js';
import { PermissionRegistry } from '../src/modules/rbac/application/permission-registry.js';
import { SYSTEM_ADMINISTRATOR_ROLE_NAME } from '../src/modules/rbac/application/system-administrator-rbac.service.js';
import { PasswordService } from '../src/modules/users/domain/password.service.js';
import { createTestApp } from './support/test-app.js';

/**
 * Production bootstrap acceptance coverage. CI runs the real post-migration
 * command before this suite; the explicit re-runs below prove that the same
 * operation is idempotent against already-populated PostgreSQL state.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Bootstrap System Administrator (live database)',
  () => {
    const organizationCode = `BOOT-${generateId().slice(-8)}`;
    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let userId = '';
    let roleId = '';
    let organizationId = '';

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);

      const bootstrap = app.get(SystemAdministratorBootstrapService);
      const first = await bootstrap.run();
      const second = await bootstrap.run();
      userId = first.userId;
      roleId = first.roleId;
      expect(second).toMatchObject({
        userId,
        roleId,
        permissionCount: first.permissionCount,
        userCreated: false,
        roleCreated: false,
        userRoleCreated: false,
      });
    }, 60_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        const client = await prisma.getClient<{
          user: { deleteMany: (args: unknown) => Promise<unknown> };
          organization: { deleteMany: (args: unknown) => Promise<unknown> };
          role: { deleteMany: (args: unknown) => Promise<unknown> };
        }>();
        // Test-only cleanup. Runtime has no hidden bootstrap/delete endpoint.
        await client.user.deleteMany({
          where: { username: BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME },
        });
        if (organizationId !== '') {
          await client.organization.deleteMany({
            where: { id: organizationId },
          });
        }
        await client.role.deleteMany({
          where: { name: SYSTEM_ADMINISTRATOR_ROLE_NAME },
        });
      } finally {
        await app.close();
      }
    }, 60_000);

    it('stores exactly one real user, role assignment, and complete registered permission set', async () => {
      const client = await prisma.getClient<{
        user: {
          count: (args: unknown) => Promise<number>;
          findUnique: (args: unknown) => Promise<{
            id: string;
            passwordHash: string;
          } | null>;
        };
        role: { count: (args: unknown) => Promise<number> };
        userRole: { count: (args: unknown) => Promise<number> };
        rolePermission: { count: (args: unknown) => Promise<number> };
      }>();
      const registryCount = app!.get(PermissionRegistry).size;

      await expect(
        client.user.count({
          where: { username: BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME },
        }),
      ).resolves.toBe(1);
      await expect(
        client.role.count({
          where: { name: SYSTEM_ADMINISTRATOR_ROLE_NAME },
        }),
      ).resolves.toBe(1);
      await expect(
        client.userRole.count({ where: { userId, roleId } }),
      ).resolves.toBe(1);
      await expect(
        client.rolePermission.count({ where: { roleId } }),
      ).resolves.toBe(registryCount);

      const stored = await client.user.findUnique({ where: { id: userId } });
      expect(stored).not.toBeNull();
      expect(stored!.passwordHash).not.toBe('1');
      expect(stored!.passwordHash).toMatch(/^\$argon2id\$/);
      await expect(
        new PasswordService().verify(stored!.passwordHash, '1'),
      ).resolves.toBe(true);
    });

    it('authenticates the exact initial credential and rejects a wrong password without leaking it', async () => {
      const accepted = await request(app!.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'مدیر', password: '1' })
        .expect(200);
      expect(accepted.body).toMatchObject({
        id: userId,
        username: BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
        isActive: true,
      });
      expect(accepted.body).not.toHaveProperty('password');
      expect(accepted.body).not.toHaveProperty('passwordHash');

      const rejected = await request(app!.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'مدیر', password: 'wrong' })
        .expect(401);
      expect(rejected.body).toMatchObject({
        code: 'Unauthorized',
        message: 'Invalid username or password.',
      });
      expect(JSON.stringify(rejected.body)).not.toContain('wrong');
    });

    it('uses normal RBAC and organization membership across implemented domains', async () => {
      const admin = request.agent(app!.getHttpServer());
      await admin
        .post('/api/v1/auth/login')
        .send({ username: 'مدیر', password: '1' })
        .expect(200);

      const effective = await admin
        .get('/api/v1/permissions/effective')
        .expect(200);
      expect(effective.body.permissions).toHaveLength(
        app!.get(PermissionRegistry).size,
      );
      const effectiveCodes = effective.body.permissions as string[];
      const registeredCodes = app!
        .get(PermissionRegistry)
        .all()
        .map(({ code }) => code);
      expect([...effectiveCodes].sort()).toEqual([...registeredCodes].sort());

      // Identity/Users and RBAC representatives pass through their guards.
      await admin.get('/api/v1/users').expect(200);
      await admin.get('/api/v1/roles').expect(200);

      const organization = await admin
        .post('/api/v1/organizations')
        .send({ code: organizationCode, name: 'Bootstrap verification' })
        .expect(201);
      organizationId = organization.body.id as string;

      // Full RBAC does not bypass ODR-3: before a real membership exists, an
      // organization-scoped Accounting path is deliberately invisible.
      await admin
        .get('/api/v1/accounting/balances')
        .query({ organizationId })
        .expect(404);

      // The existing first-member bootstrap contract creates an ordinary
      // membership. From here every domain still applies both RBAC and scope.
      await admin
        .post(`/api/v1/organizations/${organizationId}/members`)
        .send({ userId })
        .expect(204);

      for (const path of [
        '/api/v1/inventory/items',
        '/api/v1/documents/types',
        '/api/v1/workflow/definitions',
        '/api/v1/accounting/balances',
      ]) {
        // eslint-disable-next-line no-await-in-loop
        await admin.get(path).query({ organizationId }).expect(200);
      }
    }, 60_000);
  },
);
