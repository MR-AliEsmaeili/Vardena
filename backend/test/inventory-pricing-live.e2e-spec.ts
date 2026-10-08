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
  INVENTORY_PURCHASE_RETURN_DOCUMENT_TYPE,
  INVENTORY_RECEIPT_DOCUMENT_TYPE,
  INVENTORY_SALES_RETURN_DOCUMENT_TYPE,
  INVENTORY_TRANSFER_DOCUMENT_TYPE,
} from '../src/modules/inventory/domain/inventory-document-types.js';
import { createTestApp } from './support/test-app.js';

/**
 * Periodic Pricing and Reverse Pricing (C-59E/C-59E+) against REAL
 * PostgreSQL — the correction sprint's live evidence.
 *
 * Skipped unless `VARDENA_TEST_DATABASE_URL` is set (GitHub CI with
 * Postgres, or local Docker). The hermetic suites
 * (`inventory-pricing.service.spec.ts`,
 * `valuation-compensation.spec.ts`) prove the rules against fakes; they
 * structurally CANNOT prove the things only a real database answers, which
 * is exactly what this file exists for:
 *
 *   1. **Axis 1 (the reverse fold).** After a reverse, the movement ROWS
 *      really carry `total_cost IS NULL` / `valuation_status =
 *      'unvalued'` / the compensating run id, the valuation STATE really
 *      sits at the PRE-run fold (value parked, key stale) — not the
 *      post-run position the stale-snapshot defect produced — and no
 *      quantity column moved.
 *   2. **Axis 2 (retry semantics).** A run with a failed key does not
 *      advance the scope's from-date on the REAL
 *      `findLastRunForScope` SQL; after the blocker is fixed the next run
 *      re-covers the window and prices the failed key, quantities
 *      unchanged. A reversed run does not advance it either.
 *   3. **Concurrency (axis 4).** Genuinely concurrent pricing↔pricing,
 *      pricing↔reverse, post↔reverse and reverse↔reverse over real HTTP
 *      against real row locks: one outcome per the domain semantics, no
 *      duplicate or torn artifacts, no deadlock.
 *   4. **Accounting eligibility (axis 5).** Unpriced and stale documents
 *      are refused at the boundary; an accounting-posted document is
 *      frozen for edits and its pricing run can no longer be reversed.
 *
 * Every command goes through real authenticated HTTP; row-level truth is
 * asserted by reading `inventory` tables directly through Prisma, never by
 * trusting the response body. Each test owns a PRIVATE WAREHOUSE, which
 * gives it a private stocking key AND a private pricing-scope history
 * (scope identity = organization + warehouse + kind set), so run
 * boundaries are asserted against a clean scope every time.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

interface MovementProbeRow {
  id: string;
  movementType: string;
  baseQuantity: unknown;
  totalCost: unknown;
  valuationStatus: string;
  valuationSource: string | null;
  valuationRunId: string | null;
  referenceId: string | null;
}

interface StateProbeRow {
  valuedQuantity: unknown;
  uncostedQuantity: unknown;
  totalValue: unknown;
  status: string;
  lastRecalculationId: string | null;
}

interface CoreClientProbe {
  inventoryMovement: {
    findMany: (args: unknown) => Promise<MovementProbeRow[]>;
  };
  inventoryPricingRun: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    count: (args: unknown) => Promise<number>;
  };
  inventoryPricingRunKeyOutcome: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
  inventoryValuationRun: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
  inventoryValuationState: {
    findMany: (args: unknown) => Promise<StateProbeRow[]>;
  };
}

describe.skipIf(DATABASE_URL === undefined)(
  'Inventory pricing and reverse pricing (live database)',
  () => {
    const suffix = generateId().slice(-8).toLowerCase();

    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let client: CoreClientProbe;

    // One private warehouse per test (see the file header): stocking keys
    // and pricing-scope histories never leak across tests.
    const privateWarehouses: string[] = [];

    let orgAId = '';
    let orgBId = '';
    let whSecondId = '';
    let unitAId = '';
    let itemAId = '';
    let itemBId = '';

    let operatorId = '';
    let operatorRoleId = '';
    const operatorUsername = `invprc-op-${suffix}`;
    const password = 'Invprc-live-password-1';

    let operator: ReturnType<typeof request.agent>;

    const http = () => app!.getHttpServer();

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

    const documentsBase = '/api/v1/inventory/business-documents';
    const pricingBase = '/api/v1/inventory/pricing';

    let operationSerial = 0;
    function nextOperationKey(prefix: string): string {
      operationSerial += 1;
      return `${prefix}-${suffix}-${operationSerial}`;
    }

    async function createDocument(
      body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const response = await operator
        .post(documentsBase)
        .send({ organizationId: orgAId, ...body })
        .expect(201);
      return response.body as Record<string, unknown>;
    }

    async function finalize(
      id: string,
      expected = 200,
    ): Promise<Record<string, unknown>> {
      const response = await operator
        .post(`${documentsBase}/${id}/finalize`)
        .query({ organizationId: orgAId })
        .send({})
        .expect(expected);
      return response.body as Record<string, unknown>;
    }

    async function receiveStock(
      itemId: string,
      quantity: string,
      warehouseId: string,
      cost?: string,
    ): Promise<Record<string, unknown>> {
      const draft = await createDocument({
        kind: 'receipt',
        warehouseId,
        lines: [{ itemId, quantity, unitId: unitAId }],
        ...(cost === undefined ? {} : { cost }),
      });
      return finalize(draft['id'] as string);
    }

    async function issueStock(
      itemId: string,
      quantity: string,
      warehouseId: string,
    ): Promise<Record<string, unknown>> {
      const draft = await createDocument({
        kind: 'issue',
        warehouseId,
        lines: [{ itemId, quantity, unitId: unitAId }],
      });
      return finalize(draft['id'] as string);
    }

    async function runPricing(
      warehouseId: string,
      toDate: Date,
      expected = 201,
    ): Promise<Record<string, unknown>> {
      const response = await operator
        .post(`${pricingBase}/runs`)
        .send({
          organizationId: orgAId,
          operationKey: nextOperationKey('price'),
          warehouseId,
          documentKinds: [
            'receipt',
            'issue',
            'transfer',
            'purchase_return',
            'sales_return',
          ],
          toDate: toDate.toISOString(),
        })
        .expect(expected);
      return response.body as Record<string, unknown>;
    }

    async function reversePricing(
      pricingRunId: string,
      expected = 201,
    ): Promise<Record<string, unknown>> {
      const response = await operator
        .post(`${pricingBase}/runs/reverse`)
        .send({
          organizationId: orgAId,
          pricingRunId,
          operationKey: nextOperationKey('reverse'),
        })
        .expect(expected);
      return response.body as Record<string, unknown>;
    }

    async function assignCost(
      movementId: string,
      totalCost: string,
      repricing: 'recalculate' | 'skip',
      expected = 201,
    ): Promise<Record<string, unknown>> {
      const response = await operator
        .post(`/api/v1/inventory/valuation/movements/${movementId}/cost`)
        .send({
          organizationId: orgAId,
          operationKey: nextOperationKey('assign'),
          totalCost,
          repricing,
        })
        .expect(expected);
      return response.body as Record<string, unknown>;
    }

    function dec(value: unknown, scale: number): string {
      const decimal = value as { toFixed?: (digits: number) => string };
      return typeof decimal?.toFixed === 'function'
        ? decimal.toFixed(scale)
        : String(value);
    }

    async function movementsOfDocument(
      documentId: string,
    ): Promise<MovementProbeRow[]> {
      return client.inventoryMovement.findMany({
        where: { referenceId: documentId },
        orderBy: { createdAt: 'asc' },
      });
    }

    async function stateRow(
      warehouseId: string,
      itemId: string,
    ): Promise<StateProbeRow> {
      const rows = await client.inventoryValuationState.findMany({
        where: { organizationId: orgAId, warehouseId, itemId },
      });
      expect(rows).toHaveLength(1);
      return rows[0]!;
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

    /**
     * The canonical reverse scenario, on a private warehouse:
     * a receipt that arrives WITHOUT its cost, two issues that therefore
     * post unvalued, the cost assigned afterwards (skip — the run is the
     * retry), and one pricing run that prices both issues and stamps them
     * with its per-key run. Returns what the reverse tests need.
     */
    async function pricedIssuesScenario(warehouseId: string): Promise<{
      run: Record<string, unknown>;
      issueDocumentIds: string[];
    }> {
      const receipt = await receiveStock(itemAId, '100', warehouseId);
      const issueA = await issueStock(itemAId, '40', warehouseId);
      const issueB = await issueStock(itemAId, '10', warehouseId);
      const receiptMovement = (
        await movementsOfDocument(receipt['id'] as string)
      )[0]!;
      expect(receiptMovement.valuationStatus).toBe('unvalued');
      await assignCost(receiptMovement.id, '1000', 'skip');

      const run = await runPricing(warehouseId, new Date(Date.now() + 60_000));
      expect(run['keysPriced']).toBe(1);
      expect(run['keysFailed']).toBe(0);
      for (const documentId of [issueA['id'], issueB['id']] as string[]) {
        const movement = (await movementsOfDocument(documentId))[0]!;
        expect(movement.valuationStatus).toBe('valued');
        expect(movement.valuationRunId).not.toBeNull();
      }
      const state = await stateRow(warehouseId, itemAId);
      expect(dec(state.valuedQuantity, 4)).toBe('50.0000');
      expect(dec(state.totalValue, 2)).toBe('500.00');
      expect(state.status).toBe('valued');
      return {
        run,
        issueDocumentIds: [issueA['id'] as string, issueB['id'] as string],
      };
    }

    beforeAll(async () => {
      const baseConfig = loadAppConfig();
      const built = await createTestApp({
        override: (builder) =>
          builder.overrideProvider(APP_CONFIG).useValue({
            ...baseConfig,
            databaseUrl: DATABASE_URL,
            // This suite issues many non-login API calls in quick
            // succession (several concurrency rounds), beyond the general
            // per-IP budget that `rate-limit.e2e-spec.ts` covers on its
            // own. The login limit is left untouched.
            rateLimit: { ...baseConfig.rateLimit, max: 5000 },
          }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);
      client = await prisma.getClient<CoreClientProbe>();

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
        code: `PRLA-${suffix}`,
        name: 'Pricing Live Org A',
      });
      const orgB = await organizations.createOrganization({
        code: `PRLB-${suffix}`,
        name: 'Pricing Live Org B',
      });
      orgAId = orgA.id;
      orgBId = orgB.id;

      for (const documentType of [
        INVENTORY_RECEIPT_DOCUMENT_TYPE,
        INVENTORY_ISSUE_DOCUMENT_TYPE,
        INVENTORY_TRANSFER_DOCUMENT_TYPE,
        INVENTORY_PURCHASE_RETURN_DOCUMENT_TYPE,
        INVENTORY_SALES_RETURN_DOCUMENT_TYPE,
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

      whSecondId = (
        await warehouses.createWarehouse({
          organizationId: orgAId,
          branchId: branchA.id,
          code: 'WH-SECOND',
          name: 'Second warehouse',
        })
      ).id;
      for (let index = 1; index <= 16; index += 1) {
        privateWarehouses.push(
          (
            await warehouses.createWarehouse({
              organizationId: orgAId,
              branchId: branchA.id,
              code: `WH-T${index}`,
              name: `Test warehouse ${index}`,
            })
          ).id,
        );
      }
      expect(privateWarehouses).toHaveLength(16);

      const unitA = await units.createUnit({
        organizationId: orgAId,
        code: 'EA',
        name: 'Each',
      });
      unitAId = unitA.id;
      const unitB = await units.createUnit({
        organizationId: orgBId,
        code: 'EA',
        name: 'Each',
      });

      itemAId = (
        await items.createItem({
          organizationId: orgAId,
          code: 'ITM-A',
          name: 'Item A',
          itemKind: 'goods',
          baseUnitId: unitAId,
        })
      ).id;
      itemBId = (
        await items.createItem({
          organizationId: orgAId,
          code: 'ITM-B',
          name: 'Item B',
          itemKind: 'goods',
          baseUnitId: unitAId,
        })
      ).id;

      // Org B has real rows so isolation probes are meaningful.
      const orgBWarehouse = await warehouses.createWarehouse({
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
      expect(orgBWarehouse.id).toBeTruthy();

      const operatorRole = await roles.createRole({
        name: `Pricing operator ${suffix}`,
        description:
          'Live-spec fixture: C-58 documents, ledger authority, valuation and pricing authority.',
        permissionCodes: [
          ...Object.values(INVENTORY_DOCUMENT_PERMISSIONS),
          MOVEMENT_PERMISSIONS.CREATE,
          MOVEMENT_PERMISSIONS.REVERSE,
          MOVEMENT_PERMISSIONS.VIEW,
          TRANSFER_PERMISSIONS.CREATE,
          BALANCE_PERMISSIONS.VIEW,
          VALUATION_PERMISSIONS.VIEW,
          VALUATION_PERMISSIONS.ASSIGN_COST,
          VALUATION_PERMISSIONS.RECALCULATE,
          VALUATION_PERMISSIONS.RUN_PRICING,
          VALUATION_PERMISSIONS.REVERSE_PRICING,
        ],
      });
      operatorRoleId = operatorRole.id;

      const operatorUser = await users.createUser({
        username: operatorUsername,
        password,
      });
      operatorId = operatorUser.id;
      await userRoles.assignRoleToUser(operatorRoleId, operatorId);
      await memberships.grantMembership(orgAId, operatorId);

      operator = await loggedInAgent(operatorUsername);
    }, 180_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        const cleanup = await prisma.getClient<{
          inventoryBusinessDocumentLine: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryAccountingPostingSnapshotMovement: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryAccountingPostingSnapshot: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryAccountingPostingOperation: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryBusinessDocument: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryPricingRunKeyOutcome: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryPricingRun: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryOperation: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          numberingAllocation: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          numberingSeries: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          inventoryBalance: {
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
        await cleanup.inventoryAccountingPostingSnapshotMovement.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.inventoryAccountingPostingSnapshot.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.inventoryAccountingPostingOperation.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.inventoryBusinessDocumentLine.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.inventoryBusinessDocument.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.inventoryPricingRunKeyOutcome.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.inventoryPricingRun.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.inventoryOperation.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.numberingAllocation.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.numberingSeries.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.inventoryBalance.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.inventoryMovement.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.inventoryValuationState.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.inventoryValuationRun.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.itemValuationMethod.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.warehouse.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.item.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.unit.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.branch.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.organizationMembership.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await cleanup.organization.deleteMany({
          where: { id: { in: orgIds } },
        });
        await cleanup.userRole.deleteMany({
          where: { userId: operatorId },
        });
        await cleanup.rolePermission.deleteMany({
          where: { roleId: operatorRoleId },
        });
        await cleanup.role.deleteMany({
          where: { id: operatorRoleId },
        });
        await cleanup.user.deleteMany({ where: { id: operatorId } });
      } finally {
        await app.close();
      }
    }, 120_000);

    // -----------------------------------------------------------------------
    // 1. Periodic Pricing — the window, the boundary and the retry loop
    // -----------------------------------------------------------------------

    it('prices a stale key exactly once per movement and stamps the run (OD-PDP-01…05)', async () => {
      // A receipt without a cost, an issue that could not be valued; the
      // cost arrives (skip) and the RUN is the retry that prices history.
      const receipt = await receiveStock(itemAId, '100', privateWarehouses[0]!);
      const issue = await issueStock(itemAId, '40', privateWarehouses[0]!);
      const receiptMovement = (
        await movementsOfDocument(receipt['id'] as string)
      )[0]!;
      const issueMovement = (
        await movementsOfDocument(issue['id'] as string)
      )[0]!;
      expect(issueMovement.valuationStatus).toBe('unvalued');

      await assignCost(receiptMovement.id, '1000', 'skip');

      const run = await runPricing(
        privateWarehouses[0]!,
        new Date(Date.now() + 60_000),
      );
      expect(run['keysExamined']).toBe(1);
      expect(run['keysPriced']).toBe(1);
      expect(run['keysFailed']).toBe(0);
      expect(run['fromDate']).toBeNull();

      // The issue is valued at the average and stamped with the run's
      // per-key valuation run — exactly one valuation per movement row.
      const issueAfter = (await movementsOfDocument(issue['id'] as string))[0]!;
      expect(dec(issueAfter.totalCost, 2)).toBe('-400.00');
      expect(issueAfter.valuationStatus).toBe('valued');
      expect(issueAfter.valuationRunId).not.toBeNull();
      expect(dec(issueAfter.baseQuantity, 4)).toBe(
        dec(issueMovement.baseQuantity, 4),
      );

      // The receipt keeps its entered value — preserved, never re-derived.
      const receiptAfter = (
        await movementsOfDocument(receipt['id'] as string)
      )[0]!;
      expect(dec(receiptAfter.totalCost, 2)).toBe('1000.00');
      expect(receiptAfter.valuationRunId).toBeNull();

      const state = await stateRow(privateWarehouses[0]!, itemAId);
      expect(dec(state.valuedQuantity, 4)).toBe('60.0000');
      expect(dec(state.totalValue, 2)).toBe('600.00');
      expect(state.status).toBe('valued');
      expect(await onHand(privateWarehouses[0]!, itemAId)).toBe(60);
    });

    it('AXIS 2: a failed key stays in scope — the boundary does not advance past it, and the retry prices it', async () => {
      // Item A: healthy from the start. Item B: a receipt with NO cost
      // blocks its key (OD-PDP-03).
      await receiveStock(itemAId, '50', privateWarehouses[1]!, '500');
      const unvaluedReceipt = await receiveStock(
        itemBId,
        '10',
        privateWarehouses[1]!,
      );
      const unvaluedMovement = (
        await movementsOfDocument(unvaluedReceipt['id'] as string)
      )[0]!;
      expect(unvaluedMovement.valuationStatus).toBe('unvalued');

      const first = await runPricing(
        privateWarehouses[1]!,
        new Date(Date.now() + 60_000),
      );
      expect(first['keysExamined']).toBe(2);
      expect(first['keysPriced']).toBe(1);
      expect(first['keysFailed']).toBe(1);

      // The failure is AUDITABLE: an outcome row names the movement.
      const outcomes = await client.inventoryPricingRunKeyOutcome.findMany({
        where: { pricingRunId: first['id'] as string },
      });
      const failed = outcomes.find((o) => o['outcome'] === 'failed')!;
      expect(failed).toBeDefined();
      expect(failed['itemId']).toBe(itemBId);
      expect(failed['reason']).toBe(
        'inventory.pricing.unvalued_inbound_in_range',
      );
      expect(failed['failedMovementIds']).toEqual([unvaluedMovement.id]);

      // The failed run does NOT advance the from-date: the next run's
      // window still starts at the beginning of history (the axis-2
      // correction, against the real findLastRunForScope SQL).
      const second = await runPricing(
        privateWarehouses[1]!,
        new Date(Date.now() + 120_000),
      );
      expect(second['fromDate']).toBeNull();
      expect(second['keysFailed']).toBe(1);

      // Fix the blocker: the receipt receives its cost; the run retries.
      await assignCost(unvaluedMovement.id, '120', 'skip');
      const third = await runPricing(
        privateWarehouses[1]!,
        new Date(Date.now() + 180_000),
      );
      expect(third['keysPriced']).toBe(2);
      expect(third['keysFailed']).toBe(0);
      // The retried key is valued now, and its quantity never moved.
      const retried = (
        await movementsOfDocument(unvaluedReceipt['id'] as string)
      )[0]!;
      expect(retried.valuationStatus).toBe('valued');
      expect(dec(retried.totalCost, 2)).toBe('120.00');
      expect(dec(retried.baseQuantity, 4)).toBe('10.0000');
      expect(await onHand(privateWarehouses[1]!, itemBId)).toBe(10);

      // NOW the boundary advances: a fully-completed run is the new edge.
      const fourth = await runPricing(
        privateWarehouses[1]!,
        new Date(Date.now() + 240_000),
      );
      expect(fourth['fromDate']).not.toBeNull();
      expect(new Date(fourth['fromDate'] as string).getTime()).toBe(
        new Date(third['toDate'] as string).getTime(),
      );
    });

    it('is idempotent per operation key and refuses a reused key with a different intent', async () => {
      await receiveStock(itemAId, '5', privateWarehouses[2]!, '50');
      const toDate = new Date(Date.now() + 60_000).toISOString();
      const key = nextOperationKey('price');
      const body = {
        organizationId: orgAId,
        operationKey: key,
        warehouseId: privateWarehouses[2]!,
        documentKinds: [
          'receipt',
          'issue',
          'transfer',
          'purchase_return',
          'sales_return',
        ],
        toDate,
      };
      const first = await operator
        .post(`${pricingBase}/runs`)
        .send(body)
        .expect(201);
      const runsBefore = await client.inventoryPricingRun.count({
        where: { organizationId: orgAId },
      });

      const replay = await operator
        .post(`${pricingBase}/runs`)
        .send(body)
        .expect(201);
      expect(replay.body['id']).toBe(first.body['id']);
      expect(
        await client.inventoryPricingRun.count({
          where: { organizationId: orgAId },
        }),
      ).toBe(runsBefore);

      const conflicting = await operator
        .post(`${pricingBase}/runs`)
        .send({
          ...body,
          toDate: new Date(Date.now() + 120_000).toISOString(),
        })
        .expect(409);
      expect(conflicting.body['code']).toBe('Conflict');
    });

    it('never answers another organization\u2019s pricing run', async () => {
      const own = await runPricing(
        privateWarehouses[3]!,
        new Date(Date.now() + 60_000),
      );
      const response = await operator
        .get(`${pricingBase}/runs/${own['id'] as string}`)
        .query({ organizationId: orgBId });
      expect(response.status).toBe(404);
    });

    // -----------------------------------------------------------------------
    // 2. Reverse Pricing — the compensation fold and its guards
    // -----------------------------------------------------------------------

    it('AXIS 1: reverses to the PRE-run fold on the real database — values erased, quantities untouched, key stale', async () => {
      const { run, issueDocumentIds } = await pricedIssuesScenario(
        privateWarehouses[4]!,
      );
      const runId = run['id'] as string;

      const issuesBefore = (
        await Promise.all(issueDocumentIds.map((id) => movementsOfDocument(id)))
      ).flat();
      expect(issuesBefore).toHaveLength(2);

      const reverse = await reversePricing(runId);
      const compensatingId = reverse['id'] as string;

      // The original is MARKED, never deleted.
      const original = await client.inventoryPricingRun.findUnique({
        where: { id: runId },
      });
      expect(original?.['reversedByRunId']).toBe(compensatingId);
      expect(original?.['reversedAt']).not.toBeNull();

      // The compensating run exists and points back.
      const compensating = await client.inventoryPricingRun.findUnique({
        where: { id: compensatingId },
      });
      expect(compensating?.['kind']).toBe('reverse_pricing');
      expect(compensating?.['reversesRunId']).toBe(runId);
      expect(compensating?.['keysExamined']).toBe(1);

      // Every issue the run valued is un-valued, pointing at the
      // compensating run; the quantities are byte-identical.
      const issuesAfter = (
        await Promise.all(issueDocumentIds.map((id) => movementsOfDocument(id)))
      ).flat();
      for (const [index, issue] of issuesAfter.entries()) {
        expect(dec(issue.baseQuantity, 4)).toBe(
          dec(issuesBefore[index]!.baseQuantity, 4),
        );
        expect(issue.totalCost).toBeNull();
        expect(issue.valuationStatus).toBe('unvalued');
        expect(issue.valuationRunId).not.toBeNull();
      }

      // The valuation STATE sits at the PRE-run fold: 50 valued units
      // carrying the WHOLE 1000 (the outbounds' value is parked, not
      // attributed), and the key is STALE. The stale-snapshot defect
      // produced the post-run position (500) instead.
      const state = await stateRow(privateWarehouses[4]!, itemAId);
      expect(dec(state.valuedQuantity, 4)).toBe('50.0000');
      expect(dec(state.uncostedQuantity, 4)).toBe('0.0000');
      expect(dec(state.totalValue, 2)).toBe('1000.00');
      expect(state.status).toBe('stale');
      expect(state.lastRecalculationId).not.toBe(runId);

      // Quantity columns never moved: on-hand is exactly the fold.
      expect(await onHand(privateWarehouses[4]!, itemAId)).toBe(50);

      // The per-key compensating valuation run is recorded (audit trail).
      const valuationRuns = await client.inventoryValuationRun.findMany({
        where: {
          organizationId: orgAId,
          warehouseId: privateWarehouses[4]!,
          itemId: itemAId,
          trigger: 'reverse_pricing',
        },
      });
      expect(valuationRuns).toHaveLength(1);
      expect(valuationRuns[0]!['resultingStatus']).toBe('stale');
    });

    it('AXIS 2 (reverse half): a reversed run does not advance the from-date; the next run re-prices the window', async () => {
      const { run } = await pricedIssuesScenario(privateWarehouses[5]!);
      await reversePricing(run['id'] as string);

      const next = await runPricing(
        privateWarehouses[5]!,
        new Date(Date.now() + 120_000),
      );
      // The reversed run no longer counts as completed: the window starts
      // at the beginning again, and the re-pricing restores the position.
      expect(next['fromDate']).toBeNull();
      const state = await stateRow(privateWarehouses[5]!, itemAId);
      expect(dec(state.valuedQuantity, 4)).toBe('50.0000');
      expect(dec(state.totalValue, 2)).toBe('500.00');
      expect(state.status).toBe('valued');
    });

    it('refuses to reverse a run that is no longer the latest valuation (reverse_not_latest_run)', async () => {
      const { run } = await pricedIssuesScenario(privateWarehouses[6]!);
      // A newer valuation on the same key, through the front door: an issue
      // whose business date falls INSIDE the next run's window (after the
      // first run's toDate — the automatic boundary makes now-dated
      // movements unreachable until then), priced by a second run whose
      // whole-key replay re-derives the key.
      const laterIssue = await createDocument({
        kind: 'issue',
        warehouseId: privateWarehouses[6]!,
        businessDate: new Date(Date.now() + 90_000).toISOString(),
        lines: [{ itemId: itemAId, quantity: '5', unitId: unitAId }],
      });
      await finalize(laterIssue['id'] as string);
      const second = await runPricing(
        privateWarehouses[6]!,
        new Date(Date.now() + 120_000),
      );
      expect(second['keysExamined']).toBe(1);
      const refused = await reversePricing(run['id'] as string, 422);
      expect(refused['details']).toMatchObject({
        code: 'inventory.pricing.reverse_not_latest_run',
      });
      const original = await client.inventoryPricingRun.findUnique({
        where: { id: run['id'] as string },
      });
      expect(original?.['reversedByRunId']).toBeNull();
    });

    // The `reverse_accounting_posted` rule needs a document that REALLY crossed
    // the Accounting boundary, and this suite configures no Accounting mapping
    // — so every `accounting-post` here is a refusal and the premise cannot be
    // built. The rule itself is covered hermetically
    // (`inventory-pricing.service.spec.ts`, "refuses when an affected document
    // has crossed Accounting Post"); the live proof now lives in
    // `inventory-accounting-posting-live.e2e-spec.ts`, which has the Accounting
    // master data and can actually cross.
    it('does NOT block reverse pricing for a document whose posting was refused', async () => {
      const { run } = await pricedIssuesScenario(privateWarehouses[7]!);
      await operator
        .post(`${documentsBase}/${run['id'] as string}/accounting-post`)
        .query({ organizationId: orgAId })
        .send({})
        .expect(404);

      // A refused posting never reached the books, so it must not freeze the
      // valuation history: the compensating run is still allowed.
      const reverse = await reversePricing(run['id'] as string);
      expect(reverse['kind']).toBe('reverse_pricing');
    });

    it('refuses to reverse a compensating run (reverse_of_reverse) and an already-reversed run (409)', async () => {
      const { run } = await pricedIssuesScenario(privateWarehouses[8]!);
      const reverse = await reversePricing(run['id'] as string);

      const ofReverse = await reversePricing(reverse['id'] as string, 422);
      expect(ofReverse['details']).toMatchObject({
        code: 'inventory.pricing.reverse_of_reverse',
      });

      const again = await reversePricing(run['id'] as string, 409);
      expect(again['message']).toContain('already reversed');

      // Exactly one compensating run exists for the original.
      const compensatingRuns = await client.inventoryPricingRun.count({
        where: {
          organizationId: orgAId,
          kind: 'reverse_pricing',
          reversesRunId: run['id'] as string,
        },
      });
      expect(compensatingRuns).toBe(1);
    });

    it('replays the stored reverse for a retried operation key (idempotency)', async () => {
      const { run } = await pricedIssuesScenario(privateWarehouses[9]!);
      const key = nextOperationKey('reverse');
      const first = await operator
        .post(`${pricingBase}/runs/reverse`)
        .send({
          organizationId: orgAId,
          pricingRunId: run['id'],
          operationKey: key,
        })
        .expect(201);
      const second = await operator
        .post(`${pricingBase}/runs/reverse`)
        .send({
          organizationId: orgAId,
          pricingRunId: run['id'],
          operationKey: key,
        })
        .expect(201);
      expect(second.body['id']).toBe(first.body['id']);
      const compensatingRuns = await client.inventoryPricingRun.count({
        where: {
          organizationId: orgAId,
          kind: 'reverse_pricing',
          reversesRunId: run['id'] as string,
        },
      });
      expect(compensatingRuns).toBe(1);
    });

    // -----------------------------------------------------------------------
    // 3. Concurrency over real row locks (axis 4)
    // -----------------------------------------------------------------------

    it('pricing ↔ pricing: two concurrent runs of one scope leave one consistent answer, nothing double-counted', async () => {
      await receiveStock(itemBId, '80', privateWarehouses[10]!, '800');
      const issue = await issueStock(itemBId, '30', privateWarehouses[10]!);

      const toDate = new Date(Date.now() + 300_000).toISOString();
      const results = await Promise.all([
        operator.post(`${pricingBase}/runs`).send({
          organizationId: orgAId,
          operationKey: nextOperationKey('price'),
          warehouseId: privateWarehouses[10]!,
          documentKinds: [
            'receipt',
            'issue',
            'transfer',
            'purchase_return',
            'sales_return',
          ],
          toDate,
        }),
        operator.post(`${pricingBase}/runs`).send({
          organizationId: orgAId,
          operationKey: nextOperationKey('price'),
          warehouseId: privateWarehouses[10]!,
          documentKinds: [
            'receipt',
            'issue',
            'transfer',
            'purchase_return',
            'sales_return',
          ],
          toDate,
        }),
      ]);
      // Domain semantics: both may complete (whole-key replay is
      // idempotent), or the second is refused because the first already
      // covered the exact window (range_not_extending). Neither may fail
      // any other way, and neither may double-count.
      for (const result of results) {
        expect([201, 422]).toContain(result.status);
        if (result.status === 422) {
          expect(result.body['details']).toMatchObject({
            code: 'inventory.pricing.range_not_extending',
          });
        }
      }
      expect(results.some((result) => result.status === 201)).toBe(true);

      // The movement is valued EXACTLY once: one row, one consistent
      // answer. (It was already valued at posting time — average_cost —
      // so an idempotent replay may leave the posting valuation
      // unstamped; what must hold is the single consistent value.)
      const movements = await movementsOfDocument(issue['id'] as string);
      expect(movements).toHaveLength(1);
      expect(movements[0]!.valuationStatus).toBe('valued');
      expect(dec(movements[0]!.totalCost, 2)).toBe('-300.00');

      // The state is the same single answer either order produces.
      const state = await stateRow(privateWarehouses[10]!, itemBId);
      expect(dec(state.valuedQuantity, 4)).toBe('50.0000');
      expect(dec(state.totalValue, 2)).toBe('500.00');
      expect(state.status).toBe('valued');
      expect(await onHand(privateWarehouses[10]!, itemBId)).toBe(50);
    });

    it('pricing ↔ reverse: one domain outcome, one consistent state, no deadlock', async () => {
      const { run } = await pricedIssuesScenario(privateWarehouses[11]!);

      const results = await Promise.all([
        operator.post(`${pricingBase}/runs/reverse`).send({
          organizationId: orgAId,
          pricingRunId: run['id'],
          operationKey: nextOperationKey('reverse'),
        }),
        operator.post(`${pricingBase}/runs`).send({
          organizationId: orgAId,
          operationKey: nextOperationKey('price'),
          warehouseId: privateWarehouses[11]!,
          documentKinds: [
            'receipt',
            'issue',
            'transfer',
            'purchase_return',
            'sales_return',
          ],
          toDate: new Date(Date.now() + 300_000).toISOString(),
        }),
      ]);
      const [reverseResult, pricingResult] = results;
      expect(pricingResult.status).toBe(201);

      const original = await client.inventoryPricingRun.findUnique({
        where: { id: run['id'] as string },
      });
      if (reverseResult.status === 201) {
        // The reverse won (or committed first): the original is marked.
        expect(original?.['reversedByRunId']).not.toBeNull();
      } else {
        // The pricing run committed first: the reverse is refused by the
        // latest-run guard — never a torn compensation.
        expect(reverseResult.status).toBe(422);
        expect(reverseResult.body['details']).toMatchObject({
          code: 'inventory.pricing.reverse_not_latest_run',
        });
        expect(original?.['reversedByRunId']).toBeNull();
      }

      // Two legitimate interleavings, one invariant each:
      // - The pricing run started AFTER the reverse committed: its
      //   automatic from-date is null (the reversed run no longer counts),
      //   it re-covered the whole window and re-priced the key.
      // - The pricing run started FIRST: the reverse had not committed at
      //   its boundary read, its window (the previous run's toDate → its
      //   own toDate) legitimately contained no movement, and it completed
      //   EMPTY. The key then sits at the pre-run fold, honestly STALE —
      //   and because an empty run advances nothing, the NEXT run must
      //   re-cover and re-price it (OD-RVP-06). No stranded state.
      if (pricingResult.body['keysExamined'] === 1) {
        const state = await stateRow(privateWarehouses[11]!, itemAId);
        expect(dec(state.valuedQuantity, 4)).toBe('50.0000');
        expect(dec(state.totalValue, 2)).toBe('500.00');
        expect(state.status).toBe('valued');
      } else {
        expect(pricingResult.body['keysExamined']).toBe(0);
        expect(reverseResult.status).toBe(201);
        const stale = await stateRow(privateWarehouses[11]!, itemAId);
        expect(dec(stale.valuedQuantity, 4)).toBe('50.0000');
        expect(dec(stale.totalValue, 2)).toBe('1000.00');
        expect(stale.status).toBe('stale');
        const recovery = await runPricing(
          privateWarehouses[11]!,
          new Date(Date.now() + 60_000),
        );
        expect(recovery['fromDate']).toBeNull();
        expect(recovery['keysPriced']).toBe(1);
        const recovered = await stateRow(privateWarehouses[11]!, itemAId);
        expect(dec(recovered.valuedQuantity, 4)).toBe('50.0000');
        expect(dec(recovered.totalValue, 2)).toBe('500.00');
        expect(recovered.status).toBe('valued');
      }
      expect(await onHand(privateWarehouses[11]!, itemAId)).toBe(50);
    });

    it('post ↔ reverse: a concurrent receipt and reverse compose to one identical state in either order', async () => {
      const { run } = await pricedIssuesScenario(privateWarehouses[12]!);
      expect(await onHand(privateWarehouses[12]!, itemAId)).toBe(50);

      const draft = await createDocument({
        kind: 'receipt',
        warehouseId: privateWarehouses[12]!,
        lines: [{ itemId: itemAId, quantity: '20', unitId: unitAId }],
        cost: '200',
      });
      const results = await Promise.all([
        operator
          .post(`${documentsBase}/${draft['id'] as string}/finalize`)
          .query({ organizationId: orgAId })
          .send({}),
        operator.post(`${pricingBase}/runs/reverse`).send({
          organizationId: orgAId,
          pricingRunId: run['id'],
          operationKey: nextOperationKey('reverse'),
        }),
      ]);
      const [finalizeResult, reverseResult] = results;
      expect(finalizeResult.status).toBe(200);
      expect(reverseResult.status).toBe(201);

      // Order-independence by construction: the receipt's valued inbound
      // fact joins the pool and the issues' erased values park, so BOTH
      // interleavings end at 70 valued units carrying 1200.
      expect(await onHand(privateWarehouses[12]!, itemAId)).toBe(70);
      const state = await stateRow(privateWarehouses[12]!, itemAId);
      expect(dec(state.valuedQuantity, 4)).toBe('70.0000');
      expect(dec(state.totalValue, 2)).toBe('1200.00');
      // The posting's receipt keeps its entered value.
      const receiptMovements = await movementsOfDocument(draft['id'] as string);
      expect(dec(receiptMovements[0]!.totalCost, 2)).toBe('200.00');
    });

    it('reverse ↔ reverse: exactly one of two concurrent reverses wins, the loser writes nothing', async () => {
      const { run } = await pricedIssuesScenario(privateWarehouses[13]!);
      const runId = run['id'] as string;

      const results = await Promise.all([
        operator.post(`${pricingBase}/runs/reverse`).send({
          organizationId: orgAId,
          pricingRunId: runId,
          operationKey: nextOperationKey('reverse'),
        }),
        operator.post(`${pricingBase}/runs/reverse`).send({
          organizationId: orgAId,
          pricingRunId: runId,
          operationKey: nextOperationKey('reverse'),
        }),
      ]);
      const statuses = results.map((result) => result.status).sort();
      expect(statuses).toEqual([201, 409]);

      // Exactly ONE compensating run; the original marked exactly once.
      const compensating = await client.inventoryPricingRun.findMany({
        where: {
          organizationId: orgAId,
          kind: 'reverse_pricing',
          reversesRunId: runId,
        },
      });
      expect(compensating).toHaveLength(1);
      const original = await client.inventoryPricingRun.findUnique({
        where: { id: runId },
      });
      expect(original?.['reversedByRunId']).toBe(compensating[0]!['id']);

      // And the key is at the pre-run fold — once, not twice.
      const state = await stateRow(privateWarehouses[13]!, itemAId);
      expect(dec(state.valuedQuantity, 4)).toBe('50.0000');
      expect(dec(state.totalValue, 2)).toBe('1000.00');
      expect(state.status).toBe('stale');
      expect(await onHand(privateWarehouses[13]!, itemAId)).toBe(50);
    });

    // -----------------------------------------------------------------------
    // 4. Accounting eligibility and the immutability boundary (axis 5)
    // -----------------------------------------------------------------------

    it('refuses accounting post for unpriced and stale documents, and freezes a posted document', async () => {
      // Unpriced: a receipt without a cost.
      const unpriced = await receiveStock(itemBId, '7', privateWarehouses[14]!);
      const refusedUnpriced = await operator
        .post(`${documentsBase}/${unpriced['id'] as string}/accounting-post`)
        .query({ organizationId: orgAId })
        .send({})
        .expect(422);
      expect(refusedUnpriced.body['details']).toMatchObject({
        code: 'inventory.document.accounting_ineligible',
        valuationState: 'unpriced',
      });

      // Stale: an edit whose valuation side effect is explicitly skipped is
      // recorded honestly — the document stays priced but is FLAGGED, and
      // the accounting boundary refuses it (OD-54-06 + OD-PRC-11). (A
      // key-level `assignCost(..., 'skip')` marks the KEY inconsistent but
      // is not a document-level gate: the established eligibility contract
      // is operational AND fully-priced movements AND not
      // header-valuationStale.)
      const staleReceipt = await receiveStock(
        itemBId,
        '6',
        privateWarehouses[14]!,
        '60',
      );
      const patched = await operator
        .patch(`${documentsBase}/${staleReceipt['id'] as string}`)
        .query({ organizationId: orgAId })
        .send({
          cost: '60',
          acknowledgeSideEffects: true,
          repricing: 'skip',
          lines: [{ itemId: itemBId, quantity: '5', unitId: unitAId }],
        })
        .expect(200);
      expect(patched.body['valuationStale']).toBe(true);
      const refusedStale = await operator
        .post(
          `${documentsBase}/${staleReceipt['id'] as string}/accounting-post`,
        )
        .query({ organizationId: orgAId })
        .send({})
        .expect(422);
      expect(refusedStale.body['details']).toMatchObject({
        code: 'inventory.document.accounting_ineligible',
        valuationState: 'priced',
        valuationStale: true,
      });

      // Fully priced: Inventory DOES cross its own boundary here, but this
      // suite configures no `accounting.source_posting_mappings` row, so
      // Accounting refuses (fail closed, never a guessed account, C62-OD-04).
      // A refusal is a durable fact about the OPERATION, not a lifecycle
      // crossing: the document stays operational and stays editable. The happy
      // path — the document actually becoming `accounting_posted` and freezing
      // — is proven in `inventory-accounting-posting-live.e2e-spec.ts`, where
      // the Accounting master data exists.
      const priced = await receiveStock(
        itemBId,
        '3',
        privateWarehouses[14]!,
        '30',
      );
      const posted = await operator
        .post(`${documentsBase}/${priced['id'] as string}/accounting-post`)
        .query({ organizationId: orgAId })
        .send({})
        .expect(200);
      expect(posted.body['status']).toBe('operational');
      expect(posted.body['accountingPostingState']).toBe('not_posted');

      // Idempotent replay of the refused attempt: the SAME durable operation
      // answers, no second one is written.
      const replay = await operator
        .post(`${documentsBase}/${priced['id'] as string}/accounting-post`)
        .query({ organizationId: orgAId })
        .send({})
        .expect(200);
      expect(replay.body['status']).toBe('operational');

      // Still operational, so an edit is still legal.
      const edited = await operator
        .patch(`${documentsBase}/${priced['id'] as string}`)
        .query({ organizationId: orgAId })
        .send({ description: 'still editable after a refused posting' })
        .expect(200);
      expect(edited.body['description']).toBe(
        'still editable after a refused posting',
      );
    });

    it('walks the full pipeline: receipt → issue → returns → transfer → pricing → accounting post (e2e regression)', async () => {
      // Receipt with a cost.
      const receipt = await receiveStock(
        itemAId,
        '100',
        privateWarehouses[15]!,
        '1000',
      );
      const receiptMovement = (
        await movementsOfDocument(receipt['id'] as string)
      )[0]!;

      // Issue 40 (valued at the average at posting time).
      const issue = await issueStock(itemAId, '40', privateWarehouses[15]!);
      const issueMovement = (
        await movementsOfDocument(issue['id'] as string)
      )[0]!;
      expect(dec(issueMovement.totalCost, 2)).toBe('-400.00');

      // Purchase return of 10 against the receipt: mirrors its own cost.
      const purchaseReturn = await createDocument({
        kind: 'purchase_return',
        warehouseId: privateWarehouses[15]!,
        lines: [
          {
            itemId: itemAId,
            quantity: '10',
            unitId: unitAId,
            basisMovementId: receiptMovement.id,
          },
        ],
      });
      await finalize(purchaseReturn['id'] as string);
      const returnMovement = (
        await movementsOfDocument(purchaseReturn['id'] as string)
      )[0]!;
      expect(dec(returnMovement.totalCost, 2)).toBe('-100.00');
      expect(returnMovement.valuationSource).toBe('return_basis');

      // Sales return of 5 based on the issue, at an explicit amount.
      const salesReturn = await createDocument({
        kind: 'sales_return',
        warehouseId: privateWarehouses[15]!,
        cost: '60',
        lines: [
          {
            itemId: itemAId,
            quantity: '5',
            unitId: unitAId,
            basisMovementId: issueMovement.id,
          },
        ],
      });
      await finalize(salesReturn['id'] as string);
      const salesReturnMovement = (
        await movementsOfDocument(salesReturn['id'] as string)
      )[0]!;
      expect(dec(salesReturnMovement.totalCost, 2)).toBe('60.00');
      expect(salesReturnMovement.valuationSource).toBe('entered');

      // Transfer 20 to the second warehouse.
      const transfer = await createDocument({
        kind: 'transfer',
        sourceWarehouseId: privateWarehouses[15]!,
        destinationWarehouseId: whSecondId,
        lines: [{ itemId: itemAId, quantity: '20', unitId: unitAId }],
      });
      await finalize(transfer['id'] as string);
      const transferLegs = await movementsOfDocument(transfer['id'] as string);
      expect(transferLegs).toHaveLength(2);

      // A pricing run over every kind prices the whole history; the
      // transfer legs keep their posting-time values (source 'transfer'),
      // preserved — never re-derived — by the replay.
      const run = await runPricing(
        privateWarehouses[15]!,
        new Date(Date.now() + 300_000),
      );
      expect(run['keysFailed']).toBe(0);
      const legsAfter = await movementsOfDocument(transfer['id'] as string);
      expect(legsAfter.every((leg) => leg.valuationSource === 'transfer')).toBe(
        true,
      );

      // Quantities survived the run untouched.
      expect(await onHand(privateWarehouses[15]!, itemAId)).toBe(35);
      expect(await onHand(whSecondId, itemAId)).toBe(20);

      // The fully-priced receipt reaches the accounting boundary. This suite
      // has no Accounting mapping configured, so the crossing is refused and
      // the document stays operational — see the note in the eligibility test
      // above, and `inventory-accounting-posting-live.e2e-spec.ts` for the run
      // that really posts.
      const posted = await operator
        .post(`${documentsBase}/${receipt['id'] as string}/accounting-post`)
        .query({ organizationId: orgAId })
        .send({})
        .expect(200);
      expect(posted.body['status']).toBe('operational');
      expect(posted.body['accountingPostingState']).toBe('not_posted');
      // (The reverse-after-accounting-post blocker is proven by its own
      // dedicated test above, on a run that actually stamped movements.)
    });

    it('keeps a basis-linked unvalued purchase return unvalued through a recalculation (OD-RET-02/04)', async () => {
      const warehouseId = privateWarehouses[14]!;

      // Basis receipt WITHOUT a cost, an issue that consumes exactly those
      // uncosted units, then a costed receipt: the return's quantity will
      // come out of the VALUED pool without carrying value.
      const basisReceipt = await receiveStock(itemAId, '10', warehouseId);
      const basisMovement = (
        await movementsOfDocument(basisReceipt['id'] as string)
      )[0]!;
      expect(basisMovement.valuationStatus).toBe('unvalued');
      await issueStock(itemAId, '10', warehouseId);
      await receiveStock(itemAId, '5', warehouseId, '500');

      const purchaseReturn = await createDocument({
        kind: 'purchase_return',
        warehouseId,
        lines: [
          {
            itemId: itemAId,
            quantity: '4',
            unitId: unitAId,
            basisMovementId: basisMovement.id,
          },
        ],
      });
      await finalize(purchaseReturn['id'] as string);
      const returnMovement = (
        await movementsOfDocument(purchaseReturn['id'] as string)
      )[0]!;
      // The posting path already refuses to invent a value…
      expect(returnMovement.valuationStatus).toBe('unvalued');
      expect(returnMovement.totalCost).toBeNull();
      expect(returnMovement.valuationSource).toBe('return_basis');
      // …and honestly flags the key, because the exit consumed valued stock.
      const afterPost = await stateRow(warehouseId, itemAId);
      expect(afterPost.status).toBe('stale');
      expect(dec(afterPost.valuedQuantity, 4)).toBe('1.0000');
      expect(dec(afterPost.totalValue, 2)).toBe('100.00');

      // A recalculation replays the whole key and must reproduce that fact
      // EXACTLY: the same unvalued exit, nothing restated, the key still
      // honestly stale, and every quantity untouched.
      const recalculation = await operator
        .post('/api/v1/inventory/valuation/recalculations')
        .send({
          organizationId: orgAId,
          operationKey: nextOperationKey('recalc'),
          warehouseId,
          itemId: itemAId,
        })
        .expect(201);
      const run = recalculation.body['run'] as Record<string, unknown>;
      expect(run['movementsExamined']).toBe(4);
      expect(run['movementsRevalued']).toBe(0);

      const replayed = (
        await movementsOfDocument(purchaseReturn['id'] as string)
      )[0]!;
      expect(replayed.valuationStatus).toBe('unvalued');
      expect(replayed.totalCost).toBeNull();
      expect(replayed.valuationSource).toBe('return_basis');

      const afterReplay = await stateRow(warehouseId, itemAId);
      expect(afterReplay.status).toBe('stale');
      expect(dec(afterReplay.valuedQuantity, 4)).toBe('1.0000');
      expect(dec(afterReplay.uncostedQuantity, 4)).toBe('0.0000');
      expect(dec(afterReplay.totalValue, 2)).toBe('100.00');
      expect(await onHand(warehouseId, itemAId)).toBe(1);
    });
  },
);
