/**
 * User domain entity — minimal authentication record.
 *
 * Per the task scope, this contains ONLY the fields required for
 * authentication: identity (username), password hash, active/disabled
 * state, and the standard audit columns (AR-12).
 *
 * Login identifier: ADR-0007 + docs/security.md §2 specify "username +
 * password" as the v1 credential. `docs/modules.md` mentions a future
 * optional unique email column on `users.users`; that belongs to the
 * Users module session and is intentionally NOT part of this
 * authentication implementation. Mobile login, MFA, password reset, and
 * social login are all explicitly out of scope.
 *
 * Profile fields (display name, email, employee info, preferences,
 * roles/permissions) belong to later modules and later sessions.
 *
 * This file is framework-free (AR-05): no Nest decorators, no Prisma imports.
 */

export interface User {
  /** ULID primary key. */
  id: string;
  /** Unique login identifier (username; see docs/security.md §2, OQ-06 assumption). */
  username: string;
  /** argon2id hash of the password — never plaintext, never returned via APIs. */
  passwordHash: string;
  /** Whether the user may authenticate; disabled users are rejected at login. */
  isActive: boolean;
  /** Audit columns (AR-12). */
  createdAt: Date;
  updatedAt: Date;
  /** Soft delete (AR-13); soft-deleted users cannot authenticate. */
  deletedAt: Date | null;
}

/**
 * Safe user representation — returned by APIs. Excludes password hash and
 * any other security-sensitive fields.
 */
export interface UserDto {
  id: string;
  username: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toUserDto(
  user: Pick<User, 'id' | 'username' | 'isActive' | 'createdAt' | 'updatedAt'>,
): UserDto {
  return {
    id: user.id,
    username: user.username,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
