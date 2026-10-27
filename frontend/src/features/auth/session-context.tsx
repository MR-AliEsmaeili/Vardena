import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { setUnauthorizedHandler } from '@/api/client';
import { normalizeApiError } from '@/api/errors';
import * as identityApi from '@/api/identity.api';
import { queryKeys } from '@/api/query-keys';
import type {
  AuthenticatedUser,
  ChangePasswordRequest,
  LoginRequest,
} from '@/api/contracts';

export type SessionStatus =
  'loading' | 'authenticated' | 'unauthenticated' | 'error';

export interface SessionContextValue {
  user: AuthenticatedUser | null;
  status: SessionStatus;
  error: unknown;
  /** True when the authenticated user must change their password before accessing normal routes. */
  mustChangePassword: boolean;
  /** Effective permission codes of the current session (UX only, AR-21). */
  permissions: readonly string[];
  permissionsLoaded: boolean;
  sessionExpired: boolean;
  login: (credentials: LoginRequest) => Promise<AuthenticatedUser>;
  isLoggingIn: boolean;
  loginError: unknown;
  resetLoginError: () => void;
  changePassword: (
    payload: ChangePasswordRequest,
  ) => Promise<AuthenticatedUser>;
  isChangingPassword: boolean;
  changePasswordError: unknown;
  resetChangePasswordError: () => void;
  logout: () => Promise<void>;
  isLoggingOut: boolean;
  acknowledgeSessionExpiry: () => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Authentication state for the whole application.
 *
 * Follows the real Identity contract (ADR-0007,
 * `backend/src/modules/identity`):
 * `POST /auth/login` → server-side session + httpOnly cookie,
 * `GET /auth/me` → the current session's user (401 when there is none),
 * `POST /auth/logout` → idempotent server-side revocation.
 *
 * `GET /auth/me` answering 401 is a STATE (`unauthenticated`), not an error;
 * anything else (network failure, 500) surfaces as an error so the UI does
 * not silently look like a logout. Effective permissions are fetched once a
 * session exists and are used for UX gating only — the backend authorizes
 * every request regardless (AR-21).
 */
export function SessionProvider({
  children,
  onSessionEnd,
}: {
  children: ReactNode;
  /**
   * Invoked when the session ends server-side (a 401 on any request) or on
   * explicit logout. The app layer wires device-local workspace cleanup here
   * (ADR-0054 §6.10) — this module stays unaware of workspace storage,
   * keeping the features → app layering intact.
   */
  onSessionEnd?: () => void;
}) {
  const queryClient = useQueryClient();
  const [sessionExpired, setSessionExpired] = useState(false);

  const sessionQuery = useQuery({
    queryKey: queryKeys.session(),
    queryFn: async ({ signal }): Promise<AuthenticatedUser | null> => {
      try {
        return await identityApi.getCurrentUser(signal);
      } catch (error) {
        const apiError = normalizeApiError(error);
        if (apiError.isUnauthorized) return null;
        throw apiError;
      }
    },
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const user = sessionQuery.data ?? null;
  const mustChangePassword = user?.mustChangePassword === true;

  const permissionsQuery = useQuery({
    queryKey: queryKeys.effectivePermissions(),
    queryFn: async ({ signal }) => identityApi.getEffectivePermissions(signal),
    enabled: user !== null && !mustChangePassword,
    retry: false,
    staleTime: 60_000,
  });

  // A 401 on ANY other request means the session ended server-side
  // (idle/absolute expiry, logout elsewhere, user disabled). Drop every
  // cached server value so no stale, cross-session data can be rendered.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSessionExpired(true);
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session(), null);
      onSessionEnd?.();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient, onSessionEnd]);

  const loginMutation = useMutation({
    mutationFn: (credentials: LoginRequest) => identityApi.login(credentials),
    onSuccess: async (authenticatedUser) => {
      setSessionExpired(false);
      queryClient.setQueryData(queryKeys.session(), authenticatedUser);
      if (!authenticatedUser.mustChangePassword) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.effectivePermissions(),
        });
      }
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: (payload: ChangePasswordRequest) =>
      identityApi.changePassword(payload),
    onSuccess: async (updatedUser) => {
      setSessionExpired(false);
      queryClient.setQueryData(queryKeys.session(), updatedUser);
      if (!updatedUser.mustChangePassword) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.effectivePermissions(),
        });
      }
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => identityApi.logout(),
    onSettled: () => {
      // Logout is idempotent server-side; locally we always end the session
      // and drop every cached response of the previous user.
      setSessionExpired(false);
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session(), null);
      onSessionEnd?.();
    },
  });

  const login = useCallback(
    async (credentials: LoginRequest) => {
      return loginMutation.mutateAsync(credentials);
    },
    [loginMutation],
  );

  const changePassword = useCallback(
    async (payload: ChangePasswordRequest) => {
      return changePasswordMutation.mutateAsync(payload);
    },
    [changePasswordMutation],
  );

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const resetLoginError = useCallback(() => {
    loginMutation.reset();
  }, [loginMutation]);

  const resetChangePasswordError = useCallback(() => {
    changePasswordMutation.reset();
  }, [changePasswordMutation]);

  const status: SessionStatus = sessionQuery.isPending
    ? 'loading'
    : sessionQuery.isError
      ? 'error'
      : user !== null
        ? 'authenticated'
        : 'unauthenticated';

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      status,
      error: sessionQuery.error,
      mustChangePassword,
      permissions: permissionsQuery.data?.permissions ?? [],
      permissionsLoaded: permissionsQuery.isSuccess,
      sessionExpired,
      login,
      isLoggingIn: loginMutation.isPending,
      loginError: loginMutation.error,
      resetLoginError,
      changePassword,
      isChangingPassword: changePasswordMutation.isPending,
      changePasswordError: changePasswordMutation.error,
      resetChangePasswordError,
      logout,
      isLoggingOut: logoutMutation.isPending,
      acknowledgeSessionExpiry: () => setSessionExpired(false),
    }),
    [
      user,
      status,
      sessionQuery.error,
      mustChangePassword,
      permissionsQuery.data,
      permissionsQuery.isSuccess,
      sessionExpired,
      login,
      loginMutation.isPending,
      loginMutation.error,
      resetLoginError,
      changePassword,
      changePasswordMutation.isPending,
      changePasswordMutation.error,
      resetChangePasswordError,
      logout,
      logoutMutation.isPending,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
