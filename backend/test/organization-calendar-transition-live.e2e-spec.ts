import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import {
  businessDateToDbDate,
  toBusinessDate,
} from '../src/kernel/datetime/business-date.js';
import { JALALI_RENDERABLE_GREGORIAN_RANGE } from '../src/kernel/datetime/jalali.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { BranchesService } from '../src/modules/organization/application/branches.service.js';
import { WarehousesService } from '../src/modules/inventory/application/warehouses.service.js';
import { InventoryBusinessDocumentsRepository } from '../src/modules/inventory/data/inventory-business-documents.repository.js';
import { OrganizationCalendarChangedDuringDocumentWriteError } from '../src/modules/inventory/data/inventory-business-document-errors.js';
import { createTestApp } from './support/test-app.js';

const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

type CalendarTransitionTransaction = {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  inventoryBusinessDocument: {
    create(args: unknown): Promise<unknown>;
  };
};

type CalendarTransitionClient = {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $transaction<T>(
    callback: (tx: CalendarTransitionTransaction) => Promise<T>,
  ): Promise<T>;
};

describe.skipIf(DATABASE_URL === undefined)(
  'Organization calendar transition (live database)',
  () => {
    const suffix = generateId().slice(-8).toLowerCase();
    const organizationIds: string[] = [];
    const branchIds: string[] = [];
    const warehouseIds: string[] = [];
    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let organizations: OrganizationsService;
    let branches: BranchesService;
    let warehouses: WarehousesService;
    let documents: InventoryBusinessDocumentsRepository;

    async function createGregorianOrganization(label: string) {
      const organization = await organizations.createOrganization({
        code: `CAL-${label}-${suffix}`,
        name: `Calendar transition ${label}`,
        calendarSystem: 'GREGORIAN',
        timeZone: 'UTC',
      });
      organizationIds.push(organization.id);
      const branch = await branches.createBranch({
        organizationId: organization.id,
        code: `BR-${label}`,
        name: `Branch ${label}`,
      });
      branchIds.push(branch.id);
      const warehouse = await warehouses.createWarehouse({
        organizationId: organization.id,
        branchId: branch.id,
        code: `WH-${label}`,
        name: `Warehouse ${label}`,
      });
      warehouseIds.push(warehouse.id);
      return { organization, warehouse };
    }

    async function createReceipt(
      organizationId: string,
      warehouseId: string,
      canonicalDate: string,
      validatedCalendarSystem: 'GREGORIAN' | 'JALALI' = 'GREGORIAN',
    ) {
      const businessDate = toBusinessDate(canonicalDate);
      if (businessDate === null) {
        throw new Error(`Invalid fixture BusinessDate: ${canonicalDate}`);
      }
      return documents.createDocument({
        header: {
          id: generateId(),
          organizationId,
          kind: 'receipt',
          businessDate,
          warehouseId,
          sourceWarehouseId: null,
          destinationWarehouseId: null,
          receiptCost: null,
          status: 'draft',
          description: null,
          reference: null,
          actorId: null,
          at: new Date(),
        },
        lines: [],
        validatedCalendarSystem,
      });
    }

    beforeAll(async () => {
      const baseConfig = loadAppConfig();
      const built = await createTestApp({
        override: (builder) =>
          builder.overrideProvider(APP_CONFIG).useValue({
            ...baseConfig,
            databaseUrl: DATABASE_URL,
          }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);
      organizations = app.get(OrganizationsService);
      branches = app.get(BranchesService);
      warehouses = app.get(WarehousesService);
      documents = app.get(InventoryBusinessDocumentsRepository);
    }, 180_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        const client = await prisma.getClient<{
          inventoryBusinessDocument: {
            deleteMany(args: unknown): Promise<unknown>;
          };
          warehouse: { deleteMany(args: unknown): Promise<unknown> };
          branch: { deleteMany(args: unknown): Promise<unknown> };
          organization: { deleteMany(args: unknown): Promise<unknown> };
        }>();
        if (organizationIds.length > 0) {
          await client.inventoryBusinessDocument.deleteMany({
            where: { organizationId: { in: organizationIds } },
          });
        }
        if (warehouseIds.length > 0) {
          await client.warehouse.deleteMany({
            where: { id: { in: warehouseIds } },
          });
        }
        if (branchIds.length > 0) {
          await client.branch.deleteMany({
            where: { id: { in: branchIds } },
          });
        }
        if (organizationIds.length > 0) {
          await client.organization.deleteMany({
            where: { id: { in: organizationIds } },
          });
        }
      } finally {
        await app.close();
      }
    }, 30_000);

    it('rejects an unrenderable historical BusinessDate without changing the organization or document', async () => {
      const { organization, warehouse } =
        await createGregorianOrganization('blocked');
      const receipt = await createReceipt(
        organization.id,
        warehouse.id,
        '0600-01-01',
      );

      await expect(
        organizations.updateOrganization(organization.id, {
          calendarSystem: 'JALALI',
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'BusinessRuleViolation',
        details: {
          code: 'organization.calendar.jalali_history_unrenderable',
          businessDate: '0600-01-01',
          supportedGregorianRange: JALALI_RENDERABLE_GREGORIAN_RANGE,
        },
      });

      await expect(
        organizations.getDateTimeSettings(organization.id),
      ).resolves.toEqual({ calendarSystem: 'GREGORIAN', timeZone: 'UTC' });
      await expect(
        documents.findById(organization.id, receipt.id),
      ).resolves.toMatchObject({ businessDate: '0600-01-01' });
    });

    it('allows the transition when every existing document date is renderable', async () => {
      const { organization, warehouse } =
        await createGregorianOrganization('allowed');
      const first = await createReceipt(
        organization.id,
        warehouse.id,
        JALALI_RENDERABLE_GREGORIAN_RANGE.minimum,
      );
      const last = await createReceipt(
        organization.id,
        warehouse.id,
        JALALI_RENDERABLE_GREGORIAN_RANGE.maximum,
      );

      const updated = await organizations.updateOrganization(organization.id, {
        calendarSystem: 'JALALI',
      });

      expect(updated.calendarSystem).toBe('JALALI');
      await expect(
        documents.findById(organization.id, first.id),
      ).resolves.toMatchObject({
        businessDate: JALALI_RENDERABLE_GREGORIAN_RANGE.minimum,
      });
      await expect(
        documents.findById(organization.id, last.id),
      ).resolves.toMatchObject({
        businessDate: JALALI_RENDERABLE_GREGORIAN_RANGE.maximum,
      });
    });

    it('refuses a stale Gregorian document write after a calendar transition', async () => {
      const { organization, warehouse } =
        await createGregorianOrganization('stale');
      await organizations.updateOrganization(organization.id, {
        calendarSystem: 'JALALI',
      });

      await expect(
        createReceipt(organization.id, warehouse.id, '0600-01-01', 'GREGORIAN'),
      ).rejects.toBeInstanceOf(
        OrganizationCalendarChangedDuringDocumentWriteError,
      );

      const client = await prisma.getClient<{
        inventoryBusinessDocument: {
          count(args: unknown): Promise<number>;
        };
      }>();
      await expect(
        client.inventoryBusinessDocument.count({
          where: { organizationId: organization.id },
        }),
      ).resolves.toBe(0);
    });

    it('waits for a concurrent Inventory writer and checks its committed date', async () => {
      const { organization, warehouse } =
        await createGregorianOrganization('concurrent');
      const client = await prisma.getClient<CalendarTransitionClient>();
      const businessDate = businessDateToDbDate('0600-01-01');
      if (businessDate === null) {
        throw new Error('Invalid concurrent-test BusinessDate fixture.');
      }
      const documentId = generateId();

      let signalWriterLock: () => void = () => undefined;
      const writerLocked = new Promise<void>((resolve) => {
        signalWriterLock = resolve;
      });
      let releaseWriter: () => void = () => undefined;
      const writerGate = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });
      const writer = client.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
            FROM "organization"."organizations"
           WHERE "id" = ${organization.id}
           FOR KEY SHARE
        `;
        signalWriterLock();
        await writerGate;
        await tx.inventoryBusinessDocument.create({
          data: {
            id: documentId,
            organizationId: organization.id,
            kind: 'receipt',
            businessDate,
            warehouseId: warehouse.id,
            status: 'draft',
          },
        });
      });

      await writerLocked;
      const transition = organizations
        .updateOrganization(organization.id, { calendarSystem: 'JALALI' })
        .then(
          (value) => ({ kind: 'updated' as const, value }),
          (error: unknown) => ({ kind: 'rejected' as const, error }),
        );

      try {
        let blockedOnOrganizationLock = false;
        for (let attempt = 0; attempt < 120; attempt += 1) {
          const activity = await client.$queryRaw<Array<{ waiting: boolean }>>`
            SELECT EXISTS (
              SELECT 1
                FROM pg_stat_activity
               WHERE datname = current_database()
                 AND state = 'active'
                 AND wait_event_type = 'Lock'
                 AND query LIKE '%FROM "organization"."organizations"%'
                 AND query LIKE '%FOR UPDATE%'
            ) AS "waiting"
          `;
          if (activity[0]?.waiting === true) {
            blockedOnOrganizationLock = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(blockedOnOrganizationLock).toBe(true);
      } finally {
        releaseWriter();
      }

      await writer;
      const result = await transition;
      expect(result.kind).toBe('rejected');
      if (result.kind === 'rejected') {
        expect(result.error).toMatchObject({
          status: 422,
          code: 'BusinessRuleViolation',
          details: {
            code: 'organization.calendar.jalali_history_unrenderable',
            businessDate: '0600-01-01',
          },
        });
      }
      await expect(
        organizations.getDateTimeSettings(organization.id),
      ).resolves.toEqual({ calendarSystem: 'GREGORIAN', timeZone: 'UTC' });
      await expect(
        documents.findById(organization.id, documentId),
      ).resolves.toMatchObject({ businessDate: '0600-01-01' });
    });
  },
);
