import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { BranchesService } from '../src/modules/organization/application/branches.service.js';
import { OrganizationMembershipsService } from '../src/modules/organization/application/organization-memberships.service.js';
import { WarehousesService } from '../src/modules/inventory/application/warehouses.service.js';
import { UnitsService } from '../src/modules/inventory/application/units.service.js';
import { ItemsService } from '../src/modules/inventory/application/items.service.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { NumberingSeriesService } from '../src/modules/documents/application/numbering-series.service.js';
import { INVENTORY_DOCUMENT_PERMISSIONS } from '../src/modules/inventory/domain/inventory-document-permissions.js';
import {
  BALANCE_PERMISSIONS,
  MOVEMENT_PERMISSIONS,
  TRANSFER_PERMISSIONS,
} from '../src/modules/inventory/domain/inventory-core-permissions.js';
import { VALUATION_PERMISSIONS } from '../src/modules/inventory/domain/inventory-valuation-permissions.js';
import {
  INVENTORY_ISSUE_DOCUMENT_TYPE,
  INVENTORY_RECEIPT_DOCUMENT_TYPE,
  INVENTORY_TRANSFER_DOCUMENT_TYPE,
} from '../src/modules/inventory/domain/inventory-document-types.js';
import { InventoryValuationRepository } from '../src/modules/inventory/data/inventory-valuation.repository.js';
import type { RecalculationInput } from '../src/modules/inventory/data/inventory-valuation.repository.js';
import type { CoreTxClient } from '../src/modules/inventory/data/inventory-core-rows.js';
import { RecalculationTooLargeError } from '../src/modules/inventory/data/inventory-posting-errors.js';
import { createTestApp } from './support/test-app.js';

/**
 * Fault injection at EXACTLY one seam: the in-transaction valuation replay.
 *
 * Everything else — the service, the real repository arithmetic, the real
 * transaction — stays untouched; the only thing this double can do is make
 * `recalculateKeyWithin` refuse, which is how a real refusal
 * (`RecalculationTooLargeError`, an unsupported historical method) reaches
 * the caller. It is armed for one test and disarmed immediately after, so no
 * other test in this file is weakened by its presence.
 */
class FaultInjectingValuationRepository extends InventoryValuationRepository {
  static failWithin = false;

  override async recalculateKeyWithin(
    tx: CoreTxClient,
    input: RecalculationInput,
  ) {
    if (FaultInjectingValuationRepository.failWithin) {
      throw new RecalculationTooLargeError(1);
    }
    return super.recalculateKeyWithin(tx, input);
  }
}

/**
 * Inventory Business Documents (C-58) against REAL PostgreSQL.
 *
 * Skipped unless `VARDENA_TEST_DATABASE_URL` is set (GitHub CI with Postgres,
 * or local Docker). The hermetic suite
 * (`inventory-business-documents.service.spec.ts`) proves the rules against a
 * fake ledger; it structurally CANNOT prove the three things that only a real
 * database answers, which is exactly what this file exists for:
 *
 *   1. **Real transactional atomicity.** A finalize that fails mid-way (an
 *      insufficient-stock transfer leg, an over-issue) leaves NO movement
 *      row, NO balance change, NO idempotency row and NO document state
 *      change — asserted by counting rows in `inventory.inventory_movements`
 *      and reading `inventory.inventory_balances` directly, not by trusting
 *      a mock.
 *   2. **Concurrency.** Two genuinely concurrent finalizes of the same draft,
 *      and two concurrent issues competing for the same stock, over real
 *      HTTP against real row locks: the ledger never double-posts and stock
 *      never goes negative.
 *   3. **Genuine organization isolation and real numbering.** Another
 *      organization's document id is a 404 through every route, and the
 *      `documents.numbering_allocations` rows show a cancelled document's
 *      number is kept and never handed out again.
 *
 * Master data (organizations, branches, units, items, warehouses, users,
 * roles, numbering series) is seeded through the application services in
 * system context — the same posture as every other `*-live.e2e-spec.ts`,
 * since none of that setup is under test here. Every C-58 command itself goes
 * through real authenticated HTTP, because the service requires a real
 * principal and because the HTTP surface is part of the deliverable.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

interface MovementRowProbe {
  count: (args: unknown) => Promise<number>;
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  deleteMany: (args: unknown) => Promise<unknown>;
}

describe.skipIf(DATABASE_URL === undefined)(
  'Inventory business documents (live database)',
  () => {
    const suffix = generateId().slice(-8).toLowerCase();

    let app: INestApplication | undefined;
    let prisma: PrismaService;

    let orgAId = '';
    let orgBId = '';
    let whMainId = '';
    let whSecondId = '';
    let unitAId = '';
    let itemAId = '';
    let itemBId = '';
    /** A fresh item for the coupled backdated-transfer replay (C-59C): the
     * replay restates a key's WHOLE history, so it needs a key whose history
     * this test controls. */
    let itemCId = '';

    let operatorId = '';
    let clerkId = '';
    let operatorRoleId = '';
    let clerkRoleId = '';
    const operatorUsername = `invdoc-op-${suffix}`;
    const clerkUsername = `invdoc-clerk-${suffix}`;
    const password = 'Invdoc-live-password-1';

    const http = () => app!.getHttpServer();

    /** Full C-58 + ledger authority. */
    let operator: ReturnType<typeof request.agent>;
    /** Document permissions only — deliberately NO ledger authority. */
    let clerk: ReturnType<typeof request.agent>;

    async function loggedInAgent(
      username: string,
    ): Promise<ReturnType<typeof request.agent>> {
      const agent = request.agent(http());
      await agent
        .post('/api/v1/auth/login')
        .send({ username, password })
        .expect(200);
      return agent;
    }

    const base = '/api/v1/inventory/business-documents';

    async function createDocument(
      body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const response = await operator
        .post(base)
        .send({ organizationId: orgAId, ...body })
        .expect(201);
      return response.body as Record<string, unknown>;
    }

    async function finalize(
      id: string,
      expected = 200,
    ): Promise<Record<string, unknown>> {
      const response = await operator
        .post(`${base}/${id}/finalize`)
        .query({ organizationId: orgAId })
        .send({})
        .expect(expected);
      return response.body as Record<string, unknown>;
    }

    async function receiveStock(
      warehouseId: string,
      itemId: string,
      quantity: string,
    ): Promise<Record<string, unknown>> {
      const draft = await createDocument({
        kind: 'receipt',
        warehouseId,
        lines: [{ itemId, quantity, unitId: unitAId }],
      });
      return finalize(draft['id'] as string);
    }

    const movementRows = async (): Promise<MovementRowProbe> => {
      const client = await prisma.getClient<{
        inventoryMovement: MovementRowProbe;
      }>();
      return client.inventoryMovement;
    };

    async function movementCount(documentId: string): Promise<number> {
      return (await movementRows()).count({
        where: { referenceId: documentId },
      });
    }

    /** Exact textual value of a decimal column at its declared scale. */
    function decimalAtScale(value: unknown, scale: number): string {
      const decimal = value as { toFixed?: (digits: number) => string };
      return typeof decimal?.toFixed === 'function'
        ? decimal.toFixed(scale)
        : String(value);
    }

    async function onHand(
      warehouseId: string,
      itemId: string,
    ): Promise<number> {
      const response = await operator
        .get('/api/v1/inventory/balances/availability')
        .query({ organizationId: orgAId, warehouseId, itemId })
        .expect(200);
      return Number(response.body.onHand);
    }

    beforeAll(async () => {
      const baseConfig = loadAppConfig();
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(InventoryValuationRepository)
            .useFactory({
              factory: (prismaService: PrismaService) =>
                new FaultInjectingValuationRepository(prismaService),
              inject: [PrismaService],
            })
            .overrideProvider(APP_CONFIG)
            .useValue({
              ...baseConfig,
              databaseUrl: DATABASE_URL,
              // This suite issues many non-login API calls in quick
              // succession (lifecycle walks plus two concurrency rounds),
              // beyond the general per-IP budget that `rate-limit.e2e-spec.ts`
              // covers on its own. The login limit is left untouched.
              rateLimit: { ...baseConfig.rateLimit, max: 5000 },
            }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);

      const organizations = app.get(OrganizationsService);
      const branches = app.get(BranchesService);
      const memberships = app.get(OrganizationMembershipsService);
      const warehouses = app.get(WarehousesService);
      const units = app.get(UnitsService);
      const items = app.get(ItemsService);
      const users = app.get(UsersService);
      const roles = app.get(RolesService);
      const userRoles = app.get(UserRolesService);
      const numberingSeries = app.get(NumberingSeriesService);

      const orgA = await organizations.createOrganization({
        code: `IDLA-${suffix}`,
        name: 'Inventory Document Live Org A',
      });
      const orgB = await organizations.createOrganization({
        code: `IDLB-${suffix}`,
        name: 'Inventory Document Live Org B',
      });
      orgAId = orgA.id;
      orgBId = orgB.id;

      for (const documentType of [
        INVENTORY_RECEIPT_DOCUMENT_TYPE,
        INVENTORY_ISSUE_DOCUMENT_TYPE,
        INVENTORY_TRANSFER_DOCUMENT_TYPE,
      ]) {
        await numberingSeries.createNumberingSeries({
          organizationId: orgAId,
          documentType,
          name: `${documentType} live ${suffix}`,
          width: 4,
        });
      }

      const branchA = await branches.createBranch({
        organizationId: orgAId,
        code: 'BR-A',
        name: 'Branch A',
      });
      const branchB = await branches.createBranch({
        organizationId: orgBId,
        code: 'BR-B',
        name: 'Branch B',
      });

      const main = await warehouses.createWarehouse({
        organizationId: orgAId,
        branchId: branchA.id,
        code: 'WH-MAIN',
        name: 'Main warehouse',
      });
      const second = await warehouses.createWarehouse({
        organizationId: orgAId,
        branchId: branchA.id,
        code: 'WH-SECOND',
        name: 'Second warehouse',
      });
      whMainId = main.id;
      whSecondId = second.id;

      const unitA = await units.createUnit({
        organizationId: orgAId,
        code: 'EA',
        name: 'Each',
      });
      const unitB = await units.createUnit({
        organizationId: orgBId,
        code: 'EA',
        name: 'Each',
      });
      unitAId = unitA.id;

      const itemA = await items.createItem({
        organizationId: orgAId,
        code: 'ITM-A',
        name: 'Item A',
        itemKind: 'goods',
        baseUnitId: unitAId,
      });
      const itemB = await items.createItem({
        organizationId: orgAId,
        code: 'ITM-B',
        name: 'Item B',
        itemKind: 'goods',
        baseUnitId: unitAId,
      });
      const itemC = await items.createItem({
        organizationId: orgAId,
        code: 'ITM-C',
        name: 'Item C (coupled replay)',
        itemKind: 'goods',
        baseUnitId: unitAId,
      });
      itemAId = itemA.id;
      itemBId = itemB.id;
      itemCId = itemC.id;

      // Org B exists with its own master data so the isolation probes are
      // real rows in the same tables, not an empty organization.
      const branchBWarehouse = await warehouses.createWarehouse({
        organizationId: orgBId,
        branchId: branchB.id,
        code: 'WH-B',
        name: 'Warehouse B',
      });
      await items.createItem({
        organizationId: orgBId,
        code: 'ITM-B1',
        name: 'Item B1',
        itemKind: 'goods',
        baseUnitId: unitB.id,
      });
      expect(branchBWarehouse.id).toBeTruthy();

      const operatorRole = await roles.createRole({
        name: `Inventory document operator ${suffix}`,
        description: 'Live-spec fixture: full C-58 plus ledger authority.',
        permissionCodes: [
          ...Object.values(INVENTORY_DOCUMENT_PERMISSIONS),
          MOVEMENT_PERMISSIONS.CREATE,
          MOVEMENT_PERMISSIONS.REVERSE,
          MOVEMENT_PERMISSIONS.VIEW,
          TRANSFER_PERMISSIONS.CREATE,
          BALANCE_PERMISSIONS.VIEW,
          // A receipt cost is an Inventory VALUATION assignment, so the
          // operator needs the valuation authority too — a document
          // permission alone never buys the right to price stock.
          VALUATION_PERMISSIONS.ASSIGN_COST,
          VALUATION_PERMISSIONS.RECALCULATE,
        ],
      });
      operatorRoleId = operatorRole.id;

      // The direct regression check for "backend authorization is
      // mandatory": document permissions alone must NOT be enough to write
      // ledger facts.
      const clerkRole = await roles.createRole({
        name: `Inventory document clerk ${suffix}`,
        description:
          'Live-spec fixture: C-58 document permissions WITHOUT any Inventory.Movement/Transfer authority.',
        permissionCodes: Object.values(INVENTORY_DOCUMENT_PERMISSIONS),
      });
      clerkRoleId = clerkRole.id;

      const operatorUser = await users.createUser({
        username: operatorUsername,
        password,
      });
      const clerkUser = await users.createUser({
        username: clerkUsername,
        password,
      });
      operatorId = operatorUser.id;
      clerkId = clerkUser.id;

      await userRoles.assignRoleToUser(operatorRoleId, operatorId);
      await userRoles.assignRoleToUser(clerkRoleId, clerkId);
      await memberships.grantMembership(orgAId, operatorId);
      await memberships.grantMembership(orgAId, clerkId);

      operator = await loggedInAgent(operatorUsername);
      clerk = await loggedInAgent(clerkUsername);
    }, 180_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        const client = await prisma.getClient<{
          inventoryBusinessDocumentLine: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryBusinessDocument: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryOperation: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryBalance: { deleteMany: (args: unknown) => Promise<unknown> };
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
          numberingAllocation: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          numberingSeries: { deleteMany: (args: unknown) => Promise<unknown> };
          warehouse: { deleteMany: (args: unknown) => Promise<unknown> };
          item: { deleteMany: (args: unknown) => Promise<unknown> };
          unit: { deleteMany: (args: unknown) => Promise<unknown> };
          branch: { deleteMany: (args: unknown) => Promise<unknown> };
          organizationMembership: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          organization: { deleteMany: (args: unknown) => Promise<unknown> };
          userRole: { deleteMany: (args: unknown) => Promise<unknown> };
          rolePermission: { deleteMany: (args: unknown) => Promise<unknown> };
          role: { deleteMany: (args: unknown) => Promise<unknown> };
          user: { deleteMany: (args: unknown) => Promise<unknown> };
        }>();
        const orgIds = [orgAId, orgBId].filter((id) => id !== '');
        const userIds = [operatorId, clerkId].filter((id) => id !== '');
        const roleIds = [operatorRoleId, clerkRoleId].filter((id) => id !== '');

        await client.inventoryBusinessDocumentLine.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.inventoryBusinessDocument.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.numberingAllocation.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.numberingSeries.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.inventoryOperation.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.inventoryBalance.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.inventoryMovement.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
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
        await client.organizationMembership.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.organization.deleteMany({ where: { id: { in: orgIds } } });
        await client.userRole.deleteMany({
          where: { userId: { in: userIds } },
        });
        await client.rolePermission.deleteMany({
          where: { roleId: { in: roleIds } },
        });
        await client.role.deleteMany({ where: { id: { in: roleIds } } });
        await client.user.deleteMany({ where: { id: { in: userIds } } });
      } finally {
        await app.close();
      }
    }, 120_000);

    // -----------------------------------------------------------------------
    // 1. Receipt / Issue / Transfer actually work end to end
    // -----------------------------------------------------------------------

    it('posts a receipt: real movement row, real balance, real number', async () => {
      const before = await onHand(whMainId, itemAId);
      const draft = await createDocument({
        kind: 'receipt',
        warehouseId: whMainId,
        cost: '1250.00',
        lines: [{ itemId: itemAId, quantity: '100', unitId: unitAId }],
      });
      expect(draft['status']).toBe('draft');
      expect(draft['valuationState']).toBe('priced');
      expect(draft['number']).toBeNull();
      expect(await movementCount(draft['id'] as string)).toBe(0);

      const finalized = await finalize(draft['id'] as string);
      expect(finalized['status']).toBe('operational');
      expect(finalized['valuationState']).toBe('priced');
      expect(finalized['number']).toMatch(/\d{4}$/);
      expect(await movementCount(draft['id'] as string)).toBe(1);
      expect(await onHand(whMainId, itemAId)).toBe(before + 100);

      const rows = await (
        await movementRows()
      ).findMany({ where: { referenceId: draft['id'] } });
      expect(rows[0]!['movementType']).toBe('inbound');
      expect(String(rows[0]!['baseQuantity'])).toBe('100');
      // Prisma returns a Decimal; its default rendering drops the trailing
      // zeros of the fixed numeric(18,2) column, so the assertion pins the
      // exact value at the column's own scale instead of a float.
      expect(decimalAtScale(rows[0]!['totalCost'], 2)).toBe('1250.00');

      // Kardex reads the same authoritative movement ledger; the document
      // layer has not created a parallel visibility path.
      const kardex = await operator
        .get('/api/v1/inventory/kardex')
        .query({
          organizationId: orgAId,
          warehouseId: whMainId,
          itemId: itemAId,
          page: 1,
          pageSize: 100,
        })
        .expect(200);
      expect(
        (kardex.body.items as Array<Record<string, unknown>>).some(
          (row) =>
            row['movementId'] === rows[0]!['id'] &&
            row['referenceId'] === draft['id'],
        ),
      ).toBe(true);
    });

    it('operationalizes an unpriced receipt without inventing a pricing operation', async () => {
      const before = await onHand(whSecondId, itemBId);
      const draft = await createDocument({
        kind: 'receipt',
        warehouseId: whSecondId,
        lines: [{ itemId: itemBId, quantity: '11', unitId: unitAId }],
      });
      expect(draft['valuationState']).toBe('unpriced');

      const finalized = await finalize(draft['id'] as string);
      expect(finalized['status']).toBe('operational');
      expect(finalized['valuationState']).toBe('unpriced');
      expect(await movementCount(draft['id'] as string)).toBe(1);
      expect(await onHand(whSecondId, itemBId)).toBe(before + 11);

      const rows = await (
        await movementRows()
      ).findMany({ where: { referenceId: draft['id'] } });
      expect(rows[0]!['valuationStatus']).toBe('unvalued');
      expect(rows[0]!['totalCost']).toBeNull();
    });

    it('posts an issue whose value is derived, never entered', async () => {
      await receiveStock(whMainId, itemBId, '60');
      const before = await onHand(whMainId, itemBId);

      const rejected = await operator
        .post(base)
        .send({
          organizationId: orgAId,
          kind: 'issue',
          warehouseId: whMainId,
          cost: '10',
          lines: [{ itemId: itemBId, quantity: '5', unitId: unitAId }],
        })
        .expect(400);
      expect(JSON.stringify(rejected.body)).toContain(
        'costNotAcceptedForDocumentKind',
      );

      const draft = await createDocument({
        kind: 'issue',
        warehouseId: whMainId,
        lines: [{ itemId: itemBId, quantity: '25', unitId: unitAId }],
      });
      await finalize(draft['id'] as string);
      expect(await onHand(whMainId, itemBId)).toBe(before - 25);
      const rows = await (
        await movementRows()
      ).findMany({ where: { referenceId: draft['id'] } });
      expect(rows[0]!['movementType']).toBe('outbound');
      expect(String(rows[0]!['baseQuantity'])).toBe('-25');
    });

    it('posts a transfer as two legs sharing one transfer id', async () => {
      await receiveStock(whMainId, itemAId, '40');
      const sourceBefore = await onHand(whMainId, itemAId);
      const destinationBefore = await onHand(whSecondId, itemAId);

      const draft = await createDocument({
        kind: 'transfer',
        sourceWarehouseId: whMainId,
        destinationWarehouseId: whSecondId,
        lines: [{ itemId: itemAId, quantity: '15', unitId: unitAId }],
      });
      const finalized = await finalize(draft['id'] as string);
      const line = (finalized['lines'] as Array<Record<string, unknown>>)[0]!;
      expect(line['outMovementId']).not.toBeNull();
      expect(line['inMovementId']).not.toBeNull();

      const rows = await (
        await movementRows()
      ).findMany({ where: { referenceId: draft['id'] } });
      expect(rows).toHaveLength(2);
      expect(rows[0]!['transferId']).toBe(rows[1]!['transferId']);
      expect(rows[0]!['transferId']).not.toBeNull();
      expect(await onHand(whMainId, itemAId)).toBe(sourceBefore - 15);
      expect(await onHand(whSecondId, itemAId)).toBe(destinationBefore + 15);
    });

    it('values a BACKDATED transfer by replaying BOTH keys together (C-59C)', async () => {
      const costedReceipt = async (
        warehouseId: string,
        quantity: string,
        cost: string,
        businessDate: string,
      ): Promise<void> => {
        const draft = await createDocument({
          kind: 'receipt',
          warehouseId,
          businessDate,
          cost,
          lines: [{ itemId: itemCId, quantity, unitId: unitAId }],
        });
        await finalize(draft['id'] as string);
      };
      // Source average 100/unit, destination average 50/unit, and a movement
      // AFTER the transfer on both keys. The pair (Jan 15) must therefore be
      // valued from the source position ON ITS DATE (5 × 100), and the
      // movements that follow it must be recomputed around the arriving
      // value.
      await costedReceipt(whMainId, '10', '1000', '2026-01-10T00:00:00.000Z');
      await costedReceipt(whSecondId, '20', '1000', '2026-01-05T00:00:00.000Z');
      await costedReceipt(whMainId, '10', '3000', '2026-01-20T00:00:00.000Z');
      const issueDraft = await createDocument({
        kind: 'issue',
        warehouseId: whSecondId,
        businessDate: '2026-02-01T00:00:00.000Z',
        lines: [{ itemId: itemCId, quantity: '12', unitId: unitAId }],
      });
      const issued = await finalize(issueDraft['id'] as string);
      const issueMovementId = (
        issued['lines'] as Array<Record<string, unknown>>
      )[0]!['movementId'] as string;

      const draft = await createDocument({
        kind: 'transfer',
        sourceWarehouseId: whMainId,
        destinationWarehouseId: whSecondId,
        businessDate: '2026-01-15T00:00:00.000Z',
        lines: [{ itemId: itemCId, quantity: '5', unitId: unitAId }],
      });
      const draftId = draft['id'] as string;

      // Unconfirmed: the shared backdating refusal, naming BOTH keys with
      // what each of them actually holds. Nothing is written.
      const refused = await operator
        .post(`${base}/${draftId}/finalize`)
        .query({ organizationId: orgAId })
        .send({})
        .expect(422);
      expect(refused.body['details']).toMatchObject({
        code: 'inventory.backdated_document',
        keys: [
          {
            warehouseId: whMainId,
            latestMovementDate: '2026-01-20T00:00:00.000Z',
          },
          {
            warehouseId: whSecondId,
            latestMovementDate: '2026-02-01T00:00:00.000Z',
          },
        ],
      });
      expect(await movementCount(draftId)).toBe(0);

      const confirmedResponse = await operator
        .post(`${base}/${draftId}/finalize`)
        .query({ organizationId: orgAId })
        .send({ backdateConfirmed: true })
        .expect(200);
      const confirmed = confirmedResponse.body as Record<string, unknown>;
      expect(confirmed['status']).toBe('operational');
      // The coupled replay restated both keys, so the document is NOT flagged
      // as carrying unreconciled values.
      expect(confirmed['valuationStale']).toBe(false);

      const legs = await (
        await movementRows()
      ).findMany({ where: { referenceId: draftId } });
      expect(legs).toHaveLength(2);
      const outLeg = legs.find(
        (leg) => leg['movementType'] === 'transfer_out',
      )!;
      const inLeg = legs.find((leg) => leg['movementType'] === 'transfer_in')!;
      expect(decimalAtScale(outLeg['totalCost'], 2)).toBe('-500.00');
      expect(decimalAtScale(inLeg['totalCost'], 2)).toBe('500.00');
      expect(outLeg['valuationSource']).toBe('transfer');

      // The destination's later issue was recomputed around the arriving
      // value: 12 of the 25 units now cost 720, where the incremental path
      // had written 600.
      const restated = await (
        await movementRows()
      ).findMany({ where: { id: issueMovementId } });
      expect(decimalAtScale(restated[0]!['totalCost'], 2)).toBe('-720.00');
      expect(restated[0]!['valuationRunId']).not.toBeNull();

      const stateProbe = (
        await prisma.getClient<{
          inventoryValuationState: {
            findMany: (
              args: unknown,
            ) => Promise<Array<Record<string, unknown>>>;
          };
        }>()
      ).inventoryValuationState;
      const states = await stateProbe.findMany({
        where: {
          organizationId: orgAId,
          itemId: itemCId,
          warehouseId: { in: [whMainId, whSecondId] },
        },
      });
      const byWarehouse = new Map(
        states.map((row) => [row['warehouseId'] as string, row]),
      );
      expect(decimalAtScale(byWarehouse.get(whMainId)!['totalValue'], 2)).toBe(
        '3500.00',
      );
      expect(
        decimalAtScale(byWarehouse.get(whSecondId)!['totalValue'], 2),
      ).toBe('780.00');
      expect(byWarehouse.get(whMainId)!['staleSince']).toBeNull();
      expect(byWarehouse.get(whSecondId)!['staleSince']).toBeNull();
    });

    // -----------------------------------------------------------------------
    // 2. Atomicity — a failed command leaves the database untouched
    // -----------------------------------------------------------------------

    it('rolls a failed issue back completely: no movement, no balance change, still a draft', async () => {
      const available = await onHand(whMainId, itemBId);
      const draft = await createDocument({
        kind: 'issue',
        warehouseId: whMainId,
        lines: [
          {
            itemId: itemBId,
            quantity: String(available + 1000),
            unitId: unitAId,
          },
        ],
      });
      const refused = await finalize(draft['id'] as string, 422);
      expect(JSON.stringify(refused)).toContain('inventory.insufficient_stock');

      expect(await movementCount(draft['id'] as string)).toBe(0);
      expect(await onHand(whMainId, itemBId)).toBe(available);
      const reloaded = await operator
        .get(`${base}/${draft['id'] as string}`)
        .query({ organizationId: orgAId })
        .expect(200);
      expect(reloaded.body.status).toBe('draft');
      expect(reloaded.body.number).toBeNull();
    });

    it('never leaves half a transfer behind when the source cannot cover it', async () => {
      const sourceBefore = await onHand(whSecondId, itemBId);
      const destinationBefore = await onHand(whMainId, itemBId);
      const draft = await createDocument({
        kind: 'transfer',
        sourceWarehouseId: whSecondId,
        destinationWarehouseId: whMainId,
        lines: [
          {
            itemId: itemBId,
            quantity: String(sourceBefore + 500),
            unitId: unitAId,
          },
        ],
      });
      await finalize(draft['id'] as string, 422);

      expect(await movementCount(draft['id'] as string)).toBe(0);
      expect(await onHand(whSecondId, itemBId)).toBe(sourceBefore);
      expect(await onHand(whMainId, itemBId)).toBe(destinationBefore);
    });

    it('rejects an edit that would make stock negative and changes nothing', async () => {
      const receipt = await createDocument({
        kind: 'receipt',
        warehouseId: whSecondId,
        lines: [{ itemId: itemBId, quantity: '100', unitId: unitAId }],
      });
      await finalize(receipt['id'] as string);
      const issue = await createDocument({
        kind: 'issue',
        warehouseId: whSecondId,
        lines: [{ itemId: itemBId, quantity: '95', unitId: unitAId }],
      });
      await finalize(issue['id'] as string);
      const balanceBefore = await onHand(whSecondId, itemBId);
      const movementsBefore = await movementCount(receipt['id'] as string);

      const refused = await operator
        .patch(`${base}/${receipt['id'] as string}`)
        .query({ organizationId: orgAId })
        .send({
          acknowledgeSideEffects: true,
          repricing: 'skip',
          lines: [{ itemId: itemBId, quantity: '10', unitId: unitAId }],
        })
        .expect(422);
      expect(JSON.stringify(refused.body)).toContain(
        'inventory.insufficient_stock',
      );

      expect(await onHand(whSecondId, itemBId)).toBe(balanceBefore);
      expect(await movementCount(receipt['id'] as string)).toBe(
        movementsBefore,
      );
      const reloaded = await operator
        .get(`${base}/${receipt['id'] as string}`)
        .query({ organizationId: orgAId })
        .expect(200);
      expect(reloaded.body.lines[0].quantity).toBe('100');
      expect(reloaded.body.status).toBe('operational');
    });

    // -----------------------------------------------------------------------
    // 3. Concurrency — real row locks, not a single-threaded fake
    // -----------------------------------------------------------------------

    it('posts exactly once when the same draft is finalized concurrently', async () => {
      const before = await onHand(whMainId, itemAId);
      const draft = await createDocument({
        kind: 'receipt',
        warehouseId: whMainId,
        lines: [{ itemId: itemAId, quantity: '30', unitId: unitAId }],
      });
      const id = draft['id'] as string;

      const results = await Promise.all([
        operator
          .post(`${base}/${id}/finalize`)
          .query({ organizationId: orgAId })
          .send({}),
        operator
          .post(`${base}/${id}/finalize`)
          .query({ organizationId: orgAId })
          .send({}),
      ]);
      // At least one succeeds; neither may produce a second ledger effect.
      expect(results.some((result) => result.status === 200)).toBe(true);
      expect(await movementCount(id)).toBe(1);
      expect(await onHand(whMainId, itemAId)).toBe(before + 30);

      const numbers = new Set(
        results
          .filter((result) => result.status === 200)
          .map((result) => result.body.number as string),
      );
      expect(numbers.size).toBe(1);
    });

    it('never lets two concurrent issues drive the same stock negative', async () => {
      const receipt = await createDocument({
        kind: 'receipt',
        warehouseId: whSecondId,
        lines: [{ itemId: itemAId, quantity: '100', unitId: unitAId }],
      });
      await finalize(receipt['id'] as string);
      const before = await onHand(whSecondId, itemAId);

      const drafts = await Promise.all([
        createDocument({
          kind: 'issue',
          warehouseId: whSecondId,
          lines: [
            { itemId: itemAId, quantity: String(before), unitId: unitAId },
          ],
        }),
        createDocument({
          kind: 'issue',
          warehouseId: whSecondId,
          lines: [
            { itemId: itemAId, quantity: String(before), unitId: unitAId },
          ],
        }),
      ]);
      const results = await Promise.all(
        drafts.map((draft) =>
          operator
            .post(`${base}/${draft['id'] as string}/finalize`)
            .query({ organizationId: orgAId })
            .send({}),
        ),
      );
      const succeeded = results.filter((result) => result.status === 200);
      expect(succeeded).toHaveLength(1);
      expect(await onHand(whSecondId, itemAId)).toBe(0);
    });

    // -----------------------------------------------------------------------
    // 4. Edit pipeline, cancellation, numbering, lifecycle
    // -----------------------------------------------------------------------

    it('reconciles a quantity edit by reversing and re-posting, and records the stale valuation', async () => {
      const before = await onHand(whMainId, itemAId);
      const receipt = await createDocument({
        kind: 'receipt',
        warehouseId: whMainId,
        lines: [{ itemId: itemAId, quantity: '50', unitId: unitAId }],
      });
      const id = receipt['id'] as string;
      await finalize(id);
      expect(await onHand(whMainId, itemAId)).toBe(before + 50);

      // No silent side effect: the unacknowledged edit is refused.
      const unacknowledged = await operator
        .patch(`${base}/${id}`)
        .query({ organizationId: orgAId })
        .send({ lines: [{ itemId: itemAId, quantity: '40', unitId: unitAId }] })
        .expect(422);
      expect(JSON.stringify(unacknowledged.body)).toContain(
        'side_effect_acknowledgement_required',
      );

      const edited = await operator
        .patch(`${base}/${id}`)
        .query({ organizationId: orgAId })
        .send({
          acknowledgeSideEffects: true,
          repricing: 'skip',
          lines: [{ itemId: itemAId, quantity: '40', unitId: unitAId }],
        })
        .expect(200);
      expect(edited.body.valuationStale).toBe(true);
      expect(await onHand(whMainId, itemAId)).toBe(before + 40);
      // original + reversal + re-post, all referencing this document.
      expect(await movementCount(id)).toBe(3);
    });

    it('ROLLS BACK the whole edit when the explicitly requested repricing fails', async () => {
      // `repricing: "recalculate"` runs INSIDE the command's transaction.
      // A refused valuation replay must therefore take the reversal, the
      // re-post and the header change down with it — a posted quantity
      // whose valuation never ran would be exactly the dishonest state the
      // explicit-repricing contract exists to prevent.
      const before = await onHand(whMainId, itemAId);
      const receipt = await createDocument({
        kind: 'receipt',
        warehouseId: whMainId,
        lines: [{ itemId: itemAId, quantity: '30', unitId: unitAId }],
      });
      const id = receipt['id'] as string;
      await finalize(id);
      expect(await onHand(whMainId, itemAId)).toBe(before + 30);
      const movementsAfterFinalize = await movementCount(id);

      FaultInjectingValuationRepository.failWithin = true;
      let refused: Record<string, unknown>;
      try {
        const response = await operator
          .patch(`${base}/${id}`)
          .query({ organizationId: orgAId })
          .send({
            acknowledgeSideEffects: true,
            repricing: 'recalculate',
            lines: [{ itemId: itemAId, quantity: '25', unitId: unitAId }],
          })
          .expect(422);
        refused = response.body as Record<string, unknown>;
      } finally {
        FaultInjectingValuationRepository.failWithin = false;
      }
      // The failure is surfaced, never swallowed.
      expect(JSON.stringify(refused)).toContain(
        'inventory.recalculation_too_large',
      );

      // Nothing of the edit survived: no reversal, no re-post, no header
      // change, and no half-written valuation state.
      expect(await onHand(whMainId, itemAId)).toBe(before + 30);
      expect(await movementCount(id)).toBe(movementsAfterFinalize);
      const reloaded = await operator
        .get(`${base}/${id}`)
        .query({ organizationId: orgAId })
        .expect(200);
      expect(reloaded.body.status).toBe('operational');
      expect(reloaded.body.valuationStale).toBe(false);
      expect(
        (reloaded.body.lines as Array<Record<string, unknown>>)[0]?.[
          'quantity'
        ],
      ).toBe('30');

      // And the same edit succeeds once the valuation replay is healthy,
      // proving the refusal was the only thing standing in its way.
      const repriced = await operator
        .patch(`${base}/${id}`)
        .query({ organizationId: orgAId })
        .send({
          acknowledgeSideEffects: true,
          repricing: 'recalculate',
          lines: [{ itemId: itemAId, quantity: '25', unitId: unitAId }],
        })
        .expect(200);
      expect(repriced.body.valuationStale).toBe(false);
      expect(await onHand(whMainId, itemAId)).toBe(before + 25);
    });

    it('keeps the number allocation outside the inventory transaction, and never reuses it', async () => {
      // Numbering is its OWN transactional boundary (Documents module). A
      // failed finalize does not roll the allocation back; what protects
      // the series is the allocation key, which is the document id.
      const client = await prisma.getClient<{
        numberingAllocation: {
          findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
        };
      }>();
      const allocationOf = (documentId: string) =>
        client.numberingAllocation.findFirst({
          where: { allocationKey: documentId, organizationId: orgAId },
        });

      const available = await onHand(whSecondId, itemAId);
      const draft = await createDocument({
        kind: 'issue',
        warehouseId: whSecondId,
        lines: [
          {
            itemId: itemAId,
            quantity: String(available + 7),
            unitId: unitAId,
          },
        ],
      });
      const id = draft['id'] as string;

      const refused = await finalize(id, 422);
      expect(JSON.stringify(refused)).toContain('inventory.insufficient_stock');
      // Inventory side: untouched.
      expect(await movementCount(id)).toBe(0);
      expect(await onHand(whSecondId, itemAId)).toBe(available);
      const stillDraft = await operator
        .get(`${base}/${id}`)
        .query({ organizationId: orgAId })
        .expect(200);
      expect(stillDraft.body.status).toBe('draft');
      // The document carries no number...
      expect(stillDraft.body.number).toBeNull();
      // ...but the allocation it reserved survived the rollback.
      const reserved = await allocationOf(id);
      expect(reserved).not.toBeNull();
      const reservedNumber = reserved!['number'] as string;

      // Retry once the stock exists: the SAME number, not a second one.
      await receiveStock(whSecondId, itemAId, '50');
      // The replenishing receipt is now the latest movement on this key, so
      // the retry is a backdated posting and must answer both questions —
      // which also exercises the in-transaction repricing on a finalize.
      const retried = await operator
        .post(`${base}/${id}/finalize`)
        .query({ organizationId: orgAId })
        .send({ backdateConfirmed: true, repricing: 'recalculate' })
        .expect(200);
      const finalized = retried.body as Record<string, unknown>;
      expect(finalized['status']).toBe('operational');
      expect(finalized['valuationStale']).toBe(false);
      expect(finalized['number']).toBe(reservedNumber);
      const afterRetry = await allocationOf(id);
      expect(afterRetry!['id']).toBe(reserved!['id']);

      // A different document never receives that number.
      const other = await createDocument({
        kind: 'issue',
        warehouseId: whSecondId,
        lines: [{ itemId: itemAId, quantity: '1', unitId: unitAId }],
      });
      const otherFinalized = await finalize(other['id'] as string);
      expect(otherFinalized['number']).not.toBe(reservedNumber);
    });

    it('cancels an operational document by reversing it, keeps its number, and never reuses it', async () => {
      const before = await onHand(whMainId, itemAId);
      const receipt = await createDocument({
        kind: 'receipt',
        warehouseId: whMainId,
        lines: [{ itemId: itemAId, quantity: '20', unitId: unitAId }],
      });
      const id = receipt['id'] as string;
      const finalized = await finalize(id);
      const number = finalized['number'] as string;

      const cancelled = await operator
        .post(`${base}/${id}/cancel`)
        .query({ organizationId: orgAId })
        .send({ reason: 'Received in error' })
        .expect(200);
      expect(cancelled.body.status).toBe('cancelled');
      expect(cancelled.body.number).toBe(number);
      expect(cancelled.body.cancellationReason).toBe('Received in error');
      expect(await onHand(whMainId, itemAId)).toBe(before);
      expect(await movementCount(id)).toBe(2);

      // Still visible and listable (OD-54-08).
      const listed = await operator
        .get(base)
        .query({
          organizationId: orgAId,
          status: 'cancelled',
          page: 1,
          pageSize: 50,
        })
        .expect(200);
      expect(
        (listed.body.items as Array<Record<string, unknown>>).some(
          (row) => row['id'] === id,
        ),
      ).toBe(true);

      // The next receipt gets a NEW number: the cancelled one is gone forever.
      const next = await createDocument({
        kind: 'receipt',
        warehouseId: whMainId,
        lines: [{ itemId: itemAId, quantity: '1', unitId: unitAId }],
      });
      const nextFinalized = await finalize(next['id'] as string);
      expect(nextFinalized['number']).not.toBe(number);
    });

    it('walks the lifecycle and refuses every illegal move along it', async () => {
      const receipt = await createDocument({
        kind: 'receipt',
        warehouseId: whMainId,
        cost: '50.00',
        lines: [{ itemId: itemAId, quantity: '5', unitId: unitAId }],
      });
      const id = receipt['id'] as string;
      const scope = { organizationId: orgAId };

      // Draft → accounting posted is illegal.
      await operator
        .post(`${base}/${id}/accounting-post`)
        .query(scope)
        .send({})
        .expect(422);

      await finalize(id);
      // Finalized but unposted is still editable (OQ-54 acceptance #2).
      await operator
        .patch(`${base}/${id}`)
        .query(scope)
        .send({ description: 'still editable while operational' })
        .expect(200);

      await operator
        .post(`${base}/${id}/accounting-post`)
        .query(scope)
        .send({})
        .expect(200);
      // Accounting posted: no direct edit, no delete, no cancel.
      await operator
        .patch(`${base}/${id}`)
        .query(scope)
        .send({ description: 'nope' })
        .expect(422);
      await operator.delete(`${base}/${id}`).query(scope).expect(422);
      await operator
        .post(`${base}/${id}/cancel`)
        .query(scope)
        .send({})
        .expect(422);

      await operator
        .post(`${base}/${id}/seal`)
        .query(scope)
        .send({})
        .expect(200);
      await operator
        .post(`${base}/${id}/seal`)
        .query(scope)
        .send({})
        .expect(422);
    });

    it('deletes a draft but refuses to delete a document with history', async () => {
      const draft = await createDocument({
        kind: 'receipt',
        warehouseId: whMainId,
        lines: [{ itemId: itemAId, quantity: '3', unitId: unitAId }],
      });
      await operator
        .delete(`${base}/${draft['id'] as string}`)
        .query({ organizationId: orgAId })
        .expect(204);
      await operator
        .get(`${base}/${draft['id'] as string}`)
        .query({ organizationId: orgAId })
        .expect(404);
    });

    // -----------------------------------------------------------------------
    // 5. Authorization and organization isolation
    // -----------------------------------------------------------------------

    it('refuses to post ledger facts to a caller holding only document permissions', async () => {
      const draft = await clerk
        .post(base)
        .send({
          organizationId: orgAId,
          kind: 'receipt',
          warehouseId: whMainId,
          lines: [{ itemId: itemAId, quantity: '7', unitId: unitAId }],
        })
        .expect(201);
      const id = draft.body.id as string;

      await clerk
        .post(`${base}/${id}/finalize`)
        .query({ organizationId: orgAId })
        .send({})
        .expect(403);
      expect(await movementCount(id)).toBe(0);
    });

    it('answers 404 — never 403 — for a document outside the caller\u2019s organization', async () => {
      const draft = await createDocument({
        kind: 'receipt',
        warehouseId: whMainId,
        lines: [{ itemId: itemAId, quantity: '2', unitId: unitAId }],
      });
      const id = draft['id'] as string;
      for (const call of [
        () => operator.get(`${base}/${id}`).query({ organizationId: orgBId }),
        () =>
          operator
            .patch(`${base}/${id}`)
            .query({ organizationId: orgBId })
            .send({ description: 'x' }),
        () =>
          operator
            .post(`${base}/${id}/finalize`)
            .query({ organizationId: orgBId })
            .send({}),
        () =>
          operator
            .post(`${base}/${id}/cancel`)
            .query({ organizationId: orgBId })
            .send({}),
        () =>
          operator.delete(`${base}/${id}`).query({ organizationId: orgBId }),
      ]) {
        const response = await call();
        // 404 (not a member of org B → the scope check itself answers 404,
        // and a member would also get 404 because the row is not theirs).
        expect(response.status).toBe(404);
        expect(JSON.stringify(response.body)).not.toContain(whMainId);
      }
      expect(await movementCount(id)).toBe(0);
    });
  },
);
