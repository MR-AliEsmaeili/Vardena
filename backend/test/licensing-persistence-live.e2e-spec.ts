import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { InstallationIdentityService } from '../src/modules/licensing/application/installation-identity.service.js';
import { LicensingService } from '../src/modules/licensing/application/licensing.service.js';
import { LicenseActivationService } from '../src/modules/licensing/application/license-activation.service.js';
import {
  generateAuthorityKeyPair,
  issueLicenseCode,
} from '../src/tools/development-license-authority.js';
import { createTestApp } from './support/test-app.js';

const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

/**
 * PostgreSQL proof that installation identity and license activation really
 * survive a restart (L-02).
 *
 * The hermetic suite (`licensing-activation.e2e-spec.ts`) proves the
 * behaviour against in-memory stores; this one proves the SQL side of it:
 * the real tables, the real partial unique indexes ("one self installation",
 * "one current license per installation") and the real transaction. A second
 * application instance over the same database is the restart.
 */
describe.skipIf(DATABASE_URL === undefined)(
  'Licensing persistence (live PostgreSQL)',
  () => {
    const authority = generateAuthorityKeyPair();
    let app: INestApplication;
    let prisma: PrismaService;

    async function boot(): Promise<INestApplication> {
      const base = loadAppConfig();
      const built = await createTestApp({
        override: (builder) =>
          builder.overrideProvider(APP_CONFIG).useValue({
            ...base,
            databaseUrl: DATABASE_URL,
            licensing: {
              ...base.licensing,
              provider: 'persistent',
              signingPublicKeys: [authority.publicKey],
            },
          }),
      });
      return built.app;
    }

    async function cleanup(service: PrismaService): Promise<void> {
      const client = await service.getClient<{
        $executeRawUnsafe(query: string): Promise<unknown>;
      }>();
      await client.$executeRawUnsafe(
        'DELETE FROM "licensing"."license_entitlements"',
      );
      await client.$executeRawUnsafe('DELETE FROM "licensing"."licenses"');
      await client.$executeRawUnsafe('DELETE FROM "licensing"."installations"');
      await client.$executeRawUnsafe('DELETE FROM "licensing"."customers"');
    }

    beforeAll(async () => {
      app = await boot();
      prisma = app.get(PrismaService);
      await cleanup(prisma);
    }, 60_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        await cleanup(prisma);
      } finally {
        await app.close();
      }
    }, 60_000);

    it('persists identity and license, and reloads both after a restart', async () => {
      // 1. Fresh installation: identity is created once, nothing is licensed.
      const identity = await app.get(InstallationIdentityService).current();
      expect(identity.installationId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      await expect(app.get(LicensingService).current()).resolves.toMatchObject({
        status: 'UNLICENSED',
        active: false,
        installationId: identity.installationId,
      });

      // 2. Activation persists the license (direct service call: the HTTP
      //    authorization path is covered by the hermetic suite).
      const { code } = issueLicenseCode(
        {
          installationId: identity.installationId,
          customerName: 'Live customer',
          organizationLimit: 2,
          moduleEntitlements: ['organization', 'users'],
        },
        authority.privateKey,
      );
      const activated = await app.get(LicenseActivationService).activate(code);
      expect(activated).toMatchObject({
        changed: true,
        license: { active: true, status: 'ACTIVE', organizationLimit: 2 },
      });

      // 3. Restart: a brand-new application over the same database.
      await app.close();
      app = await boot();
      prisma = app.get(PrismaService);

      const reloaded = await app.get(InstallationIdentityService).current();
      expect(reloaded.installationId).toBe(identity.installationId);
      expect(reloaded.customerId).not.toBeNull();

      await expect(app.get(LicensingService).current()).resolves.toMatchObject({
        licensed: true,
        status: 'ACTIVE',
        active: true,
        installationId: identity.installationId,
        organizationLimit: 2,
      });

      // 4. Re-activating the same code stays idempotent across the restart,
      //    and a replacement keeps exactly one current license.
      await expect(
        app.get(LicenseActivationService).activate(code),
      ).resolves.toMatchObject({ changed: false });

      const replacement = issueLicenseCode(
        {
          installationId: identity.installationId,
          customerName: 'Live customer',
          organizationLimit: 5,
          moduleEntitlements: ['organization', 'users'],
        },
        authority.privateKey,
      ).code;
      await expect(
        app.get(LicenseActivationService).activate(replacement),
      ).resolves.toMatchObject({
        changed: true,
        license: { organizationLimit: 5 },
      });

      const client = await prisma.getClient<{
        $queryRawUnsafe<T>(query: string): Promise<T>;
      }>();
      const current = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
        'SELECT COUNT(*)::bigint AS count FROM "licensing"."licenses" WHERE "replaced_at" IS NULL',
      );
      expect(Number(current[0]?.count)).toBe(1);
      const installations = await client.$queryRawUnsafe<
        Array<{ count: bigint }>
      >(
        'SELECT COUNT(*)::bigint AS count FROM "licensing"."installations" WHERE "is_self"',
      );
      expect(Number(installations[0]?.count)).toBe(1);
    }, 120_000);

    it('rejects a license bound to another installation against the real database', async () => {
      const foreign = issueLicenseCode(
        { installationId: '01K7OTHERINSTALLATION0000' },
        authority.privateKey,
      ).code;

      await expect(
        app.get(LicenseActivationService).activate(foreign),
      ).rejects.toThrow(/different Vardena installation/);

      await expect(app.get(LicensingService).current()).resolves.toMatchObject({
        active: true,
      });
    }, 60_000);
  },
);
