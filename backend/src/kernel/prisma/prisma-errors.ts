/**
 * Prisma error classification (kernel-technical, AR-06).
 *
 * Database constraints — unique indexes and foreign keys — are the
 * authoritative guard against duplicates and dangling references. Application
 * code maps those failures onto stable API errors instead of pre-checking
 * (which would race).
 *
 * This is the kernel copy: error-code classification is a technical concern
 * and new modules use it rather than importing another module's `data/`
 * helpers (AR-07). `modules/rbac/data/prisma-errors.ts` predates it and is
 * left untouched (no drive-by refactoring, AG-03).
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
