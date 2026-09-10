import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { PermissionRegistry } from '../src/modules/rbac/application/permission-registry.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database integration suite. Skipped unless VARDENA_TEST_DATABASE_URL
 * is set (CI with Postgres, or local Docker). Requires a generated client
 * (`npm run prisma:generate`) and a migrated database (`prisma migrate dev`).
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Database (live integration)',
  () => {
    it('connects through PrismaService and reports readiness', async () => {
      let app: INestApplication | undefined;
      try {
        const built = await createTestApp({
          override: (builder) =>
            builder
              .overrideProvider(APP_CONFIG)
              .useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL }),
        });
        app = built.app;
        const prisma = built.module.get(PrismaService);
        await prisma.checkHealth();
        expect(prisma.describeConnection()).toMatch(/^postgresql:\/\//);

        const res = await request(app.getHttpServer())
          .get('/api/v1/health/ready')
          .expect(200);
        expect(res.body.checks).toEqual({ database: 'up' });
      } finally {
        await app?.close();
      }
    });
  },
);

/**
 * Users + RBAC journey against a live database. Same opt-in gate as above:
 * requires `VARDENA_TEST_DATABASE_URL`, a generated client, and a database
 * with the migrations applied. Unlike the in-memory journey
 * (`test/rbac.e2e-spec.ts`), this suite exercises the real Prisma repository
 * code paths, constraints, transactions and error mapping.
 */
describe.skipIf(DATABASE_URL === undefined)(
  'Users + RBAC (live database)',
  () => {
    const suffix = generateId().slice(-8);
    const ROOT_USERNAME = `live-root-${suffix}`;
    const ROOT_ROLE_NAME = `Live Root ${suffix}`;
    const ALICE_USERNAME = `live-alice-${suffix}`;
    const VIEWER_ROLE_NAME = `Live Viewer ${suffix}`;
    const ROOT_PASSWORD = 'root-secret';
    const ALICE_PASSWORD = 'alice-secret';

    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let rootId = '';
    let aliceId = '';
    let rootRoleId = '';
    let viewerRoleId = '';

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);

      // Bootstrap the first administrator in the documented system context.
      const users = app.get(UsersService);
      const roles = app.get(RolesService);
      const userRoles = app.get(UserRolesService);
      const root = await users.createUser({
        username: ROOT_USERNAME,
        password: ROOT_PASSWORD,
      });
      rootId = root.id;
      const allCodes = app
        .get(PermissionRegistry)
        .all()
        .map((definition) => definition.code);
      const rootRole = await roles.createRole({
        name: ROOT_ROLE_NAME,
        permissionCodes: allCodes,
      });
      rootRoleId = rootRole.id;
      await userRoles.assignRoleToUser(rootRoleId, rootId);
    }, 60_000);

    afterAll(async () => {
      if (app !== undefined) {
        // Test-only cleanup through the raw client; the API has no delete
        // endpoints (OQ-18/OQ-20). Assignments cascade from these rows.
        const client = await prisma.getClient<{
          user: { deleteMany: (args: unknown) => Promise<unknown> };
          role: { deleteMany: (args: unknown) => Promise<unknown> };
        }>();
        await client.user.deleteMany({
          where: { username: { in: [ROOT_USERNAME, ALICE_USERNAME] } },
        });
        await client.role.deleteMany({
          where: { id: { in: [rootRoleId, viewerRoleId] } },
        });
        await app.close();
      }
    }, 60_000);

    it('mirrors the permission registry into rbac.permissions', async () => {
      const client = await prisma.getClient<{
        permission: { findUnique: (args: unknown) => Promise<unknown | null> };
      }>();
      await expect(
        client.permission.findUnique({ where: { code: 'Users.User.View' } }),
      ).resolves.not.toBeNull();
    });

    it('runs the create → role → permission → assign → login → 200 → revoke → 403 journey', async () => {
      const root = request.agent(app!.getHttpServer());
      await root
        .post('/api/v1/auth/login')
        .send({ username: ROOT_USERNAME, password: ROOT_PASSWORD })
        .expect(200);

      const created = await root
        .post('/api/v1/users')
        .send({ username: ALICE_USERNAME, password: ALICE_PASSWORD })
        .expect(201);
      aliceId = created.body.id as string;
      expect(created.body).not.toHaveProperty('passwordHash');

      // The real unique index is what makes this a 409.
      await root
        .post('/api/v1/users')
        .send({ username: ALICE_USERNAME, password: 'x' })
        .expect(409);

      const role = await root
        .post('/api/v1/roles')
        .send({ name: VIEWER_ROLE_NAME })
        .expect(201);
      viewerRoleId = role.body.id as string;

      await root
        .post(`/api/v1/roles/${viewerRoleId}/permissions`)
        .send({ code: 'Users.User.View' })
        .expect(204);
      await root
        .post(`/api/v1/roles/${viewerRoleId}/users`)
        .send({ userId: aliceId })
        .expect(204);

      // Composite primary key → duplicate assignment is a 409.
      await root
        .post(`/api/v1/roles/${viewerRoleId}/users`)
        .send({ userId: aliceId })
        .expect(409);
      // Foreign key (unknown user) → 404.
      await root
        .post(`/api/v1/roles/${viewerRoleId}/users`)
        .send({ userId: generateId() })
        .expect(404);

      const alice = request.agent(app!.getHttpServer());
      await alice
        .post('/api/v1/auth/login')
        .send({ username: ALICE_USERNAME, password: ALICE_PASSWORD })
        .expect(200);
      const list = await alice.get('/api/v1/users').expect(200);
      expect(
        (list.body.items as Array<{ id: string }>).map((user) => user.id),
      ).toContain(aliceId);

      // Revocation is immediate for the same session (no cache).
      await root
        .delete(`/api/v1/roles/${viewerRoleId}/permissions/Users.User.View`)
        .expect(204);
      const denied = await alice.get('/api/v1/users').expect(403);
      expect(denied.body.code).toBe('PermissionDenied');
      await alice.get('/api/v1/auth/me').expect(200);
    }, 60_000);

    it('disabling a user revokes the sessions stored in the real table', async () => {
      const root = request.agent(app!.getHttpServer());
      await root
        .post('/api/v1/auth/login')
        .send({ username: ROOT_USERNAME, password: ROOT_PASSWORD })
        .expect(200);

      const alice = request.agent(app!.getHttpServer());
      await alice
        .post('/api/v1/auth/login')
        .send({ username: ALICE_USERNAME, password: ALICE_PASSWORD })
        .expect(200);

      await root.post(`/api/v1/users/${aliceId}/disable`).expect(200);
      await alice.get('/api/v1/auth/me').expect(401);
      await root.post(`/api/v1/users/${aliceId}/enable`).expect(200);
    }, 60_000);
  },
);
