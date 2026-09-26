import type { ReactNode } from 'react';
import { usePermissions } from './use-permissions';

export interface PermissionGateProps {
  /** All codes must be held (matching the backend's AND semantics). */
  permission: string | readonly string[];
  children: ReactNode;
  /** Rendered instead of the children when the permission is missing. */
  fallback?: ReactNode;
  /**
   * Render children while the effective permissions are still loading.
   * Default `false`: nothing flashes before the answer arrives.
   */
  renderWhileLoading?: boolean;
}

/**
 * Hide UI the session clearly cannot use.
 *
 * UX only (AR-21): a hidden button is not authorization — the backend
 * rejects the request anyway. A gate is never used to "unlock" anything, only
 * to avoid offering an action that would certainly fail.
 */
export function PermissionGate({
  permission,
  children,
  fallback = null,
  renderWhileLoading = false,
}: PermissionGateProps) {
  const permissions = usePermissions();
  const codes = typeof permission === 'string' ? [permission] : permission;

  if (!permissions.loaded) {
    return <>{renderWhileLoading ? children : fallback}</>;
  }

  return <>{permissions.hasAll(codes) ? children : fallback}</>;
}
