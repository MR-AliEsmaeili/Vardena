import { describe, expect, it } from 'vitest';
import {
  DomainEventBus,
  type DomainEvent,
} from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { createInMemoryStores } from '../../../../test/support/in-memory-repositories.js';
import {
  USER_ROLE_ASSIGNED_EVENT,
  USER_ROLE_REMOVED_EVENT,
} from '../domain/rbac.events.js';
import { AuthorizationService } from './authorization.service.js';
import { UserRolesService } from './user-roles.service.js';

const USER = 'user-1';

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

async function buildFixture(): Promise<{
  service: UserRolesService;
  events: DomainEvent[];
  stores: ReturnType<typeof createInMemoryStores>;
  roleId: string;
}> {
  const stores = createInMemoryStores();
  await stores.raw.users.create({
    id: USER,
    username: 'alice',
    passwordHash: 'hash',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
  });
  const role = await stores.raw.roles.createWithPermissions({
    id: 'role-1',
    name: 'Viewer',
    description: null,
    permissionIds: [],
    now: new Date(),
    createdBy: null,
  });

  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  bus.on(USER_ROLE_ASSIGNED_EVENT, (event) => {
    events.push(event);
  });
  bus.on(USER_ROLE_REMOVED_EVENT, (event) => {
    events.push(event);
  });

  const authorization = new AuthorizationService(
    stores.userRoles,
    loggerStub(),
  );
  const service = new UserRolesService(
    stores.roles,
    stores.userRoles,
    authorization,
    loggerStub(),
    bus,
  );
  return { service, events, stores, roleId: role.id };
}

describe('UserRolesService', () => {
  it('assigns a role to a user and publishes UserRole.Assigned', async () => {
    const { service, events, stores, roleId } = await buildFixture();

    await service.assignRoleToUser(roleId, USER);

    expect(stores.raw.userRoles.isAssigned(USER, roleId)).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      USER_ROLE_ASSIGNED_EVENT,
    ]);
    expect(events[0]?.aggregateId).toBe(`${USER}:${roleId}`);
    expect(events[0]?.payload).toEqual({ userId: USER, roleId });
  });

  it('rejects a duplicate assignment with a conflict', async () => {
    const { service, roleId } = await buildFixture();
    await service.assignRoleToUser(roleId, USER);

    await expect(service.assignRoleToUser(roleId, USER)).rejects.toMatchObject({
      code: 'Conflict',
    });
  });

  it('reports an unknown user as 404 from the foreign-key violation', async () => {
    const { service, roleId } = await buildFixture();

    await expect(
      service.assignRoleToUser(roleId, 'user-missing'),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('reports an unknown role as 404 without touching the assignment table', async () => {
    const { service, stores } = await buildFixture();

    await expect(
      service.assignRoleToUser('role-x', USER),
    ).rejects.toMatchObject({
      code: 'EntityNotFound',
    });
    expect(stores.raw.userRoles.isAssigned(USER, 'role-x')).toBe(false);
  });

  it('removes an assignment and publishes UserRole.Removed', async () => {
    const { service, events, stores, roleId } = await buildFixture();
    await service.assignRoleToUser(roleId, USER);

    await service.removeRoleFromUser(roleId, USER);

    expect(stores.raw.userRoles.isAssigned(USER, roleId)).toBe(false);
    expect(events.map((event) => event.type)).toEqual([
      USER_ROLE_ASSIGNED_EVENT,
      USER_ROLE_REMOVED_EVENT,
    ]);
  });

  it('rejects removing an assignment that does not exist', async () => {
    const { service, roleId } = await buildFixture();
    await expect(
      service.removeRoleFromUser(roleId, USER),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('lists the roles of a user (and only that user)', async () => {
    const { service, roleId, stores } = await buildFixture();
    await stores.raw.users.create({
      id: 'user-2',
      username: 'bob',
      passwordHash: 'hash',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    });
    await service.assignRoleToUser(roleId, USER);

    await expect(service.listRoleIdsForUser(USER)).resolves.toEqual([roleId]);
    await expect(service.listRoleIdsForUser('user-2')).resolves.toEqual([]);
  });
});
