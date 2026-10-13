import { useMemo } from 'react';
import { useSession } from '@/features/auth/use-session';

export interface PermissionChecks {
  /** Effective codes of the session (empty until they are loaded). */
  codes: readonly string[];
  /** Whether `GET /permissions/effective` has answered yet. */
  loaded: boolean;
  has: (code: string) => boolean;
  hasAll: (codes: readonly string[]) => boolean;
  hasAny: (codes: readonly string[]) => boolean;
}

/**
 * Permission checks for UX decisions ONLY (AR-21).
 *
 * The codes come from `GET /api/v1/permissions/effective` — the backend's own
 * self-read, documented as a UI bootstrapping surface. Hiding a menu item or
 * disabling a button is a convenience; it is never a security boundary, and
 * every request is authorized again server-side. Exact-match only: there is
 * no wildcard/prefix expansion anywhere in this layer.
 */
export function usePermissions(): PermissionChecks {
  const { permissions, permissionsLoaded } = useSession();

  return useMemo(() => {
    const codeSet = new Set(permissions);
    const has = (code: string): boolean => codeSet.has(code);
    return {
      codes: permissions,
      loaded: permissionsLoaded,
      has,
      hasAll: (codes) => codes.every(has),
      hasAny: (codes) => codes.some(has),
    };
  }, [permissions, permissionsLoaded]);
}
