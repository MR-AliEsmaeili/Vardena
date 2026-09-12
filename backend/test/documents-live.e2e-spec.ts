import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { DocumentTypeRegistry } from '../src/modules/documents/application/document-type-registry.js';
import { NumberingService } from '../src/modules/documents/application/numbering.service.js';
import { NumberingSeriesService } from '../src/modules/documents/application/numbering-series.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database concurrency suite for document numbering (Task 8 §11/§17).
 * Skipped unless VARDENA_TEST_DATABASE_URL is set (CI with Postgres, or local
 * Docker). Requires a generated client (`npm run prisma:generate`) and a
 * migrated database (`prisma migrate dev`).
 *
 * This is where the `SELECT … FOR UPDATE` lock and the
 * `(series_id, number)` / `(series_id, allocation_key)` unique indexes are
 * exercised for real: concurrent allocations for one series must never
 * collide, and a retried key must replay instead of double-issuing. The
 * in-memory suite (`numbering.service.spec.ts`, `documents.e2e-spec.ts`)
 * covers the same contract with faked data access.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Document numbering (live database)',
  () => {
    const suffix = generateId().slice(-8);

    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let organizationId = '';
    let seriesId = '';

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);

      // Task 8 owns no business type; register the fixture like a future
      // owning module would at startup.
      built.module.get(DocumentTypeRegistry).register([
        {
          code: 'inventory_receipt',
          module: 'inventory',
          name: 'Inventory receipt',
          draftCapable: true,
          entryStates: ['temporary'],
          deletablePhases: ['draft', 'temporary'],
        },
      ]);

      const organizations = app.get(OrganizationsService);
      const numberingSeries = app.get(NumberingSeriesService);
      organizationId = (
        await organizations.createOrganization({
          code: `DOCS-${suffix}`,
          name: 'Documents live org',
        })
      ).id;
      seriesId = (
        await numberingSeries.createNumberingSeries({
          organizationId,
          documentType: 'inventory_receipt',
          name: 'Live receipts',
          width: 0,
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      if (app !== undefined) {
        // Test-only cleanup through the raw client; the API has no delete
        // endpoints for these rows (Task 8 §20).
        const client = await prisma.getClient<{
          numberingAllocation: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          numberingSeries: { deleteMany: (args: unknown) => Promise<unknown> };
          documentTypeConfig: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          organization: { deleteMany: (args: unknown) => Promise<unknown> };
        }>();
        await client.numberingAllocation.deleteMany({
          where: { organizationId },
        });
        await client.numberingSeries.deleteMany({ where: { organizationId } });
        await client.documentTypeConfig.deleteMany({
          where: { organizationId },
        });
        await client.organization.deleteMany({ where: { id: organizationId } });
        await app.close();
      }
    }, 60_000);

    it('allocates distinct monotonic serials across concurrent requests', async () => {
      const numbering = app!.get(NumberingService);
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          numbering.allocateNumber({
            organizationId,
            documentType: 'inventory_receipt',
            allocationKey: `live-${index}`,
            referenceModule: 'inventory',
            referenceDocumentType: 'inventory_receipt',
            referenceDocumentId: generateId(),
          }),
        ),
      );

      const numbers = results.map((allocation) => allocation.number);
      // The hard guarantee: no two concurrent allocations share a serial.
      expect(new Set(numbers).size).toBe(20);
      // And the sequence is exactly 1..20 — no gaps, no skipped counters.
      expect([...numbers].sort((a, b) => Number(a) - Number(b))).toEqual(
        Array.from({ length: 20 }, (_, index) => String(index + 1)),
      );
    }, 60_000);

    it('replays the same serial for the same key under concurrency', async () => {
      const numbering = app!.get(NumberingService);
      const key = 'live-same-key';
      const reference = {
        referenceModule: 'inventory',
        referenceDocumentType: 'inventory_receipt',
        referenceDocumentId: generateId(),
      };
      const [first, second] = await Promise.all([
        numbering.allocateNumber({
          organizationId,
          documentType: 'inventory_receipt',
          allocationKey: key,
          ...reference,
        }),
        numbering.allocateNumber({
          organizationId,
          documentType: 'inventory_receipt',
          allocationKey: key,
          ...reference,
        }),
      ]);

      expect(first.number).toBe(second.number);
      expect(first.id).toBe(second.id);

      // Exactly one ledger row for the key — the loser replayed, it did not
      // double-issue.
      const client = await prisma.getClient<{
        numberingAllocation: { count: (args: unknown) => Promise<number> };
      }>();
      const count = await client.numberingAllocation.count({
        where: { seriesId, allocationKey: key },
      });
      expect(count).toBe(1);
    }, 60_000);

    it('rejects the same key with a different reference (409)', async () => {
      const numbering = app!.get(NumberingService);
      const key = 'live-conflict-key';
      await numbering.allocateNumber({
        organizationId,
        documentType: 'inventory_receipt',
        allocationKey: key,
        referenceModule: 'inventory',
        referenceDocumentType: 'inventory_receipt',
        referenceDocumentId: generateId(),
      });
      await expect(
        numbering.allocateNumber({
          organizationId,
          documentType: 'inventory_receipt',
          allocationKey: key,
          referenceModule: 'inventory',
          referenceDocumentType: 'inventory_receipt',
          referenceDocumentId: generateId(),
        }),
      ).rejects.toMatchObject({ code: 'Conflict' });
    }, 60_000);
  },
);
