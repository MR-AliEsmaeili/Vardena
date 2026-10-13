import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { LicensingService } from '../src/modules/licensing/application/licensing.service.js';
import type { InstallationLicense } from '../src/modules/licensing/domain/license.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { createTestApp } from './support/test-app.js';

const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];
const PREFIX = 'LIC-LIMIT-';

/** PostgreSQL proof for the installation-scoped advisory transaction locks. */
describe.skipIf(DATABASE_URL === undefined)(
  'License limit allocation concurrency (live PostgreSQL)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let organizations: OrganizationsService;
    let users: UsersService;
    const license: InstallationLicense = {
      customerId: 'live-customer',
      installationId: '01JLOCALINSTALLATION000000',
      licenseId: 'live-license',
      status: 'ACTIVE',
      validFrom: new Date('2020-01-01T00:00:00Z'),
      validUntil: null,
      organizationLimit: null,
      userLimit: null,
      provider: 'live-test',
      entitlements: [
        'organization',
        'users',
        'rbac',
        'inventory',
        'documents',
        'workflow',
        'accounting',
      ].map((code) => ({ kind: 'MODULE' as const, code })),
    };

    beforeAll(async () => {
      const licensing = new LicensingService({
        getLicense: async () => license,
      });
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL })
            .overrideProvider(LicensingService)
            .useValue(licensing),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);
      organizations = built.module.get(OrganizationsService);
      users = built.module.get(UsersService);
      await cleanup();
    }, 60_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        await cleanup();
      } finally {
        await app.close();
      }
    }, 60_000);

    async function client() {
      return prisma.getClient<{
        organization: {
          count: (args: unknown) => Promise<number>;
          deleteMany: (args: unknown) => Promise<unknown>;
        };
        user: {
          count: (args: unknown) => Promise<number>;
          deleteMany: (args: unknown) => Promise<unknown>;
        };
      }>();
    }

    async function cleanup() {
      if (prisma === undefined) return;
      const db = await client();
      await db.organization.deleteMany({
        where: { code: { startsWith: PREFIX } },
      });
      await db.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    }

    it('commits exactly one of two concurrent organization allocations for one available slot', async () => {
      const db = await client();
      const baseline = await db.organization.count({ where: {} });
      license.organizationLimit = baseline + 1;
      const outcomes = await Promise.allSettled([
        organizations.createOrganization({ code: `${PREFIX}ORG-A`, name: 'A' }),
        organizations.createOrganization({ code: `${PREFIX}ORG-B`, name: 'B' }),
      ]);
      expect(
        outcomes.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        outcomes.filter(({ status }) => status === 'rejected'),
      ).toHaveLength(1);
      await expect(
        db.organization.count({ where: { code: { startsWith: PREFIX } } }),
      ).resolves.toBe(1);
    });

    it('commits exactly one of two concurrent active-user allocations for one available slot', async () => {
      await cleanup();
      const db = await client();
      const baseline = await db.user.count({
        where: { isActive: true, deletedAt: null },
      });
      license.userLimit = baseline + 1;
      const outcomes = await Promise.allSettled([
        users.createUser({ username: `${PREFIX}USER-A`, password: 'secret' }),
        users.createUser({ username: `${PREFIX}USER-B`, password: 'secret' }),
      ]);
      expect(
        outcomes.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        outcomes.filter(({ status }) => status === 'rejected'),
      ).toHaveLength(1);
      await expect(
        db.user.count({
          where: {
            username: { startsWith: PREFIX },
            isActive: true,
            deletedAt: null,
          },
        }),
      ).resolves.toBe(1);
    });

    it('commits exactly one of two concurrent inactive-to-active allocations for one available slot', async () => {
      await cleanup();
      const db = await client();
      const disabled = await Promise.all([
        users.createUser({
          username: `${PREFIX}ENABLE-A`,
          password: 'secret',
          isActive: false,
        }),
        users.createUser({
          username: `${PREFIX}ENABLE-B`,
          password: 'secret',
          isActive: false,
        }),
      ]);
      const baseline = await db.user.count({
        where: { isActive: true, deletedAt: null },
      });
      license.userLimit = baseline + 1;
      const outcomes = await Promise.allSettled(
        disabled.map(({ id }) => users.enableUser(id)),
      );
      expect(
        outcomes.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        outcomes.filter(({ status }) => status === 'rejected'),
      ).toHaveLength(1);
      await expect(
        db.user.count({
          where: {
            username: { startsWith: `${PREFIX}ENABLE-` },
            isActive: true,
            deletedAt: null,
          },
        }),
      ).resolves.toBe(1);
    });
  },
);
