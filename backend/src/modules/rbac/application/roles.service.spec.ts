import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { describe, expect, it } from 'vitest';
import {
  DomainEventBus,
  type DomainEvent,
} from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';
import { createInMemoryStores } from '../../../../test/support/in-memory-repositories.js';
import {
  RBAC_PERMISSIONS,
  RBAC_PERMISSION_DEFINITIONS,
} from '../domain/rbac-permissions.js';
import {
  ROLE_CREATED_EVENT,
  ROLE_PERMISSION_ASSIGNED_EVENT,
  ROLE_PERMISSION_REMOVED_EVENT,
  ROLE_UPDATED_EVENT,
} from '../domain/rbac.events.js';
import { AuthorizationService } from './authorization.service.js';
import { PermissionRegistry } from './permission-registry.js';
import { PermissionsService } from './permissions.service.js';
import { RolesService } from './roles.service.js';

const ACTOR = 'actor-1';

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

async function buildFixture(): Promise<{
  service: RolesService;
  events: DomainEvent[];
}> {
  const stores = createInMemoryStores();
  const registry = new PermissionRegistry();
  registry.register(RBAC_PERMISSION_DEFINITIONS);

  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  for (const type of [
    ROLE_CREATED_EVENT,
    ROLE_UPDATED_EVENT,
    ROLE_PERMISSION_ASSIGNED_EVENT,
    ROLE_PERMISSION_REMOVED_EVENT,
  ]) {
    bus.on(type, (event) => {
      events.push(event);
    });
  }

  // Mirror the registry into the permission table, like the startup sync does.
  await stores.raw.permissions.syncDefinitions(registry.all(), new Date());

  const permissions = new PermissionsService(
    registry,
    stores.permissions,
    licensingTestDouble(),
  );
  const authorization = new AuthorizationService(
    stores.userRoles,
    loggerStub(),
    licensingTestDouble(),
  );
  const service = new RolesService(
    stores.roles,
    permissions,
    authorization,
    loggerStub(),
    bus,
  );
  return { service, events };
}

describe('RolesService', () => {
  it('creates a role together with its permission set and publishes Role.Created', async () => {
    const { service, events } = await buildFixture();

    const created = await service.createRole({
      name: '  Auditor  ',
      description: 'Read-only access',
      permissionCodes: [
        RBAC_PERMISSIONS.ROLE_VIEW,
        RBAC_PERMISSIONS.PERMISSION_VIEW,
      ],
    });

    expect(created.name).toBe('Auditor');
    expect(created.permissionCount).toBe(2);
    // Sorted by code, like the real repository's detail query.
    expect(created.permissions.map((permission) => permission.code)).toEqual([
      'Rbac.Permission.View',
      'Rbac.Role.View',
    ]);
    expect(events.map((event) => event.type)).toEqual([ROLE_CREATED_EVENT]);
    expect(events[0]?.payload).toMatchObject({
      name: 'Auditor',
      permissionCodes: ['Rbac.Role.View', 'Rbac.Permission.View'],
    });
  });

  it('rejects a duplicate role name with a conflict', async () => {
    const { service } = await buildFixture();
    await service.createRole({ name: 'Auditor' });

    await expect(service.createRole({ name: 'Auditor' })).rejects.toMatchObject(
      {
        code: 'Conflict',
      },
    );
  });

  it('rejects an unknown permission code (404) and a malformed one (400)', async () => {
    const { service } = await buildFixture();

    await expect(
      service.createRole({
        name: 'Unknown code',
        permissionCodes: ['Inventory.Receipt.View'],
      }),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });

    await expect(
      service.createRole({
        name: 'Malformed code',
        permissionCodes: ['not-a-code'],
      }),
    ).rejects.toMatchObject({ code: 'ValidationFailed' });
  });

  it('updates a role and publishes Role.Updated', async () => {
    const { service, events } = await buildFixture();
    const role = await service.createRole({ name: 'Auditor' });

    const updated = await service.updateRole(role.id, {
      name: 'Senior Auditor',
      description: null,
    });

    expect(updated.name).toBe('Senior Auditor');
    expect(updated.description).toBeNull();
    expect(events.map((event) => event.type)).toContain(ROLE_UPDATED_EVENT);
  });

  it('returns 404 for an unknown role on read and update', async () => {
    const { service } = await buildFixture();
    await expect(service.getRole('missing')).rejects.toMatchObject({
      code: 'EntityNotFound',
    });
    await expect(
      service.updateRole('missing', { name: 'X' }),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('assigns and removes a permission, publishing the matching events', async () => {
    const { service, events } = await buildFixture();
    const role = await service.createRole({ name: 'Viewer' });

    await service.assignPermissionToRole(role.id, RBAC_PERMISSIONS.ROLE_VIEW);
    const withPermission = await service.getRole(role.id);
    expect(
      withPermission.permissions.map((permission) => permission.code),
    ).toEqual(['Rbac.Role.View']);

    // The database constraint is what makes a duplicate a conflict.
    await expect(
      service.assignPermissionToRole(role.id, RBAC_PERMISSIONS.ROLE_VIEW),
    ).rejects.toMatchObject({ code: 'Conflict' });

    await service.removePermissionFromRole(role.id, RBAC_PERMISSIONS.ROLE_VIEW);
    const empty = await service.getRole(role.id);
    expect(empty.permissions).toEqual([]);

    await expect(
      service.removePermissionFromRole(role.id, RBAC_PERMISSIONS.ROLE_VIEW),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });

    expect(events.map((event) => event.type)).toEqual([
      ROLE_CREATED_EVENT,
      ROLE_PERMISSION_ASSIGNED_EVENT,
      ROLE_PERMISSION_REMOVED_EVENT,
    ]);
  });

  it('rejects assignment to an unknown role or an unknown permission', async () => {
    const { service } = await buildFixture();
    const role = await service.createRole({ name: 'Viewer' });

    await expect(
      service.assignPermissionToRole('missing', RBAC_PERMISSIONS.ROLE_VIEW),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    await expect(
      service.assignPermissionToRole(role.id, 'Inventory.Receipt.View'),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('lists roles with pagination and a permission count', async () => {
    const { service } = await buildFixture();
    await service.createRole({
      name: 'A',
      permissionCodes: [RBAC_PERMISSIONS.ROLE_VIEW],
    });
    await service.createRole({ name: 'B' });

    const page = await service.listRoles({ page: 1, pageSize: 1 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.pageSize).toBe(1);

    const all = await service.listRoles({
      page: 1,
      pageSize: 10,
      sort: 'name:asc',
    });
    expect(all.items.map((role) => role.name)).toEqual(['A', 'B']);
    expect(all.items[0]?.permissionCount).toBe(1);
  });

  it('rejects an unsupported sort field instead of passing it to the query', async () => {
    const { service } = await buildFixture();
    await expect(
      service.listRoles({ page: 1, pageSize: 10, sort: 'secret:asc' }),
    ).rejects.toMatchObject({ code: 'ValidationFailed' });
  });

  it('denies role administration in a request context without the permission', async () => {
    const { service } = await buildFixture();
    await runWithRequestContext(
      { correlationId: 'corr-1', principal: { userId: ACTOR, sessionId: 's' } },
      async () => {
        await expect(
          service.listRoles({ page: 1, pageSize: 10 }),
        ).rejects.toMatchObject({ code: 'PermissionDenied' });
      },
    );
  });

  it('does not define any Delete permission (lifecycle is an open question)', () => {
    expect(
      RBAC_PERMISSION_DEFINITIONS.some((definition) =>
        definition.code.endsWith('Delete'),
      ),
    ).toBe(false);
  });
});
