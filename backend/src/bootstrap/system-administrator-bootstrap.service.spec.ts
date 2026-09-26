import { describe, expect, it, vi } from 'vitest';
import type { User } from '../modules/users/domain/user.js';
import { SystemAdministratorRbacService } from '../modules/rbac/application/system-administrator-rbac.service.js';
import { UsersService } from '../modules/users/application/users.service.js';
import {
  BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
  SystemAdministratorBootstrapService,
} from './system-administrator-bootstrap.service.js';

const USER_ID = '01K6D3Q8GH0K97M5DFYBTZ8V7P';
const ROLE_ID = '01K6D3Q8GH0K97M5DFYBTZ8V7Q';

function storedUser(): User {
  const now = new Date('2026-09-26T00:00:00.000Z');
  return {
    id: USER_ID,
    username: BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
    passwordHash: '$argon2id$stored-hash',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

describe('SystemAdministratorBootstrapService', () => {
  it('creates the exact initial credential through Users and assigns the real RBAC role', async () => {
    const findByUsername = vi.fn().mockResolvedValue(null);
    const createUser = vi.fn().mockResolvedValue({
      id: USER_ID,
      username: BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
      isActive: true,
      createdAt: '2026-09-26T00:00:00.000Z',
      updatedAt: '2026-09-26T00:00:00.000Z',
    });
    const ensureForUser = vi.fn().mockResolvedValue({
      roleId: ROLE_ID,
      permissionCount: 131,
      roleCreated: true,
      userRoleCreated: true,
    });
    const service = new SystemAdministratorBootstrapService(
      { findByUsername, createUser } as unknown as UsersService,
      { ensureForUser } as unknown as SystemAdministratorRbacService,
    );

    await expect(service.run()).resolves.toEqual({
      userId: USER_ID,
      roleId: ROLE_ID,
      permissionCount: 131,
      userCreated: true,
      roleCreated: true,
      userRoleCreated: true,
    });
    expect(createUser).toHaveBeenCalledOnce();
    expect(createUser).toHaveBeenCalledWith({
      username: 'مدیر',
      password: '1',
    });
    expect(ensureForUser).toHaveBeenCalledWith(USER_ID);
  });

  it('is idempotent and never resets an existing bootstrap user password', async () => {
    const findByUsername = vi.fn().mockResolvedValue(storedUser());
    const createUser = vi.fn();
    const ensureForUser = vi.fn().mockResolvedValue({
      roleId: ROLE_ID,
      permissionCount: 131,
      roleCreated: false,
      userRoleCreated: false,
    });
    const service = new SystemAdministratorBootstrapService(
      { findByUsername, createUser } as unknown as UsersService,
      { ensureForUser } as unknown as SystemAdministratorRbacService,
    );

    const first = await service.run();
    const second = await service.run();

    expect(first).toEqual(second);
    expect(createUser).not.toHaveBeenCalled();
    expect(ensureForUser).toHaveBeenCalledTimes(2);
    expect(ensureForUser).toHaveBeenNthCalledWith(1, USER_ID);
    expect(ensureForUser).toHaveBeenNthCalledWith(2, USER_ID);
  });
});
