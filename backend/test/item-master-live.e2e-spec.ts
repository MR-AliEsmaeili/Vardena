import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { toBusinessDate } from '../src/kernel/datetime/business-date.js';
import { AppException } from '../src/kernel/errors/app-exception.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { BranchesService } from '../src/modules/organization/application/branches.service.js';
import { WarehousesService } from '../src/modules/inventory/application/warehouses.service.js';
import { UnitsService } from '../src/modules/inventory/application/units.service.js';
import { ItemsService } from '../src/modules/inventory/application/items.service.js';
import { ItemGroupsService } from '../src/modules/inventory/application/item-groups.service.js';
import { UnitConversionsService } from '../src/modules/inventory/application/unit-conversions.service.js';
import { InventoryMovementsService } from '../src/modules/inventory/application/inventory-movements.service.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database verification for the Inventory ITEM master (C-47), following
 * the pattern of `warehouse-master-live.e2e-spec.ts` (C-46). Skipped unless
 * `VARDENA_TEST_DATABASE_URL` is set (CI with Postgres, or local Docker).
 *
 * The guarantees this suite pins against REAL PostgreSQL — none of them
 * provable by the hermetic in-memory suites, all of them load-bearing for the
 * item master's correctness under concurrency and isolation:
 *
 *   1. organization-scoped item code uniqueness survives a genuine
 *      concurrent write race (the unique index is the final authority: the
 *      pre-check conflicts single-threaded, the DB resolves the race);
 *   2. concurrent conversion version creates NEVER leave a unit pair with
 *      overlapping or multiple open-ended versions — the advisory-locked
 *      in-transaction plan (`unit-conversions.repository.ts`) resolves every
 *      race into either a clean supersession or the stable 422 rejection;
 *   3. entered→base resolution against real conversion rows preserves
 *      backdated business dates: a posting dated before a factor change
 *      snapshots the OLD factor onto the movement row forever (D-21/D-26);
 *   4. a posting whose entered unit has no covering conversion is rejected
 *      (never an invented 1:1, never a division through the reverse pair),
 *      and a converted product that would not fit `numeric(18,4)` exactly is
 *      rejected — never rounded (OQ-29 deliberately untouched);
 *   5. the item freeze guards (base-unit change and stockability-off blocked
 *      once real movements exist; disable blocked while the real balance
 *      holds stock, lifted when it drains) fire against rows produced by the
 *      real posting transaction;
 *   6. organization isolation holds against real committed rows, including
 *      the C-47 fix: conversion factors are never resolvable through a
 *      foreign organization's item.
 *
 * Everything runs in system context (the established live-suite posture):
 * RBAC itself is proven in `master-data-authorization.spec.ts`.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

interface UnitConversionDelegate {
  findMany: (args: unknown) => Promise<
    Array<{
      id: string;
      validFrom: Date;
      validTo: Date | null;
      factor: string;
    }>
  >;
  deleteMany: (args: unknown) => Promise<unknown>;
}

describe.skipIf(DATABASE_URL === undefined)(
  'Inventory item master (live database)',
  () => {
    const suffix = generateId().slice(-8).toLowerCase();

    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let organizations: OrganizationsService;
    let branches: BranchesService;
    let warehouses: WarehousesService;
    let units: UnitsService;
    let itemGroups: ItemGroupsService;
    let items: ItemsService;
    let conversions: UnitConversionsService;
    let movements: InventoryMovementsService;

    let orgAId = '';
    let orgBId = '';
    let branchAId = '';
    let pcsAId = '';
    let boxAId = '';
    let crateAId = '';
    let warehouseAId = '';

    const JAN = toBusinessDate('2026-01-01')!;
    const FEB = toBusinessDate('2026-02-01')!;

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);

      organizations = app.get(OrganizationsService);
      branches = app.get(BranchesService);
      warehouses = app.get(WarehousesService);
      units = app.get(UnitsService);
      itemGroups = app.get(ItemGroupsService);
      items = app.get(ItemsService);
      conversions = app.get(UnitConversionsService);
      movements = app.get(InventoryMovementsService);

      orgAId = (
        await organizations.createOrganization({
          code: `IMA-${suffix}`,
          name: 'Item live org A',
        })
      ).id;
      orgBId = (
        await organizations.createOrganization({
          code: `IMB-${suffix}`,
          name: 'Item live org B',
        })
      ).id;
      branchAId = (
        await branches.createBranch({
          organizationId: orgAId,
          code: 'A-1',
          name: 'Org A branch 1',
        })
      ).id;
      pcsAId = (
        await units.createUnit({
          organizationId: orgAId,
          code: 'PCS',
          name: 'Piece',
        })
      ).id;
      boxAId = (
        await units.createUnit({
          organizationId: orgAId,
          code: 'BOX',
          name: 'Box',
        })
      ).id;
      crateAId = (
        await units.createUnit({
          organizationId: orgAId,
          code: 'CRATE',
          name: 'Crate',
        })
      ).id;
      warehouseAId = (
        await warehouses.createWarehouse({
          organizationId: orgAId,
          branchId: branchAId,
          code: `WH-${suffix}`,
          name: 'Posting warehouse (live)',
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      if (app !== undefined) {
        const client = await prisma.getClient<{
          itemUnitConversion: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          unitConversion: { deleteMany: (args: unknown) => Promise<unknown> };
          inventoryBalance: { deleteMany: (args: unknown) => Promise<unknown> };
          inventoryOperation: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryMovement: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryValuationState: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryValuationRun: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          itemValuationMethod: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          warehouse: { deleteMany: (args: unknown) => Promise<unknown> };
          item: { deleteMany: (args: unknown) => Promise<unknown> };
          itemGroup: { deleteMany: (args: unknown) => Promise<unknown> };
          unit: { deleteMany: (args: unknown) => Promise<unknown> };
          branch: { deleteMany: (args: unknown) => Promise<unknown> };
          organization: { deleteMany: (args: unknown) => Promise<unknown> };
        }>();
        try {
          const orgIds = [orgAId, orgBId];
          await client.itemUnitConversion.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await client.unitConversion.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await client.inventoryBalance.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await client.inventoryOperation.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await client.inventoryMovement.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          // Valuation rows reference warehouse and item with ON DELETE RESTRICT,
          // so they must go before the references they point at (ADR-0039).
          await client.inventoryValuationState.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await client.inventoryValuationRun.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await client.itemValuationMethod.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await client.warehouse.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await client.item.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await client.itemGroup.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await client.unit.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await client.branch.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await client.organization.deleteMany({
            where: { id: { in: orgIds } },
          });
        } finally {
          await app.close();
        }
      }
    }, 60_000);

    it('enforces organization-scoped item code uniqueness under a real concurrent write race', async () => {
      const code = `ITM-RACE-${suffix}`;
      const attempts = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          items.createItem({
            organizationId: orgAId,
            code,
            name: `Race item attempt ${index}`,
            itemKind: 'goods',
            baseUnitId: pcsAId,
          }),
        ),
      );

      const fulfilled = attempts.filter(
        (attempt) => attempt.status === 'fulfilled',
      );
      const rejected = attempts.filter(
        (attempt) => attempt.status === 'rejected',
      );
      // The database's unique index is the final authority: exactly one
      // writer wins, no matter how many raced the pre-check simultaneously.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(7);
      for (const loser of rejected) {
        const reason = (loser as PromiseRejectedResult).reason;
        expect(reason).toBeInstanceOf(AppException);
        expect((reason as AppException).code).toBe('Conflict');
      }

      const { item } = await prisma.getClient<{
        item: { findMany: (args: unknown) => Promise<unknown[]> };
      }>();
      const rows = await item.findMany({
        where: { organizationId: orgAId, code },
      });
      expect(rows).toHaveLength(1);
    });

    it('allows the same code in two organizations and rejects every cross-organization reference on real rows', async () => {
      const pcsB = await units.createUnit({
        organizationId: orgBId,
        code: 'PCS',
        name: 'Piece (B)',
      });
      // Identical codes across tenants — no bleed.
      const itemA = await items.createItem({
        organizationId: orgAId,
        code: `ITM-SHARED-${suffix}`,
        name: 'Shared-code item A',
        itemKind: 'goods',
        baseUnitId: pcsAId,
      });
      const itemB = await items.createItem({
        organizationId: orgBId,
        code: `ITM-SHARED-${suffix}`,
        name: 'Shared-code item B',
        itemKind: 'goods',
        baseUnitId: pcsB.id,
      });
      expect(itemA.code).toBe(itemB.code);

      const groupB = await itemGroups.createItemGroup({
        organizationId: orgBId,
        code: `G-B-${suffix}`,
        name: 'Group B',
      });

      // Every addressing of A's item through org B is opaque not-found.
      for (const probe of [
        () => items.getItem(orgBId, itemA.id),
        () => items.updateItem(orgBId, itemA.id, { name: 'Hijacked' }),
        () => items.disableItem(orgBId, itemA.id),
        () => items.enableItem(orgBId, itemA.id),
        () => items.requireUsableItemInOrganization(itemA.id, orgBId),
      ]) {
        // eslint-disable-next-line no-await-in-loop
        await expect(probe()).rejects.toMatchObject({
          code: 'EntityNotFound',
        });
      }

      // Foreign unit/group cannot anchor a new item in A at all.
      await expect(
        items.createItem({
          organizationId: orgAId,
          code: `ITM-FX-${suffix}`,
          name: 'Foreign unit anchor',
          itemKind: 'goods',
          baseUnitId: pcsB.id,
        }),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      await expect(
        items.createItem({
          organizationId: orgAId,
          code: `ITM-FG-${suffix}`,
          name: 'Foreign group anchor',
          itemKind: 'goods',
          baseUnitId: pcsAId,
          itemGroupId: groupB.id,
        }),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
    });

    it('serializes concurrent same-BusinessDate conversion creates: exactly one version, the rest get the stable overlap rejection', async () => {
      const itemPair = await items.createItem({
        organizationId: orgAId,
        code: `ITM-CVP-${suffix}`,
        name: 'Race conversion anchor',
        itemKind: 'goods',
        baseUnitId: pcsAId,
      });
      const attempts = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          conversions.createConversion({
            organizationId: orgAId,
            itemId: itemPair.id,
            fromUnitId: boxAId,
            toUnitId: pcsAId,
            factor: '12',
            validFrom: toBusinessDate('2026-03-01')!,
            validTo: null,
          }),
        ),
      );

      const fulfilled = attempts.filter(
        (attempt) => attempt.status === 'fulfilled',
      );
      const rejected = attempts.filter(
        (attempt) => attempt.status === 'rejected',
      );
      // Advisory-lock serialization turns the race into sequential creates:
      // exactly one version starts on that BusinessDate, and every loser gets
      // the SAME stable error a single-threaded overlapping create gets — the
      // pair can never carry two versions sharing a date start.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(7);
      for (const loser of rejected) {
        const reason = (loser as PromiseRejectedResult).reason;
        expect(reason).toBeInstanceOf(AppException);
        expect(['BusinessRuleViolation', 'Conflict']).toContain(
          (reason as AppException).code,
        );
      }

      const { itemUnitConversion } = await prisma.getClient<{
        itemUnitConversion: UnitConversionDelegate & {
          count: (args: unknown) => Promise<number>;
        };
      }>();
      const rows = await itemUnitConversion.findMany({
        where: {
          itemId: itemPair.id,
          fromUnitId: boxAId,
          toUnitId: pcsAId,
        },
      });
      expect(rows).toHaveLength(1);
    });

    it('keeps a unit pair free of overlapping versions under a concurrent supersession race', async () => {
      const itemPair = await items.createItem({
        organizationId: orgAId,
        code: `ITM-CVR-${suffix}`,
        name: 'Supersession race anchor',
        itemKind: 'goods',
        baseUnitId: pcsAId,
      });
      // Eight racers at distinct consecutive business days.
      const validFromDates = [
        '2026-04-01',
        '2026-04-02',
        '2026-04-03',
        '2026-04-04',
        '2026-04-05',
        '2026-04-06',
        '2026-04-07',
        '2026-04-08',
      ].map((value) => toBusinessDate(value)!);
      const attempts = await Promise.allSettled(
        validFromDates.map((validFrom) =>
          conversions.createConversion({
            organizationId: orgAId,
            itemId: itemPair.id,
            fromUnitId: boxAId,
            toUnitId: pcsAId,
            factor: '12',
            validFrom,
            validTo: null,
          }),
        ),
      );

      const fulfilled = attempts.filter(
        (attempt) => attempt.status === 'fulfilled',
      ) as PromiseFulfilledResult<{ id: string }>[];
      const rejected = attempts.filter(
        (attempt) => attempt.status === 'rejected',
      );
      // At least the first lock-holder must succeed; every rejection is the
      // stable overlap rule (no silent damage, no partial writes).
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      expect(fulfilled.length + rejected.length).toBe(8);
      for (const loser of rejected) {
        expect((loser as PromiseRejectedResult).reason).toBeInstanceOf(
          AppException,
        );
        expect((loser as PromiseRejectedResult).reason.code).toBe(
          'BusinessRuleViolation',
        );
      }

      // The pair's committed history is a consistent chain: sorted by
      // validFrom, each version ends exactly where the next begins, and
      // exactly one (the latest) is open-ended — forever. This is the
      // invariant the read-the-plan-outside-the-transaction version broke.
      const { itemUnitConversion } = await prisma.getClient<{
        itemUnitConversion: UnitConversionDelegate;
      }>();
      const rows = (
        await itemUnitConversion.findMany({
          where: {
            itemId: itemPair.id,
            fromUnitId: boxAId,
            toUnitId: pcsAId,
          },
        })
      ).sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
      expect(rows).toHaveLength(fulfilled.length);
      const openEnded = rows.filter((row) => row.validTo === null);
      expect(openEnded).toHaveLength(1);
      for (let index = 0; index < rows.length - 1; index += 1) {
        expect(rows[index]?.validTo?.getTime()).toBe(
          rows[index + 1]?.validFrom.getTime(),
        );
      }
    });

    it('resolves historically against real rows and snapshots the factor of the movement date, not of today', async () => {
      const item = await items.createItem({
        organizationId: orgAId,
        code: `ITM-HIST-${suffix}`,
        name: 'History-resolved item',
        itemKind: 'goods',
        baseUnitId: pcsAId,
      });
      const first = await conversions.createConversion({
        organizationId: orgAId,
        itemId: null,
        fromUnitId: boxAId,
        toUnitId: pcsAId,
        factor: '12',
        validFrom: JAN,
        validTo: null,
      });
      await conversions.createConversion({
        organizationId: orgAId,
        itemId: null,
        fromUnitId: boxAId,
        toUnitId: pcsAId,
        factor: '24',
        validFrom: FEB,
        validTo: null,
      });

      // The closure actually landed in the real table (supersession).
      const closed = await conversions.getConversion(orgAId, first.id);
      expect(closed.validTo).toBe(FEB);
      expect(closed.factor).toBe('12');

      const january = await conversions.resolveConversion({
        organizationId: orgAId,
        itemId: null,
        fromUnitId: boxAId,
        toUnitId: pcsAId,
        asOf: toBusinessDate('2026-01-15')!,
      });
      expect(january?.factor).toBe('12');

      // A movement dated in January converts at the JANUARY factor and keeps
      // it frozen on the ledger row forever (D-21), including the entered
      // quantity and unit.
      const posted = await movements.postMovement({
        operationKey: `live-backdated-${suffix}`,
        organizationId: orgAId,
        warehouseId: warehouseAId,
        itemId: item.id,
        movementType: 'inbound',
        quantity: '2',
        unitId: boxAId,
        movementDate: '2026-01-20',
      });
      expect(posted.conversionFactor).toBe('12');
      expect(posted.baseQuantity).toBe('24');

      const { inventoryMovement } = await prisma.getClient<{
        inventoryMovement: {
          findUnique: (args: unknown) => Promise<{
            conversionFactor: string;
            baseQuantity: string;
            quantity: string;
          } | null>;
        };
      }>();
      const row = await inventoryMovement.findUnique({
        where: { id: posted.id },
      });
      expect(String(row?.conversionFactor)).toBe('12');
      expect(String(row?.baseQuantity)).toBe('24');

      // A movement dated after the change resolves the NEW factor — same
      // item, same units, different business date.
      const current = await movements.postMovement({
        operationKey: `live-current-${suffix}`,
        organizationId: orgAId,
        warehouseId: warehouseAId,
        itemId: item.id,
        movementType: 'inbound',
        quantity: '2',
        unitId: boxAId,
        movementDate: '2026-03-01',
      });
      expect(current.conversionFactor).toBe('24');
      expect(current.baseQuantity).toBe('48');
    });

    it('rejects a posting whose entered unit has no covering conversion, and records nothing', async () => {
      const item = await items.createItem({
        organizationId: orgAId,
        code: `ITM-NOCV-${suffix}`,
        name: 'No-conversion item',
        itemKind: 'goods',
        baseUnitId: pcsAId,
      });
      const { inventoryMovement } = await prisma.getClient<{
        inventoryMovement: { count: (args: unknown) => Promise<number> };
      }>();
      const before = await inventoryMovement.count({
        where: { organizationId: orgAId },
      });

      // CRATE → PCS has no conversion at all: explicit rejection, never an
      // invented 1:1. Also: no silently-divided reverse-pair derivation.
      await expect(
        movements.postMovement({
          operationKey: `live-nocv-${suffix}`,
          organizationId: orgAId,
          warehouseId: warehouseAId,
          itemId: item.id,
          movementType: 'inbound',
          quantity: '1',
          unitId: crateAId,
        }),
      ).rejects.toMatchObject({
        code: 'BusinessRuleViolation',
        message: expect.stringContaining('No unit conversion'),
      });

      const after = await inventoryMovement.count({
        where: { organizationId: orgAId },
      });
      expect(after).toBe(before);
    });

    it('rejects a converted base quantity needing more than 4 decimals rather than rounding (OQ-29 untouched)', async () => {
      const item = await items.createItem({
        organizationId: orgAId,
        code: `ITM-PREC-${suffix}`,
        name: 'Precision probe item',
        itemKind: 'goods',
        baseUnitId: pcsAId,
      });
      await conversions.createConversion({
        organizationId: orgAId,
        itemId: item.id,
        fromUnitId: crateAId,
        toUnitId: pcsAId,
        factor: '0.166667',
        validFrom: JAN,
        validTo: null,
      });
      // 1 × 0.166667 = 0.166667 — six decimals; the posting must be refused,
      // never rounded to 0.1667 (rounding mode is an open OQ-29 decision).
      await expect(
        movements.postMovement({
          operationKey: `live-prec-${suffix}`,
          organizationId: orgAId,
          warehouseId: warehouseAId,
          itemId: item.id,
          movementType: 'inbound',
          quantity: '1',
          unitId: crateAId,
          movementDate: '2026-03-05',
        }),
      ).rejects.toMatchObject({
        code: 'BusinessRuleViolation',
        message: expect.stringContaining('more than 4 decimal places'),
      });
    });

    it('enforces item freeze guards against real movements and balances', async () => {
      const kgUnit = await units.createUnit({
        organizationId: orgAId,
        code: `KG-${suffix}`,
        name: 'Kilogram',
      });
      const item = await items.createItem({
        organizationId: orgAId,
        code: `ITM-FR-${suffix}`,
        name: 'Freeze-guard item',
        itemKind: 'goods',
        baseUnitId: pcsAId,
      });

      await movements.postMovement({
        operationKey: `live-frz-in-${suffix}`,
        organizationId: orgAId,
        warehouseId: warehouseAId,
        itemId: item.id,
        movementType: 'inbound',
        quantity: '10',
        unitId: pcsAId,
      });

      // Once real movements exist, the base unit is ledger-owned.
      await expect(
        items.updateItem(orgAId, item.id, { baseUnitId: kgUnit.id }),
      ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

      // …and the item cannot silently stop being stockable (movements stay
      // meaningful; remaining quantities stay reachable).
      await expect(
        items.updateItem(orgAId, item.id, {
          isStockable: false,
          isValued: false,
        }),
      ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

      // Disabling is blocked while the real balance still holds stock.
      await expect(items.disableItem(orgAId, item.id)).rejects.toMatchObject({
        code: 'BusinessRuleViolation',
      });

      // Draining to zero lifts ONLY the disable guard — the movement-existence
      // guards are permanent (history never becomes reinterpretable).
      await movements.postMovement({
        operationKey: `live-frz-out-${suffix}`,
        organizationId: orgAId,
        warehouseId: warehouseAId,
        itemId: item.id,
        movementType: 'outbound',
        quantity: '10',
        unitId: pcsAId,
      });
      const disabled = await items.disableItem(orgAId, item.id);
      expect(disabled.isActive).toBe(false);

      await expect(
        items.updateItem(orgAId, item.id, { baseUnitId: kgUnit.id }),
      ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
    }, 30_000);

    it("never resolves conversion factors through another organization's item on real rows", async () => {
      const unitB = await units.createUnit({
        organizationId: orgBId,
        code: `PCS-${suffix}`,
        name: 'Piece (B)',
      });
      const boxB = await units.createUnit({
        organizationId: orgBId,
        code: `BOX-${suffix}`,
        name: 'Box (B)',
      });
      const itemB = await items.createItem({
        organizationId: orgBId,
        code: `ITM-SEC-${suffix}`,
        name: 'Isolation probe item',
        itemKind: 'goods',
        baseUnitId: unitB.id,
      });
      await conversions.createConversion({
        organizationId: orgBId,
        itemId: itemB.id,
        fromUnitId: boxB.id,
        toUnitId: unitB.id,
        factor: '6',
        validFrom: JAN,
        validTo: null,
      });

      // System context has full trust, so the only possible disclosure path
      // is the missing item-organization proof — the C-47 fix closes it on
      // real rows too.
      await expect(
        conversions.resolveConversion({
          organizationId: orgAId,
          itemId: itemB.id,
          fromUnitId: boxB.id,
          toUnitId: unitB.id,
          asOf: FEB,
        }),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });

      // While its own organization still resolves it — including after the
      // item is disabled (history must stay resolvable, master-data-strategy
      // §7.4), against the real stored version.
      await items.disableItem(orgBId, itemB.id);
      const resolved = await conversions.resolveConversion({
        organizationId: orgBId,
        itemId: itemB.id,
        fromUnitId: boxB.id,
        toUnitId: unitB.id,
        asOf: FEB,
      });
      expect(resolved?.factor).toBe('6');
      expect(resolved?.itemId).toBe(itemB.id);
    });
  },
);
