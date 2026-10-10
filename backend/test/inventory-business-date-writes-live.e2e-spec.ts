import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import type { BusinessDate } from '../src/kernel/datetime/business-date.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { BranchesService } from '../src/modules/organization/application/branches.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { ItemsService } from '../src/modules/inventory/application/items.service.js';
import { InventoryBusinessDocumentsService } from '../src/modules/inventory/application/inventory-business-documents.service.js';
import { InventoryBalancesService } from '../src/modules/inventory/application/inventory-balances.service.js';
import { InventoryMovementsService } from '../src/modules/inventory/application/inventory-movements.service.js';
import { InventoryPricingService } from '../src/modules/inventory/application/inventory-pricing.service.js';
import { InventoryTransfersService } from '../src/modules/inventory/application/inventory-transfers.service.js';
import { InventoryValuationService } from '../src/modules/inventory/application/inventory-valuation.service.js';
import { UnitConversionsService } from '../src/modules/inventory/application/unit-conversions.service.js';
import { UnitsService } from '../src/modules/inventory/application/units.service.js';
import { WarehousesService } from '../src/modules/inventory/application/warehouses.service.js';
import { OrganizationCalendarTransitionService } from '../src/composition/organization-calendar-transition.service.js';
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

interface LiveDatabaseClient {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
}

interface Fixture {
  organizationId: string;
  branchId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  unitAId: string;
  unitBId: string;
  unitCId: string;
  itemAId: string;
  itemBId: string;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type TransitionOutcome =
  { kind: 'updated'; value: unknown } | { kind: 'rejected'; error: unknown };

describe.skipIf(DATABASE_URL === undefined)(
  'Inventory BusinessDate write/transition contract (live PostgreSQL)',
  () => {
    const suffix = generateId().slice(-8).toLowerCase();
    const applicationName = `vardena-inventory-business-date-${suffix}`;
    const organizationIds: string[] = [];
    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let organizations: OrganizationsService;
    let calendarTransitions: OrganizationCalendarTransitionService;
    let inventoryDocuments: InventoryBusinessDocumentsService;
    let balances: InventoryBalancesService;
    let movements: InventoryMovementsService;
    let transfers: InventoryTransfersService;
    let unitConversions: UnitConversionsService;
    let valuation: InventoryValuationService;
    let pricing: InventoryPricingService;
    let branches: BranchesService;
    let warehouses: WarehousesService;
    let units: UnitsService;
    let items: ItemsService;

    async function createFixture(label: string): Promise<Fixture> {
      const key = `${label}-${generateId().slice(-6).toLowerCase()}`;
      const organization = await organizations.createOrganization({
        code: `BDW-${key}-${suffix}`,
        name: `Business date writes ${key}`,
        calendarSystem: 'GREGORIAN',
        timeZone: 'UTC',
      });
      organizationIds.push(organization.id);
      const branch = await branches.createBranch({
        organizationId: organization.id,
        code: `BR-${key}-${suffix}`,
        name: `Branch ${key}`,
      });
      const source = await warehouses.createWarehouse({
        organizationId: organization.id,
        branchId: branch.id,
        code: `WH-A-${key}-${suffix}`,
        name: `Source ${key}`,
      });
      const destination = await warehouses.createWarehouse({
        organizationId: organization.id,
        branchId: branch.id,
        code: `WH-B-${key}-${suffix}`,
        name: `Destination ${key}`,
      });
      const unitA = await units.createUnit({
        organizationId: organization.id,
        code: `EA-${suffix}`,
        name: `Each ${key}`,
        symbol: 'ea',
      });
      const unitB = await units.createUnit({
        organizationId: organization.id,
        code: `BX-${suffix}`,
        name: `Box ${key}`,
        symbol: 'bx',
      });
      const unitC = await units.createUnit({
        organizationId: organization.id,
        code: `PL-${suffix}`,
        name: `Pallet ${key}`,
        symbol: 'pl',
      });
      const itemA = await items.createItem({
        organizationId: organization.id,
        code: `GOOD-A-${suffix}`,
        name: `Good A ${key}`,
        itemKind: 'goods',
        baseUnitId: unitA.id,
      });
      const itemB = await items.createItem({
        organizationId: organization.id,
        code: `GOOD-B-${suffix}`,
        name: `Good B ${key}`,
        itemKind: 'goods',
        baseUnitId: unitA.id,
      });
      return {
        organizationId: organization.id,
        branchId: branch.id,
        sourceWarehouseId: source.id,
        destinationWarehouseId: destination.id,
        unitAId: unitA.id,
        unitBId: unitB.id,
        unitCId: unitC.id,
        itemAId: itemA.id,
        itemBId: itemB.id,
      };
    }

    function postReceipt(
      fixture: Fixture,
      params: {
        itemId?: string;
        quantity?: string;
        movementDate?: string;
        operationKey?: string;
      } = {},
    ) {
      return movements.postMovement({
        organizationId: fixture.organizationId,
        warehouseId: fixture.sourceWarehouseId,
        itemId: params.itemId ?? fixture.itemAId,
        movementType: 'inbound',
        quantity: params.quantity ?? '10',
        unitId: fixture.unitAId,
        movementDate: params.movementDate ?? '2026-10-01',
        operationKey: params.operationKey ?? `receipt:${generateId()}`,
      });
    }

    function postTransfer(
      fixture: Fixture,
      params: {
        itemId?: string;
        quantity?: string;
        movementDate?: string;
        operationKey?: string;
      } = {},
    ) {
      return transfers.postTransfer({
        organizationId: fixture.organizationId,
        sourceWarehouseId: fixture.sourceWarehouseId,
        destinationWarehouseId: fixture.destinationWarehouseId,
        itemId: params.itemId ?? fixture.itemAId,
        quantity: params.quantity ?? '2',
        unitId: fixture.unitAId,
        movementDate: params.movementDate ?? '2026-10-02',
        operationKey: params.operationKey ?? `transfer:${generateId()}`,
      });
    }

    function startGatedTransition(organizationId: string) {
      const historyRead = deferred<BusinessDate | null>();
      const historyGate = deferred<void>();
      const transition = organizations
        .updateOrganization(
          organizationId,
          { calendarSystem: 'JALALI' },
          async (scopedOrganizationId) => {
            const incompatible =
              await inventoryDocuments.findFirstUnrenderableBusinessDate(
                scopedOrganizationId,
              );
            historyRead.resolve(incompatible);
            await historyGate.promise;
            return incompatible;
          },
        )
        .then<TransitionOutcome, TransitionOutcome>(
          (value) => ({ kind: 'updated', value }),
          (error: unknown) => ({ kind: 'rejected', error }),
        );
      return {
        historyRead: historyRead.promise,
        release: () => historyGate.resolve(),
        result: transition,
      };
    }

    function pauseWriterAtCalendarLock(mode: 'attempt' | 'acquired') {
      const entered = deferred<void>();
      const gate = deferred<void>();
      const original =
        organizations.withBusinessDateWriteLock.bind(organizations);
      let callbackInvoked = false;
      const spy = vi
        .spyOn(organizations, 'withBusinessDateWriteLock')
        .mockImplementation((organizationId, calendarSystem, work) => {
          if (mode === 'attempt') {
            entered.resolve();
            return original(organizationId, calendarSystem, async () => {
              callbackInvoked = true;
              return work();
            });
          }
          return original(organizationId, calendarSystem, async () => {
            entered.resolve();
            await gate.promise;
            callbackInvoked = true;
            return work();
          });
        });
      return {
        entered: entered.promise,
        release: () => gate.resolve(),
        callbackInvoked: () => callbackInvoked,
        restore: () => spy.mockRestore(),
      };
    }

    async function isWaitingForOrganizationLock(
      lockMode: 'FOR UPDATE' | 'FOR SHARE',
    ): Promise<boolean> {
      const client = await prisma.getClient<LiveDatabaseClient>();
      const pattern = `%${lockMode}%`;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const rows = await client.$queryRaw<Array<{ waiting: boolean }>>`
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
        if (rows[0]?.waiting === true) return true;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return false;
    }

    async function movementRows(organizationId: string) {
      const client = await prisma.getClient<LiveDatabaseClient>();
      return client.$queryRaw<
        Array<{
          id: string;
          itemId: string;
          movementType: string;
          movementDate: string;
          operationKey: string;
          transferId: string | null;
          reversalOfMovementId: string | null;
        }>
      >`
        SELECT "id",
               "item_id" AS "itemId",
               "movement_type" AS "movementType",
               "movement_date"::text AS "movementDate",
               "operation_key" AS "operationKey",
               "transfer_id" AS "transferId",
               "reversal_of_movement_id" AS "reversalOfMovementId"
          FROM "inventory"."inventory_movements"
         WHERE "organization_id" = ${organizationId}
         ORDER BY "created_at" ASC, "id" ASC
      `;
    }

    async function countUnitConversions(organizationId: string) {
      const client = await prisma.getClient<LiveDatabaseClient>();
      const rows = await client.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::integer AS "count"
          FROM "inventory"."unit_conversions"
         WHERE "organization_id" = ${organizationId}
      `;
      return rows[0]?.count ?? 0;
    }

    async function countOperations(
      organizationId: string,
      operationKey: string,
    ) {
      const client = await prisma.getClient<LiveDatabaseClient>();
      const rows = await client.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::integer AS "count"
          FROM "inventory"."inventory_operations"
         WHERE "organization_id" = ${organizationId}
           AND "operation_key" = ${operationKey}
      `;
      return rows[0]?.count ?? 0;
    }

    async function balance(
      organizationId: string,
      warehouseId: string,
      itemId: string,
    ) {
      const client = await prisma.getClient<LiveDatabaseClient>();
      const rows = await client.$queryRaw<Array<{ onHand: string }>>`
        SELECT "on_hand"::text AS "onHand"
          FROM "inventory"."inventory_balances"
         WHERE "organization_id" = ${organizationId}
           AND "warehouse_id" = ${warehouseId}
           AND "item_id" = ${itemId}
      `;
      return rows[0]?.onHand ?? '0.0000';
    }

    async function overwriteBalanceOnHand(
      organizationId: string,
      warehouseId: string,
      itemId: string,
      onHand: string,
    ) {
      const client = await prisma.getClient<LiveDatabaseClient>();
      const updated = await client.$executeRaw`
        UPDATE "inventory"."inventory_balances"
           SET "on_hand" = ${onHand}::numeric
         WHERE "organization_id" = ${organizationId}
           AND "warehouse_id" = ${warehouseId}
           AND "item_id" = ${itemId}
      `;
      if (updated !== 1) {
        throw new Error(
          `Expected to corrupt one balance row; updated ${updated}.`,
        );
      }
    }

    async function balanceBusinessDate(
      organizationId: string,
      warehouseId: string,
      itemId: string,
    ): Promise<string | null> {
      const client = await prisma.getClient<LiveDatabaseClient>();
      const rows = await client.$queryRaw<
        Array<{ lastMovementDate: string | null }>
      >`
        SELECT "last_movement_date"::text AS "lastMovementDate"
          FROM "inventory"."inventory_balances"
         WHERE "organization_id" = ${organizationId}
           AND "warehouse_id" = ${warehouseId}
           AND "item_id" = ${itemId}
      `;
      return rows[0]?.lastMovementDate ?? null;
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
      balances = app.get(InventoryBalancesService);
      movements = app.get(InventoryMovementsService);
      transfers = app.get(InventoryTransfersService);
      unitConversions = app.get(UnitConversionsService);
      valuation = app.get(InventoryValuationService);
      pricing = app.get(InventoryPricingService);
      branches = app.get(BranchesService);
      warehouses = app.get(WarehousesService);
      units = app.get(UnitsService);
      items = app.get(ItemsService);
    }, 180_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        const client = await prisma.getClient<LiveDatabaseClient>();
        for (const organizationId of organizationIds) {
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_accounting_posting_snapshot_movements"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_accounting_posting_snapshots"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_accounting_posting_operations"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_business_document_lines"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_business_documents"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_pricing_run_key_outcomes"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_pricing_runs"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_operations"
             WHERE "organization_id" = ${organizationId}
          `;
          // A reversal is a child row in the movement table and the self-FK is
          // ON DELETE RESTRICT. Remove correction rows before their originals.
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_movements"
             WHERE "organization_id" = ${organizationId}
               AND "reversal_of_movement_id" IS NOT NULL
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_movements"
             WHERE "organization_id" = ${organizationId}
               AND "reversal_of_movement_id" IS NULL
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_valuation_states"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_valuation_runs"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_balances"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."inventory_reservations"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."item_valuation_methods"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."item_unit_conversions"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."unit_conversions"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."items"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."warehouses"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "inventory"."units"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "organization"."branches"
             WHERE "organization_id" = ${organizationId}
          `;
          await client.$executeRaw`
            DELETE FROM "organization"."organizations"
             WHERE "id" = ${organizationId}
          `;
        }
      } finally {
        await app.close();
      }
    }, 30_000);

    it('rejects an unrenderable standalone movement in JALALI before creating any ledger state', async () => {
      const fixture = await createFixture('jalali-range');
      await calendarTransitions.updateOrganization(fixture.organizationId, {
        calendarSystem: 'JALALI',
      });

      await expect(
        postReceipt(fixture, {
          movementDate: '4000-01-01',
          operationKey: 'jalali-range-reject',
        }),
      ).rejects.toMatchObject({
        code: 'ValidationFailed',
        details: [{ field: 'movementDate', code: 'business_date_calendar' }],
      });
      expect(await movementRows(fixture.organizationId)).toHaveLength(0);
      expect(
        await countOperations(fixture.organizationId, 'jalali-range-reject'),
      ).toBe(0);
    });

    it('serializes a writer-first standalone movement; the transition sees committed history and retry replays', async () => {
      const fixture = await createFixture('movement-wins');
      const pause = pauseWriterAtCalendarLock('acquired');
      const input = {
        organizationId: fixture.organizationId,
        warehouseId: fixture.sourceWarehouseId,
        itemId: fixture.itemAId,
        movementType: 'inbound',
        quantity: '3',
        unitId: fixture.unitAId,
        movementDate: '4000-01-01',
        operationKey: 'movement-writer-wins',
      } as const;
      const writer = movements.postMovement(input);
      let transitionWaiting = false;
      try {
        await pause.entered;
        const transition = calendarTransitions
          .updateOrganization(fixture.organizationId, {
            calendarSystem: 'JALALI',
          })
          .then<TransitionOutcome, TransitionOutcome>(
            (value) => ({ kind: 'updated', value }),
            (error: unknown) => ({ kind: 'rejected', error }),
          );
        transitionWaiting = await isWaitingForOrganizationLock('FOR UPDATE');
        pause.release();
        const movement = await writer;
        const transitionResult = await transition;

        expect(transitionWaiting).toBe(true);
        expect(movement.movementDate).toBe('4000-01-01');
        expect(transitionResult.kind).toBe('rejected');
        if (transitionResult.kind === 'rejected') {
          expect(transitionResult.error).toMatchObject({
            code: 'BusinessRuleViolation',
            details: {
              code: 'organization.calendar.jalali_history_unrenderable',
              businessDate: '4000-01-01',
            },
          });
        }
        const replay = await movements.postMovement(input);
        expect(replay.id).toBe(movement.id);
        expect(await movementRows(fixture.organizationId)).toHaveLength(1);
        expect(
          await countOperations(fixture.organizationId, 'movement-writer-wins'),
        ).toBe(1);
      } finally {
        pause.release();
        pause.restore();
      }
    });

    it('does not start a stale standalone-movement transaction when the transition wins', async () => {
      const fixture = await createFixture('movement-transition-wins');
      const transition = startGatedTransition(fixture.organizationId);
      const pause = pauseWriterAtCalendarLock('attempt');
      let writerError: unknown;
      let transitionWaiting = false;
      try {
        await expect(transition.historyRead).resolves.toBeNull();
        const writer = movements
          .postMovement({
            organizationId: fixture.organizationId,
            warehouseId: fixture.sourceWarehouseId,
            itemId: fixture.itemAId,
            movementType: 'inbound',
            quantity: '3',
            unitId: fixture.unitAId,
            movementDate: '4000-01-01',
            operationKey: 'movement-transition-wins',
          })
          .catch((error: unknown) => {
            writerError = error;
            return null;
          });
        await pause.entered;
        transitionWaiting = await isWaitingForOrganizationLock('FOR SHARE');
        transition.release();
        const transitionResult = await transition.result;
        await writer;

        expect(transitionWaiting).toBe(true);
        expect(transitionResult.kind).toBe('updated');
        expect(writerError).toMatchObject({
          code: 'Conflict',
          details: {
            code: 'organization.calendar.changed_during_business_date_write',
          },
        });
        expect(pause.callbackInvoked()).toBe(false);
        expect(await movementRows(fixture.organizationId)).toHaveLength(0);
        expect(
          await countOperations(
            fixture.organizationId,
            'movement-transition-wins',
          ),
        ).toBe(0);
      } finally {
        transition.release();
        pause.release();
        pause.restore();
      }
    });

    it('surfaces an outer-transaction error after Inventory commit, and a keyed retry replays without duplicating the movement', async () => {
      const fixture = await createFixture('outer-transaction-failure');
      const input = {
        organizationId: fixture.organizationId,
        warehouseId: fixture.sourceWarehouseId,
        itemId: fixture.itemAId,
        movementType: 'inbound',
        quantity: '3',
        unitId: fixture.unitAId,
        movementDate: '2026-10-01',
        operationKey: 'outer-commit-failure-retry',
      } as const;
      const injectedFailure = new Error(
        'Injected failure after the Inventory-local commit.',
      );
      const original =
        organizations.withBusinessDateWriteLock.bind(organizations);
      const lockSpy = vi
        .spyOn(organizations, 'withBusinessDateWriteLock')
        .mockImplementationOnce((organizationId, calendarSystem, work) =>
          original(organizationId, calendarSystem, async () => {
            await work();
            throw injectedFailure;
          }),
        );

      try {
        await expect(movements.postMovement(input)).rejects.toMatchObject({
          message: injectedFailure.message,
        });
        expect(await movementRows(fixture.organizationId)).toHaveLength(1);
        expect(
          await countOperations(fixture.organizationId, input.operationKey),
        ).toBe(1);
        expect(
          await balance(
            fixture.organizationId,
            fixture.sourceWarehouseId,
            fixture.itemAId,
          ),
        ).toBe('3.0000');

        const retry = await movements.postMovement(input);
        expect(retry.operationKey).toBe(input.operationKey);
        expect(await movementRows(fixture.organizationId)).toHaveLength(1);
        expect(
          await countOperations(fixture.organizationId, input.operationKey),
        ).toBe(1);
      } finally {
        lockSpy.mockRestore();
      }
    });

    it('serializes an effective-dated unit-conversion version before validating the calendar transition', async () => {
      const fixture = await createFixture('conversion-wins');
      const pause = pauseWriterAtCalendarLock('acquired');
      const writer = unitConversions.createConversion({
        organizationId: fixture.organizationId,
        fromUnitId: fixture.unitAId,
        toUnitId: fixture.unitBId,
        factor: '12',
        validFrom: '4000-01-01',
      });
      let transitionWaiting = false;
      try {
        await pause.entered;
        const transition = calendarTransitions
          .updateOrganization(fixture.organizationId, {
            calendarSystem: 'JALALI',
          })
          .then<TransitionOutcome, TransitionOutcome>(
            (value) => ({ kind: 'updated', value }),
            (error: unknown) => ({ kind: 'rejected', error }),
          );
        transitionWaiting = await isWaitingForOrganizationLock('FOR UPDATE');
        pause.release();
        const conversion = await writer;
        const transitionResult = await transition;

        expect(transitionWaiting).toBe(true);
        expect(conversion.validFrom).toBe('4000-01-01');
        expect(transitionResult.kind).toBe('rejected');
        if (transitionResult.kind === 'rejected') {
          expect(transitionResult.error).toMatchObject({
            code: 'BusinessRuleViolation',
            details: {
              code: 'organization.calendar.jalali_history_unrenderable',
              businessDate: '4000-01-01',
            },
          });
        }
        expect(await countUnitConversions(fixture.organizationId)).toBe(1);
      } finally {
        pause.release();
        pause.restore();
      }
    });

    it('commits both transfer legs together and rejects reversing only one leg', async () => {
      const fixture = await createFixture('transfer-pair');
      await postReceipt(fixture, { quantity: '10' });
      const transfer = await postTransfer(fixture, { quantity: '2' });

      expect(transfer.outLeg.transferId).toBe(transfer.transferId);
      expect(transfer.inLeg.transferId).toBe(transfer.transferId);
      const before = await movementRows(fixture.organizationId);
      expect(before).toHaveLength(3);
      await expect(
        movements.reverseMovement(fixture.organizationId, transfer.outLeg.id, {
          operationKey: 'forbidden-single-transfer-leg-reversal',
          movementDate: '2026-10-03',
        }),
      ).rejects.toMatchObject({
        code: 'Conflict',
        details: {
          code: 'inventory.transfer.reverse_pair_required',
          transferId: transfer.transferId,
          movementId: transfer.outLeg.id,
        },
      });
      expect(await movementRows(fixture.organizationId)).toHaveLength(3);
      expect(
        await countOperations(
          fixture.organizationId,
          'forbidden-single-transfer-leg-reversal',
        ),
      ).toBe(0);
      expect(
        await balance(
          fixture.organizationId,
          fixture.sourceWarehouseId,
          fixture.itemAId,
        ),
      ).toBe('8.0000');
      expect(
        await balance(
          fixture.organizationId,
          fixture.destinationWarehouseId,
          fixture.itemAId,
        ),
      ).toBe('2.0000');
    });

    it('serializes a writer-first transfer as one atomic two-leg write before transition validation', async () => {
      const fixture = await createFixture('transfer-wins');
      await postReceipt(fixture, { quantity: '10' });
      const pause = pauseWriterAtCalendarLock('acquired');
      const input = {
        organizationId: fixture.organizationId,
        sourceWarehouseId: fixture.sourceWarehouseId,
        destinationWarehouseId: fixture.destinationWarehouseId,
        itemId: fixture.itemAId,
        quantity: '2',
        unitId: fixture.unitAId,
        movementDate: '4000-01-01',
        operationKey: 'transfer-writer-wins',
      } as const;
      const writer = transfers.postTransfer(input);
      let transitionWaiting = false;
      try {
        await pause.entered;
        const transition = calendarTransitions
          .updateOrganization(fixture.organizationId, {
            calendarSystem: 'JALALI',
          })
          .then<TransitionOutcome, TransitionOutcome>(
            (value) => ({ kind: 'updated', value }),
            (error: unknown) => ({ kind: 'rejected', error }),
          );
        transitionWaiting = await isWaitingForOrganizationLock('FOR UPDATE');
        pause.release();
        const result = await writer;
        const transitionResult = await transition;

        expect(transitionWaiting).toBe(true);
        expect(result.outLeg.transferId).toBe(result.transferId);
        expect(result.inLeg.transferId).toBe(result.transferId);
        expect(transitionResult.kind).toBe('rejected');
        if (transitionResult.kind === 'rejected') {
          expect(transitionResult.error).toMatchObject({
            code: 'BusinessRuleViolation',
            details: {
              code: 'organization.calendar.jalali_history_unrenderable',
              businessDate: '4000-01-01',
            },
          });
        }
        const legs = (await movementRows(fixture.organizationId)).filter(
          (row) => row.transferId === result.transferId,
        );
        expect(legs).toHaveLength(2);
        expect(legs.map((row) => row.movementType).sort()).toEqual([
          'transfer_in',
          'transfer_out',
        ]);
        expect(
          await countOperations(fixture.organizationId, input.operationKey),
        ).toBe(1);
        const replay = await transfers.postTransfer(input);
        expect(replay.transferId).toBe(result.transferId);
        expect(
          (await movementRows(fixture.organizationId)).filter(
            (row) => row.transferId === result.transferId,
          ),
        ).toHaveLength(2);
      } finally {
        pause.release();
        pause.restore();
      }
    });

    it('rejects a transition-first transfer before either transfer leg or balance change starts', async () => {
      const fixture = await createFixture('transfer-transition-wins');
      await postReceipt(fixture, { quantity: '10' });
      const transition = startGatedTransition(fixture.organizationId);
      const pause = pauseWriterAtCalendarLock('attempt');
      let writerError: unknown;
      let transitionWaiting = false;
      try {
        await expect(transition.historyRead).resolves.toBeNull();
        const input = {
          organizationId: fixture.organizationId,
          sourceWarehouseId: fixture.sourceWarehouseId,
          destinationWarehouseId: fixture.destinationWarehouseId,
          itemId: fixture.itemAId,
          quantity: '2',
          unitId: fixture.unitAId,
          movementDate: '4000-01-01',
          operationKey: 'transfer-transition-wins',
        } as const;
        const writer = transfers.postTransfer(input).catch((error: unknown) => {
          writerError = error;
          return null;
        });
        await pause.entered;
        transitionWaiting = await isWaitingForOrganizationLock('FOR SHARE');
        transition.release();
        const transitionResult = await transition.result;
        await writer;

        expect(transitionWaiting).toBe(true);
        expect(transitionResult.kind).toBe('updated');
        expect(writerError).toMatchObject({
          code: 'Conflict',
          details: {
            code: 'organization.calendar.changed_during_business_date_write',
          },
        });
        expect(pause.callbackInvoked()).toBe(false);
        expect(await movementRows(fixture.organizationId)).toHaveLength(1);
        expect(
          await countOperations(
            fixture.organizationId,
            'transfer-transition-wins',
          ),
        ).toBe(0);
        expect(
          await balance(
            fixture.organizationId,
            fixture.sourceWarehouseId,
            fixture.itemAId,
          ),
        ).toBe('10.0000');
        expect(
          await balance(
            fixture.organizationId,
            fixture.destinationWarehouseId,
            fixture.itemAId,
          ),
        ).toBe('0');
      } finally {
        transition.release();
        pause.release();
        pause.restore();
      }
    });

    it('rolls back a losing paired transfer after its late idempotency insert conflict, and the winner replays', async () => {
      const fixture = await createFixture('transfer-idempotency-race');
      await postReceipt(fixture, {
        itemId: fixture.itemAId,
        quantity: '10',
      });
      await postReceipt(fixture, {
        itemId: fixture.itemBId,
        quantity: '10',
      });

      const bothHaveCalendarLock = deferred<void>();
      const releaseTransactions = deferred<void>();
      const original =
        organizations.withBusinessDateWriteLock.bind(organizations);
      let acquired = 0;
      const lockSpy = vi
        .spyOn(organizations, 'withBusinessDateWriteLock')
        .mockImplementation((organizationId, calendarSystem, work) =>
          original(organizationId, calendarSystem, async () => {
            acquired += 1;
            if (acquired === 2) bothHaveCalendarLock.resolve();
            await releaseTransactions.promise;
            return work();
          }),
        );
      const sharedOperationKey = 'competing-transfer-operation-key';
      const inputs = [fixture.itemAId, fixture.itemBId].map((itemId) => ({
        organizationId: fixture.organizationId,
        sourceWarehouseId: fixture.sourceWarehouseId,
        destinationWarehouseId: fixture.destinationWarehouseId,
        itemId,
        quantity: '2',
        unitId: fixture.unitAId,
        movementDate: '2026-10-02',
        operationKey: sharedOperationKey,
      }));
      try {
        const requests = inputs.map((input) =>
          transfers.postTransfer(input).then(
            (value) => ({ kind: 'fulfilled' as const, value }),
            (error: unknown) => ({ kind: 'rejected' as const, error }),
          ),
        );
        await bothHaveCalendarLock.promise;
        releaseTransactions.resolve();
        const results = await Promise.all(requests);
        const winners = results.filter((result) => result.kind === 'fulfilled');
        const losers = results.filter((result) => result.kind === 'rejected');
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        if (losers[0]?.kind === 'rejected') {
          expect(losers[0].error).toMatchObject({ code: 'Conflict' });
        }
        const winner = winners[0];
        if (winner?.kind !== 'fulfilled') {
          throw new Error('Expected one competing transfer to commit.');
        }
        const rows = (await movementRows(fixture.organizationId)).filter(
          (row) => row.operationKey === sharedOperationKey,
        );
        expect(rows).toHaveLength(2);
        expect(rows[0]!.transferId).toBe(winner.value.transferId);
        expect(rows[1]!.transferId).toBe(winner.value.transferId);
        expect(rows.map((row) => row.movementType).sort()).toEqual([
          'transfer_in',
          'transfer_out',
        ]);
        expect(
          await countOperations(fixture.organizationId, sharedOperationKey),
        ).toBe(1);

        const winnerInput = inputs.find(
          (input) => input.itemId === winner.value.outLeg.itemId,
        );
        if (winnerInput === undefined) {
          throw new Error('Could not resolve the winning transfer input.');
        }
        const replay = await transfers.postTransfer(winnerInput);
        expect(replay.transferId).toBe(winner.value.transferId);
        expect(
          (await movementRows(fixture.organizationId)).filter(
            (row) => row.operationKey === sharedOperationKey,
          ),
        ).toHaveLength(2);
        const losingItemId = inputs.find(
          (input) => input.itemId !== winner.value.outLeg.itemId,
        )!.itemId;
        expect(
          await balance(
            fixture.organizationId,
            fixture.sourceWarehouseId,
            losingItemId,
          ),
        ).toBe('10.0000');
        expect(
          await balance(
            fixture.organizationId,
            fixture.destinationWarehouseId,
            losingItemId,
          ),
        ).toBe('0');
      } finally {
        releaseTransactions.resolve();
        lockSpy.mockRestore();
      }
    });

    it('locks standalone reversal writes, enforces paired-transfer reversal, and blocks an out-of-range reversal on transition', async () => {
      const fixture = await createFixture('reversal');
      const original = await postReceipt(fixture, {
        quantity: '5',
        movementDate: '2026-10-01',
        operationKey: 'reversal-source-receipt',
      });
      const reversalInput = {
        operationKey: 'standalone-reversal-4000',
        movementDate: '4000-01-01',
      } as const;
      const reversal = await movements.reverseMovement(
        fixture.organizationId,
        original.id,
        reversalInput,
      );
      expect(reversal.reversalOfMovementId).toBe(original.id);
      expect(reversal.movementDate).toBe('4000-01-01');
      const replay = await movements.reverseMovement(
        fixture.organizationId,
        original.id,
        reversalInput,
      );
      expect(replay.id).toBe(reversal.id);

      await expect(
        calendarTransitions.updateOrganization(fixture.organizationId, {
          calendarSystem: 'JALALI',
        }),
      ).rejects.toMatchObject({
        code: 'BusinessRuleViolation',
        details: {
          code: 'organization.calendar.jalali_history_unrenderable',
          businessDate: '4000-01-01',
        },
      });
      expect(await movementRows(fixture.organizationId)).toHaveLength(2);
      expect(
        await countOperations(
          fixture.organizationId,
          reversalInput.operationKey,
        ),
      ).toBe(1);
    });

    it('serializes balance rebuild per key and safely retries after a transition commits between keys', async () => {
      const fixture = await createFixture('balance-rebuild-transition');
      await postReceipt(fixture, {
        itemId: fixture.itemAId,
        operationKey: 'balance-rebuild-first-key-source',
      });
      await postReceipt(fixture, {
        itemId: fixture.itemBId,
        operationKey: 'balance-rebuild-second-key-source',
      });
      const orderedItems = [fixture.itemAId, fixture.itemBId].sort(
        (left, right) =>
          `${fixture.sourceWarehouseId}|${left}`.localeCompare(
            `${fixture.sourceWarehouseId}|${right}`,
          ),
      );
      const [firstItemId, secondItemId] = orderedItems;
      if (firstItemId === undefined || secondItemId === undefined) {
        throw new Error('Expected two fixture items for the rebuild batch.');
      }
      await overwriteBalanceOnHand(
        fixture.organizationId,
        fixture.sourceWarehouseId,
        firstItemId,
        '99',
      );
      await overwriteBalanceOnHand(
        fixture.organizationId,
        fixture.sourceWarehouseId,
        secondItemId,
        '88',
      );

      const pause = pauseWriterAtCalendarLock('acquired');
      const rebuild = balances
        .rebuild({ organizationId: fixture.organizationId })
        .then(
          (value) => ({ kind: 'rebuilt' as const, value }),
          (error: unknown) => ({ kind: 'rejected' as const, error }),
        );
      let transition: ReturnType<typeof startGatedTransition> | null = null;
      let transitionWaited = false;
      let nextKeyWaited = false;
      try {
        await pause.entered;
        transition = startGatedTransition(fixture.organizationId);
        transitionWaited = await isWaitingForOrganizationLock('FOR UPDATE');
        pause.release();

        // The first key commits, then the transition takes FOR UPDATE and
        // pauses after its complete history read. The rebuild's next key must
        // queue behind that lock rather than reuse the stale captured calendar.
        await expect(transition.historyRead).resolves.toBeNull();
        nextKeyWaited = await isWaitingForOrganizationLock('FOR SHARE');
        transition.release();

        const [transitionResult, rebuildResult] = await Promise.all([
          transition.result,
          rebuild,
        ]);
        expect(transitionWaited).toBe(true);
        expect(nextKeyWaited).toBe(true);
        expect(transitionResult).toMatchObject({
          kind: 'updated',
          value: { calendarSystem: 'JALALI' },
        });
        expect(rebuildResult.kind).toBe('rejected');
        if (rebuildResult.kind === 'rejected') {
          expect(rebuildResult.error).toMatchObject({
            code: 'Conflict',
            details: {
              code: 'organization.calendar.changed_during_business_date_write',
              completedKeys: 1,
              totalKeys: 2,
              retrySafe: true,
            },
          });
        }

        expect(
          await balance(
            fixture.organizationId,
            fixture.sourceWarehouseId,
            firstItemId,
          ),
        ).toBe('10.0000');
        expect(
          await balance(
            fixture.organizationId,
            fixture.sourceWarehouseId,
            secondItemId,
          ),
        ).toBe('88.0000');
        expect(
          await balanceBusinessDate(
            fixture.organizationId,
            fixture.sourceWarehouseId,
            firstItemId,
          ),
        ).toBe('2026-10-01');

        // A retry captures JALALI, sees the current calendar under each key
        // lock, and completes idempotently: the first key is already correct.
        const retry = await balances.rebuild({
          organizationId: fixture.organizationId,
        });
        expect(retry).toMatchObject({ checked: 2, rebuilt: 1 });
        expect(
          retry.corrections.map((correction) => correction.itemId),
        ).toEqual([secondItemId]);
        expect(
          await balance(
            fixture.organizationId,
            fixture.sourceWarehouseId,
            firstItemId,
          ),
        ).toBe('10.0000');
        expect(
          await balance(
            fixture.organizationId,
            fixture.sourceWarehouseId,
            secondItemId,
          ),
        ).toBe('10.0000');
      } finally {
        transition?.release();
        pause.release();
        pause.restore();
      }
    });

    it('retries the full balance-rebuild scope after an outer lock transaction fails post-Inventory commit', async () => {
      const fixture = await createFixture('balance-rebuild-outer-failure');
      await postReceipt(fixture, {
        operationKey: 'balance-rebuild-outer-failure-source',
      });
      await overwriteBalanceOnHand(
        fixture.organizationId,
        fixture.sourceWarehouseId,
        fixture.itemAId,
        '99',
      );

      const injectedFailure = new Error(
        'Injected Organization transaction failure after the Inventory-local commit.',
      );
      const original =
        organizations.withBusinessDateWriteLock.bind(organizations);
      const lockSpy = vi
        .spyOn(organizations, 'withBusinessDateWriteLock')
        .mockImplementationOnce((organizationId, calendarSystem, work) =>
          original(organizationId, calendarSystem, async () => {
            await work();
            throw injectedFailure;
          }),
        );

      try {
        await expect(
          balances.rebuild({ organizationId: fixture.organizationId }),
        ).rejects.toMatchObject({ message: injectedFailure.message });
        // The Inventory key committed even though the outer Organization
        // callback failed; a full-scope retry must converge without duplicating
        // a row or reporting a second correction.
        expect(
          await balance(
            fixture.organizationId,
            fixture.sourceWarehouseId,
            fixture.itemAId,
          ),
        ).toBe('10.0000');

        const retry = await balances.rebuild({
          organizationId: fixture.organizationId,
        });
        expect(retry).toMatchObject({
          checked: 1,
          rebuilt: 0,
          corrections: [],
        });
        expect(
          await balance(
            fixture.organizationId,
            fixture.sourceWarehouseId,
            fixture.itemAId,
          ),
        ).toBe('10.0000');
      } finally {
        lockSpy.mockRestore();
      }
    });

    it('scans all Inventory-owned BusinessDate columns and returns the earliest tenant-scoped history day', async () => {
      const fixture = await createFixture('history-sources');
      const firstOutOfRange = async (expected: string) => {
        await expect(
          inventoryDocuments.findFirstUnrenderableBusinessDate(
            fixture.organizationId,
          ),
        ).resolves.toBe(expected);
      };

      await unitConversions.createConversion({
        organizationId: fixture.organizationId,
        fromUnitId: fixture.unitAId,
        toUnitId: fixture.unitBId,
        factor: '12',
        validFrom: '4000-01-01',
      });
      await firstOutOfRange('4000-01-01');

      await unitConversions.createConversion({
        organizationId: fixture.organizationId,
        fromUnitId: fixture.unitBId,
        toUnitId: fixture.unitCId,
        factor: '8',
        validFrom: '2026-01-01',
        validTo: '3990-01-01',
      });
      await firstOutOfRange('3990-01-01');

      await unitConversions.createConversion({
        organizationId: fixture.organizationId,
        itemId: fixture.itemAId,
        fromUnitId: fixture.unitAId,
        toUnitId: fixture.unitCId,
        factor: '4',
        validFrom: '3980-01-01',
      });
      await firstOutOfRange('3980-01-01');

      await unitConversions.createConversion({
        organizationId: fixture.organizationId,
        itemId: fixture.itemAId,
        fromUnitId: fixture.unitBId,
        toUnitId: fixture.unitAId,
        factor: '2',
        validFrom: '2026-01-01',
        validTo: '3970-01-01',
      });
      await firstOutOfRange('3970-01-01');

      await valuation.configureMethod({
        organizationId: fixture.organizationId,
        itemId: fixture.itemAId,
        method: 'moving_weighted_average',
        validFrom: '3960-01-01',
      });
      await firstOutOfRange('3960-01-01');
      await valuation.configureMethod({
        organizationId: fixture.organizationId,
        itemId: fixture.itemBId,
        method: 'moving_weighted_average',
        validFrom: '2026-01-01',
        validTo: '3950-01-01',
      });
      await firstOutOfRange('3950-01-01');

      await valuation.recalculate({
        organizationId: fixture.organizationId,
        warehouseId: fixture.sourceWarehouseId,
        itemId: fixture.itemAId,
        operationKey: 'history-valuation-run',
        trigger: 'manual',
        fromDate: '3940-01-01',
      });
      await firstOutOfRange('3940-01-01');

      await pricing.runPricing({
        organizationId: fixture.organizationId,
        operationKey: 'history-pricing-run',
        documentKinds: ['receipt'],
        toDate: '3930-01-01',
      });
      await firstOutOfRange('3930-01-01');

      await postReceipt(fixture, {
        movementDate: '3920-01-01',
        operationKey: 'history-standalone-movement',
      });
      await firstOutOfRange('3920-01-01');

      const document = await inventoryDocuments.createDraft({
        organizationId: fixture.organizationId,
        kind: 'receipt',
        warehouseId: fixture.sourceWarehouseId,
        businessDate: '3910-01-01',
        lines: [
          {
            itemId: fixture.itemBId,
            quantity: '1',
            unitId: fixture.unitAId,
          },
        ],
      });
      await firstOutOfRange('3910-01-01');

      // Corruption probes prove the guard also checks the materialized balance
      // and immutable posting snapshot date columns, not just their sources.
      const client = await prisma.getClient<LiveDatabaseClient>();
      await client.$executeRaw`
        UPDATE "inventory"."inventory_balances"
           SET "last_movement_date" = '3900-01-01'::date
         WHERE "organization_id" = ${fixture.organizationId}
           AND "warehouse_id" = ${fixture.sourceWarehouseId}
           AND "item_id" = ${fixture.itemAId}
      `;
      await firstOutOfRange('3900-01-01');

      const operationId = generateId();
      const snapshotId = generateId();
      const now = new Date();
      await client.$executeRaw`
        INSERT INTO "inventory"."inventory_accounting_posting_operations" (
          "id", "organization_id", "document_id", "action", "operation_key",
          "request_hash", "document_version", "posting_mode", "state",
          "actor_permission", "requested_at", "created_at", "updated_at"
        ) VALUES (
          ${operationId}, ${fixture.organizationId}, ${document.id},
          'accounting_post', ${`history-snapshot-${suffix}`}, ${'0'.repeat(64)},
          'fixture-version', 'direct_final', 'POSTED',
          'Inventory.Document.AccountingPost', ${now}, ${now}, ${now}
        )
      `;
      await client.$executeRaw`
        INSERT INTO "inventory"."inventory_accounting_posting_snapshots" (
          "id", "organization_id", "operation_id", "document_id",
          "document_type", "document_version", "document_date", "branch_id",
          "warehouse_id", "valuation_state", "valuation_stale", "stale_verdict",
          "valuation_basis", "total_value", "captured_at", "created_at"
        ) VALUES (
          ${snapshotId}, ${fixture.organizationId}, ${operationId}, ${document.id},
          'inventory_receipt', 'fixture-version', '3910-01-01'::date,
          ${fixture.branchId}, ${fixture.sourceWarehouseId}, 'pending_cost',
          false, 'not_stale', 'entered_cost', 0, ${now}, ${now}
        )
      `;
      await client.$executeRaw`
        UPDATE "inventory"."inventory_accounting_posting_snapshots"
           SET "document_date" = '3880-01-01'::date
         WHERE "id" = ${snapshotId}
      `;
      await firstOutOfRange('3880-01-01');

      await expect(
        calendarTransitions.updateOrganization(fixture.organizationId, {
          calendarSystem: 'JALALI',
        }),
      ).rejects.toMatchObject({
        code: 'BusinessRuleViolation',
        details: {
          code: 'organization.calendar.jalali_history_unrenderable',
          businessDate: '3880-01-01',
          supportedGregorianRange: {
            minimum: '0621-03-21',
            maximum: '3798-12-31',
          },
        },
      });
    });

    it('allows another tenant to transition independently of an incompatible Inventory date', async () => {
      const incompatible = await createFixture('tenant-history-source');
      const isolated = await createFixture('tenant-history-isolated');
      await postReceipt(incompatible, {
        movementDate: '4000-01-01',
        operationKey: 'tenant-scoped-out-of-range-movement',
      });

      await expect(
        calendarTransitions.updateOrganization(isolated.organizationId, {
          calendarSystem: 'JALALI',
        }),
      ).resolves.toMatchObject({ calendarSystem: 'JALALI' });
      await expect(
        calendarTransitions.updateOrganization(incompatible.organizationId, {
          calendarSystem: 'JALALI',
        }),
      ).rejects.toMatchObject({
        code: 'BusinessRuleViolation',
        details: {
          businessDate: '4000-01-01',
        },
      });
    });
  },
);
