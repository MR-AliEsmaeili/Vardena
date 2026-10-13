import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { describe, expect, it } from 'vitest';
import {
  DomainEventBus,
  type DomainEvent,
} from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';
import {
  createInMemoryStores,
  seedUser,
} from '../../../../test/support/in-memory-repositories.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { PasswordService } from '../domain/password.service.js';
import {
  USER_CREATED_EVENT,
  USER_DISABLED_EVENT,
  USER_ENABLED_EVENT,
  USER_PASSWORD_CHANGED_EVENT,
  USER_PASSWORD_RESET_EVENT,
  USER_UPDATED_EVENT,
} from '../domain/user.events.js';
import { UsersService } from './users.service.js';

const ACTOR = 'actor-1';

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

async function buildFixture(
  licenseOverrides: Parameters<typeof licensingTestDouble>[0] = {},
): Promise<{
  service: UsersService;
  password: PasswordService;
  events: DomainEvent[];
  stores: ReturnType<typeof createInMemoryStores>;
}> {
  const stores = createInMemoryStores();
  const bus = new DomainEventBus();
  const events: DomainEvent[] = [];
  for (const type of [
    USER_CREATED_EVENT,
    USER_UPDATED_EVENT,
    USER_DISABLED_EVENT,
    USER_ENABLED_EVENT,
    USER_PASSWORD_RESET_EVENT,
    USER_PASSWORD_CHANGED_EVENT,
  ]) {
    bus.on(type, (event) => {
      events.push(event);
    });
  }

  const password = new PasswordService();
  const licensing = licensingTestDouble(licenseOverrides);
  const authorization = new AuthorizationService(
    stores.userRoles,
    loggerStub(),
    licensing,
  );
  const service = new UsersService(
    stores.users,
    password,
    authorization,
    loggerStub(),
    bus,
    licensing,
  );
  return { service, password, events, stores };
}

function asActor<R>(fn: () => Promise<R>): Promise<R> {
  return runWithRequestContext(
    {
      correlationId: 'corr-1',
      principal: { userId: ACTOR, sessionId: 'sess' },
    },
    fn,
  );
}

describe('UsersService (administration)', () => {
  it('enforces the unique active-user limit independently of organization memberships', async () => {
    const { service } = await buildFixture({ userLimit: 1 });
    await service.createUser({ username: 'first', password: 'secret' });
    await expect(
      service.createUser({ username: 'second', password: 'secret' }),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });

  it('creates a user with an argon2id hash and never returns the hash', async () => {
    const { service, password, events, stores } = await buildFixture();

    const created = await service.createUser({
      username: '  alice  ',
      password: 'correct horse battery staple',
    });

    expect(created.username).toBe('alice');
    expect(created.isActive).toBe(true);
    expect(created.mustChangePassword).toBe(false);
    // The safe DTO has no hash, and the hash is not the plaintext.
    expect(created).not.toHaveProperty('passwordHash');
    const stored = stores.raw.users.raw(created.id);
    expect(stored?.passwordHash).not.toBe('correct horse battery staple');
    expect(password.isArgon2idHash(stored?.passwordHash ?? '')).toBe(true);
    expect(stored?.mustChangePassword).toBe(false);

    expect(events.map((event) => event.type)).toEqual([USER_CREATED_EVENT]);
    expect(events[0]?.payload).toEqual({
      userId: created.id,
      username: 'alice',
    });
  });

  it('persists mustChangePassword=true when creating a forced-password-change user', async () => {
    const { service, stores } = await buildFixture();
    const created = await service.createUser({
      username: 'bootstrap-admin',
      password: 'initial-password-123',
      mustChangePassword: true,
    });
    expect(created.mustChangePassword).toBe(true);
    expect(stores.raw.users.raw(created.id)?.mustChangePassword).toBe(true);
  });

  it('rejects a duplicate username with a conflict', async () => {
    const { service } = await buildFixture();
    await service.createUser({ username: 'alice', password: 'pw' });

    await expect(
      service.createUser({ username: 'alice', password: 'pw' }),
    ).rejects.toMatchObject({ code: 'Conflict' });
  });

  it('rejects an empty username or password', async () => {
    const { service } = await buildFixture();
    await expect(
      service.createUser({ username: '   ', password: 'pw' }),
    ).rejects.toMatchObject({ code: 'BadRequest' });
    await expect(
      service.createUser({ username: 'alice', password: '' }),
    ).rejects.toMatchObject({ code: 'BadRequest' });
  });

  it('lists users with pagination and an active-state filter', async () => {
    const { service } = await buildFixture();
    const first = await service.createUser({
      username: 'alice',
      password: 'pw',
    });
    await service.createUser({ username: 'bob', password: 'pw' });
    await service.disableUser(first.id);

    const all = await service.listUsers({ page: 1, pageSize: 10 });
    expect(all.total).toBe(2);
    expect(all.items.map((user) => user.username)).toEqual(['alice', 'bob']);

    const active = await service.listUsers({
      page: 1,
      pageSize: 10,
      isActive: true,
    });
    expect(active.items.map((user) => user.username)).toEqual(['bob']);

    const paged = await service.listUsers({ page: 2, pageSize: 1 });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(2);
    expect(paged.page).toBe(2);
  });

  it('rejects an unsupported sort field (no injection into the query)', async () => {
    const { service } = await buildFixture();
    await expect(
      service.listUsers({ page: 1, pageSize: 10, sort: 'passwordHash:asc' }),
    ).rejects.toMatchObject({ code: 'ValidationFailed' });
  });

  it('rejects an unsupported sort direction', async () => {
    const { service } = await buildFixture();
    await expect(
      service.listUsers({ page: 1, pageSize: 10, sort: 'username:sideways' }),
    ).rejects.toMatchObject({ code: 'ValidationFailed' });
  });

  it('hides soft-deleted users from reads', async () => {
    const { service, stores } = await buildFixture();
    const created = await service.createUser({
      username: 'ghost',
      password: 'pw',
    });
    await stores.raw.users.update(created.id, {
      updatedAt: new Date(),
      updatedBy: null,
      deletedAt: new Date(),
    });

    await expect(service.getUser(created.id)).rejects.toMatchObject({
      code: 'EntityNotFound',
    });
    const page = await service.listUsers({ page: 1, pageSize: 10 });
    expect(page.items).toEqual([]);
  });

  it('renames a user and publishes User.Updated', async () => {
    const { service, events } = await buildFixture();
    const created = await service.createUser({
      username: 'alice',
      password: 'pw',
    });

    const updated = await service.updateUser(created.id, {
      username: ' alicia ',
    });

    expect(updated.username).toBe('alicia');
    expect(events.map((event) => event.type)).toContain(USER_UPDATED_EVENT);
  });

  it('rejects a rename onto another user (conflict) and an unknown id (404)', async () => {
    const { service } = await buildFixture();
    const alice = await service.createUser({
      username: 'alice',
      password: 'pw',
    });
    await service.createUser({ username: 'bob', password: 'pw' });

    await expect(
      service.updateUser(alice.id, { username: 'bob' }),
    ).rejects.toMatchObject({ code: 'Conflict' });
    await expect(
      service.updateUser('missing', { username: 'someone' }),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    // Renaming to the same name is a no-op, not a self-conflict.
    await expect(
      service.updateUser(alice.id, { username: 'alice' }),
    ).resolves.toMatchObject({ id: alice.id, username: 'alice' });
  });

  it('disables and re-enables a user, publishing lifecycle events', async () => {
    const { service, events } = await buildFixture();
    const created = await service.createUser({
      username: 'alice',
      password: 'pw',
    });

    expect((await service.disableUser(created.id)).isActive).toBe(false);
    expect((await service.enableUser(created.id)).isActive).toBe(true);

    expect(events.map((event) => event.type)).toEqual([
      USER_CREATED_EVENT,
      USER_DISABLED_EVENT,
      USER_ENABLED_EVENT,
    ]);
    await expect(service.disableUser('missing')).rejects.toMatchObject({
      code: 'EntityNotFound',
    });
  });

  it('resetPassword replaces the hash (the old password no longer verifies)', async () => {
    const { service, password, events, stores } = await buildFixture();
    const created = await service.createUser({
      username: 'alice',
      password: 'old-password',
    });
    const before = stores.raw.users.raw(created.id)?.passwordHash ?? '';

    await service.resetPassword(created.id, 'new-password');

    const after = stores.raw.users.raw(created.id)?.passwordHash ?? '';
    expect(after).not.toBe(before);
    await expect(password.verify(after, 'new-password')).resolves.toBe(true);
    await expect(password.verify(after, 'old-password')).resolves.toBe(false);
    expect(events.map((event) => event.type)).toContain(
      USER_PASSWORD_RESET_EVENT,
    );
  });

  it('resetPassword rejects an empty password and an unknown user', async () => {
    const { service } = await buildFixture();
    const created = await service.createUser({
      username: 'alice',
      password: 'pw',
    });

    await expect(service.resetPassword(created.id, '')).rejects.toMatchObject({
      code: 'ValidationFailed',
    });
    await expect(
      service.resetPassword('missing', 'whatever'),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
  });

  it('changeOwnPassword verifies currentPassword, enforces newPassword policy, hashes with argon2id, and clears mustChangePassword', async () => {
    const { service, password, events, stores } = await buildFixture();
    const created = await service.createUser({
      username: 'admin-user',
      password: 'initial-password-123',
      mustChangePassword: true,
    });
    const beforeHash = stores.raw.users.raw(created.id)?.passwordHash ?? '';

    const updated = await service.changeOwnPassword(created.id, {
      currentPassword: 'initial-password-123',
      newPassword: 'rotated-strong-password-456',
    });

    expect(updated.mustChangePassword).toBe(false);
    expect(stores.raw.users.raw(created.id)?.mustChangePassword).toBe(false);
    const afterHash = stores.raw.users.raw(created.id)?.passwordHash ?? '';
    expect(afterHash).not.toBe(beforeHash);
    expect(afterHash).not.toBe('rotated-strong-password-456');
    expect(password.isArgon2idHash(afterHash)).toBe(true);
    await expect(
      password.verify(afterHash, 'rotated-strong-password-456'),
    ).resolves.toBe(true);
    await expect(
      password.verify(afterHash, 'initial-password-123'),
    ).resolves.toBe(false);
    expect(events.map((event) => event.type)).toContain(
      USER_PASSWORD_CHANGED_EVENT,
    );
  });

  it('changeOwnPassword rejects wrong currentPassword, weak/blank/identical newPassword, and keep mustChangePassword=true on failure', async () => {
    const { service, stores } = await buildFixture();
    const created = await service.createUser({
      username: 'admin-user',
      password: 'initial-password-123',
      mustChangePassword: true,
    });
    const initialHash = stores.raw.users.raw(created.id)?.passwordHash ?? '';

    await expect(
      service.changeOwnPassword(created.id, {
        currentPassword: 'wrong-password',
        newPassword: 'rotated-strong-password-456',
      }),
    ).rejects.toMatchObject({
      code: 'ValidationFailed',
      details: [{ field: 'currentPassword', code: 'invalidCurrentPassword' }],
    });

    await expect(
      service.changeOwnPassword(created.id, {
        currentPassword: 'initial-password-123',
        newPassword: 'short',
      }),
    ).rejects.toMatchObject({
      code: 'ValidationFailed',
      details: [{ field: 'newPassword', code: 'minLength' }],
    });

    await expect(
      service.changeOwnPassword(created.id, {
        currentPassword: 'initial-password-123',
        newPassword: '        ',
      }),
    ).rejects.toMatchObject({
      code: 'ValidationFailed',
      details: [{ field: 'newPassword', code: 'minLength' }],
    });

    await expect(
      service.changeOwnPassword(created.id, {
        currentPassword: 'initial-password-123',
        newPassword: 'initial-password-123',
      }),
    ).rejects.toMatchObject({
      code: 'ValidationFailed',
      details: [{ field: 'newPassword', code: 'mustDifferFromCurrent' }],
    });

    // Neither passwordHash nor mustChangePassword changed on rejected attempts.
    expect(stores.raw.users.raw(created.id)?.passwordHash).toBe(initialHash);
    expect(stores.raw.users.raw(created.id)?.mustChangePassword).toBe(true);
  });

  it('verifies credentials but never leaks the failure reason through the service result shape used by login', async () => {
    const { service } = await buildFixture();
    await service.createUser({ username: 'alice', password: 'correct' });

    const ok = await service.verifyCredentials('alice', 'correct');
    expect(ok.user?.username).toBe('alice');
    expect(ok.failureReason).toBeNull();

    const wrongPassword = await service.verifyCredentials('alice', 'wrong');
    expect(wrongPassword.user).toBeNull();
    expect(wrongPassword.failureReason).toBe('invalid_credentials');

    const unknown = await service.verifyCredentials('nobody', 'whatever');
    expect(unknown.failureReason).toBe('invalid_credentials');

    const disabled = await service.createUser({
      username: 'disabled',
      password: 'correct',
    });
    await service.disableUser(disabled.id);
    const disabledResult = await service.verifyCredentials(
      'disabled',
      'correct',
    );
    expect(disabledResult.user).toBeNull();
    expect(disabledResult.failureReason).toBe('user_disabled');
  });
});

describe('UsersService (authorization)', () => {
  it('denies administration to an authenticated principal without the permission (403)', async () => {
    const { service } = await buildFixture();
    const created = await service.createUser({
      username: 'alice',
      password: 'pw',
    });

    await expect(
      asActor(() => service.listUsers({ page: 1, pageSize: 10 })),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
    await expect(
      asActor(() => service.getUser(created.id)),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
    await expect(
      asActor(() => service.createUser({ username: 'bob', password: 'pw' })),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
    await expect(
      asActor(() => service.disableUser(created.id)),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
  });

  it('reports an anonymous request as 401 (not 403)', async () => {
    const { service } = await buildFixture();
    await expect(
      runWithRequestContext({ correlationId: 'corr-1' }, () =>
        service.listUsers({ page: 1, pageSize: 10 }),
      ),
    ).rejects.toMatchObject({ code: 'Unauthorized' });
  });

  it('allows administration when the principal holds the permission through a role', async () => {
    const { service, stores } = await buildFixture();
    await seedUser(stores, { id: ACTOR, username: 'admin' });
    await stores.raw.permissions.syncDefinitions(
      [
        {
          code: 'Users.User.View',
          description: 'View users',
        },
      ],
      new Date(),
    );
    const permission =
      await stores.raw.permissions.findByCode('Users.User.View');
    const role = await stores.raw.roles.createWithPermissions({
      id: 'role-admin',
      name: 'User Admin',
      description: null,
      permissionIds: permission === null ? [] : [permission.id],
      now: new Date(),
      createdBy: null,
    });
    await stores.raw.userRoles.assign({
      userId: ACTOR,
      roleId: role.id,
      now: new Date(),
      createdBy: null,
    });

    const page = await asActor(() =>
      service.listUsers({ page: 1, pageSize: 10 }),
    );
    expect(page.total).toBe(1);
    expect(page.items.map((user) => user.username)).toEqual(['admin']);
  });
});
