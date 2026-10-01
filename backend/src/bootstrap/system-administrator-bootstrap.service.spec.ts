import { describe, expect, it, vi } from 'vitest';
import { AppException } from '../kernel/errors/app-exception.js';
import type { User } from '../modules/users/domain/user.js';
import type { Organization } from '../modules/organization/domain/organization.js';
import { OrganizationMembershipsService } from '../modules/organization/application/organization-memberships.service.js';
import { OrganizationsService } from '../modules/organization/application/organizations.service.js';
import { SystemAdministratorRbacService } from '../modules/rbac/application/system-administrator-rbac.service.js';
import { InstallationIdentityService } from '../modules/licensing/application/installation-identity.service.js';
import { UsersService } from '../modules/users/application/users.service.js';
import {
  BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
  SystemAdministratorBootstrapService,
} from './system-administrator-bootstrap.service.js';

const INSTALLATION_ID = '01K6D3Q8GH0K97M5DFYBTZ8V7N';
const USER_ID = '01K6D3Q8GH0K97M5DFYBTZ8V7P';
const ROLE_ID = '01K6D3Q8GH0K97M5DFYBTZ8V7Q';
const ORGANIZATION_ID = '01K6D3Q8GH0K97M5DFYBTZ8V7R';

function storedUser(overrides: Partial<User> = {}): User {
  const now = new Date('2026-09-26T00:00:00.000Z');
  return {
    id: USER_ID,
    username: BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
    passwordHash: '$argon2id$stored-hash',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function pinnedOrganization(): Organization {
  const now = new Date('2026-09-26T00:00:00.000Z');
  return {
    id: ORGANIZATION_ID,
    code: 'MAIN',
    name: 'سازمان اصلی',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  } as Organization;
}

interface Harness {
  service: SystemAdministratorBootstrapService;
  findByUsername: ReturnType<typeof vi.fn>;
  createUser: ReturnType<typeof vi.fn>;
  ensureForUser: ReturnType<typeof vi.fn>;
  ensureDeploymentOrganization: ReturnType<typeof vi.fn>;
  grantMembership: ReturnType<typeof vi.fn>;
}

function harness(options: {
  existingUser?: User | null;
  createUser?: ReturnType<typeof vi.fn>;
  rbac?: {
    roleCreated: boolean;
    userRoleCreated: boolean;
    permissionCount?: number;
  };
  organization?: { organization: Organization; created: boolean } | null;
  grantMembership?: ReturnType<typeof vi.fn>;
}): Harness {
  const findByUsername = vi
    .fn()
    .mockResolvedValue(options.existingUser ?? null);
  const createUser =
    options.createUser ??
    vi.fn().mockResolvedValue({
      id: USER_ID,
      username: BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
      isActive: true,
      createdAt: '2026-09-26T00:00:00.000Z',
      updatedAt: '2026-09-26T00:00:00.000Z',
    });
  const ensureForUser = vi.fn().mockResolvedValue({
    roleId: ROLE_ID,
    permissionCount: options.rbac?.permissionCount ?? 131,
    roleCreated: options.rbac?.roleCreated ?? true,
    userRoleCreated: options.rbac?.userRoleCreated ?? true,
  });
  const ensureDeploymentOrganization = vi
    .fn()
    .mockResolvedValue(
      options.organization === undefined
        ? { organization: pinnedOrganization(), created: true }
        : options.organization,
    );
  const grantMembership = options.grantMembership ?? vi.fn();
  const currentInstallation = vi.fn().mockResolvedValue({
    installationId: INSTALLATION_ID,
    name: 'Vardena installation',
    customerId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  const service = new SystemAdministratorBootstrapService(
    {
      current: currentInstallation,
    } as unknown as InstallationIdentityService,
    { findByUsername, createUser } as unknown as UsersService,
    { ensureForUser } as unknown as SystemAdministratorRbacService,
    { ensureDeploymentOrganization } as unknown as OrganizationsService,
    { grantMembership } as unknown as OrganizationMembershipsService,
  );
  return {
    service,
    findByUsername,
    createUser,
    ensureForUser,
    ensureDeploymentOrganization,
    grantMembership,
  };
}

describe('SystemAdministratorBootstrapService', () => {
  it('creates the exact initial credential through Users and assigns the real RBAC role', async () => {
    const h = harness({});

    await expect(h.service.run()).resolves.toEqual({
      installationId: INSTALLATION_ID,
      userId: USER_ID,
      roleId: ROLE_ID,
      permissionCount: 131,
      userCreated: true,
      roleCreated: true,
      userRoleCreated: true,
      organizationId: ORGANIZATION_ID,
      organizationCreated: true,
      membershipCreated: true,
    });
    expect(h.createUser).toHaveBeenCalledOnce();
    expect(h.createUser).toHaveBeenCalledWith({
      username: 'مدیر',
      password: '1',
    });
    expect(h.ensureForUser).toHaveBeenCalledWith(USER_ID);
  });

  it('is idempotent and never resets an existing bootstrap user password', async () => {
    const h = harness({
      existingUser: storedUser(),
      rbac: { roleCreated: false, userRoleCreated: false },
      organization: { organization: pinnedOrganization(), created: false },
      grantMembership: vi
        .fn()
        .mockRejectedValue(
          AppException.conflict(
            'That user is already a member of this organization.',
          ),
        ),
    });

    const first = await h.service.run();
    const second = await h.service.run();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      userCreated: false,
      roleCreated: false,
      userRoleCreated: false,
      organizationCreated: false,
      membershipCreated: false,
    });
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.ensureForUser).toHaveBeenCalledTimes(2);
    expect(h.ensureForUser).toHaveBeenNthCalledWith(1, USER_ID);
    expect(h.ensureForUser).toHaveBeenNthCalledWith(2, USER_ID);
    // Never a duplicate membership row: the second run only re-attempts the
    // owning service's idempotent-refused grant.
    expect(h.grantMembership).toHaveBeenCalledTimes(2);
  });

  it('creates the missing deployment membership for an existing administrator', async () => {
    const h = harness({
      existingUser: storedUser(),
      rbac: { roleCreated: false, userRoleCreated: false },
      organization: { organization: pinnedOrganization(), created: false },
    });

    await expect(h.service.run()).resolves.toMatchObject({
      userCreated: false,
      organizationId: ORGANIZATION_ID,
      organizationCreated: false,
      membershipCreated: true,
    });
    expect(h.grantMembership).toHaveBeenCalledWith(ORGANIZATION_ID, USER_ID);
  });

  it('reconciles a missing or incomplete role assignment on an existing user', async () => {
    const h = harness({
      existingUser: storedUser(),
      rbac: { roleCreated: false, userRoleCreated: true, permissionCount: 146 },
      organization: { organization: pinnedOrganization(), created: false },
    });

    await expect(h.service.run()).resolves.toMatchObject({
      userCreated: false,
      roleCreated: false,
      userRoleCreated: true,
      permissionCount: 146,
    });
  });

  it('invents no organization when the deployment is not pinned', async () => {
    const h = harness({ organization: null });

    await expect(h.service.run()).resolves.toMatchObject({
      organizationId: null,
      organizationCreated: false,
      membershipCreated: false,
    });
    expect(h.grantMembership).not.toHaveBeenCalled();
  });

  it('refuses to silently reactivate a disabled bootstrap administrator', async () => {
    const h = harness({ existingUser: storedUser({ isActive: false }) });

    await expect(h.service.run()).rejects.toThrow(
      /disabled or deleted.*will not silently reactivate/s,
    );
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.ensureForUser).not.toHaveBeenCalled();
    expect(h.grantMembership).not.toHaveBeenCalled();
  });

  it('refuses to silently undelete a soft-deleted bootstrap administrator', async () => {
    const h = harness({
      existingUser: storedUser({ deletedAt: new Date('2026-09-26') }),
    });

    await expect(h.service.run()).rejects.toThrow(
      /disabled or deleted.*will not silently reactivate/s,
    );
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it('adopts the winner of a concurrent bootstrap instead of failing', async () => {
    const findByUsername = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedUser());
    const createUser = vi
      .fn()
      .mockRejectedValue(
        AppException.conflict('That username is already taken.'),
      );
    const ensureForUser = vi.fn().mockResolvedValue({
      roleId: ROLE_ID,
      permissionCount: 131,
      roleCreated: false,
      userRoleCreated: false,
    });
    const service = new SystemAdministratorBootstrapService(
      {
        current: vi.fn().mockResolvedValue({
          installationId: INSTALLATION_ID,
          name: 'Vardena installation',
          customerId: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      } as unknown as InstallationIdentityService,
      { findByUsername, createUser } as unknown as UsersService,
      { ensureForUser } as unknown as SystemAdministratorRbacService,
      {
        ensureDeploymentOrganization: vi.fn().mockResolvedValue(null),
      } as unknown as OrganizationsService,
      { grantMembership: vi.fn() } as unknown as OrganizationMembershipsService,
    );

    await expect(service.run()).resolves.toMatchObject({
      installationId: INSTALLATION_ID,
      userId: USER_ID,
      userCreated: false,
    });
  });

  it('propagates a non-conflict membership failure instead of reporting success', async () => {
    const h = harness({
      grantMembership: vi
        .fn()
        .mockRejectedValue(AppException.notFound('Organization')),
    });

    await expect(h.service.run()).rejects.toBeInstanceOf(AppException);
  });
});
