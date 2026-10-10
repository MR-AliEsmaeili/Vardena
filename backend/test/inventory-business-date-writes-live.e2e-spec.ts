import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { BranchesService } from '../src/modules/organization/application/branches.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { ItemsService } from '../src/modules/inventory/application/items.service.js';
import { InventoryBusinessDocumentsService } from '../src/modules/inventory/application/inventory-business-documents.service.js';
import { InventoryBalancesService } from '../src/modules/inventory/application/inventory-balances.service.js';
import { InventoryMovementsService } from '../src/modules/inventory/application/inventory-movements.service.js';
import { InventoryTransfersService } from '../src/modules/inventory/application/inventory-transfers.service.js';
import { UnitConversionsService } from '../src/modules/inventory/application/unit-conversions.service.js';
import { InventoryMovementsRepository } from '../src/modules/inventory/data/inventory-movements.repository.js';
import { UnitsService } from '../src/modules/inventory/application/units.service.js';
import { WarehousesService } from '../src/modules/inventory/application/warehouses.service.js';
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

describe.skipIf(DATABASE_URL === undefined)(
  'Inventory BusinessDate persistence and write contracts (live PostgreSQL)',
  () => {
    const suffix = generateId().slice(-8).toLowerCase();
    const applicationName = `vardena-inventory-business-date-${suffix}`;
    const organizationIds: string[] = [];
    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let organizations: OrganizationsService;
    let inventoryDocuments: InventoryBusinessDocumentsService;
    let balances: InventoryBalancesService;
    let movements: InventoryMovementsService;
    let transfers: InventoryTransfersService;
    let unitConversions: UnitConversionsService;
    let branches: BranchesService;
    let warehouses: WarehousesService;
    let units: UnitsService;
    let items: ItemsService;

    async function createFixture(label: string): Promise<Fixture> {
      const key = `${label}-${generateId().slice(-6).toLowerCase()}`;
      const organization = await organizations.createOrganization({
        code: `BDW-${key}-${suffix}`,
        name: `Business date writes ${key}`,
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
      inventoryDocuments = app.get(InventoryBusinessDocumentsService);
      balances = app.get(InventoryBalancesService);
      movements = app.get(InventoryMovementsService);
      transfers = app.get(InventoryTransfersService);
      unitConversions = app.get(UnitConversionsService);
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

    it('persists canonical BusinessDates as PostgreSQL DATE across documents, movements, and versioned configuration', async () => {
      const fixture = await createFixture('canonical-date-persistence');
      const document = await inventoryDocuments.createDraft({
        organizationId: fixture.organizationId,
        kind: 'receipt',
        warehouseId: fixture.sourceWarehouseId,
        businessDate: '0600-01-01',
        lines: [
          { itemId: fixture.itemAId, quantity: '1', unitId: fixture.unitAId },
        ],
      });
      expect(document.businessDate).toBe('0600-01-01');
      expect(document.businessDateCalendar).toEqual({
        gregorian: '0600-01-01',
        jalali: null,
      });

      const movement = await postReceipt(fixture, {
        movementDate: '5000-01-01',
        operationKey: 'canonical-date-persistence-movement',
      });
      expect(movement.movementDate).toBe('5000-01-01');

      const conversion = await unitConversions.createConversion({
        organizationId: fixture.organizationId,
        fromUnitId: fixture.unitAId,
        toUnitId: fixture.unitBId,
        factor: '12',
        validFrom: '0600-01-01',
      });
      expect(conversion.validFrom).toBe('0600-01-01');

      const client = await prisma.getClient<LiveDatabaseClient>();
      const documents = await client.$queryRaw<
        Array<{ businessDate: string; columnType: string }>
      >`
        SELECT "business_date"::text AS "businessDate",
               pg_typeof("business_date")::text AS "columnType"
          FROM "inventory"."inventory_business_documents"
         WHERE "id" = ${document.id}
      `;
      const movementsRows = await client.$queryRaw<
        Array<{ movementDate: string; columnType: string }>
      >`
        SELECT "movement_date"::text AS "movementDate",
               pg_typeof("movement_date")::text AS "columnType"
          FROM "inventory"."inventory_movements"
         WHERE "id" = ${movement.id}
      `;
      const conversions = await client.$queryRaw<
        Array<{ validFrom: string; columnType: string }>
      >`
        SELECT "valid_from"::text AS "validFrom",
               pg_typeof("valid_from")::text AS "columnType"
          FROM "inventory"."unit_conversions"
         WHERE "id" = ${conversion.id}
      `;

      expect(documents).toEqual([
        { businessDate: '0600-01-01', columnType: 'date' },
      ]);
      expect(movementsRows).toEqual([
        { movementDate: '5000-01-01', columnType: 'date' },
      ]);
      expect(conversions).toEqual([
        { validFrom: '0600-01-01', columnType: 'date' },
      ]);
    });

    it('commits both transfer legs together and rejects reversing only one leg', async () => {
      const fixture = await createFixture('transfer-pair');
      await postReceipt(fixture, { quantity: '10' });
      const transfer = await postTransfer(fixture, { quantity: '2' });

      expect(transfer.outLeg.transferId).toBe(transfer.transferId);
      expect(transfer.inLeg.transferId).toBe(transfer.transferId);
      expect(await movementRows(fixture.organizationId)).toHaveLength(3);
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

    it('rolls back one of two competing transfers with the same operation key and replays the winner', async () => {
      const fixture = await createFixture('transfer-idempotency-race');
      await postReceipt(fixture, { itemId: fixture.itemAId, quantity: '10' });
      await postReceipt(fixture, { itemId: fixture.itemBId, quantity: '10' });

      const movementRepository = app!.get(InventoryMovementsRepository);
      const bothAtRepository = deferred<void>();
      const releaseTransactions = deferred<void>();
      const originalPostTransfer =
        movementRepository.postTransfer.bind(movementRepository);
      let calls = 0;
      const transferSpy = vi
        .spyOn(movementRepository, 'postTransfer')
        .mockImplementation(async (input, transaction) => {
          // Pause both service requests immediately before their own database
          // transactions. This preserves the unrelated idempotency race proof
          // without borrowing Organization's removed calendar lock.
          if (transaction === undefined) {
            calls += 1;
            if (calls === 2) bothAtRepository.resolve();
            await releaseTransactions.promise;
          }
          return originalPostTransfer(input, transaction);
        });
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
        await bothAtRepository.promise;
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
        expect(rows.map((row) => row.transferId)).toEqual([
          winner.value.transferId,
          winner.value.transferId,
        ]);
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
        ).toBe('0.0000');
      } finally {
        releaseTransactions.resolve();
        transferSpy.mockRestore();
      }
    });

    it('persists and replays a standalone reversal dated as a canonical BusinessDate', async () => {
      const fixture = await createFixture('standalone-reversal');
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
      expect(await movementRows(fixture.organizationId)).toHaveLength(2);
      expect(
        await countOperations(
          fixture.organizationId,
          reversalInput.operationKey,
        ),
      ).toBe(1);
    });

    it('rebuilds an out-of-sync balance from canonical movement dates in PostgreSQL', async () => {
      const fixture = await createFixture('balance-rebuild-date');
      await postReceipt(fixture, {
        movementDate: '5000-01-01',
        operationKey: 'balance-rebuild-date-source',
      });
      await overwriteBalanceOnHand(
        fixture.organizationId,
        fixture.sourceWarehouseId,
        fixture.itemAId,
        '99',
      );

      const report = await balances.rebuild({
        organizationId: fixture.organizationId,
      });
      expect(report).toMatchObject({ checked: 1, rebuilt: 1 });
      expect(
        await balance(
          fixture.organizationId,
          fixture.sourceWarehouseId,
          fixture.itemAId,
        ),
      ).toBe('10.0000');
      expect(
        await balanceBusinessDate(
          fixture.organizationId,
          fixture.sourceWarehouseId,
          fixture.itemAId,
        ),
      ).toBe('5000-01-01');
    });
  },
);
