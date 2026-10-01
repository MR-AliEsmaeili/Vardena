import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { AppRoutes } from '@/app/router';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testActiveLicenseState,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';

/**
 * End-to-end session-expiry UX (FE-UX-02 §9, mid-session 401).
 *
 * The transport layer registers a single unauthorized handler through
 * `setUnauthorizedHandler`; here we capture that handler and fire it once — the
 * way the Axios interceptor would on a real 401 — then assert the whole app
 * reaction: the authenticated cache is dropped, the session ends, and the user
 * lands back on `/login` with the Persian expiry banner (never an HTTP code or
 * raw Axios error).
 */

const unauthorizedRegistration = vi.hoisted(() => ({
  handler: null as ((error: unknown) => void) | null,
}));

vi.mock('@/api/client', () => ({
  setUnauthorizedHandler: vi.fn(
    (handler: ((error: unknown) => void) | null) => {
      unauthorizedRegistration.handler = handler;
    },
  ),
}));

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('@/api/organization.api', () => ({
  listOrganizations: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));

vi.mock('@/api/dashboard.api', () => ({
  listAccountingDocuments: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 9 }),
  listAccountBalances: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 500 }),
  listInventoryBalances: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 }),
  listWorkflowInstances: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 }),
  MAX_PAGE_SIZE: 500,
}));

vi.mock('@/api/accounting.api', () => ({
  listFinancialAreas: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 500 }),
  listFiscalYears: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 500 }),
  listAccountingPeriods: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 500 }),
  listPostableAccounts: vi.fn(),
  listGeneralLedger: vi.fn(),
  listTrialBalance: vi.fn(),
  getAccountStatement: vi.fn(),
  listChartTree: vi.fn(),
  fetchChartTreePages: vi.fn(),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));

vi.mock('@/api/licensing.api', () => ({
  getLicenseState: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const licensingApi = await import('@/api/licensing.api');

beforeEach(() => {
  // The shell resolves the installation license before the organization
  // stage (ADR-0030); these scenarios run behind the local provider's
  // default active license.
  vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
    testActiveLicenseState,
  );
  unauthorizedRegistration.handler = null;
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
    paginated([testOrganization]),
  );
});

describe('session expiry', () => {
  it('drops the session and shows the Persian expiry banner on a mid-session 401', async () => {
    const { queryClient } = renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app'],
    });

    // The authenticated shell is up and the expiry handler is registered.
    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });
    await waitFor(() =>
      expect(unauthorizedRegistration.handler).not.toBeNull(),
    );

    // Seed a previous-session cache entry that must not survive the expiry.
    const staleKey = ['accounting', 'org-1', 'general-ledger'] as const;
    queryClient.setQueryData(staleKey, { items: ['stale'] });
    expect(queryClient.getQueryData(staleKey)).toBeDefined();

    // Fire the interceptor's unauthorized reaction, as a real 401 would.
    act(() =>
      unauthorizedRegistration.handler?.(
        new ApiError({ code: 'Unauthorized', message: 'x', status: 401 }),
      ),
    );

    // Redirected to login with the single expiry banner…
    expect(await screen.findByText(t.auth.loginTitle)).toBeInTheDocument();
    expect(screen.getByText(t.auth.sessionExpired)).toBeInTheDocument();
    // …and no raw HTTP code / Axios error leaks into the copy.
    expect(screen.queryByText(/401/)).not.toBeInTheDocument();
    // …and the previous session's cache is gone.
    expect(queryClient.getQueryData(staleKey)).toBeUndefined();
  });
});
