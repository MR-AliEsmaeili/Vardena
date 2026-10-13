import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { AppException } from '../src/kernel/errors/app-exception.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { BranchesService } from '../src/modules/organization/application/branches.service.js';
import { WarehousesService } from '../src/modules/inventory/application/warehouses.service.js';
import { UnitsService } from '../src/modules/inventory/application/units.service.js';
import { ItemsService } from '../src/modules/inventory/application/items.service.js';
import { InventoryMovementsService } from '../src/modules/inventory/application/inventory-movements.service.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database verification for Task 33 (Inventory / Warehouse Master
 * Completion), per the task's §16/§17 CI policy. Skipped unless
 * `VARDENA_TEST_DATABASE_URL` is set (CI with Postgres, or local Docker).
 *
 * This proves against a REAL PostgreSQL database the three guarantees that
 * cannot be proven by the hermetic in-memory suites
 * (`master-data.e2e-spec.ts`, `warehouses.service.spec.ts`,
 * `master-data-authorization.spec.ts`):
 *
 *   1. organization-scoped code uniqueness survives a genuine concurrent
 *      write race (the database's unique index is the final authority, not
 *      the application pre-check);
 *   2. organization and branch isolation hold against real committed rows,
 *      not fakes;
 *   3. the two lifecycle freeze guards (branch change blocked once real
 *      `inventory_movements` rows exist; disable blocked while a real
 *      `inventory_balances` row still carries stock) actually fire against
 *      rows produced by the real posting transaction
 *      (`InventoryMovementsService.postMovement`), including the balance
 *      actually clearing back to zero.
 *
 * Every call below runs in system context (no HTTP request in flight), the
 * same trusted-caller posture `workflow-live.e2e-spec.ts` and
 * `licensing-persistence-live.e2e-spec.ts` use: `AuthorizationService` and
 * `OrganizationsService.assertOrganizationInScope` both no-op outside a
 * request context, so this suite is free to focus entirely on the database
 * behaviour instead of re-proving RBAC wiring (that is
 * `master-data-authorization.spec.ts`'s job).
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Inventory Warehouse master (live database)',
  () => {
    const suffix = generateId().slice(-8).toLowerCase();

    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let organizations: OrganizationsService;
    let branches: BranchesService;
    let warehouses: WarehousesService;
    let units: UnitsService;
    let items: ItemsService;
    let movements: InventoryMovementsService;

    let orgAId = '';
    let orgBId = '';
    let branchA1Id = '';
    let branchA2Id = '';
    let branchBId = '';

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
      items = app.get(ItemsService);
      movements = app.get(InventoryMovementsService);

      orgAId = (
        await organizations.createOrganization({
          code: `WHA-${suffix}`,
          name: 'Warehouse live org A',
        })
      ).id;
      orgBId = (
        await organizations.createOrganization({
          code: `WHB-${suffix}`,
          name: 'Warehouse live org B',
        })
      ).id;
      branchA1Id = (
        await branches.createBranch({
          organizationId: orgAId,
          code: 'A-1',
          name: 'Org A branch 1',
        })
      ).id;
      branchA2Id = (
        await branches.createBranch({
          organizationId: orgAId,
          code: 'A-2',
          name: 'Org A branch 2',
        })
      ).id;
      branchBId = (
        await branches.createBranch({
          organizationId: orgBId,
          code: 'B-1',
          name: 'Org B branch 1',
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      if (app !== undefined) {
        const client = await prisma.getClient<{
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
          unit: { deleteMany: (args: unknown) => Promise<unknown> };
          branch: { deleteMany: (args: unknown) => Promise<unknown> };
          organization: { deleteMany: (args: unknown) => Promise<unknown> };
        }>();
        try {
          const orgIds = [orgAId, orgBId];
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

    it('enforces organization-scoped warehouse code uniqueness under a real concurrent write race', async () => {
      const code = `WH-RACE-${suffix}`;
      const attempts = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          warehouses.createWarehouse({
            organizationId: orgAId,
            branchId: branchA1Id,
            code,
            name: `Race warehouse attempt ${index}`,
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

      const { warehouse } = await prisma.getClient<{
        warehouse: {
          findMany: (args: unknown) => Promise<unknown[]>;
        };
      }>();
      const rows = await warehouse.findMany({
        where: { organizationId: orgAId, code },
      });
      expect(rows).toHaveLength(1);
    });

    it('allows the identical code to be reused in a different organization', async () => {
      const code = `WH-SHARED-${suffix}`;
      const inA = await warehouses.createWarehouse({
        organizationId: orgAId,
        branchId: branchA1Id,
        code,
        name: 'Org A shared-code warehouse',
      });
      const inB = await warehouses.createWarehouse({
        organizationId: orgBId,
        branchId: branchBId,
        code,
        name: 'Org B shared-code warehouse',
      });
      expect(inA.code).toBe(code);
      expect(inB.code).toBe(code);
      expect(inA.organizationId).not.toBe(inB.organizationId);
    });

    it('keeps a warehouse created in one organization unreadable and unusable from another (real rows)', async () => {
      const created = await warehouses.createWarehouse({
        organizationId: orgAId,
        branchId: branchA1Id,
        code: `WH-ISO-${suffix}`,
        name: 'Isolated warehouse',
      });

      await expect(
        warehouses.getWarehouse(orgBId, created.id),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      await expect(
        warehouses.updateWarehouse(orgBId, created.id, { name: 'Hijacked' }),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      await expect(
        warehouses.disableWarehouse(orgBId, created.id),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      await expect(
        warehouses.requireUsableWarehouseInOrganization(created.id, orgBId),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });

      // Unchanged from the correct organization.
      const still = await warehouses.getWarehouse(orgAId, created.id);
      expect(still.name).toBe('Isolated warehouse');
    });

    it('rejects creating or moving a warehouse onto a branch owned by another organization (real rows)', async () => {
      await expect(
        warehouses.createWarehouse({
          organizationId: orgAId,
          branchId: branchBId,
          code: `WH-XORG-${suffix}`,
          name: 'Cross-org branch attempt',
        }),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });

      const created = await warehouses.createWarehouse({
        organizationId: orgAId,
        branchId: branchA1Id,
        code: `WH-MOVE-${suffix}`,
        name: 'Movable warehouse',
      });
      await expect(
        warehouses.updateWarehouse(orgAId, created.id, {
          branchId: branchBId,
        }),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
    });

    it('enforces lifecycle safety against real inventory movements and balances', async () => {
      const unit = await units.createUnit({
        organizationId: orgAId,
        code: `PCS-${suffix}`,
        name: 'Piece',
      });
      const item = await items.createItem({
        organizationId: orgAId,
        code: `ITM-${suffix}`,
        name: 'Live test bolt',
        itemKind: 'goods',
        baseUnitId: unit.id,
      });
      const warehouse = await warehouses.createWarehouse({
        organizationId: orgAId,
        branchId: branchA1Id,
        code: `WH-MOVFR-${suffix}`,
        name: 'Movement-frozen warehouse',
      });

      // Post a real inbound movement: this creates both an
      // `inventory_movements` row and a positive `inventory_balances` row.
      await movements.postMovement({
        operationKey: `live-inbound-${suffix}`,
        organizationId: orgAId,
        warehouseId: warehouse.id,
        itemId: item.id,
        movementType: 'inbound',
        quantity: '10',
        unitId: unit.id,
      });

      // Freeze guard 1: the branch cannot move once real movements exist.
      await expect(
        warehouses.updateWarehouse(orgAId, warehouse.id, {
          branchId: branchA2Id,
        }),
      ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

      // Freeze guard 2: disabling is blocked while the real balance is
      // non-zero.
      await expect(
        warehouses.disableWarehouse(orgAId, warehouse.id),
      ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

      // Draining the balance back to zero with a real outbound movement
      // lifts the disable guard — proving the guard reads live state, not a
      // cached "ever had stock" flag.
      await movements.postMovement({
        operationKey: `live-outbound-${suffix}`,
        organizationId: orgAId,
        warehouseId: warehouse.id,
        itemId: item.id,
        movementType: 'outbound',
        quantity: '10',
        unitId: unit.id,
      });
      const disabled = await warehouses.disableWarehouse(orgAId, warehouse.id);
      expect(disabled.isActive).toBe(false);

      // The branch freeze guard is permanent (keyed on "any movement ever",
      // not on current balance): it must still refuse after the balance
      // cleared.
      await expect(
        warehouses.updateWarehouse(orgAId, warehouse.id, {
          branchId: branchA2Id,
        }),
      ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
    }, 30_000);
  },
);
