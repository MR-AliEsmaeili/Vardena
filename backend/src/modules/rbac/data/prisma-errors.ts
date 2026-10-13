/**
 * Prisma error classification for the RBAC data layer.
 *
 * The unique/FK constraints on `rbac.role_permissions` and `rbac.user_roles`
 * are the authoritative guard against duplicate assignments and dangling
 * references (§26). The application maps those database errors onto stable API
 * errors instead of pre-checking (which would race).
 */
export const PRISMA_UNIQUE_VIOLATION = 'P2002';
export const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003';
export const PRISMA_RECORD_NOT_FOUND = 'P2025';

export function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, PRISMA_UNIQUE_VIOLATION);
}

export function isForeignKeyViolation(error: unknown): boolean {
  return hasCode(error, PRISMA_FOREIGN_KEY_VIOLATION);
}

export function isRecordNotFound(error: unknown): boolean {
  return hasCode(error, PRISMA_RECORD_NOT_FOUND);
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
