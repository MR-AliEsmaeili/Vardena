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
import { InventoryMovementsService } from '../src/modules/inventory/application/inventory-movements.service.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { MATERIAL_REQUEST_PERMISSIONS } from '../src/modules/inventory/domain/material-request-permissions.js';
import {
  BALANCE_PERMISSIONS,
  MOVEMENT_PERMISSIONS,
  RESERVATION_PERMISSIONS,
} from '../src/modules/inventory/domain/inventory-core-permissions.js';
import { MATERIAL_REQUEST_DOCUMENT_TYPE } from '../src/modules/inventory/domain/material-request-document-type.js';
import { NumberingSeriesService } from '../src/modules/documents/application/numbering-series.service.js';
import { MaterialRequestsRepository } from '../src/modules/inventory/data/material-requests.repository.js';
import { DocumentRelationsService } from '../src/modules/documents/application/document-relations.service.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database verification for Material Request (C-50), filling the gap
 * identified in PR #112 review: every other Inventory/master-data module has
 * a `*-live.e2e-spec.ts` proving real-Postgres behaviour; Material Request
 * had none. The hermetic suites (`material-requests.service.spec.ts`,
 * `material-request.spec.ts`) use a hand-rolled fake repository and cannot
 * prove real transactional atomicity, row-locking under concurrency, or
 * genuine organization-scoped isolation — that is exactly what this file
 * adds, against a real PostgreSQL instance.
 *
 * Unlike `warehouse-master-live.e2e-spec.ts` / `accounting-documents.e2e-spec.ts`,
 * Material Request's own actions (`requireActorId()`) unconditionally need a
 * real principal, so this suite authenticates real HTTP sessions
 * (`request.agent`) instead of calling the service directly in system
 * context — master data (organizations, branches, units, items, warehouses,
 * stock, users, roles) is still seeded directly through the application
 * services in system context, exactly like every other live spec, since none
 * of that setup is under test here.
 *
 * Covers (Task item 5 + re-verification of review findings #1–#4):
 *   1. Approval reserves stock atomically; a single insufficient-stock line
 *      refuses the WHOLE approval, including when mixed with an otherwise
 *      satisfiable line (no partial reservation).
 *   2. Organization isolation: a non-member cannot see another
 *      organization's Material Requests (404, never 403 — ODR-3).
 *   3. `PUT .../lines/invoke` rejects an unregistered destination type, a
 *      module/type mismatch, a nonexistent or cross-organization destination
 *      document, and a nonexistent destination line — all BEFORE consuming
 *      any invocation capacity (finding #2).
 *   4. Invocation capacity under concurrent requests never exceeds the
 *      line's remaining quantity (finding #4): the atomic check-and-write
 *      survives real concurrent HTTP calls, not just a single-threaded fake.
 *   5. Approval reversal is refused once any line has been invoked, and is
 *      refused to anyone other than the original approver — even another
 *      user who also holds the permission.
 *   6. `available` is computed by one consistent rule across
 *      `GET .../balances`, `GET .../balances/availability` and
 *      `GET .../balances/availability-across-warehouses`, under BOTH
 *      `reservationsReduceAvailable` settings (finding #3).
 *   7. Material Request mutations (create/update/submit/approve/reject)
 *      succeed for a role holding ONLY the Material Request lifecycle
 *      permissions — no `Documents.*` permission of any kind — proving
 *      finding #1 (no accidental dependency on `Documents.Relation.View`).
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Material Request (live database)',
  () => {
    const suffix = generateId().slice(-8).toLowerCase();

    let app: INestApplication | undefined;
    let prisma: PrismaService;

    let orgAId = '';
    let orgBId = '';
    let branchAId = '';
    let branchBId = '';
    let whA1Id = ''; // reservationsReduceAvailable: true
    let whA2Id = ''; // reservationsReduceAvailable: false
    let whA3Id = ''; // dedicated to the reservation-consumption scenarios
    // below (1000 on hand) — whA1/whA2 only ever carry 50 on hand, already
    // shared/drawn down by the pre-existing scenarios above (some of which
    // deliberately leave an active reservation behind, e.g. the refused-
    // cancellation test), so reusing them here would make these tests'
    // required headroom depend on execution order.
    let unitAId = '';
    let unitBId = '';
    let itemAId = '';
    let mrInOrgBId = ''; // cross-org destination probe

    let aliceId = '';
    let bobId = '';
    let roleId = '';
    const aliceUsername = `mr-alice-${suffix}`;
    const bobUsername = `mr-bob-${suffix}`;
    const alicePassword = 'Alice-live-password-1';
    const bobPassword = 'Bob-live-password-1';

    const http = () => app!.getHttpServer();

    // Logged in ONCE in `beforeAll` and reused by every `it()` below (each
    // `request.agent` keeps its own session cookie across calls): POST
    // /auth/login carries a strict per-window rate limit (security.md §5,
    // 10 attempts / 15 minutes by default) that a fresh login per test would
    // exhaust well before this suite finishes.
    let alice: ReturnType<typeof request.agent>;
    let bob: ReturnType<typeof request.agent>;

    async function loggedInAgent(
      username: string,
      password: string,
    ): Promise<ReturnType<typeof request.agent>> {
      const agent = request.agent(http());
      await agent
        .post('/api/v1/auth/login')
        .send({ username, password })
        .expect(200);
      return agent;
    }

    async function availabilitySnapshot(
      agent: ReturnType<typeof request.agent>,
      organizationId: string,
      warehouseId: string,
      itemId: string,
    ): Promise<{ onHand: number; reserved: number; available: number }> {
      const single = await agent
        .get('/api/v1/inventory/balances/availability')
        .query({ organizationId, warehouseId, itemId })
        .expect(200);
      const across = await agent
        .get('/api/v1/inventory/balances/availability-across-warehouses')
        .query({ organizationId, itemId })
        .expect(200);
      const list = await agent
        .get('/api/v1/inventory/balances')
        .query({ organizationId, warehouseId, itemId, page: 1, pageSize: 10 })
        .expect(200);

      const acrossRow = (across.body as Array<Record<string, unknown>>).find(
        (row) => row['warehouseId'] === warehouseId,
      );
      expect(
        acrossRow,
        'availability-across-warehouses must include this warehouse',
      ).toBeDefined();
      const listRow = (list.body.items as Array<Record<string, unknown>>)[0];

      const onHand = Number(single.body.onHand);
      const reserved = Number(single.body.reserved);
      const available = Number(single.body.available);

      // Finding #3: one shared computation, consistent across all three reads.
      expect(Number(acrossRow!['onHand'])).toBe(onHand);
      expect(Number(acrossRow!['reserved'])).toBe(reserved);
      expect(Number(acrossRow!['available'])).toBe(available);
      if (listRow !== undefined) {
        expect(Number(listRow['onHand'])).toBe(onHand);
        expect(Number(listRow['reserved'])).toBe(reserved);
        expect(Number(listRow['available'])).toBe(available);
      }
      // NOTE: `available` is only `onHand - reserved` when this warehouse's
      // `reservationsReduceAvailable` is true — it equals `onHand` unchanged
      // otherwise (finding #3's whole point). That per-warehouse rule is
      // asserted by the caller, which knows which warehouse and setting are
      // in play; asserting a fixed formula here would be wrong for a
      // warehouse configured the other way.
      return { onHand, reserved, available };
    }

    async function getReservation(
      agent: ReturnType<typeof request.agent>,
      organizationId: string,
      reservationId: string,
    ): Promise<{ status: string; quantity: string; baseQuantity: string }> {
      const response = await agent
        .get(`/api/v1/inventory/reservations/${reservationId}`)
        .query({ organizationId })
        .expect(200);
      return {
        status: response.body.status as string,
        quantity: response.body.quantity as string,
        baseQuantity: response.body.baseQuantity as string,
      };
    }

    beforeAll(async () => {
      const baseConfig = loadAppConfig();
      const built = await createTestApp({
        override: (builder) =>
          builder.overrideProvider(APP_CONFIG).useValue({
            ...baseConfig,
            databaseUrl: DATABASE_URL,
            // This file's own suite legitimately issues a large number of
            // non-login API calls in quick succession (many Material
            // Requests/destinations/invocations/availability reads across
            // all its scenarios, including the concurrency/compensation
            // audit round) — well beyond the general per-IP API budget
            // (security.md §5) within its 60s window. That general budget
            // is a production/abuse-prevention control, not a correctness
            // rule this suite is testing (which is covered on its own by
            // `rate-limit.e2e-spec.ts`); raising it for ONLY this test
            // app's instance avoids spurious 429s without touching the
            // separate, still-enforced `loginRateLimit`.
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
      const movements = app.get(InventoryMovementsService);
      const users = app.get(UsersService);
      const roles = app.get(RolesService);
      const userRoles = app.get(UserRolesService);
      const numberingSeries = app.get(NumberingSeriesService);

      // ---- Master data (system context, same posture as every other
      // *-live.e2e-spec.ts: trusted setup, not itself under test). ----
      const orgA = await organizations.createOrganization({
        code: `MRLA-${suffix}`,
        name: 'Material Request Live Org A',
      });
      const orgB = await organizations.createOrganization({
        code: `MRLB-${suffix}`,
        name: 'Material Request Live Org B',
      });
      orgAId = orgA.id;
      orgBId = orgB.id;

      // `submit()` allocates a number via the Documents Foundation's own
      // numbering series (default, org-wide scope — the Material Request
      // service passes no `scopeKey`); without this, every submit in this
      // suite would fail with "no numbering series configured" — a fixture
      // requirement, not a Material Request business rule under test here.
      await numberingSeries.createNumberingSeries({
        organizationId: orgAId,
        documentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
        name: `Material Request live ${suffix}`,
        width: 4,
      });

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
      branchAId = branchA.id;
      branchBId = branchB.id;

      const whA1 = await warehouses.createWarehouse({
        organizationId: orgAId,
        branchId: branchAId,
        code: 'WH-A1',
        name: 'Warehouse A1 (reservations reduce available)',
        reservationsReduceAvailable: true,
      });
      const whA2 = await warehouses.createWarehouse({
        organizationId: orgAId,
        branchId: branchAId,
        code: 'WH-A2',
        name: 'Warehouse A2 (reservations do not reduce available)',
        reservationsReduceAvailable: false,
      });
      const whA3 = await warehouses.createWarehouse({
        organizationId: orgAId,
        branchId: branchAId,
        code: 'WH-A3',
        name: 'Warehouse A3 (dedicated to reservation-consumption tests)',
        reservationsReduceAvailable: true,
      });
      await warehouses.createWarehouse({
        organizationId: orgBId,
        branchId: branchBId,
        code: 'WH-B1',
        name: 'Warehouse B1',
      });
      whA1Id = whA1.id;
      whA2Id = whA2.id;
      whA3Id = whA3.id;

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
      unitBId = unitB.id;

      const itemA = await items.createItem({
        organizationId: orgAId,
        code: 'ITM-A',
        name: 'Item A',
        itemKind: 'goods',
        baseUnitId: unitAId,
      });
      await items.createItem({
        organizationId: orgBId,
        code: 'ITM-B',
        name: 'Item B',
        itemKind: 'goods',
        baseUnitId: unitBId,
      });
      itemAId = itemA.id;

      // Real posted stock: 50 on hand in each of A1 and A2.
      await movements.postMovement({
        organizationId: orgAId,
        operationKey: `seed-a1-${suffix}`,
        warehouseId: whA1Id,
        itemId: itemAId,
        movementType: 'inbound',
        quantity: '50',
        unitId: unitAId,
      });
      await movements.postMovement({
        organizationId: orgAId,
        operationKey: `seed-a2-${suffix}`,
        warehouseId: whA2Id,
        itemId: itemAId,
        movementType: 'inbound',
        quantity: '50',
        unitId: unitAId,
      });
      // Generous headroom (1000) so the reservation-consumption scenarios
      // below never contend with each other for availability regardless of
      // execution order, including the one that deliberately leaves part of
      // its reservation active at the end (the concurrent-invocation race).
      await movements.postMovement({
        organizationId: orgAId,
        operationKey: `seed-a3-${suffix}`,
        warehouseId: whA3Id,
        itemId: itemAId,
        movementType: 'inbound',
        quantity: '1000',
        unitId: unitAId,
      });

      // A real Material Request living in org B — the cross-organization
      // destination probe for the invocation-validation scenarios below.
      // `MaterialRequestsService.createDraft` requires a real principal
      // (`requireActorId()`), which system context deliberately has none of;
      // this probe only needs to EXIST for `validateInvocationDestination`'s
      // existence/ownership lookup, so it is inserted directly through the
      // Prisma client (same posture as the cleanup code below), never
      // routing around the business rule this suite actually exercises.
      const client = await prisma.getClient<{
        materialRequest: {
          create: (args: unknown) => Promise<{ id: string }>;
        };
      }>();
      const probe = await client.materialRequest.create({
        data: {
          id: generateId(),
          organizationId: orgBId,
          number: null,
          status: 'draft',
          description: 'Cross-org destination probe (not business-relevant)',
          requestedBy: generateId(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      mrInOrgBId = probe.id;

      // ---- Two real users, one role holding ONLY the Material Request
      // lifecycle permissions (plus read-only Balance/Movement view for the
      // availability checks) — explicitly NO `Documents.*` permission. This
      // is the direct regression check for finding #1. ----
      const role = await roles.createRole({
        name: `Material Request operator ${suffix}`,
        description:
          'Live-spec fixture: MR lifecycle only, no Documents permission.',
        permissionCodes: [
          MATERIAL_REQUEST_PERMISSIONS.VIEW,
          MATERIAL_REQUEST_PERMISSIONS.CREATE,
          MATERIAL_REQUEST_PERMISSIONS.EDIT,
          MATERIAL_REQUEST_PERMISSIONS.DELETE,
          MATERIAL_REQUEST_PERMISSIONS.SUBMIT,
          MATERIAL_REQUEST_PERMISSIONS.APPROVE,
          MATERIAL_REQUEST_PERMISSIONS.REJECT,
          MATERIAL_REQUEST_PERMISSIONS.REVERSE_APPROVAL,
          MATERIAL_REQUEST_PERMISSIONS.RETURN_FOR_CORRECTION,
          MATERIAL_REQUEST_PERMISSIONS.CANCEL,
          MATERIAL_REQUEST_PERMISSIONS.INVOKE,
          BALANCE_PERMISSIONS.VIEW,
          MOVEMENT_PERMISSIONS.VIEW,
          // Read-only, so the new reservation-consumption scenarios below
          // can assert the reservation's own quantity/status directly
          // instead of only inferring it from the balance's `reserved`
          // counter — still no Documents.* permission (finding #1 is
          // unaffected).
          RESERVATION_PERMISSIONS.VIEW,
          // Generic release permission — needed ONLY to prove the C-50
          // audit finding below: this permission must NOT let its holder
          // bypass a Material Request line's own governed reservation
          // lifecycle via the generic `/inventory/reservations/:id/release`
          // endpoint.
          RESERVATION_PERMISSIONS.RELEASE,
        ],
      });
      roleId = role.id;

      const aliceUser = await users.createUser({
        username: aliceUsername,
        password: alicePassword,
      });
      const bobUser = await users.createUser({
        username: bobUsername,
        password: bobPassword,
      });
      aliceId = aliceUser.id;
      bobId = bobUser.id;

      await userRoles.assignRoleToUser(roleId, aliceId);
      await userRoles.assignRoleToUser(roleId, bobId);

      // Both are members of org A ONLY (org isolation fixture).
      await memberships.grantMembership(orgAId, aliceId);
      await memberships.grantMembership(orgAId, bobId);

      alice = await loggedInAgent(aliceUsername, alicePassword);
      bob = await loggedInAgent(bobUsername, bobPassword);
    }, 120_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        const client = await prisma.getClient<{
          materialRequestEvent: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          documentRelation: { deleteMany: (args: unknown) => Promise<unknown> };
          materialRequestLine: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          materialRequest: { deleteMany: (args: unknown) => Promise<unknown> };
          inventoryReservation: {
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
          warehouse: { deleteMany: (args: unknown) => Promise<unknown> };
          item: { deleteMany: (args: unknown) => Promise<unknown> };
          unit: { deleteMany: (args: unknown) => Promise<unknown> };
          branch: { deleteMany: (args: unknown) => Promise<unknown> };
          organizationMembership: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          organization: { deleteMany: (args: unknown) => Promise<unknown> };
          numberingAllocation: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          numberingSeries: { deleteMany: (args: unknown) => Promise<unknown> };
          userRole: { deleteMany: (args: unknown) => Promise<unknown> };
          rolePermission: { deleteMany: (args: unknown) => Promise<unknown> };
          role: { deleteMany: (args: unknown) => Promise<unknown> };
          user: { deleteMany: (args: unknown) => Promise<unknown> };
        }>();
        const orgIds = [orgAId, orgBId].filter((id) => id !== '');
        const userIds = [aliceId, bobId].filter((id) => id !== '');

        await client.materialRequestEvent.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.documentRelation.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.materialRequestLine.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.materialRequest.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.numberingAllocation.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.numberingSeries.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.inventoryReservation.deleteMany({
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
        await client.organizationMembership.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await client.organization.deleteMany({ where: { id: { in: orgIds } } });

        await client.userRole.deleteMany({
          where: { userId: { in: userIds } },
        });
        if (roleId !== '') {
          await client.rolePermission.deleteMany({ where: { roleId } });
          await client.role.deleteMany({ where: { id: roleId } });
        }
        await client.user.deleteMany({ where: { id: { in: userIds } } });
      } finally {
        await app.close();
      }
    }, 120_000);

    it('holds no Documents permission of any kind (finding #1 fixture guard)', async () => {
      const effective = await alice
        .get('/api/v1/permissions/effective')
        .expect(200);
      const codes = effective.body.permissions as string[];
      expect(codes.length).toBeGreaterThan(0);
      expect(codes.some((code) => code.startsWith('Documents.'))).toBe(false);
      expect(codes).toEqual(
        expect.arrayContaining([
          MATERIAL_REQUEST_PERMISSIONS.CREATE,
          MATERIAL_REQUEST_PERMISSIONS.APPROVE,
        ]),
      );
    });

    it(
      'runs the full draft → submit → approve lifecycle, and reject, with ONLY ' +
        'Material Request permissions — no Documents.Relation.View dependency (finding #1)',
      async () => {
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Finding #1 regression — lifecycle',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '5',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        expect(created.body.status).toBe('draft');

        const updated = await alice
          .patch(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .send({ description: 'Finding #1 regression — lifecycle (edited)' })
          .expect(200);
        expect(updated.body.description).toBe(
          'Finding #1 regression — lifecycle (edited)',
        );

        const submitted = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(submitted.body.status).toBe('submitted');
        expect(submitted.body.number).not.toBeNull();

        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(approved.body.status).toBe('approved');
        expect(approved.body.lines[0].reservationId).not.toBeNull();

        // Reject path, same actor, same permission set.
        const draft2 = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Finding #1 regression — reject path',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '1',
              },
            ],
          })
          .expect(201);
        const mr2Id = draft2.body.id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mr2Id}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const rejected = await alice
          .post(`/api/v1/inventory/material-requests/${mr2Id}/reject`)
          .query({ organizationId: orgAId })
          .send({ reason: 'Not needed anymore.' })
          .expect(200);
        expect(rejected.body.status).toBe('rejected');

        const events = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}/events`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect((events.body as unknown[]).length).toBeGreaterThan(0);
      },
    );

    it(
      'refuses the WHOLE approval when a flagged line has insufficient stock, ' +
        'leaving availability and status unchanged (atomicity, no partial reservation)',
      async () => {
        const before = await availabilitySnapshot(
          alice,
          orgAId,
          whA1Id,
          itemAId,
        );

        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Insufficient stock — single line',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '999999',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(422);

        const refetched = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(refetched.body.status).toBe('submitted');
        expect(refetched.body.lines[0].reservationId).toBeNull();

        const after = await availabilitySnapshot(
          alice,
          orgAId,
          whA1Id,
          itemAId,
        );
        expect(after).toEqual(before);
      },
    );

    it(
      'refuses the WHOLE approval when ONE of several flagged lines has ' +
        'insufficient stock — the satisfiable line is NOT partially reserved',
      async () => {
        const before = await availabilitySnapshot(
          alice,
          orgAId,
          whA1Id,
          itemAId,
        );

        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Insufficient stock — mixed lines',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '1',
                reservationRequested: true,
              },
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '999999',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(422);

        const refetched = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(refetched.body.status).toBe('submitted');
        for (const line of refetched.body.lines as Array<
          Record<string, unknown>
        >) {
          expect(line['reservationId']).toBeNull();
        }

        const after = await availabilitySnapshot(
          alice,
          orgAId,
          whA1Id,
          itemAId,
        );
        expect(after).toEqual(before);
      },
    );

    it("never reveals another organization's Material Requests to a non-member (404, not 403)", async () => {
      await alice
        .get('/api/v1/inventory/material-requests')
        .query({ organizationId: orgBId })
        .expect(404);

      const ownDraft = await alice
        .post('/api/v1/inventory/material-requests')
        .send({
          organizationId: orgAId,
          description: 'Org isolation probe',
          lines: [
            {
              itemId: itemAId,
              warehouseId: whA1Id,
              unitId: unitAId,
              quantity: '1',
            },
          ],
        })
        .expect(201);
      const mrId = ownDraft.body.id as string;

      // Correct scope: visible.
      await alice
        .get(`/api/v1/inventory/material-requests/${mrId}`)
        .query({ organizationId: orgAId })
        .expect(200);

      // Wrong scope (not a member of org B at all): invisible, 404.
      await alice
        .get(`/api/v1/inventory/material-requests/${mrId}`)
        .query({ organizationId: orgBId })
        .expect(404);
    });

    it(
      'validates an invocation destination fully before consuming any capacity ' +
        '(finding #2): unregistered type, module mismatch, nonexistent / cross-org ' +
        'document, nonexistent line, and an honestly-unsupported destination',
      async () => {
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Invocation destination validation',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '10',
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);

        const destination = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'A real destination document',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '10',
              },
            ],
          })
          .expect(201);
        const destinationId = destination.body.id as string;
        const destinationLineId = destination.body.lines[0].id as string;

        const invoke = (body: Record<string, unknown>) =>
          alice
            .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
            .query({ organizationId: orgAId })
            .send({ lineId, quantity: '1', ...body });

        // 1. Unregistered document type.
        const unregistered = await invoke({
          destinationModule: 'inventory',
          destinationDocumentType: 'totally_unregistered_document_type',
          destinationDocumentId: generateId(),
        }).expect(404);
        expect(unregistered.body.code).toBe('EntityNotFound');

        // 2. Registered type, but claimed under the wrong module.
        const moduleMismatch = await invoke({
          destinationModule: 'not_the_real_module',
          destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
          destinationDocumentId: destinationId,
        }).expect(400);
        expect(moduleMismatch.body.code).toBe('BadRequest');

        // 3. Registered, correct module, but the document does not exist.
        const nonexistentDoc = await invoke({
          destinationModule: 'inventory',
          destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
          destinationDocumentId: generateId(),
        }).expect(404);
        expect(nonexistentDoc.body.code).toBe('EntityNotFound');

        // 4. Exists, but in a different organization — never confirmed, 404.
        await invoke({
          destinationModule: 'inventory',
          destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
          destinationDocumentId: mrInOrgBId,
        }).expect(404);

        // 5. Document exists and is in scope, but the line id does not.
        await invoke({
          destinationModule: 'inventory',
          destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
          destinationDocumentId: destinationId,
          destinationLineId: generateId(),
        }).expect(404);

        // 6. Registered type/module pair this module honestly cannot verify
        // yet (an accounting voucher) — refused as an acknowledged
        // limitation, never silently accepted.
        const unsupported = await invoke({
          destinationModule: 'accounting',
          destinationDocumentType: 'accounting_voucher',
          destinationDocumentId: generateId(),
        }).expect(422);
        expect(unsupported.body.code).toBe('BusinessRuleViolation');

        // 7. Happy path: a real, module-owned, org-scoped destination.
        const ok = await invoke({
          destinationModule: 'inventory',
          destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
          destinationDocumentId: destinationId,
          destinationLineId,
          quantity: '4',
        }).expect(200);
        expect(ok.body.invokedBaseQuantity).toBe('4');
        expect(ok.body.remainingBaseQuantity).toBe('6');
        expect(ok.body.invocationCount).toBe(1);
      },
    );

    it(
      'never lets concurrent invocations exceed the remaining line quantity ' +
        '(finding #4: atomic check-and-write under real concurrency)',
      async () => {
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Concurrent invocation capacity',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '10',
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);

        // Four distinct real destination documents (one per attempt): the
        // test isolates CAPACITY contention from any unrelated uniqueness
        // constraint on the traceability relation itself.
        const destinations: Array<{ id: string; lineId: string }> = [];
        for (let i = 0; i < 4; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const destination = await alice
            .post('/api/v1/inventory/material-requests')
            .send({
              organizationId: orgAId,
              description: `Concurrent invocation destination #${i}`,
              lines: [
                {
                  itemId: itemAId,
                  warehouseId: whA1Id,
                  unitId: unitAId,
                  quantity: '10',
                },
              ],
            })
            .expect(201);
          destinations.push({
            id: destination.body.id as string,
            lineId: destination.body.lines[0].id as string,
          });
        }

        // 4 concurrent attempts of quantity 3 against a line with baseQuantity
        // 10: at most 3 can succeed (sum 9 <= 10); any 4th must be refused.
        const results = await Promise.allSettled(
          destinations.map((destination) =>
            alice
              .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
              .query({ organizationId: orgAId })
              .send({
                lineId,
                destinationModule: 'inventory',
                destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
                destinationDocumentId: destination.id,
                destinationLineId: destination.lineId,
                quantity: '3',
              }),
          ),
        );

        const succeeded = results.filter(
          (result) =>
            result.status === 'fulfilled' && result.value.status === 200,
        );
        const refused = results.filter(
          (result) =>
            result.status === 'fulfilled' && result.value.status === 422,
        );
        expect(results.every((result) => result.status === 'fulfilled')).toBe(
          true,
        );
        expect(succeeded.length).toBe(3);
        expect(refused.length).toBe(1);

        const refetched = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);
        const line = refetched.body.lines[0];
        expect(line.invokedBaseQuantity).toBe('9');
        expect(line.remainingBaseQuantity).toBe('1');
        expect(line.invocationCount).toBe(3);
      },
    );

    it(
      'refuses approval reversal once any line has been invoked, for the ' +
        'ORIGINAL approver too (necessary but not sufficient)',
      async () => {
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Reversal refused after invocation',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '5',
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);

        const destination = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Reversal-after-invocation destination',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '5',
              },
            ],
          })
          .expect(201);

        await alice
          .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
          .query({ organizationId: orgAId })
          .send({
            lineId,
            destinationModule: 'inventory',
            destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
            destinationDocumentId: destination.body.id,
            destinationLineId: destination.body.lines[0].id,
            quantity: '1',
          })
          .expect(200);

        const refused = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/reverse-approval`)
          .query({ organizationId: orgAId })
          .send({})
          .expect(422);
        expect(refused.body.code).toBe('BusinessRuleViolation');

        const stillApproved = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(stillApproved.body.status).toBe('approved');
      },
    );

    it(
      'restricts approval reversal to the ORIGINAL approver, releasing the ' +
        'reservation once that approver reverses it',
      async () => {
        const before = await availabilitySnapshot(
          alice,
          orgAId,
          whA1Id,
          itemAId,
        );

        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Approver-only reversal',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '3',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);

        // Bob approves — Bob is now the original approver, NOT Alice.
        const approved = await bob
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(approved.body.approvedBy).toBe(bobId);
        const reservationId = approved.body.lines[0].reservationId as string;
        expect(reservationId).not.toBeNull();

        const afterApproval = await availabilitySnapshot(
          alice,
          orgAId,
          whA1Id,
          itemAId,
        );
        expect(afterApproval.reserved).toBeCloseTo(before.reserved + 3, 6);
        expect(afterApproval.available).toBeCloseTo(before.available - 3, 6);

        // Alice holds REVERSE_APPROVAL too, but is not the original approver.
        const forbidden = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/reverse-approval`)
          .query({ organizationId: orgAId })
          .send({ reason: 'Alice should not be able to do this.' })
          .expect(403);
        expect(forbidden.body.code).toBe('PermissionDenied');

        const stillApproved = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(stillApproved.body.status).toBe('approved');

        // Bob, the real approver, succeeds.
        const reversed = await bob
          .post(`/api/v1/inventory/material-requests/${mrId}/reverse-approval`)
          .query({ organizationId: orgAId })
          .send({ reason: 'Changed plans.' })
          .expect(200);
        expect(reversed.body.status).toBe('submitted');
        // The line keeps its (now-released) reservation reference for audit
        // history — reverseApproval marks the InventoryReservation row
        // `released`, it does not erase the line's link to it. The real
        // proof of release is availability returning to its pre-reservation
        // state, checked below.
        expect(reversed.body.lines[0].reservationId).toBe(reservationId);

        const afterReversal = await availabilitySnapshot(
          alice,
          orgAId,
          whA1Id,
          itemAId,
        );
        expect(afterReversal).toEqual(before);
      },
    );

    it(
      'applies the same available-quantity rule consistently whether the ' +
        "warehouse's reservationsReduceAvailable is true or false (finding #3)",
      async () => {
        for (const warehouseId of [whA1Id, whA2Id]) {
          // eslint-disable-next-line no-await-in-loop
          const before = await availabilitySnapshot(
            alice,
            orgAId,
            warehouseId,
            itemAId,
          );

          // eslint-disable-next-line no-await-in-loop
          const created = await alice
            .post('/api/v1/inventory/material-requests')
            .send({
              organizationId: orgAId,
              description: `Availability consistency (${warehouseId})`,
              lines: [
                {
                  itemId: itemAId,
                  warehouseId,
                  unitId: unitAId,
                  quantity: '4',
                  reservationRequested: true,
                },
              ],
            })
            .expect(201);
          const mrId = created.body.id as string;
          // eslint-disable-next-line no-await-in-loop
          await alice
            .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
            .query({ organizationId: orgAId })
            .expect(200);
          // eslint-disable-next-line no-await-in-loop
          await alice
            .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
            .query({ organizationId: orgAId })
            .expect(200);

          // eslint-disable-next-line no-await-in-loop
          const after = await availabilitySnapshot(
            alice,
            orgAId,
            warehouseId,
            itemAId,
          );
          expect(after.onHand).toBeCloseTo(before.onHand, 6);
          expect(after.reserved).toBeCloseTo(before.reserved + 4, 6);
          if (warehouseId === whA1Id) {
            // Reservations REDUCE available here.
            expect(after.available).toBeCloseTo(before.available - 4, 6);
          } else {
            // Reservations do NOT reduce available here — same `onHand −
            // reserved` rule, applied with this warehouse's own setting,
            // consistently across all three endpoints (already asserted
            // inside `availabilitySnapshot`).
            expect(after.available).toBeCloseTo(before.available, 6);
          }
        }
      },
    );

    it(
      'lets a user with ONLY Material Request Approve approve a request they ' +
        'themselves created and submitted (self-approval is explicitly permitted)',
      async () => {
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Self-approval is permitted',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '1',
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        expect(created.body.requestedBy).toBe(aliceId);
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(approved.body.status).toBe('approved');
        expect(approved.body.approvedBy).toBe(aliceId);
        expect(approved.body.approvedBy).toBe(approved.body.requestedBy);
      },
    );

    it(
      'returns a submitted request for correction, lets the requester edit ' +
        'it, and requires resubmission before it can be approved again',
      async () => {
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Return for correction — original',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '2',
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const submitted = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const originalNumber = submitted.body.number as string;
        expect(originalNumber).not.toBeNull();

        // Edits are refused while submitted (not draft, not returned).
        await alice
          .patch(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .send({ description: 'Should be refused while submitted' })
          .expect(422);

        const returned = await bob
          .post(
            `/api/v1/inventory/material-requests/${mrId}/return-for-correction`,
          )
          .query({ organizationId: orgAId })
          .send({ reason: 'Wrong warehouse — please fix and resubmit.' })
          .expect(200);
        expect(returned.body.status).toBe('returned');
        expect(returned.body.returnedBy).toBe(bobId);
        expect(returned.body.returnReason).toBe(
          'Wrong warehouse — please fix and resubmit.',
        );

        // A second return attempt is refused — it is no longer 'submitted'.
        await bob
          .post(
            `/api/v1/inventory/material-requests/${mrId}/return-for-correction`,
          )
          .query({ organizationId: orgAId })
          .send({ reason: 'Should be refused — already returned.' })
          .expect(422);

        // The requester may now edit a 'returned' request, same as a draft.
        const edited = await alice
          .patch(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .send({
            description: 'Return for correction — corrected',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '3',
              },
            ],
          })
          .expect(200);
        expect(edited.body.description).toBe(
          'Return for correction — corrected',
        );
        expect(edited.body.lines[0].quantity).toBe('3');

        const resubmitted = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(resubmitted.body.status).toBe('submitted');
        // Resubmission replays the SAME allocated number — it is the same
        // document going through its lifecycle again, not a new one.
        expect(resubmitted.body.number).toBe(originalNumber);

        const approved = await bob
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(approved.body.status).toBe('approved');

        const events = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}/events`)
          .query({ organizationId: orgAId })
          .expect(200);
        const eventTypes = (events.body as Array<{ eventType: string }>).map(
          (e) => e.eventType,
        );
        expect(eventTypes).toContain('returned_for_correction');
        // submitted appears twice: the original submission and the
        // resubmission after correction — both are auditable history.
        expect(eventTypes.filter((t) => t === 'submitted').length).toBe(2);
      },
    );

    it(
      'refuses return-for-correction without a reason, and refuses it ' +
        'outside the submitted status',
      async () => {
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Return-for-correction validation',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '1',
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;

        // Still draft — not submitted yet.
        await alice
          .post(
            `/api/v1/inventory/material-requests/${mrId}/return-for-correction`,
          )
          .query({ organizationId: orgAId })
          .send({ reason: 'Too early.' })
          .expect(422);

        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);

        await alice
          .post(
            `/api/v1/inventory/material-requests/${mrId}/return-for-correction`,
          )
          .query({ organizationId: orgAId })
          .send({ reason: '   ' })
          .expect(400);
      },
    );

    it(
      'cancels an approved request with a reserved line, releasing the ' +
        'reservation and restoring availability — distinct from reversal',
      async () => {
        const before = await availabilitySnapshot(
          alice,
          orgAId,
          whA1Id,
          itemAId,
        );

        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Cancellation releases reservation',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '2',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(approved.body.lines[0].reservationId).not.toBeNull();

        const afterApproval = await availabilitySnapshot(
          alice,
          orgAId,
          whA1Id,
          itemAId,
        );
        expect(afterApproval.reserved).toBeCloseTo(before.reserved + 2, 6);

        // Cancellation needs no approver match — Bob, who never approved
        // this request, can cancel it as long as he holds the permission.
        const cancelled = await bob
          .post(`/api/v1/inventory/material-requests/${mrId}/cancel`)
          .query({ organizationId: orgAId })
          .send({ reason: 'No longer needed.' })
          .expect(200);
        expect(cancelled.body.status).toBe('cancelled');
        expect(cancelled.body.cancelledBy).toBe(bobId);
        expect(cancelled.body.cancellationReason).toBe('No longer needed.');
        // Cancellation must NEVER populate the separate reversal columns.
        expect(cancelled.body.approvalReversedAt).toBeNull();
        expect(cancelled.body.approvalReversedBy).toBeNull();

        const afterCancel = await availabilitySnapshot(
          alice,
          orgAId,
          whA1Id,
          itemAId,
        );
        expect(afterCancel).toEqual(before);

        // A cancelled request can never be cancelled, approved, or reversed
        // again — it is terminal.
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/cancel`)
          .query({ organizationId: orgAId })
          .send({})
          .expect(422);
      },
    );

    it(
      'refuses to cancel an approved request once ANY line has been ' +
        'invoked, even partially — and never touches the physical On Hand',
      async () => {
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Cancellation refused after partial invocation',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '6',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);

        const before = await availabilitySnapshot(
          alice,
          orgAId,
          whA1Id,
          itemAId,
        );

        const destination = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Partial-invocation destination',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA1Id,
                unitId: unitAId,
                quantity: '6',
              },
            ],
          })
          .expect(201);

        // A SINGLE unit invoked — partial, not full, consumption.
        await alice
          .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
          .query({ organizationId: orgAId })
          .send({
            lineId,
            destinationModule: 'inventory',
            destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
            destinationDocumentId: destination.body.id,
            destinationLineId: destination.body.lines[0].id,
            quantity: '1',
          })
          .expect(200);

        const refused = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/cancel`)
          .query({ organizationId: orgAId })
          .send({ reason: 'Should be refused — partially invoked.' })
          .expect(422);
        expect(refused.body.code).toBe('BusinessRuleViolation');

        const stillApproved = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(stillApproved.body.status).toBe('approved');
        expect(stillApproved.body.lines[0].invocationCount).toBe(1);
        expect(stillApproved.body.lines[0].invokedBaseQuantity).toBe('1');
        expect(stillApproved.body.lines[0].remainingBaseQuantity).toBe('5');

        // The partial invocation itself CONSUMED 1 unit from the active
        // reservation (Owner decision, C-50 §3.8 follow-up) — `reserved`
        // drops by exactly that amount. The refused cancellation attempt
        // after it changes nothing further: On Hand stays untouched
        // throughout, and the remaining 5 units stay reserved (still
        // invokable later, still blocking cancellation/reversal).
        const after = await availabilitySnapshot(
          alice,
          orgAId,
          whA1Id,
          itemAId,
        );
        expect(after.onHand).toBeCloseTo(before.onHand, 6);
        expect(after.reserved).toBeCloseTo(before.reserved - 1, 6);
      },
    );

    it(
      'a partial invocation consumes the reservation by exactly the ' +
        'invoked amount, decreasing inventory reserved, leaving On Hand ' +
        'and the request still approved',
      async () => {
        const before = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );

        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Invocation consumes reservation — partial',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '10',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        const reservationId = approved.body.lines[0].reservationId as string;
        expect(reservationId).not.toBeNull();

        const afterApproval = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        expect(afterApproval.onHand).toBeCloseTo(before.onHand, 6);
        expect(afterApproval.reserved).toBeCloseTo(before.reserved + 10, 6);

        const destination = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Invocation consumes reservation — destination',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '10',
              },
            ],
          })
          .expect(201);

        const invoked = await alice
          .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
          .query({ organizationId: orgAId })
          .send({
            lineId,
            destinationModule: 'inventory',
            destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
            destinationDocumentId: destination.body.id,
            destinationLineId: destination.body.lines[0].id,
            quantity: '6',
          })
          .expect(200);
        expect(invoked.body.invokedBaseQuantity).toBe('6');
        expect(invoked.body.remainingBaseQuantity).toBe('4');

        const reservationAfterPartial = await getReservation(
          alice,
          orgAId,
          reservationId,
        );
        expect(reservationAfterPartial.status).toBe('active');
        expect(reservationAfterPartial.quantity).toBe('4');
        expect(reservationAfterPartial.baseQuantity).toBe('4');

        // `reserved` dropped by exactly the consumed amount; On Hand is
        // untouched by invocation — it is traceability, not a movement.
        const afterPartialInvoke = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        expect(afterPartialInvoke.onHand).toBeCloseTo(before.onHand, 6);
        expect(afterPartialInvoke.reserved).toBeCloseTo(before.reserved + 4, 6);

        // The request is still approved — a partial invocation never
        // changes its lifecycle status.
        const stillApproved = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(stillApproved.body.status).toBe('approved');

        // The remaining 4 units of reservation are still usable by a LATER
        // invocation (no fixed invocation-count limit).
        const second = await alice
          .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
          .query({ organizationId: orgAId })
          .send({
            lineId,
            destinationModule: 'inventory',
            destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
            destinationDocumentId: destination.body.id,
            destinationLineId: destination.body.lines[0].id,
            quantity: '4',
          })
          .expect(200);
        expect(second.body.invokedBaseQuantity).toBe('10');
        expect(second.body.remainingBaseQuantity).toBe('0');
        expect(second.body.invocationCount).toBe(2);

        // Fully consumed: the reservation is now closed, never left ACTIVE
        // with a zero remaining quantity.
        const reservationAfterFull = await getReservation(
          alice,
          orgAId,
          reservationId,
        );
        expect(reservationAfterFull.status).toBe('released');
        expect(reservationAfterFull.quantity).toBe('0');
        expect(reservationAfterFull.baseQuantity).toBe('0');

        const afterFullInvoke = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        // Fully consumed and carried downstream — back to the pre-request
        // baseline, exactly like a real fulfillment would leave it (On Hand
        // unaffected throughout; `reserved` returns to its starting point
        // because nothing remains reserved, not because anything was
        // "released back").
        expect(afterFullInvoke).toEqual(before);
      },
    );

    it(
      'invoking a line with NO reservation never creates or mutates any ' +
        "reservation, and never touches the item's reserved/On Hand balance",
      async () => {
        const before = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );

        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Invocation without a reservation',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '7',
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(approved.body.lines[0].reservationId).toBeNull();

        const destination = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Invocation without a reservation — destination',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '7',
              },
            ],
          })
          .expect(201);
        const invoked = await alice
          .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
          .query({ organizationId: orgAId })
          .send({
            lineId,
            destinationModule: 'inventory',
            destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
            destinationDocumentId: destination.body.id,
            destinationLineId: destination.body.lines[0].id,
            quantity: '7',
          })
          .expect(200);
        expect(invoked.body.invokedBaseQuantity).toBe('7');
        expect(invoked.body.reservationId).toBeNull();

        const after = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        expect(after).toEqual(before);
      },
    );

    it(
      'two concurrent invocations of a reserved line cannot jointly over-' +
        'consume either the invocation capacity or the reservation itself',
      async () => {
        const before = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );

        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Concurrent invocation vs. reservation',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '100',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        const reservationId = approved.body.lines[0].reservationId as string;

        const destinations: Array<{ id: string; lineId: string }> = [];
        for (let i = 0; i < 2; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const destination = await alice
            .post('/api/v1/inventory/material-requests')
            .send({
              organizationId: orgAId,
              description: `Concurrent reservation-consumption destination #${i}`,
              lines: [
                {
                  itemId: itemAId,
                  warehouseId: whA3Id,
                  unitId: unitAId,
                  quantity: '100',
                },
              ],
            })
            .expect(201);
          destinations.push({
            id: destination.body.id as string,
            lineId: destination.body.lines[0].id as string,
          });
        }

        // 60 + 50 = 110 > 100: at most one of these may fully succeed.
        const results = await Promise.allSettled(
          destinations.map((destination, index) =>
            alice
              .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
              .query({ organizationId: orgAId })
              .send({
                lineId,
                destinationModule: 'inventory',
                destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
                destinationDocumentId: destination.id,
                destinationLineId: destination.lineId,
                quantity: index === 0 ? '60' : '50',
              }),
          ),
        );
        const succeeded = results.filter(
          (r) => r.status === 'fulfilled' && r.value.status === 200,
        );
        const refused = results.filter(
          (r) => r.status === 'fulfilled' && r.value.status === 422,
        );
        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
        expect(succeeded).toHaveLength(1);
        expect(refused).toHaveLength(1);

        const refetched = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);
        const line = refetched.body.lines[0];
        // Whichever one invocation won, the reservation and the line's own
        // counters must agree exactly — neither over- nor under-consumed.
        const reservation = await getReservation(alice, orgAId, reservationId);
        expect(reservation.status).toBe('active');
        expect(reservation.baseQuantity).toBe(line.remainingBaseQuantity);
        expect(
          Number(line.invokedBaseQuantity) + Number(reservation.baseQuantity),
        ).toBeCloseTo(100, 6);
        expect(Number(reservation.baseQuantity)).toBeGreaterThanOrEqual(0);

        const afterRace = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        expect(afterRace.onHand).toBeCloseTo(before.onHand, 6);
        expect(afterRace.reserved).toBeCloseTo(
          before.reserved + Number(reservation.baseQuantity),
          6,
        );
      },
    );

    it(
      'a downstream relation write that fails AFTER invocation capacity is ' +
        'reserved restores the reservation, its balance contribution, and ' +
        'the invocation counters to their exact pre-attempt state',
      async () => {
        const before = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );

        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Compensation restores reservation',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '10',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        const reservationId = approved.body.lines[0].reservationId as string;

        const afterApproval = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        expect(afterApproval.reserved).toBeCloseTo(before.reserved + 10, 6);

        // Invoking a Material Request line INTO ITSELF passes every
        // pre-invocation destination check (the document genuinely exists,
        // belongs to this organization, and the line genuinely exists on
        // it) but is refused by `DocumentRelationsService.linkDocuments`
        // itself as a self-referencing relation — a REAL failure that
        // happens strictly AFTER `reserveInvocationCapacity` has already
        // committed, exercising the actual compensation path end to end
        // (not a mocked failure).
        const refused = await alice
          .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
          .query({ organizationId: orgAId })
          .send({
            lineId,
            destinationModule: 'inventory',
            destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
            destinationDocumentId: mrId,
            destinationLineId: lineId,
            quantity: '6',
          });
        expect(refused.status).toBe(422);

        const refetched = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(refetched.body.lines[0].invokedBaseQuantity).toBe('0');
        expect(refetched.body.lines[0].invocationCount).toBe(0);
        expect(refetched.body.lines[0].remainingBaseQuantity).toBe('10');

        const reservation = await getReservation(alice, orgAId, reservationId);
        expect(reservation.status).toBe('active');
        expect(reservation.quantity).toBe('10');
        expect(reservation.baseQuantity).toBe('10');

        const afterCompensation = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        expect(afterCompensation).toEqual(afterApproval);

        // The reservation is still fully intact and usable by a real,
        // valid invocation afterwards.
        const destination = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Compensation restores reservation — destination',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '10',
              },
            ],
          })
          .expect(201);
        const succeeded = await alice
          .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
          .query({ organizationId: orgAId })
          .send({
            lineId,
            destinationModule: 'inventory',
            destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
            destinationDocumentId: destination.body.id,
            destinationLineId: destination.body.lines[0].id,
            quantity: '10',
          })
          .expect(200);
        expect(succeeded.body.invokedBaseQuantity).toBe('10');
        const reservationAfterReal = await getReservation(
          alice,
          orgAId,
          reservationId,
        );
        expect(reservationAfterReal.status).toBe('released');
        expect(reservationAfterReal.quantity).toBe('0');
        expect(reservationAfterReal.baseQuantity).toBe('0');

        const afterReal = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        expect(afterReal).toEqual(before);
      },
    );

    // -------------------------------------------------------------------
    // Concurrency/compensation audit round — the race: invocation A
    // consumes part of a reservation, invocation B then consumes the
    // remainder and legitimately closes it, THEN A's own Document Relation
    // write fails and A's compensation runs. The compensation used to key
    // off A's OWN `closed` snapshot (did *I* close it?) to decide whether
    // the reservation "ought" to still be `active` or `released` — an
    // assumption B's perfectly valid, concurrent consumption invalidates.
    // The fix makes compensation add its captured amount back to whatever
    // the CURRENT (locked) state is, never branching on that stale
    // snapshot. See `MaterialRequestsRepository.releaseInvocationCapacity`.
    // -------------------------------------------------------------------

    it(
      'a failed attempt is compensated after a different invocation has ' +
        'actually committed its relation and event against real Postgres',
      async () => {
        const repository = app!.get(MaterialRequestsRepository);
        const documentRelations = app!.get(DocumentRelationsService);
        const client = await prisma.getClient<{
          documentRelation: {
            findMany: (args: unknown) => Promise<
              Array<{
                id: string;
                sourceLineId: string | null;
                targetDocumentId: string;
              }>
            >;
          };
          materialRequestEvent: {
            findMany: (
              args: unknown,
            ) => Promise<
              Array<{ eventType: string; referenceId: string | null }>
            >;
          };
        }>();
        const before = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );

        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Deterministic compensation race — A(60)/B(40)',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '100',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        const reservationId = approved.body.lines[0].reservationId as string;

        const destination = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Deterministic compensation race — B destination',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '100',
              },
            ],
          })
          .expect(201);

        // A is deliberately held at the downstream relation boundary after
        // its capacity transaction has committed. This is a test-only
        // synchronization point: no production delay, hook, or sleep is
        // involved. B cannot start until A has reached this point; after B
        // returns 200, its relation and audit event are committed before A
        // is allowed to execute the self-relation failure and compensate.
        let signalAAtRelation!: () => void;
        const aAtRelation = new Promise<void>((resolve) => {
          signalAAtRelation = resolve;
        });
        let releaseA!: () => void;
        const holdA = new Promise<void>((resolve) => {
          releaseA = resolve;
        });
        const originalLinkDocuments = documentRelations.linkDocuments;
        documentRelations.linkDocuments = async (input) => {
          if (
            input.source.documentId === mrId &&
            input.target.documentId === mrId
          ) {
            signalAAtRelation();
            await holdA;
          }
          return originalLinkDocuments.call(documentRelations, input);
        };

        try {
          const aRequest = alice
            .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
            .query({ organizationId: orgAId })
            .send({
              lineId,
              destinationModule: 'inventory',
              destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
              destinationDocumentId: mrId,
              destinationLineId: lineId,
              quantity: '60',
            });
          const aResponsePromise = aRequest.then((response) => response);

          // A has already committed its 60-unit capacity transaction, but
          // its downstream relation call is paused. This proves B starts
          // after A's reservation consumption, not merely concurrently with
          // an unknown ordering.
          await aAtRelation;

          const bResponse = await alice
            .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
            .query({ organizationId: orgAId })
            .send({
              lineId,
              destinationModule: 'inventory',
              destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
              destinationDocumentId: destination.body.id,
              destinationLineId: destination.body.lines[0].id,
              quantity: '40',
            })
            .expect(200);
          expect(bResponse.body.invokedBaseQuantity).toBe('100');

          // B's HTTP success means its relation write and subsequent event
          // write completed. Confirm the reservation is closed before A is
          // released, which is the exact stale-snapshot ordering under test.
          expect(await getReservation(alice, orgAId, reservationId)).toEqual({
            status: 'released',
            quantity: '0',
            baseQuantity: '0',
          });
          const relationsAfterB = await client.documentRelation.findMany({
            where: {
              organizationId: orgAId,
              sourceDocumentId: mrId,
              sourceLineId: lineId,
            },
          });
          expect(relationsAfterB).toHaveLength(1);
          expect(relationsAfterB[0]?.targetDocumentId).toBe(
            destination.body.id,
          );
          const eventsAfterB = await client.materialRequestEvent.findMany({
            where: {
              organizationId: orgAId,
              materialRequestId: mrId,
              eventType: 'line_invoked',
            },
          });
          expect(eventsAfterB).toHaveLength(1);
          expect(eventsAfterB[0]?.referenceId).toBe(relationsAfterB[0]?.id);

          // Only now does A's self-referencing relation proceed and fail;
          // the service compensates exactly A's captured 60 against B's
          // already-closed reservation state.
          releaseA();
          const aResponse = await aResponsePromise;
          expect(aResponse.status).toBe(422);
        } finally {
          documentRelations.linkDocuments = originalLinkDocuments;
          // Prevent a failed assertion from leaving a held request behind.
          releaseA();
        }

        const lines = await repository.listLines(mrId);
        expect(lines[0]?.invokedBaseQuantity).toBe('40');
        expect(lines[0]?.invocationCount).toBe(1);

        const reservationAfterCompensation = await getReservation(
          alice,
          orgAId,
          reservationId,
        );
        expect(reservationAfterCompensation).toEqual({
          status: 'active',
          quantity: '60',
          baseQuantity: '60',
        });

        const afterRace = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        expect(afterRace.onHand).toBeCloseTo(before.onHand, 6);
        expect(afterRace.reserved).toBeCloseTo(before.reserved + 60, 6);

        const refetched = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(refetched.body.lines[0].invokedBaseQuantity).toBe('40');
        expect(refetched.body.lines[0].remainingBaseQuantity).toBe('60');
        expect(refetched.body.lines[0].invocationCount).toBe(1);

        const relationsAfterCompensation =
          await client.documentRelation.findMany({
            where: {
              organizationId: orgAId,
              sourceDocumentId: mrId,
              sourceLineId: lineId,
            },
          });
        expect(relationsAfterCompensation).toHaveLength(1);
        expect(relationsAfterCompensation[0]?.targetDocumentId).toBe(
          destination.body.id,
        );
        const eventsAfterCompensation =
          await client.materialRequestEvent.findMany({
            where: {
              organizationId: orgAId,
              materialRequestId: mrId,
              eventType: 'line_invoked',
            },
          });
        expect(eventsAfterCompensation).toHaveLength(1);
        expect(eventsAfterCompensation[0]?.referenceId).toBe(
          relationsAfterCompensation[0]?.id,
        );
      },
    );

    it(
      'a failed attempt that would have closed the reservation by ITSELF ' +
        '(no concurrent attempt involved) is still compensated correctly ' +
        'against real Postgres — reopened, not left released',
      async () => {
        const repository = app!.get(MaterialRequestsRepository);
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Solo failed attempt that would have closed it',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '30',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        const reservationId = approved.body.lines[0].reservationId as string;

        const reserved = await repository.reserveInvocationCapacity({
          id: mrId,
          organizationId: orgAId,
          lineId,
          invokedBase: '30',
          invokedEntered: '30',
          now: new Date(),
          actorId: aliceId,
        });
        expect(reserved.reservationConsumption?.closed).toBe(true);
        const closedReservation = await getReservation(
          alice,
          orgAId,
          reservationId,
        );
        expect(closedReservation.status).toBe('released');

        await repository.releaseInvocationCapacity({
          id: mrId,
          lineId,
          invokedBase: '30',
          now: new Date(),
          actorId: aliceId,
          reservationConsumption: reserved.reservationConsumption,
        });

        const reopened = await getReservation(alice, orgAId, reservationId);
        expect(reopened).toEqual({
          status: 'active',
          quantity: '30',
          baseQuantity: '30',
        });
        const lines = await repository.listLines(mrId);
        expect(lines[0]?.invokedBaseQuantity).toBe('0');
        expect(lines[0]?.invocationCount).toBe(0);
      },
    );

    it(
      'two concurrent invocations summing to EXACTLY the remaining ' +
        'capacity both succeed and close the reservation correctly',
      async () => {
        const before = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Concurrent pair exactly fills capacity',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '100',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        const reservationId = approved.body.lines[0].reservationId as string;

        const destinations: Array<{ id: string; lineId: string }> = [];
        for (let i = 0; i < 2; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const destination = await alice
            .post('/api/v1/inventory/material-requests')
            .send({
              organizationId: orgAId,
              description: `Exact-capacity destination #${i}`,
              lines: [
                {
                  itemId: itemAId,
                  warehouseId: whA3Id,
                  unitId: unitAId,
                  quantity: '100',
                },
              ],
            })
            .expect(201);
          destinations.push({
            id: destination.body.id as string,
            lineId: destination.body.lines[0].id as string,
          });
        }

        // 50 + 50 = 100 exactly: BOTH must succeed, genuinely overlapping
        // (not sequential awaits) — a correct atomic check-and-write must
        // never reject one of two attempts that together exactly fit.
        const results = await Promise.all(
          destinations.map((destination) =>
            alice
              .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
              .query({ organizationId: orgAId })
              .send({
                lineId,
                destinationModule: 'inventory',
                destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
                destinationDocumentId: destination.id,
                destinationLineId: destination.lineId,
                quantity: '50',
              }),
          ),
        );
        expect(results.every((r) => r.status === 200)).toBe(true);

        const refetched = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(refetched.body.lines[0].invokedBaseQuantity).toBe('100');
        expect(refetched.body.lines[0].remainingBaseQuantity).toBe('0');
        expect(refetched.body.lines[0].invocationCount).toBe(2);

        const reservation = await getReservation(alice, orgAId, reservationId);
        expect(reservation).toEqual({
          status: 'released',
          quantity: '0',
          baseQuantity: '0',
        });

        const after = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        expect(after.onHand).toBeCloseTo(before.onHand, 6);
        expect(after.reserved).toBeCloseTo(before.reserved, 6);
      },
    );

    it(
      'a genuinely concurrent pair where one attempt is guaranteed to fail ' +
        'its Document Relation (self-referencing) never corrupts the ' +
        "other, successful attempt's state, regardless of which one the " +
        'row lock happens to serialize first',
      async () => {
        const before = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Concurrent HTTP race: one guaranteed-fail, one valid',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '100',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        const reservationId = approved.body.lines[0].reservationId as string;

        const validDestination = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Concurrent HTTP race — valid destination',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '100',
              },
            ],
          })
          .expect(201);

        // A targets the Material Request ITSELF — a destination that is
        // genuinely valid enough to pass every pre-reserve check
        // (`validateInvocationDestination`) yet is ALWAYS refused by
        // `DocumentRelationsService.linkDocuments` as a self-reference, a
        // REAL failure happening strictly after `reserveInvocationCapacity`
        // commits — no mocking. B targets a different, always-valid
        // destination. 60 + 40 = 100 fits regardless of which one the
        // header-row lock serializes first, so the correct final state
        // (B's 40 invoked, A's 60 fully compensated and the reservation
        // reopened at 60) is identical either way.
        const [aResult, bResult] = await Promise.all([
          alice
            .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
            .query({ organizationId: orgAId })
            .send({
              lineId,
              destinationModule: 'inventory',
              destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
              destinationDocumentId: mrId,
              destinationLineId: lineId,
              quantity: '60',
            }),
          alice
            .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
            .query({ organizationId: orgAId })
            .send({
              lineId,
              destinationModule: 'inventory',
              destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
              destinationDocumentId: validDestination.body.id,
              destinationLineId: validDestination.body.lines[0].id,
              quantity: '40',
            }),
        ]);
        expect(aResult.status).toBe(422);
        expect(bResult.status).toBe(200);

        const refetched = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);
        expect(refetched.body.lines[0].invokedBaseQuantity).toBe('40');
        expect(refetched.body.lines[0].invocationCount).toBe(1);
        const reservation = await getReservation(alice, orgAId, reservationId);
        expect(reservation).toEqual({
          status: 'active',
          quantity: '60',
          baseQuantity: '60',
        });
        const after = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        expect(after.onHand).toBeCloseTo(before.onHand, 6);
        expect(after.reserved).toBeCloseTo(before.reserved + 60, 6);
      },
    );

    it(
      'a concurrent invocation and a cancellation of the same Material ' +
        'Request never produce an invalid combined outcome',
      async () => {
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Concurrent invoke vs. cancel',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '10',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        const reservationId = approved.body.lines[0].reservationId as string;

        const destination = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Concurrent invoke vs. cancel — destination',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '100',
              },
            ],
          })
          .expect(201);

        const [invokeResult, cancelResult] = await Promise.all([
          alice
            .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
            .query({ organizationId: orgAId })
            .send({
              lineId,
              destinationModule: 'inventory',
              destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
              destinationDocumentId: destination.body.id,
              destinationLineId: destination.body.lines[0].id,
              quantity: '10',
            }),
          alice
            .post(`/api/v1/inventory/material-requests/${mrId}/cancel`)
            .query({ organizationId: orgAId })
            .send({ reason: 'Concurrent invoke vs. cancel probe' }),
        ]);

        const refetched = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);

        if (invokeResult.status === 200) {
          // The invocation committed first (under the header lock) — the
          // Owner decision then REQUIRES cancellation to be refused, never
          // silently undoing an already-consumed quantity.
          expect(cancelResult.status).toBe(422);
          expect(refetched.body.status).toBe('approved');
          expect(refetched.body.lines[0].invocationCount).toBe(1);
          expect(refetched.body.lines[0].invokedBaseQuantity).toBe('10');
          const reservation = await getReservation(
            alice,
            orgAId,
            reservationId,
          );
          expect(reservation).toEqual({
            status: 'released',
            quantity: '0',
            baseQuantity: '0',
          });
        } else {
          // Cancellation committed first — the request is no longer
          // `approved`, so the invocation must be refused, never silently
          // succeeding against a cancelled request.
          expect(cancelResult.status).toBe(200);
          expect(invokeResult.status).toBe(422);
          expect(refetched.body.status).toBe('cancelled');
          expect(refetched.body.lines[0].invocationCount).toBe(0);
          expect(refetched.body.lines[0].invokedBaseQuantity).toBe('0');
          const reservation = await getReservation(
            alice,
            orgAId,
            reservationId,
          );
          expect(reservation.status).toBe('released');
        }
      },
    );

    it(
      'a concurrent invocation and an approval reversal of the same ' +
        'Material Request never produce an invalid combined outcome',
      async () => {
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Concurrent invoke vs. reverseApproval',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '10',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        const lineId = created.body.lines[0].id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        const reservationId = approved.body.lines[0].reservationId as string;

        const destination = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Concurrent invoke vs. reverseApproval — destination',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '100',
              },
            ],
          })
          .expect(201);

        const [invokeResult, reversalResult] = await Promise.all([
          alice
            .put(`/api/v1/inventory/material-requests/${mrId}/lines/invoke`)
            .query({ organizationId: orgAId })
            .send({
              lineId,
              destinationModule: 'inventory',
              destinationDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
              destinationDocumentId: destination.body.id,
              destinationLineId: destination.body.lines[0].id,
              quantity: '10',
            }),
          alice
            .post(
              `/api/v1/inventory/material-requests/${mrId}/reverse-approval`,
            )
            .query({ organizationId: orgAId })
            .send({}),
        ]);

        const refetched = await alice
          .get(`/api/v1/inventory/material-requests/${mrId}`)
          .query({ organizationId: orgAId })
          .expect(200);

        if (invokeResult.status === 200) {
          expect(reversalResult.status).toBe(422);
          expect(refetched.body.status).toBe('approved');
          expect(refetched.body.lines[0].invocationCount).toBe(1);
          const reservation = await getReservation(
            alice,
            orgAId,
            reservationId,
          );
          expect(reservation).toEqual({
            status: 'released',
            quantity: '0',
            baseQuantity: '0',
          });
        } else {
          expect(reversalResult.status).toBe(200);
          expect(invokeResult.status).toBe(422);
          // Reversal returns the request to `submitted` (never back to
          // `draft`) — it must never leave `approved` once reversed, which
          // is the whole point of also refusing the invocation.
          expect(refetched.body.status).toBe('submitted');
          expect(refetched.body.lines[0].invocationCount).toBe(0);
          const reservation = await getReservation(
            alice,
            orgAId,
            reservationId,
          );
          expect(reservation.status).toBe('released');
        }
      },
    );

    it(
      'two concurrent cancellations of different, multi-line reserved ' +
        'requests that touch the same two (warehouse, item) balance rows ' +
        'in OPPOSITE line order cannot deadlock — both release cleanly',
      async () => {
        // `cancel`/`reverseApproval` lock one `inventory_balances` row per
        // reserved line; if that locking order followed each document's own
        // `lineNumber` order instead of a document-independent, globally
        // consistent key order, two concurrent cancellations whose lines
        // reference the same two balance rows in reversed order could lock
        // them in opposite order and deadlock in real Postgres — exactly
        // the class of bug a hermetic/fake-repository test can never catch.
        const items = app!.get(ItemsService);
        const movements = app!.get(InventoryMovementsService);
        const itemA2 = await items.createItem({
          organizationId: orgAId,
          code: `ITM-A2-${suffix}`,
          name: 'Item A2 (deadlock-order probe)',
          itemKind: 'goods',
          baseUnitId: unitAId,
        });
        const itemA2Id = itemA2.id;
        await movements.postMovement({
          organizationId: orgAId,
          operationKey: `seed-a3-item2-${suffix}`,
          warehouseId: whA3Id,
          itemId: itemA2Id,
          movementType: 'inbound',
          quantity: '1000',
          unitId: unitAId,
        });

        const beforeA1 = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        const beforeA2 = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemA2Id,
        );

        async function createApprovedTwoLineRequest(
          firstItemId: string,
          secondItemId: string,
          description: string,
        ): Promise<string> {
          const created = await alice
            .post('/api/v1/inventory/material-requests')
            .send({
              organizationId: orgAId,
              description,
              lines: [
                {
                  itemId: firstItemId,
                  warehouseId: whA3Id,
                  unitId: unitAId,
                  quantity: '5',
                  reservationRequested: true,
                },
                {
                  itemId: secondItemId,
                  warehouseId: whA3Id,
                  unitId: unitAId,
                  quantity: '5',
                  reservationRequested: true,
                },
              ],
            })
            .expect(201);
          const mrId = created.body.id as string;
          await alice
            .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
            .query({ organizationId: orgAId })
            .expect(200);
          await alice
            .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
            .query({ organizationId: orgAId })
            .expect(200);
          return mrId;
        }

        // MR1's lines are (item A, item A2); MR2's are the exact reverse —
        // (item A2, item A) — so each document's own `lineNumber` order
        // disagrees with the other's for the same two balance rows.
        const mr1Id = await createApprovedTwoLineRequest(
          itemAId,
          itemA2Id,
          'Deadlock-order probe — MR1 (A, A2)',
        );
        const mr2Id = await createApprovedTwoLineRequest(
          itemA2Id,
          itemAId,
          'Deadlock-order probe — MR2 (A2, A)',
        );

        // If the two cancellations ever lock their shared balance rows in
        // opposite order, Postgres's deadlock detector aborts one of them;
        // a correct, consistent lock order lets both commit instead. A
        // bounded timeout guards against a true hang if that detector were
        // somehow disabled.
        const results = await Promise.all([
          alice
            .post(`/api/v1/inventory/material-requests/${mr1Id}/cancel`)
            .query({ organizationId: orgAId })
            .send({ reason: 'Deadlock-order probe' })
            .timeout({ deadline: 15000 }),
          alice
            .post(`/api/v1/inventory/material-requests/${mr2Id}/cancel`)
            .query({ organizationId: orgAId })
            .send({ reason: 'Deadlock-order probe' })
            .timeout({ deadline: 15000 }),
        ]);
        expect(results[0].status).toBe(200);
        expect(results[1].status).toBe(200);
        expect(results[0].body.status).toBe('cancelled');
        expect(results[1].body.status).toBe('cancelled');

        // Every reservation on both requests released, and both balance
        // rows restored to their pre-request state — nothing left dangling
        // regardless of which cancellation's transaction committed first.
        const afterA1 = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemAId,
        );
        const afterA2 = await availabilitySnapshot(
          alice,
          orgAId,
          whA3Id,
          itemA2Id,
        );
        expect(afterA1).toEqual(beforeA1);
        expect(afterA2).toEqual(beforeA2);
      },
      20000,
    );

    it(
      'the generic reservation-release endpoint refuses to release a ' +
        "Material Request line's reservation directly, even for a " +
        'caller holding the generic release permission',
      async () => {
        const created = await alice
          .post('/api/v1/inventory/material-requests')
          .send({
            organizationId: orgAId,
            description: 'Generic release must not bypass MR governance',
            lines: [
              {
                itemId: itemAId,
                warehouseId: whA3Id,
                unitId: unitAId,
                quantity: '10',
                reservationRequested: true,
              },
            ],
          })
          .expect(201);
        const mrId = created.body.id as string;
        await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/submit`)
          .query({ organizationId: orgAId })
          .expect(200);
        const approved = await alice
          .post(`/api/v1/inventory/material-requests/${mrId}/approve`)
          .query({ organizationId: orgAId })
          .expect(200);
        const reservationId = approved.body.lines[0].reservationId as string;

        const refused = await alice
          .post(`/api/v1/inventory/reservations/${reservationId}/release`)
          .query({ organizationId: orgAId })
          .send({ operationKey: `generic-release-probe-${reservationId}` });
        expect(refused.status).toBe(422);

        // Untouched: still active, full amount, and the Material Request
        // itself is unaffected — the only ways to release it remain
        // `cancel`/`reverseApproval`/invocation, never this endpoint.
        const reservation = await getReservation(alice, orgAId, reservationId);
        expect(reservation.status).toBe('active');
        expect(reservation.quantity).toBe('10');
        expect(reservation.baseQuantity).toBe('10');
      },
    );
  },
);
