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
const INITIAL_BOOTSTRAP_PASSWORD = 'vardena_ci_bootstrap_password';
const ROTATED_ADMIN_PASSWORD = 'vardena_rotated_admin_password';

describe.skipIf(DATABASE_URL === undefined)(
  'Bootstrap System Administrator (live database)',
  () => {
    const organizationCode = `BOOT-${generateId().slice(-8)}`;
    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let userId = '';
    let roleId = '';
    let organizationId = '';
    let impostorUserId = '';

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder.overrideProvider(APP_CONFIG).useValue({
            ...loadAppConfig(),
            databaseUrl: DATABASE_URL,
            bootstrapSystemAdminPassword: INITIAL_BOOTSTRAP_PASSWORD,
          }),
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
        if (impostorUserId !== '') {
          await client.user.deleteMany({ where: { id: impostorUserId } });
        }
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
            mustChangePassword: boolean;
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
      expect(stored!.mustChangePassword).toBe(true);
      expect(stored!.passwordHash).not.toBe(INITIAL_BOOTSTRAP_PASSWORD);
      expect(stored!.passwordHash).not.toBe('1');
      expect(stored!.passwordHash).toMatch(/^\$argon2id\$/);
      await expect(
        new PasswordService().verify(
          stored!.passwordHash,
          INITIAL_BOOTSTRAP_PASSWORD,
        ),
      ).resolves.toBe(true);
      await expect(
        new PasswordService().verify(stored!.passwordHash, '1'),
      ).resolves.toBe(false);
    });

    it('authenticates the configured initial credential with mustChangePassword=true, blocks ordinary APIs until change-password, and rejects wrong passwords', async () => {
      await request(app!.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'مدیر', password: '1' })
        .expect(401);

      const rejected = await request(app!.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'مدیر', password: 'wrong' })
        .expect(401);
      expect(rejected.body).toMatchObject({
        code: 'Unauthorized',
        message: 'Invalid username or password.',
      });
      expect(JSON.stringify(rejected.body)).not.toContain('wrong');

      const admin = request.agent(app!.getHttpServer());
      const accepted = await admin
        .post('/api/v1/auth/login')
        .send({ username: 'مدیر', password: INITIAL_BOOTSTRAP_PASSWORD })
        .expect(200);
      expect(accepted.body).toMatchObject({
        id: userId,
        username: BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
        isActive: true,
        mustChangePassword: true,
      });
      expect(accepted.body).not.toHaveProperty('password');
      expect(accepted.body).not.toHaveProperty('passwordHash');

      const meBefore = await admin.get('/api/v1/auth/me').expect(200);
      expect(meBefore.body).toMatchObject({
        id: userId,
        mustChangePassword: true,
      });

      // Ordinary protected APIs are blocked while mustChangePassword is true.
      const blockedUsers = await admin.get('/api/v1/users').expect(403);
      expect(blockedUsers.body).toMatchObject({
        code: 'PermissionDenied',
        details: { reason: 'password_change_required' },
      });

      const blockedPermissions = await admin
        .get('/api/v1/permissions/effective')
        .expect(403);
      expect(blockedPermissions.body).toMatchObject({
        code: 'PermissionDenied',
        details: { reason: 'password_change_required' },
      });

      const changed = await admin
        .post('/api/v1/auth/change-password')
        .send({
          currentPassword: INITIAL_BOOTSTRAP_PASSWORD,
          newPassword: ROTATED_ADMIN_PASSWORD,
        })
        .expect(200);
      expect(changed.body).toMatchObject({
        id: userId,
        username: BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
        isActive: true,
        mustChangePassword: false,
      });

      // Re-running bootstrap after password change neither resets the password
      // nor restores mustChangePassword=true.
      const rerun = await app!.get(SystemAdministratorBootstrapService).run();
      expect(rerun.userCreated).toBe(false);

      const meAfter = await admin.get('/api/v1/auth/me').expect(200);
      expect(meAfter.body).toMatchObject({
        id: userId,
        mustChangePassword: false,
      });
    });

    it('uses normal RBAC and organization membership across implemented domains', async () => {
      const admin = request.agent(app!.getHttpServer());
      await admin
        .post('/api/v1/auth/login')
        .send({ username: 'مدیر', password: ROTATED_ADMIN_PASSWORD })
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

    it('gives no administrator authority to a different user with a similar username', async () => {
      const admin = request.agent(app!.getHttpServer());
      await admin
        .post('/api/v1/auth/login')
        .send({ username: 'مدیر', password: ROTATED_ADMIN_PASSWORD })
        .expect(200);

      // A real, ordinary user whose name merely resembles the bootstrap one.
      const impostorName = `مدیر-${generateId().slice(-6)}`;
      const created = await admin
        .post('/api/v1/users')
        .send({ username: impostorName, password: 'Impostor-password-1' })
        .expect(201);
      impostorUserId = created.body.id as string;

      const impostor = request.agent(app!.getHttpServer());
      await impostor
        .post('/api/v1/auth/login')
        .send({ username: impostorName, password: 'Impostor-password-1' })
        .expect(200);

      // Authenticated, but holding no role: the username grants nothing.
      const effective = await impostor
        .get('/api/v1/permissions/effective')
        .expect(200);
      expect(effective.body.permissions).toEqual([]);
      await impostor.get('/api/v1/users').expect(403);
      await impostor.get('/api/v1/roles').expect(403);
      await impostor
        .get('/api/v1/inventory/items')
        .query({ organizationId })
        .expect(403);
    }, 60_000);

    it('denies the administrator when a single permission is removed from the role (ordinary RBAC, not a bypass)', async () => {
      const client = await prisma.getClient<{
        permission: {
          findFirst: (args: unknown) => Promise<{ id: string } | null>;
        };
        rolePermission: {
          delete: (args: unknown) => Promise<unknown>;
          create: (args: unknown) => Promise<unknown>;
        };
      }>();
      const permission = await client.permission.findFirst({
        where: { code: 'Users.User.View' },
      });
      expect(permission).not.toBeNull();

      const admin = request.agent(app!.getHttpServer());
      await admin
        .post('/api/v1/auth/login')
        .send({ username: 'مدیر', password: ROTATED_ADMIN_PASSWORD })
        .expect(200);
      await admin.get('/api/v1/users').expect(200);

      await client.rolePermission.delete({
        where: {
          roleId_permissionId: { roleId, permissionId: permission!.id },
        },
      });
      try {
        // The role name is still 'System Administrator' — it carries no
        // authority of its own, so the operation is now denied.
        await admin.get('/api/v1/users').expect(403);
        // An unrelated permission is unaffected: this is per-permission RBAC.
        await admin.get('/api/v1/roles').expect(200);
      } finally {
        await client.rolePermission.create({
          data: {
            roleId,
            permissionId: permission!.id,
            createdAt: new Date(),
            createdBy: null,
          },
        });
      }
      await admin.get('/api/v1/users').expect(200);
    }, 60_000);

    it('denies organization-scoped access when the administrator membership is removed', async () => {
      const client = await prisma.getClient<{
        organizationMembership: {
          deleteMany: (args: unknown) => Promise<{ count: number }>;
          create: (args: unknown) => Promise<unknown>;
        };
      }>();
      const admin = request.agent(app!.getHttpServer());
      await admin
        .post('/api/v1/auth/login')
        .send({ username: 'مدیر', password: ROTATED_ADMIN_PASSWORD })
        .expect(200);
      await admin
        .get('/api/v1/inventory/items')
        .query({ organizationId })
        .expect(200);

      await client.organizationMembership.deleteMany({
        where: { userId, organizationId },
      });
      try {
        // Complete permissions, no membership: ODR-3 answers 404.
        await admin
          .get('/api/v1/inventory/items')
          .query({ organizationId })
          .expect(404);
        await admin
          .get('/api/v1/accounting/balances')
          .query({ organizationId })
          .expect(404);
      } finally {
        await client.organizationMembership.create({
          data: {
            userId,
            organizationId,
            createdAt: new Date(),
            createdBy: null,
          },
        });
      }
      await admin
        .get('/api/v1/inventory/items')
        .query({ organizationId })
        .expect(200);
    }, 60_000);
  },
);

/**
 * Fresh-install acceptance for a PINNED deployment (ADR-0025): the bootstrap
 * command alone must produce the pinned organization, the administrator, the
 * complete permission catalog, and the ordinary membership — with no manual
 * SQL and no API call in between.
 */
describe.skipIf(DATABASE_URL === undefined)(
  'Bootstrap System Administrator — pinned deployment fresh install (live database)',
  () => {
    const pin = generateId();
    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let userId = '';

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder.overrideProvider(APP_CONFIG).useValue({
            ...loadAppConfig(),
            databaseUrl: DATABASE_URL,
            deploymentOrganizationId: pin,
            bootstrapSystemAdminPassword: INITIAL_BOOTSTRAP_PASSWORD,
          }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);
    }, 60_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        const client = await prisma.getClient<{
          user: { deleteMany: (args: unknown) => Promise<unknown> };
          organization: { deleteMany: (args: unknown) => Promise<unknown> };
          organizationMembership: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          role: { deleteMany: (args: unknown) => Promise<unknown> };
        }>();
        await client.organizationMembership.deleteMany({
          where: { organizationId: pin },
        });
        await client.organization.deleteMany({ where: { id: pin } });
        await client.user.deleteMany({
          where: { username: BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME },
        });
        await client.role.deleteMany({
          where: { name: SYSTEM_ADMINISTRATOR_ROLE_NAME },
        });
      } finally {
        await app.close();
      }
    }, 60_000);

    it('provisions the pinned organization, the administrator, and the membership in one idempotent command', async () => {
      const bootstrap = app!.get(SystemAdministratorBootstrapService);
      const first = await bootstrap.run();
      userId = first.userId;
      expect(first).toMatchObject({
        organizationId: pin,
        organizationCreated: true,
        membershipCreated: true,
      });
      expect(first.permissionCount).toBe(app!.get(PermissionRegistry).size);

      const second = await bootstrap.run();
      expect(second).toMatchObject({
        userId,
        roleId: first.roleId,
        permissionCount: first.permissionCount,
        userCreated: false,
        roleCreated: false,
        userRoleCreated: false,
        organizationId: pin,
        organizationCreated: false,
        membershipCreated: false,
      });

      const client = await prisma.getClient<{
        organization: { count: (args: unknown) => Promise<number> };
        organizationMembership: {
          count: (args: unknown) => Promise<number>;
        };
      }>();
      await expect(
        client.organization.count({ where: { id: pin } }),
      ).resolves.toBe(1);
      await expect(
        client.organizationMembership.count({
          where: { organizationId: pin, userId },
        }),
      ).resolves.toBe(1);
    }, 120_000);

    it('logs in with the initial credential, enforces first-login password change, and reaches organization-scoped APIs with no manual step', async () => {
      const admin = request.agent(app!.getHttpServer());
      const loginRes = await admin
        .post('/api/v1/auth/login')
        .send({ username: 'مدیر', password: INITIAL_BOOTSTRAP_PASSWORD })
        .expect(200);
      expect(loginRes.body).toMatchObject({
        id: userId,
        mustChangePassword: true,
      });

      await admin
        .get('/api/v1/inventory/items')
        .query({ organizationId: pin })
        .expect(403);

      await admin
        .post('/api/v1/auth/change-password')
        .send({
          currentPassword: INITIAL_BOOTSTRAP_PASSWORD,
          newPassword: ROTATED_ADMIN_PASSWORD,
        })
        .expect(200);

      for (const path of [
        '/api/v1/inventory/items',
        '/api/v1/documents/types',
        '/api/v1/workflow/definitions',
        '/api/v1/accounting/balances',
        '/api/v1/branches',
      ]) {
        // eslint-disable-next-line no-await-in-loop
        await admin.get(path).query({ organizationId: pin }).expect(200);
      }

      // The deployment pin is intact: another organization id is invisible,
      // so an arbitrary organizationId cannot widen the administrator's scope.
      await admin
        .get('/api/v1/inventory/items')
        .query({ organizationId: generateId() })
        .expect(404);
    }, 120_000);
  },
);
