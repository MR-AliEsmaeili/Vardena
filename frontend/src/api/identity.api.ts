import { apiGet, apiPost } from './client';
import type {
  AuthenticatedUser,
  ChangePasswordRequest,
  EffectivePermissions,
  LoginRequest,
} from './contracts';

/**
 * Identity + RBAC read surface (`backend/src/modules/identity`,
 * `backend/src/modules/rbac`).
 *
 * The session is a server-side opaque token delivered as an httpOnly cookie
 * (ADR-0007); there is nothing for the SPA to store. `login` returns the safe
 * user DTO, `me` re-reads it, `logout` is idempotent (the backend accepts it
 * with or without a live session), and `effectivePermissions` is the
 * documented self-read the UI uses to hide what the user cannot do — a UX
 * affordance only; the backend enforces every permission (AR-21).
 */

/**
 * Auth mutations own their feedback surface (the login form / password form /
 * top-bar logout button shows the pending label and orb). They are therefore
 * `background` for the global panel: the same operation must not be announced
 * twice, and a generic «در حال ذخیره اطلاعات…» would misdescribe signing in.
 */
export function login(body: LoginRequest): Promise<AuthenticatedUser> {
  return apiPost<AuthenticatedUser, LoginRequest>('/auth/login', body, {
    vardenaRequestActivity: { scope: 'background' },
  });
}

export function logout(): Promise<void> {
  return apiPost<void>('/auth/logout', undefined, {
    vardenaRequestActivity: { scope: 'background' },
  });
}

export function changePassword(
  body: ChangePasswordRequest,
): Promise<AuthenticatedUser> {
  return apiPost<AuthenticatedUser, ChangePasswordRequest>(
    '/auth/change-password',
    body,
    { vardenaRequestActivity: { scope: 'background' } },
  );
}

export function getCurrentUser(
  signal?: AbortSignal,
): Promise<AuthenticatedUser> {
  return apiGet<AuthenticatedUser>('/auth/me', signal ? { signal } : {});
}

export function getEffectivePermissions(
  signal?: AbortSignal,
): Promise<EffectivePermissions> {
  return apiGet<EffectivePermissions>(
    '/permissions/effective',
    signal ? { signal } : {},
  );
}
