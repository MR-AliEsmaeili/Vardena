import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { InventoryKardexRepository } from '../src/modules/inventory/data/inventory-kardex.repository.js';
import { createTestApp } from './support/test-app.js';

const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Inventory quantity Kardex (live database)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let repository: InventoryKardexRepository;
    const ids = {
      org: generateId(),
      branch: generateId(),
      unit: generateId(),
      item: generateId(),
      warehouse: generateId(),
    };
    const movementIds: string[] = [];

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue(loadAppConfig({ DATABASE_URL: DATABASE_URL! })),
      });
      app = built.app;
      prisma = app.get(PrismaService);
      repository = app.get(InventoryKardexRepository);
      const db = await prisma.getClient<{
        $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<unknown>;
      }>();
      await db.$executeRawUnsafe(
        'INSERT INTO organization.organizations (id, code, name) VALUES ($1,$2,$3)',
        ids.org,
        `K-${ids.org}`,
        'Kardex',
      );
      await db.$executeRawUnsafe(
        'INSERT INTO organization.branches (id, organization_id, code, name) VALUES ($1,$2,$3,$4)',
        ids.branch,
        ids.org,
        `B-${ids.branch}`,
        'Branch',
      );
      await db.$executeRawUnsafe(
        'INSERT INTO inventory.units (id, organization_id, code, name) VALUES ($1,$2,$3,$4)',
        ids.unit,
        ids.org,
        `U-${ids.unit}`,
        'Unit',
      );
      await db.$executeRawUnsafe(
        "INSERT INTO inventory.items (id, organization_id, code, name, item_kind, base_unit_id, is_stockable, is_purchasable, is_sellable, is_valued) VALUES ($1,$2,$3,$4,'goods',$5,true,false,false,false)",
        ids.item,
        ids.org,
        `I-${ids.item}`,
        'Item',
        ids.unit,
      );
      await db.$executeRawUnsafe(
        'INSERT INTO inventory.warehouses (id, organization_id, branch_id, code, name, allow_negative_stock) VALUES ($1,$2,$3,$4,$5,true)',
        ids.warehouse,
        ids.org,
        ids.branch,
        `W-${ids.warehouse}`,
        'Warehouse',
      );
    });

    afterAll(async () => {
      const db = await prisma.getClient<{
        $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<unknown>;
      }>();
      await db.$executeRawUnsafe(
        'DELETE FROM inventory.inventory_movements WHERE organization_id=$1',
        ids.org,
      );
      await db.$executeRawUnsafe(
        'DELETE FROM inventory.warehouses WHERE id=$1',
        ids.warehouse,
      );
      await db.$executeRawUnsafe(
        'DELETE FROM inventory.items WHERE id=$1',
        ids.item,
      );
      await db.$executeRawUnsafe(
        'DELETE FROM inventory.units WHERE id=$1',
        ids.unit,
      );
      await db.$executeRawUnsafe(
        'DELETE FROM organization.branches WHERE id=$1',
        ids.branch,
      );
      await db.$executeRawUnsafe(
        'DELETE FROM organization.organizations WHERE id=$1',
        ids.org,
      );
      await app.close();
    });

    async function insert(
      type: string,
      quantity: string,
      movementDate: string,
      createdAt: string,
      id = generateId(),
    ) {
      movementIds.push(id);
      const db = await prisma.getClient<{
        $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<unknown>;
      }>();
      await db.$executeRawUnsafe(
        `INSERT INTO inventory.inventory_movements
      (id,organization_id,branch_id,warehouse_id,item_id,movement_type,quantity,unit_id,base_quantity,base_unit_id,conversion_factor,movement_date,operation_key,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,abs($7::numeric),$8,$7,$8,1,$9,$10,$11,$11)`,
        id,
        ids.org,
        ids.branch,
        ids.warehouse,
        ids.item,
        type,
        quantity,
        ids.unit,
        new Date(movementDate),
        `op-${id}`,
        new Date(createdAt),
      );
    }

    it('derives opening, all signs, deterministic order, continuous pages and snapshot exclusion', async () => {
      await insert(
        'inbound',
        '100.0000',
        '2026-01-01T00:00:00Z',
        '2026-01-01T01:00:00Z',
      );
      const sameDate = '2026-01-05T00:00:00Z';
      const sameCreated = '2026-01-05T01:00:00Z';
      const orderedIds = [generateId(), generateId()].sort();
      await insert(
        'adjustment_in',
        '20.0000',
        sameDate,
        sameCreated,
        orderedIds[1],
      );
      await insert(
        'outbound',
        '-30.0000',
        sameDate,
        sameCreated,
        orderedIds[0],
      );
      await insert(
        'transfer_in',
        '5.0000',
        '2026-01-06T00:00:00Z',
        '2026-01-06T01:00:00Z',
      );
      await insert(
        'transfer_out',
        '-5.0000',
        '2026-01-07T00:00:00Z',
        '2026-01-07T01:00:00Z',
      );
      await insert(
        'adjustment_out',
        '-2.5000',
        '2026-01-08T00:00:00Z',
        '2026-01-08T01:00:00Z',
      );
      await insert(
        'reversal_in',
        '2.5000',
        '2026-01-09T00:00:00Z',
        '2026-01-09T01:00:00Z',
      );
      await insert(
        'reversal_out',
        '-10.0000',
        '2026-01-10T00:00:00Z',
        '2026-01-10T01:00:00Z',
      );

      const query = {
        organizationId: ids.org,
        itemId: ids.item,
        warehouseId: ids.warehouse,
        dateFrom: new Date('2026-01-05T00:00:00Z'),
        dateTo: new Date('2026-01-10T00:00:00Z'),
        page: 1,
        pageSize: 2,
      };
      const first = await repository.read(query);
      expect(first.openingBaseQuantity).toBe('100.0000');
      expect(first.total).toBe(7);
      expect(first.items.map((row) => row.movementId)).toEqual(orderedIds);
      expect(first.items.map((row) => row.runningBaseQuantity)).toEqual([
        '70.0000',
        '90.0000',
      ]);
      expect(first.closingBaseQuantity).toBe('80.0000');

      await insert(
        'inbound',
        '999.0000',
        '2026-01-06T00:00:00Z',
        '2026-02-01T00:00:00Z',
      );
      const second = await repository.read({
        ...query,
        page: 2,
        snapshot: first.snapshot,
      });
      expect(second.total).toBe(7);
      expect(second.items.map((row) => row.runningBaseQuantity)).toEqual([
        '95.0000',
        '90.0000',
      ]);
    });
  },
);
