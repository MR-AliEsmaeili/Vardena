import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { toBusinessDate } from '../src/kernel/datetime/business-date.js';
import { JALALI_RENDERABLE_GREGORIAN_RANGE } from '../src/kernel/datetime/jalali.js';
import type { CalendarSystem } from '../src/kernel/datetime/calendar-system.js';
import { OrganizationCalendarTransitionService } from '../src/composition/organization-calendar-transition.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { BranchesService } from '../src/modules/organization/application/branches.service.js';
import { InventoryBusinessDocumentsService } from '../src/modules/inventory/application/inventory-business-documents.service.js';
import { WarehousesService } from '../src/modules/inventory/application/warehouses.service.js';
import {
  InventoryBusinessDocumentsRepository,
  type DocumentLineCreate,
} from '../src/modules/inventory/data/inventory-business-documents.repository.js';
import { OrganizationCalendarChangedDuringDocumentWriteError } from '../src/modules/inventory/data/inventory-business-document-errors.js';
import { createTestApp } from './support/test-app.js';

const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

function databaseUrlWithApplicationName(
  databaseUrl: string,
  applicationName: string,
): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('application_name', applicationName);
  return url.toString();
}

type CalendarTransitionTransaction = {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

type CalendarTransitionClient = CalendarTransitionTransaction & {
  $transaction<T>(
    callback: (tx: CalendarTransitionTransaction) => Promise<T>,
  ): Promise<T>;
};

describe.skipIf(DATABASE_URL === undefined)(
  'Organization calendar transition (live database)',
  () => {
    const suffix = generateId().slice(-8).toLowerCase();
    const applicationName = `vardena-calendar-transition-${suffix}`;
    const organizationIds: string[] = [];
    const branchIds: string[] = [];
    const warehouseIds: string[] = [];
    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let organizations: OrganizationsService;
    let calendarTransitions: OrganizationCalendarTransitionService;
    let inventoryDocuments: InventoryBusinessDocumentsService;
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

    async function insertReceipt(
      organizationId: string,
      warehouseId: string,
      canonicalDate: string,
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
      });
    }

    async function createReceipt(
      organizationId: string,
      warehouseId: string,
      canonicalDate: string,
      validatedCalendarSystem: CalendarSystem = 'GREGORIAN',
    ) {
      const result = await organizations.withBusinessDateWriteLock(
        organizationId,
        validatedCalendarSystem,
        () => insertReceipt(organizationId, warehouseId, canonicalDate),
      );
      if (result.kind !== 'completed') {
        throw new OrganizationCalendarChangedDuringDocumentWriteError();
      }
      return result.value;
    }

    async function isWaitingForCalendarLock(
      client: CalendarTransitionClient,
      lockMode: 'FOR UPDATE' | 'FOR SHARE',
    ): Promise<boolean> {
      const pattern = `%${lockMode}%`;
      for (let attempt = 0; attempt < 160; attempt += 1) {
        const activity = await client.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (
            SELECT 1
              FROM pg_stat_activity
             WHERE datname = current_database()
               AND application_name = ${applicationName}
               AND pid <> pg_backend_pid()
               AND state = 'active'
               AND wait_event_type = 'Lock'
               AND query LIKE '%FROM "organization"."organizations"%'
               AND query LIKE ${pattern}
          ) AS "waiting"
        `;
        if (activity[0]?.waiting === true) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    }

    beforeAll(async () => {
      const baseConfig = loadAppConfig();
      const built = await createTestApp({
        override: (builder) =>
          builder.overrideProvider(APP_CONFIG).useValue({
            ...baseConfig,
            databaseUrl: databaseUrlWithApplicationName(
              DATABASE_URL!,
              applicationName,
            ),
          }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);
      organizations = app.get(OrganizationsService);
      calendarTransitions = app.get(OrganizationCalendarTransitionService);
      inventoryDocuments = app.get(InventoryBusinessDocumentsService);
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
        calendarTransitions.updateOrganization(organization.id, {
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

      const updated = await calendarTransitions.updateOrganization(
        organization.id,
        {
          calendarSystem: 'JALALI',
        },
      );

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

    it('keeps JALALI → GREGORIAN unrestricted with out-of-range history', async () => {
      const { organization, warehouse } =
        await createGregorianOrganization('reverse');
      await calendarTransitions.updateOrganization(organization.id, {
        calendarSystem: 'JALALI',
      });
      const legacyReceipt = await createReceipt(
        organization.id,
        warehouse.id,
        '0600-01-01',
        'JALALI',
      );

      const updated = await calendarTransitions.updateOrganization(
        organization.id,
        { calendarSystem: 'GREGORIAN' },
      );

      expect(updated.calendarSystem).toBe('GREGORIAN');
      await expect(
        documents.findById(organization.id, legacyReceipt.id),
      ).resolves.toMatchObject({ businessDate: '0600-01-01' });
    });

    it('takes the same PostgreSQL transition lock for the unrestricted JALALI → GREGORIAN reversal', async () => {
      const { organization, warehouse } =
        await createGregorianOrganization('reverse-lock');
      await calendarTransitions.updateOrganization(organization.id, {
        calendarSystem: 'JALALI',
      });
      await createReceipt(
        organization.id,
        warehouse.id,
        '0600-01-01',
        'JALALI',
      );

      const client = await prisma.getClient<CalendarTransitionClient>();
      let signalHeldLock: () => void = () => undefined;
      const heldLockReady = new Promise<void>((resolve) => {
        signalHeldLock = resolve;
      });
      let releaseHeldLock: () => void = () => undefined;
      const heldLockGate = new Promise<void>((resolve) => {
        releaseHeldLock = resolve;
      });
      const heldLock = client.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
            FROM "organization"."organizations"
           WHERE "id" = ${organization.id}
           FOR UPDATE
        `;
        signalHeldLock();
        await heldLockGate;
      });
      await heldLockReady;
      const transition = calendarTransitions
        .updateOrganization(organization.id, {
          calendarSystem: 'GREGORIAN',
        })
        .then(
          (value) => ({ kind: 'updated' as const, value }),
          (error: unknown) => ({ kind: 'rejected' as const, error }),
        );

      let transitionWaited = false;
      try {
        transitionWaited = await isWaitingForCalendarLock(client, 'FOR UPDATE');
      } finally {
        releaseHeldLock();
      }

      await heldLock;
      expect(transitionWaited).toBe(true);
      await expect(transition).resolves.toMatchObject({
        kind: 'updated',
        value: { calendarSystem: 'GREGORIAN' },
      });
      const clientForHistory = await prisma.getClient<{
        inventoryBusinessDocument: {
          count(args: unknown): Promise<number>;
        };
      }>();
      await expect(
        clientForHistory.inventoryBusinessDocument.count({
          where: { organizationId: organization.id },
        }),
      ).resolves.toBe(1);
    });

    it('serializes two simultaneous calendar transitions on the Organization row', async () => {
      const { organization } =
        await createGregorianOrganization('two-transitions');
      const client = await prisma.getClient<CalendarTransitionClient>();
      let signalHistoryRead: () => void = () => undefined;
      const historyRead = new Promise<void>((resolve) => {
        signalHistoryRead = resolve;
      });
      let releaseFirstTransition: () => void = () => undefined;
      const firstTransitionGate = new Promise<void>((resolve) => {
        releaseFirstTransition = resolve;
      });
      const firstTransition = organizations
        .updateOrganization(
          organization.id,
          { calendarSystem: 'JALALI' },
          async (organizationId) => {
            const incompatible =
              await inventoryDocuments.findFirstUnrenderableBusinessDate(
                organizationId,
              );
            signalHistoryRead();
            await firstTransitionGate;
            return incompatible;
          },
        )
        .then(
          (value) => ({ kind: 'updated' as const, value }),
          (error: unknown) => ({ kind: 'rejected' as const, error }),
        );

      await historyRead;
      const secondTransition = calendarTransitions
        .updateOrganization(organization.id, {
          calendarSystem: 'GREGORIAN',
        })
        .then(
          (value) => ({ kind: 'updated' as const, value }),
          (error: unknown) => ({ kind: 'rejected' as const, error }),
        );
      let secondWaited = false;
      try {
        secondWaited = await isWaitingForCalendarLock(client, 'FOR UPDATE');
      } finally {
        releaseFirstTransition();
      }

      const [first, second] = await Promise.all([
        firstTransition,
        secondTransition,
      ]);
      expect(secondWaited).toBe(true);
      expect(first).toMatchObject({
        kind: 'updated',
        value: { calendarSystem: 'JALALI' },
      });
      expect(second).toMatchObject({
        kind: 'updated',
        value: { calendarSystem: 'GREGORIAN' },
      });
      await expect(
        organizations.getDateTimeSettings(organization.id),
      ).resolves.toEqual({ calendarSystem: 'GREGORIAN', timeZone: 'UTC' });
    });

    it('refuses a stale Gregorian document write after a calendar transition', async () => {
      const { organization, warehouse } =
        await createGregorianOrganization('stale');
      await calendarTransitions.updateOrganization(organization.id, {
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

    it('rolls back Organization settings when the mandatory Inventory history contract fails', async () => {
      const { organization, warehouse } =
        await createGregorianOrganization('guard-failure');
      const receipt = await createReceipt(
        organization.id,
        warehouse.id,
        '2026-10-01',
      );
      const injectedFailure = new Error('Injected Inventory history failure.');

      await expect(
        organizations.updateOrganization(
          organization.id,
          { calendarSystem: 'JALALI' },
          async (organizationId) => {
            await inventoryDocuments.findFirstUnrenderableBusinessDate(
              organizationId,
            );
            throw injectedFailure;
          },
        ),
      ).rejects.toBe(injectedFailure);

      await expect(
        organizations.getDateTimeSettings(organization.id),
      ).resolves.toEqual({ calendarSystem: 'GREGORIAN', timeZone: 'UTC' });
      await expect(
        documents.findById(organization.id, receipt.id),
      ).resolves.toMatchObject({ businessDate: '2026-10-01' });

      // The failed transaction released its row lock; the normal composition
      // path can now complete the same transition.
      await expect(
        calendarTransitions.updateOrganization(organization.id, {
          calendarSystem: 'JALALI',
        }),
      ).resolves.toMatchObject({ calendarSystem: 'JALALI' });
    });

    it('rolls back the Inventory header and line transaction when the write callback fails', async () => {
      const { organization, warehouse } =
        await createGregorianOrganization('write-failure');
      const businessDate = toBusinessDate('2026-10-01');
      if (businessDate === null) {
        throw new Error('Invalid write-failure BusinessDate fixture.');
      }
      const badLine: DocumentLineCreate = {
        id: generateId(),
        lineNumber: 1,
        itemId: generateId(),
        quantity: '1',
        unitId: generateId(),
        baseQuantity: '1',
        baseUnitId: generateId(),
        conversionFactor: '1',
        basisMovementId: null,
      };

      await expect(
        organizations.withBusinessDateWriteLock(
          organization.id,
          'GREGORIAN',
          () =>
            documents.createDocument({
              header: {
                id: generateId(),
                organizationId: organization.id,
                kind: 'receipt',
                businessDate,
                warehouseId: warehouse.id,
                sourceWarehouseId: null,
                destinationWarehouseId: null,
                receiptCost: null,
                status: 'draft',
                description: null,
                reference: null,
                actorId: null,
                at: new Date(),
              },
              lines: [badLine],
            }),
        ),
      ).rejects.toThrow();

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

      // Both independent transactions released their locks on failure.
      await expect(
        createReceipt(organization.id, warehouse.id, '2026-10-01'),
      ).resolves.toMatchObject({ businessDate: '2026-10-01' });
    });

    it('keeps the Organization row lock beyond the former 5-second default until the Inventory write callback completes', async () => {
      const { organization, warehouse } = await createGregorianOrganization(
        'write-timeout-margin',
      );
      const client = await prisma.getClient<CalendarTransitionClient>();
      let signalInventoryCommit: () => void = () => undefined;
      const inventoryCommitted = new Promise<void>((resolve) => {
        signalInventoryCommit = resolve;
      });

      // The delay is test-only: it exercises the Organization transaction's
      // explicit 10-second timeout after the independent Inventory transaction
      // commits. Production callbacks return immediately after their Inventory
      // transaction; no post-commit work belongs inside this lock.
      const writerOutcome = organizations
        .withBusinessDateWriteLock(organization.id, 'GREGORIAN', async () => {
          const document = await insertReceipt(
            organization.id,
            warehouse.id,
            '0600-01-01',
          );
          signalInventoryCommit();
          await client.$queryRaw`SELECT pg_sleep(8)`;
          return document;
        })
        .then(
          (value) => ({ kind: 'completed' as const, value }),
          (error: unknown) => ({ kind: 'rejected' as const, error }),
        );
      await inventoryCommitted;
      const transition = calendarTransitions
        .updateOrganization(organization.id, { calendarSystem: 'JALALI' })
        .then(
          (value) => ({ kind: 'updated' as const, value }),
          (error: unknown) => ({ kind: 'rejected' as const, error }),
        );

      expect(await isWaitingForCalendarLock(client, 'FOR UPDATE')).toBe(true);
      await client.$queryRaw`SELECT pg_sleep(6)`;
      expect(await isWaitingForCalendarLock(client, 'FOR UPDATE')).toBe(true);

      const [writer, transitionResult] = await Promise.all([
        writerOutcome,
        transition,
      ]);
      expect(writer.kind).toBe('completed');
      expect(transitionResult.kind).toBe('rejected');
      if (transitionResult.kind === 'rejected') {
        expect(transitionResult.error).toMatchObject({
          code: 'BusinessRuleViolation',
          details: {
            code: 'organization.calendar.jalali_history_unrenderable',
            businessDate: '0600-01-01',
          },
        });
      }
    }, 30_000);

    it('waits for a writer-first Inventory transaction, then checks its committed history', async () => {
      const { organization, warehouse } =
        await createGregorianOrganization('writer-first');
      const client = await prisma.getClient<CalendarTransitionClient>();

      let signalWriterLock: () => void = () => undefined;
      const writerLocked = new Promise<void>((resolve) => {
        signalWriterLock = resolve;
      });
      let releaseWriter: () => void = () => undefined;
      const writerGate = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });
      const writer = organizations.withBusinessDateWriteLock(
        organization.id,
        'GREGORIAN',
        async () => {
          signalWriterLock();
          await writerGate;
          return insertReceipt(organization.id, warehouse.id, '0600-01-01');
        },
      );

      await writerLocked;
      const transition = calendarTransitions
        .updateOrganization(organization.id, { calendarSystem: 'JALALI' })
        .then(
          (value) => ({ kind: 'updated' as const, value }),
          (error: unknown) => ({ kind: 'rejected' as const, error }),
        );

      try {
        expect(await isWaitingForCalendarLock(client, 'FOR UPDATE')).toBe(true);
      } finally {
        releaseWriter();
      }

      const writerResult = await writer;
      expect(writerResult.kind).toBe('completed');
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
      if (writerResult.kind === 'completed') {
        await expect(
          documents.findById(organization.id, writerResult.value.id),
        ).resolves.toMatchObject({ businessDate: '0600-01-01' });
      }
    });

    it('when the transition wins, a waiting READ COMMITTED writer observes the new calendar and never starts its write callback', async () => {
      const { organization, warehouse } =
        await createGregorianOrganization('transition-first');
      const client = await prisma.getClient<CalendarTransitionClient>();

      let signalHistoryRead: () => void = () => undefined;
      const historyRead = new Promise<void>((resolve) => {
        signalHistoryRead = resolve;
      });
      let releaseTransition: () => void = () => undefined;
      const transitionGate = new Promise<void>((resolve) => {
        releaseTransition = resolve;
      });
      const transition = organizations
        .updateOrganization(
          organization.id,
          { calendarSystem: 'JALALI' },
          async (organizationId) => {
            const incompatible =
              await inventoryDocuments.findFirstUnrenderableBusinessDate(
                organizationId,
              );
            signalHistoryRead();
            await transitionGate;
            return incompatible;
          },
        )
        .then(
          (value) => ({ kind: 'updated' as const, value }),
          (error: unknown) => ({ kind: 'rejected' as const, error }),
        );

      await historyRead;
      let writerCallbackInvoked = false;
      const staleWriter = organizations.withBusinessDateWriteLock(
        organization.id,
        'GREGORIAN',
        async () => {
          writerCallbackInvoked = true;
          return insertReceipt(organization.id, warehouse.id, '0600-01-01');
        },
      );

      try {
        expect(await isWaitingForCalendarLock(client, 'FOR SHARE')).toBe(true);
      } finally {
        releaseTransition();
      }

      const transitionResult = await transition;
      expect(transitionResult.kind).toBe('updated');
      const writerResult = await staleWriter;
      expect(writerResult).toEqual({ kind: 'calendar_changed' });
      expect(writerCallbackInvoked).toBe(false);
      await expect(
        organizations.getDateTimeSettings(organization.id),
      ).resolves.toEqual({ calendarSystem: 'JALALI', timeZone: 'UTC' });

      const documentsInOrganization = await prisma
        .getClient<{
          inventoryBusinessDocument: {
            count(args: unknown): Promise<number>;
          };
        }>()
        .then((db) =>
          db.inventoryBusinessDocument.count({
            where: { organizationId: organization.id },
          }),
        );
      expect(documentsInOrganization).toBe(0);
    });
  },
);
