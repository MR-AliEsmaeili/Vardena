import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { toBusinessDate } from '../src/kernel/datetime/business-date.js';
import { PermissionRegistry } from '../src/modules/rbac/application/permission-registry.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { OrganizationMembershipsRepository } from '../src/modules/organization/data/organization-memberships.repository.js';
import { KARDEX_PERMISSIONS } from '../src/modules/inventory/domain/inventory-kardex-permissions.js';
import { InventoryKardexRepository } from '../src/modules/inventory/data/inventory-kardex.repository.js';
import { createTestApp } from './support/test-app.js';

const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Inventory quantity Kardex (live database)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let repository: InventoryKardexRepository;
    let kardexViewer: ReturnType<typeof request.agent>;
    let foreignKardexViewer: ReturnType<typeof request.agent>;
    let viewerWithoutPermission: ReturnType<typeof request.agent>;
    const ids = {
      org: generateId(),
      otherOrg: generateId(),
      branch: generateId(),
      unit: generateId(),
      item: generateId(),
      warehouse: generateId(),
    };
    const movementIds: string[] = [];
    const userIds: string[] = [];
    let roleId = '';

    beforeAll(async () => {
      // The shared CI database has only the bootstrap administrator's
      // unlicensed one-user allowance. This suite tests Inventory/RBAC, not
      // licensing, so use the explicit local-development provider in this
      // isolated app instance instead of changing persisted license state.
      const testConfig = loadAppConfig({
        DATABASE_URL: DATABASE_URL!,
        LICENSE_PROVIDER: 'local-development',
      });
      const built = await createTestApp({
        override: (builder) =>
          builder.overrideProvider(APP_CONFIG).useValue(testConfig),
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
        'INSERT INTO organization.organizations (id, code, name) VALUES ($1,$2,$3)',
        ids.otherOrg,
        `K-OTHER-${ids.otherOrg}`,
        'Kardex Other Organization',
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

      const users = app.get(UsersService);
      const roles = app.get(RolesService);
      const userRoles = app.get(UserRolesService);
      const permissions = app.get(PermissionRegistry);
      expect(permissions.has(KARDEX_PERMISSIONS.VIEW)).toBe(true);

      const suffix = ids.org.slice(-8).toLowerCase();
      const viewerCredentials = {
        username: `kardex-view-${suffix}`,
        password: 'kardex-view-password',
      };
      const foreignViewerCredentials = {
        username: `kardex-foreign-${suffix}`,
        password: 'kardex-foreign-password',
      };
      const deniedCredentials = {
        username: `kardex-denied-${suffix}`,
        password: 'kardex-denied-password',
      };
      const viewer = await users.createUser(viewerCredentials);
      userIds.push(viewer.id);
      const foreignViewer = await users.createUser(foreignViewerCredentials);
      userIds.push(foreignViewer.id);
      const deniedViewer = await users.createUser(deniedCredentials);
      userIds.push(deniedViewer.id);
      const role = await roles.createRole({
        name: `Kardex Viewer ${suffix}`,
        description: 'Live Kardex endpoint fixture',
        permissionCodes: [KARDEX_PERMISSIONS.VIEW],
      });
      roleId = role.id;
      await userRoles.assignRoleToUser(role.id, viewer.id);
      await userRoles.assignRoleToUser(role.id, foreignViewer.id);

      const memberships = app.get(OrganizationMembershipsRepository);
      await memberships.create({
        userId: viewer.id,
        organizationId: ids.org,
        now: new Date(),
        createdBy: null,
      });
      await memberships.create({
        userId: foreignViewer.id,
        organizationId: ids.otherOrg,
        now: new Date(),
        createdBy: null,
      });
      await memberships.create({
        userId: deniedViewer.id,
        organizationId: ids.org,
        now: new Date(),
        createdBy: null,
      });

      kardexViewer = request.agent(app.getHttpServer());
      foreignKardexViewer = request.agent(app.getHttpServer());
      viewerWithoutPermission = request.agent(app.getHttpServer());
      await kardexViewer
        .post('/api/v1/auth/login')
        .send(viewerCredentials)
        .expect(200);
      await foreignKardexViewer
        .post('/api/v1/auth/login')
        .send(foreignViewerCredentials)
        .expect(200);
      await viewerWithoutPermission
        .post('/api/v1/auth/login')
        .send(deniedCredentials)
        .expect(200);
    });

    afterAll(async () => {
      if (app === undefined) return;
      try {
        const db = await prisma.getClient<{
          $executeRawUnsafe(
            sql: string,
            ...values: unknown[]
          ): Promise<unknown>;
          userRole: { deleteMany(args: unknown): Promise<unknown> };
          rolePermission: { deleteMany(args: unknown): Promise<unknown> };
          role: { deleteMany(args: unknown): Promise<unknown> };
          user: { deleteMany(args: unknown): Promise<unknown> };
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
          'DELETE FROM organization.organization_memberships WHERE organization_id IN ($1, $2)',
          ids.org,
          ids.otherOrg,
        );
        await db.$executeRawUnsafe(
          'DELETE FROM organization.organizations WHERE id IN ($1, $2)',
          ids.org,
          ids.otherOrg,
        );
        await db.userRole.deleteMany({ where: { userId: { in: userIds } } });
        if (roleId !== '') {
          await db.rolePermission.deleteMany({ where: { roleId } });
          await db.role.deleteMany({ where: { id: roleId } });
        }
        await db.user.deleteMany({ where: { id: { in: userIds } } });
      } finally {
        await app.close();
      }
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
        dateFrom: toBusinessDate('2026-01-05')!,
        dateTo: toBusinessDate('2026-01-10')!,
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

    it('serves the quantity route with permission, ODR-3 isolation, and snapshot pagination', async () => {
      await insert(
        'inbound',
        '100.0000',
        '2025-02-01T00:00:00Z',
        '2025-02-01T01:00:00Z',
      );
      const sameDate = '2025-02-05T00:00:00Z';
      const sameCreated = '2025-02-05T01:00:00Z';
      const orderedIds = [generateId(), generateId()].sort();
      await insert(
        'outbound',
        '-30.0000',
        sameDate,
        sameCreated,
        orderedIds[0],
      );
      await insert(
        'adjustment_in',
        '20.0000',
        sameDate,
        sameCreated,
        orderedIds[1],
      );
      await insert(
        'transfer_in',
        '5.0000',
        '2025-02-06T00:00:00Z',
        '2025-02-06T01:00:00Z',
      );
      await insert(
        'transfer_out',
        '-5.0000',
        '2025-02-07T00:00:00Z',
        '2025-02-07T01:00:00Z',
      );
      await insert(
        'adjustment_out',
        '-2.5000',
        '2025-02-08T00:00:00Z',
        '2025-02-08T01:00:00Z',
      );

      const query = {
        organizationId: ids.org,
        itemId: ids.item,
        warehouseId: ids.warehouse,
        dateFrom: toBusinessDate('2025-02-05')!,
        dateTo: toBusinessDate('2025-02-08')!,
        pageSize: 2,
      };
      const first = await kardexViewer
        .get('/api/v1/inventory/kardex/quantity')
        .query({ ...query, page: 1 })
        .expect(200);
      expect(first.body).toMatchObject({
        total: 5,
        page: 1,
        pageSize: 2,
        opening: '100.0000',
        closing: '87.5000',
        items: [
          {
            movementId: orderedIds[0],
            date: '2025-02-05',
            movementType: 'outbound',
            quantityChange: '-30.0000',
            quantityAfter: '70.0000',
          },
          {
            movementId: orderedIds[1],
            date: '2025-02-05',
            movementType: 'adjustment_in',
            quantityChange: '20.0000',
            quantityAfter: '90.0000',
          },
        ],
      });
      expect(first.body.snapshot).toEqual(expect.any(String));
      expect(first.body.unitId).toBe(ids.unit);

      const second = await kardexViewer
        .get('/api/v1/inventory/kardex/quantity')
        .query({ ...query, page: 2, snapshot: first.body.snapshot })
        .expect(200);
      expect(second.body).toMatchObject({
        total: 5,
        page: 2,
        pageSize: 2,
        items: [
          { movementType: 'transfer_in', quantityAfter: '95.0000' },
          { movementType: 'transfer_out', quantityAfter: '90.0000' },
        ],
      });

      await foreignKardexViewer
        .get('/api/v1/inventory/kardex/quantity')
        .query({ ...query, page: 1 })
        .expect(404);
      await viewerWithoutPermission
        .get('/api/v1/inventory/kardex/quantity')
        .query({ ...query, page: 1 })
        .expect(403);
      await kardexViewer
        .get('/api/v1/inventory/kardex/quantity')
        .query({
          organizationId: ids.org,
          itemId: ids.item,
          warehouseId: generateId(),
          page: 1,
        })
        .expect(404);
      await kardexViewer
        .get('/api/v1/inventory/kardex/quantity')
        .query({
          organizationId: ids.org,
          itemId: ids.item,
          warehouseId: ids.warehouse,
          page: 1,
          pageSize: 501,
        })
        .expect(400);
      await kardexViewer
        .get('/api/v1/inventory/kardex/quantity')
        .query({ organizationId: ids.org, page: 1 })
        .expect(400);
    });
  },
);
