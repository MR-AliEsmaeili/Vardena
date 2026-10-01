/**
 * In-memory stand-ins for the Prisma-backed repositories (test support).
 *
 * Purpose: tests run the FULL application stack — controllers, guards, real
 * application services, real password hashing, the production HTTP pipeline —
 * against in-memory data access, so the suite needs no Postgres, no Docker and
 * no code generation.
 *
 * What is faked and what is not:
 * - faked: the five repositories (`UsersRepository`, `SessionsRepository`,
 *   `PermissionsRepository`, `RolesRepository`, `UserRolesRepository`) and
 *   `PrismaService` (which must never be touched);
 * - NOT faked: everything that encodes behaviour under test — authorization
 *   checks, the permission registry + startup sync, role/user services,
 *   guards, DTO validation, session lifecycle, password hashing.
 *
 * The fakes mimic the contracts the real repositories guarantee, including the
 * database-level failures the application maps to API responses (unique
 * violations `P2002`, foreign-key violations `P2003`, missing rows `P2025`).
 * Keep them in sync with the repositories they stand in for.
 *
 * Usage (see test/rbac.e2e-spec.ts):
 *
 *   const stores = createInMemoryStores();
 *   builder.overrideProvider(UsersRepository).useValue(stores.users) …
 *
 * `stores.raw` exposes the concrete stores for assertions and direct
 * manipulation (seeding a user, checking an assignment exists).
 */
import type {
  Permission,
  PermissionRef,
} from '../../src/modules/rbac/domain/permission.js';
import type { Role } from '../../src/modules/rbac/domain/role.js';
import type { User } from '../../src/modules/users/domain/user.js';
import type { Session } from '../../src/modules/identity/domain/session.js';
import type { PermissionsRepository } from '../../src/modules/rbac/data/permissions.repository.js';
import type { RolesRepository } from '../../src/modules/rbac/data/roles.repository.js';
import type { UserRolesRepository } from '../../src/modules/rbac/data/user-roles.repository.js';
import type { UsersRepository } from '../../src/modules/users/data/users.repository.js';
import type { SessionsRepository } from '../../src/modules/identity/data/sessions.repository.js';
import { generateId } from '../../src/kernel/ids/ulid.js';

// ---------------------------------------------------------------------------
// Prisma-style failures
// ---------------------------------------------------------------------------

export function uniqueViolation(target: readonly string[] = []): Error {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target: [...target] },
  });
}

export function foreignKeyViolation(): Error {
  return Object.assign(new Error('Foreign key constraint failed'), {
    code: 'P2003',
  });
}

export function recordNotFound(): Error {
  return Object.assign(new Error('Record to update not found'), {
    code: 'P2025',
  });
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export class InMemoryUsersRepository {
  private readonly byId = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }

  async findByUsername(username: string): Promise<User | null> {
    for (const user of this.byId.values()) {
      if (user.username === username) return user;
    }
    return null;
  }

  async findByUsernameExcludingId(
    username: string,
    excludeId: string,
  ): Promise<User | null> {
    for (const user of this.byId.values()) {
      if (user.username === username && user.id !== excludeId) return user;
    }
    return null;
  }

  async list(params: {
    where: { isActive?: boolean | undefined };
    orderBy: Array<Record<string, 'asc' | 'desc'>>;
    skip: number;
    take: number;
  }): Promise<{ items: User[]; total: number }> {
    const filtered = [...this.byId.values()].filter(
      (user) =>
        user.deletedAt === null &&
        (params.where.isActive === undefined ||
          user.isActive === params.where.isActive),
    );
    const sorted = sortBy(filtered, params.orderBy);
    return {
      items: sorted.slice(params.skip, params.skip + params.take),
      total: filtered.length,
    };
  }

  async countActive(): Promise<number> {
    return [...this.byId.values()].filter(
      (user) => user.isActive && user.deletedAt === null,
    ).length;
  }

  async create(input: {
    id: string;
    username: string;
    passwordHash: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
  }): Promise<User> {
    const user: User = {
      id: input.id,
      username: input.username,
      passwordHash: input.passwordHash,
      isActive: input.isActive,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      deletedAt: null,
    };
    this.byId.set(user.id, user);
    return user;
  }

  async update(
    id: string,
    patch: {
      username?: string | undefined;
      passwordHash?: string | undefined;
      isActive?: boolean | undefined;
      updatedAt: Date;
      updatedBy: string | null;
      deletedAt?: Date | null | undefined;
    },
  ): Promise<User | null> {
    const existing = this.byId.get(id);
    if (existing === undefined) return null; // the real repo maps P2025 to null
    const updated: User = {
      ...existing,
      username: patch.username ?? existing.username,
      passwordHash: patch.passwordHash ?? existing.passwordHash,
      isActive: patch.isActive ?? existing.isActive,
      updatedAt: patch.updatedAt,
      deletedAt:
        patch.deletedAt === undefined ? existing.deletedAt : patch.deletedAt,
    };
    this.byId.set(id, updated);
    return updated;
  }

  /** Foreign-key emulation for RBAC's `user_roles.user_id`. */
  exists(id: string): boolean {
    return this.byId.has(id);
  }

  /** Test helper: raw stored row (includes the hash, tests only). */
  raw(id: string): User | undefined {
    return this.byId.get(id);
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export class InMemorySessionsRepository {
  private readonly byId = new Map<string, Session>();

  async create(input: {
    id: string;
    userId: string;
    tokenHash: string;
    userAgent: string | null;
    ipAddress: string | null;
    createdAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
    absoluteExpiresAt: Date;
  }): Promise<Session> {
    const session: Session = { ...input, revokedAt: null };
    this.byId.set(session.id, session);
    return session;
  }

  async findById(id: string): Promise<Session | null> {
    return this.byId.get(id) ?? null;
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    for (const session of this.byId.values()) {
      if (session.tokenHash === tokenHash) return session;
    }
    return null;
  }

  async touch(
    id: string,
    data: { lastSeenAt: Date; expiresAt: Date },
  ): Promise<void> {
    const session = this.byId.get(id);
    if (session === undefined) return;
    session.lastSeenAt = data.lastSeenAt;
    session.expiresAt = data.expiresAt;
  }

  async revoke(id: string, revokedAt: Date): Promise<void> {
    const session = this.byId.get(id);
    if (session === undefined) return;
    session.revokedAt = revokedAt;
  }

  async revokeAllForUser(
    userId: string,
    exceptSessionId: string | null,
    revokedAt: Date,
  ): Promise<number> {
    let count = 0;
    for (const session of this.byId.values()) {
      if (session.userId !== userId) continue;
      if (session.revokedAt !== null) continue;
      if (exceptSessionId !== null && session.id === exceptSessionId) continue;
      session.revokedAt = revokedAt;
      count += 1;
    }
    return count;
  }

  /** Test helper: every session of a user, including revoked ones. */
  forUser(userId: string): Session[] {
    return [...this.byId.values()].filter(
      (session) => session.userId === userId,
    );
  }
}

// ---------------------------------------------------------------------------
// RBAC: permissions
// ---------------------------------------------------------------------------

export class InMemoryPermissionsRepository {
  private readonly byId = new Map<string, Permission>();
  private readonly byCode = new Map<string, string>();

  async syncDefinitions(
    definitions: readonly { code: string; description: string }[],
    now: Date,
  ): Promise<{ created: number; updated: number; total: number }> {
    let created = 0;
    for (const definition of definitions) {
      const id = this.byCode.get(definition.code);
      if (id === undefined) {
        const permission: Permission = {
          id: generateId(),
          code: definition.code,
          description: definition.description,
          createdAt: now,
          updatedAt: now,
        };
        this.byId.set(permission.id, permission);
        this.byCode.set(permission.code, permission.id);
        created += 1;
      } else {
        const existing = this.byId.get(id) as Permission;
        this.byId.set(id, {
          ...existing,
          description: definition.description,
          updatedAt: now,
        });
      }
    }
    return {
      created,
      updated: definitions.length - created,
      total: definitions.length,
    };
  }

  /** Fail the next sync (tests the non-fatal bootstrap path). */
  failNextSync = false;

  async findByCode(code: string): Promise<Permission | null> {
    const id = this.byCode.get(code);
    return id === undefined ? null : (this.byId.get(id) as Permission);
  }

  async findByCodes(codes: readonly string[]): Promise<Permission[]> {
    const found: Permission[] = [];
    for (const code of codes) {
      const permission = await this.findByCode(code);
      if (permission !== null) found.push(permission);
    }
    return found;
  }

  async list(params: {
    orderBy: Array<Record<string, 'asc' | 'desc'>>;
    skip: number;
    take: number;
    allowedCodes?: string[];
  }): Promise<{ items: PermissionRef[]; total: number }> {
    const allowed =
      params.allowedCodes === undefined ? null : new Set(params.allowedCodes);
    const all = sortBy(
      [...this.byId.values()].filter(
        (permission) => allowed === null || allowed.has(permission.code),
      ),
      params.orderBy,
    );
    return {
      items: all
        .slice(params.skip, params.skip + params.take)
        .map((row) => ({ code: row.code, description: row.description })),
      total: all.length,
    };
  }

  /**
   * Test helper: resolve ids to codes (role detail rendering). Sorted by code,
   * matching the real repository's `findWithPermissions` (role detail is
   * deterministic).
   */
  refsFor(permissionIds: readonly string[]): PermissionRef[] {
    return permissionIds
      .map((id) => this.byId.get(id))
      .filter((row): row is Permission => row !== undefined)
      .map((row) => ({ code: row.code, description: row.description }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  get size(): number {
    return this.byId.size;
  }
}

// ---------------------------------------------------------------------------
// RBAC: roles
// ---------------------------------------------------------------------------

export class InMemoryRolesRepository {
  private readonly byId = new Map<string, Role>();
  private readonly assignments = new Map<string, string>(); // `roleId:permissionId`

  /** Wired by `createInMemoryStores` so role detail can render permissions. */
  constructor(private readonly permissions: InMemoryPermissionsRepository) {}

  async createWithPermissions(input: {
    id: string;
    name: string;
    description: string | null;
    permissionIds: readonly string[];
    now: Date;
    createdBy: string | null;
  }): Promise<Role> {
    const role: Role = {
      id: input.id,
      name: input.name,
      description: input.description,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.createdBy,
      updatedBy: null,
    };
    this.byId.set(role.id, role);
    for (const permissionId of input.permissionIds) {
      this.assignments.set(`${role.id}:${permissionId}`, permissionId);
    }
    return role;
  }

  async findById(id: string): Promise<Role | null> {
    return this.byId.get(id) ?? null;
  }

  async findByName(name: string): Promise<Role | null> {
    for (const role of this.byId.values()) {
      if (role.name === name) return role;
    }
    return null;
  }

  async findWithPermissions(
    id: string,
  ): Promise<{ role: Role; permissions: PermissionRef[] } | null> {
    const role = this.byId.get(id);
    if (role === undefined) return null;
    return {
      role,
      permissions: this.permissions.refsFor(this.permissionIdsFor(id)),
    };
  }

  async list(params: {
    orderBy: Array<Record<string, 'asc' | 'desc'>>;
    skip: number;
    take: number;
  }): Promise<{
    items: Array<{ role: Role; permissionCount: number }>;
    total: number;
  }> {
    const all = sortBy([...this.byId.values()], params.orderBy);
    return {
      items: all.slice(params.skip, params.skip + params.take).map((role) => ({
        role,
        permissionCount: this.permissionIdsFor(role.id).length,
      })),
      total: all.length,
    };
  }

  async update(
    id: string,
    patch: {
      name?: string | undefined;
      description?: string | null | undefined;
      updatedAt: Date;
      updatedBy: string | null;
    },
  ): Promise<Role | null> {
    const existing = this.byId.get(id);
    if (existing === undefined) return null;
    const updated: Role = {
      ...existing,
      name: patch.name ?? existing.name,
      description:
        patch.description === undefined
          ? existing.description
          : patch.description,
      updatedAt: patch.updatedAt,
      updatedBy: patch.updatedBy,
    };
    this.byId.set(id, updated);
    return updated;
  }

  async addPermission(input: {
    roleId: string;
    permissionId: string;
    now: Date;
    createdBy: string | null;
  }): Promise<void> {
    const key = `${input.roleId}:${input.permissionId}`;
    if (this.assignments.has(key)) throw uniqueViolation();
    this.assignments.set(key, input.permissionId);
  }

  async removePermission(
    roleId: string,
    permissionId: string,
  ): Promise<boolean> {
    return this.assignments.delete(`${roleId}:${permissionId}`);
  }

  /**
   * Installation reconciliation, mirroring the real repository transaction:
   * upsert by role NAME (preserving an existing role's id/description), add
   * only the missing `role_permissions` rows, and ensure the `user_roles` row.
   * Nothing is ever removed, so administrator-added extra permissions survive.
   */
  async ensureRoleWithPermissionsForUser(input: {
    roleId: string;
    roleName: string;
    description: string;
    permissionIds: readonly string[];
    userId: string;
    now: Date;
  }): Promise<{
    role: Role;
    permissionCount: number;
    roleCreated: boolean;
    userRoleCreated: boolean;
  }> {
    const existing = await this.findByName(input.roleName);
    const role =
      existing ??
      (await this.createWithPermissions({
        id: input.roleId,
        name: input.roleName,
        description: input.description,
        permissionIds: [],
        now: input.now,
        createdBy: null,
      }));
    for (const permissionId of input.permissionIds) {
      this.assignments.set(`${role.id}:${permissionId}`, permissionId);
    }
    const assigned = new Set(this.permissionIdsFor(role.id));
    const userRoleCreated =
      this.userRoles !== undefined &&
      !this.userRoles.isAssigned(input.userId, role.id);
    if (userRoleCreated) {
      await this.userRoles!.assign({
        userId: input.userId,
        roleId: role.id,
        now: input.now,
        createdBy: null,
      });
    }
    return {
      role,
      permissionCount: input.permissionIds.filter((id) => assigned.has(id))
        .length,
      roleCreated: existing === null,
      userRoleCreated,
    };
  }

  /** Wired by `createInMemoryStores` (the real repository shares one transaction). */
  private userRoles: InMemoryUserRolesRepository | undefined;

  attachUserRoles(userRoles: InMemoryUserRolesRepository): void {
    this.userRoles = userRoles;
  }

  /** Test helper: database-level check that an assignment exists. */
  isPermissionAssigned(roleId: string, permissionId: string): boolean {
    return this.assignments.has(`${roleId}:${permissionId}`);
  }

  permissionIdsFor(roleId: string): string[] {
    return [...this.assignments.entries()]
      .filter(([key]) => key.startsWith(`${roleId}:`))
      .map(([, permissionId]) => permissionId);
  }
}

// ---------------------------------------------------------------------------
// RBAC: user ↔ role assignments
// ---------------------------------------------------------------------------

export class InMemoryUserRolesRepository {
  private readonly assignments = new Set<string>(); // `${userId}:${roleId}`

  constructor(
    private readonly permissions: InMemoryPermissionsRepository,
    private readonly roles: InMemoryRolesRepository,
    private readonly userExists: (id: string) => boolean,
  ) {}

  async assign(input: {
    userId: string;
    roleId: string;
    now: Date;
    createdBy: string | null;
  }): Promise<void> {
    if (!this.userExists(input.userId)) throw foreignKeyViolation();
    const key = `${input.userId}:${input.roleId}`;
    if (this.assignments.has(key)) throw uniqueViolation();
    this.assignments.add(key);
  }

  async remove(userId: string, roleId: string): Promise<boolean> {
    return this.assignments.delete(`${userId}:${roleId}`);
  }

  async listRoleIdsForUser(userId: string): Promise<string[]> {
    return [...this.assignments]
      .filter((key) => key.startsWith(`${userId}:`))
      .map((key) => key.slice(userId.length + 1));
  }

  async listPermissionCodesForUser(userId: string): Promise<string[]> {
    const codes = new Set<string>();
    for (const roleId of await this.listRoleIdsForUser(userId)) {
      for (const permissionId of this.roles.permissionIdsFor(roleId)) {
        const permission = this.permissions.refsFor([permissionId]).at(0);
        if (permission !== undefined) codes.add(permission.code);
      }
    }
    return [...codes].sort();
  }

  async userHasPermission(userId: string, code: string): Promise<boolean> {
    return (await this.listPermissionCodesForUser(userId)).includes(code);
  }

  /** Test helper: database-level check that an assignment exists. */
  isAssigned(userId: string, roleId: string): boolean {
    return this.assignments.has(`${userId}:${roleId}`);
  }
}

// ---------------------------------------------------------------------------
// Store bundle
// ---------------------------------------------------------------------------

export interface InMemoryStores {
  /** Handles typed as the real repositories — safe for `overrideProvider`. */
  users: UsersRepository;
  sessions: SessionsRepository;
  permissions: PermissionsRepository;
  roles: RolesRepository;
  userRoles: UserRolesRepository;
  /** Concrete stores for assertions and direct manipulation. */
  raw: {
    users: InMemoryUsersRepository;
    sessions: InMemorySessionsRepository;
    permissions: InMemoryPermissionsRepository;
    roles: InMemoryRolesRepository;
    userRoles: InMemoryUserRolesRepository;
  };
}

/**
 * Build one coherent in-memory "database": every store shares the same data,
 * so RBAC's joins behave like the real foreign-keyed tables.
 */
export function createInMemoryStores(): InMemoryStores {
  const users = new InMemoryUsersRepository();
  const sessions = new InMemorySessionsRepository();
  const permissions = new InMemoryPermissionsRepository();
  const roles = new InMemoryRolesRepository(permissions);
  const userRoles = new InMemoryUserRolesRepository(permissions, roles, (id) =>
    users.exists(id),
  );
  roles.attachUserRoles(userRoles);
  return {
    users: users as unknown as UsersRepository,
    sessions: sessions as unknown as SessionsRepository,
    permissions: permissions as unknown as PermissionsRepository,
    roles: roles as unknown as RolesRepository,
    userRoles: userRoles as unknown as UserRolesRepository,
    raw: { users, sessions, permissions, roles, userRoles },
  };
}

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

/**
 * Seed a user row directly. Unit fixtures need an existing user before they can
 * assign a role (the fake enforces the `rbac.user_roles.user_id` foreign key,
 * exactly like the real database).
 */
export async function seedUser(
  stores: InMemoryStores,
  overrides: {
    id?: string;
    username?: string;
    passwordHash?: string;
    isActive?: boolean;
  } = {},
): Promise<User> {
  const now = new Date();
  const id = overrides.id ?? generateId();
  return stores.raw.users.create({
    id,
    username: overrides.username ?? `user-${id}`,
    passwordHash: overrides.passwordHash ?? 'argon2id$test-hash',
    isActive: overrides.isActive ?? true,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortBy<T extends object>(
  rows: T[],
  orderBy: Array<Record<string, 'asc' | 'desc'>>,
): T[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const clause of orderBy) {
      const entry = Object.entries(clause)[0];
      if (entry === undefined) continue;
      const [field, direction] = entry;
      const left = (a as Record<string, unknown>)[field];
      const right = (b as Record<string, unknown>)[field];
      const comparison =
        left instanceof Date && right instanceof Date
          ? left.getTime() - right.getTime()
          : String(left).localeCompare(String(right));
      if (comparison !== 0) {
        return direction === 'desc' ? -comparison : comparison;
      }
    }
    return 0;
  });
  return sorted;
}
