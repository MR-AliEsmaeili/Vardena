import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicenseState } from '@/api/contracts';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import { AppRoutes } from '@/app/router';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testAccountingPeriod,
  testActiveLicenseState,
  testFinancialArea,
  testFiscalYear,
  testOrganization,
  testUnlicensedLicenseState,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';

/**
 * License activation (L-02 frontend slice).
 *
 * The real providers, router, gates, forms and query cache run; only the
 * `src/api/*` modules are stubbed, so what is asserted is the application's
 * own flow:
 *
 * `inactive license → activation form → POST /license/activate →
 *  re-read of GET /license/current → active → organization bootstrap`
 *
 * The four license states themselves (loading / active / inactive / error)
 * and the retry of the license READ keep their suite in
 * `app/layouts/license-gate.test.tsx`; this file owns the activation step,
 * its failures and its security behavior.
 */

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('@/api/organization.api', () => ({
  listMyOrganizations: vi.fn(),
  createOrganization: vi.fn(),
  grantMembership: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));

vi.mock('@/api/licensing.api', () => ({
  getLicenseState: vi.fn(),
  activateLicense: vi.fn(),
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
  fetchChartTreePages: vi
    .fn()
    .mockResolvedValue({ nodes: [], total: 0, truncated: false }),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');
const licensingApi = await import('@/api/licensing.api');

/** A session that may activate the installation license. */
const activationPermissions = [
  ...allAccountingPermissions,
  PERMISSIONS.licensing.licenseActivate,
];

/** A plausible signed code; nothing about its shape is validated client-side. */
const VALID_CODE = 'VLIC1.eyJ2IjoxfQ.c2lnbmF0dXJl';

/**
 * `GET /license/current` answers whatever the backend currently persists.
 * The helper makes that explicit: the state is a variable the (mocked)
 * backend owns, and activation is what changes it — never the frontend.
 */
function serveLicenseState(initial: LicenseState) {
  const backend = { state: initial };
  vi.mocked(licensingApi.getLicenseState).mockImplementation(() =>
    Promise.resolve(backend.state),
  );
  return backend;
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: activationPermissions,
  });
  vi.mocked(identityApi.logout).mockResolvedValue(undefined);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(
    paginated([testFiscalYear]),
  );
  vi.mocked(accountingApi.listAccountingPeriods).mockResolvedValue(
    paginated([testAccountingPeriod]),
  );
  serveLicenseState(testUnlicensedLicenseState);
});

describe('license activation', () => {
  it('offers the activation form when the backend reports no active license', async () => {
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const main = await screen.findByRole('main');
    expect(
      await within(main).findByText(t.license.activateTitle),
    ).toBeInTheDocument();
    expect(within(main).getByText(t.license.activateBody)).toBeInTheDocument();
    // The installation identity comes from the backend response — the
    // frontend fingerprints nothing and generates no installation id.
    expect(
      within(main).getByText(
        testUnlicensedLicenseState.installationId ?? 'missing',
      ),
    ).toBeInTheDocument();
    expect(
      within(main).getByLabelText(t.license.activateCodeLabel),
    ).toBeInTheDocument();
    expect(
      within(main).getByRole('button', { name: t.license.activateSubmit }),
    ).toBeInTheDocument();
    // No workspace behind it, and nothing was activated by rendering.
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
    expect(licensingApi.activateLicense).not.toHaveBeenCalled();
  });

  it('renders no activation form for an active license and continues to the organization bootstrap', async () => {
    serveLicenseState(testActiveLicenseState);

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
    expect(screen.queryByText(t.license.activateTitle)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(t.license.activateCodeLabel),
    ).not.toBeInTheDocument();
    expect(organizationApi.listMyOrganizations).toHaveBeenCalled();
  });

  it('keeps the plain explainer for a session without the activation permission', async () => {
    // License and permission stay separate facts: a session that may not
    // activate is told about the license, not shown a form that could only
    // ever be answered with 403 (the backend authorizes activation anyway).
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: allAccountingPermissions,
    });

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const main = await screen.findByRole('main');
    expect(
      await within(main).findByText(t.license.unlicensedTitle),
    ).toBeInTheDocument();
    expect(
      within(main).queryByLabelText(t.license.activateCodeLabel),
    ).not.toBeInTheDocument();
    expect(licensingApi.activateLicense).not.toHaveBeenCalled();
  });

  it('rejects an empty and a whitespace-only code without calling the backend', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const submit = await screen.findByRole('button', {
      name: t.license.activateSubmit,
    });

    await user.click(submit);
    expect(
      await screen.findByText(t.license.activateCodeRequired),
    ).toBeInTheDocument();
    expect(licensingApi.activateLicense).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(t.license.activateCodeLabel), '   ');
    await user.click(submit);
    expect(
      await screen.findByText(t.license.activateCodeRequired),
    ).toBeInTheDocument();
    expect(licensingApi.activateLicense).not.toHaveBeenCalled();
  });

  it('activates, re-reads the license from the backend and continues into the workspace without a new login', async () => {
    const backend = serveLicenseState(testUnlicensedLicenseState);
    vi.mocked(licensingApi.activateLicense).mockImplementation(async () => {
      // Exactly what the backend does: it persists the license, so the next
      // `GET /license/current` reports it. The frontend learns it from there.
      backend.state = testActiveLicenseState;
      return { ...testActiveLicenseState, changed: true };
    });
    const user = userEvent.setup();

    const { queryClient } = renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app'],
    });

    await user.type(
      await screen.findByLabelText(t.license.activateCodeLabel),
      // Surrounding whitespace of a pasted code is normalized away.
      `  ${VALID_CODE}  `,
    );
    await user.click(
      screen.getByRole('button', { name: t.license.activateSubmit }),
    );

    // The workspace is reached through the gate releasing, not through a
    // logout/login cycle: the session was never touched.
    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
    expect(identityApi.logout).not.toHaveBeenCalled();
    expect(identityApi.login).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', { name: t.auth.loginTitle }),
    ).not.toBeInTheDocument();

    expect(licensingApi.activateLicense).toHaveBeenCalledTimes(1);
    expect(licensingApi.activateLicense).toHaveBeenCalledWith({
      code: VALID_CODE,
    });
    // The current-license query was invalidated and read again (the POST
    // result alone never promotes the state to active).
    expect(licensingApi.getLicenseState).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(queryKeys.licenseState())).toStrictEqual(
      testActiveLicenseState,
    );
    // The success announcement of the completed mutation.
    expect(await screen.findByText(t.license.activateSuccess)).toBeVisible();
    // …and the organization bootstrap ran behind the released gate.
    expect(organizationApi.listMyOrganizations).toHaveBeenCalled();
  });

  it('sends exactly one request while an activation is in flight', async () => {
    const inFlight: { release: () => void } = { release: () => undefined };
    vi.mocked(licensingApi.activateLicense).mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight.release = () =>
            resolve({ ...testActiveLicenseState, changed: true });
        }),
    );
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.type(
      await screen.findByLabelText(t.license.activateCodeLabel),
      VALID_CODE,
    );
    const submit = screen.getByRole('button', {
      name: t.license.activateSubmit,
    });
    await user.click(submit);

    const pending = await screen.findByRole('button', {
      name: t.license.activateSubmitting,
    });
    expect(pending).toBeDisabled();
    expect(screen.getByLabelText(t.license.activateCodeLabel)).toBeDisabled();

    await user.click(pending);
    expect(licensingApi.activateLicense).toHaveBeenCalledTimes(1);

    inFlight.release();
    await waitFor(() =>
      expect(licensingApi.activateLicense).toHaveBeenCalledTimes(1),
    );
  });

  it('keeps the activation screen usable after the backend rejects a code, and succeeds on the next attempt', async () => {
    const backend = serveLicenseState(testUnlicensedLicenseState);
    vi.mocked(licensingApi.activateLicense)
      .mockRejectedValueOnce(
        new ApiError({
          code: 'BusinessRuleViolation',
          // A raw backend sentence that must never reach the screen.
          message:
            'Ed25519 signature verification failed for payload segment 2.',
          status: 422,
          correlationId: 'corr-activate',
        }),
      )
      .mockImplementation(async () => {
        backend.state = testActiveLicenseState;
        return { ...testActiveLicenseState, changed: true };
      });
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const input = await screen.findByLabelText(t.license.activateCodeLabel);
    await user.type(input, 'WRONG-CODE');
    await user.click(
      screen.getByRole('button', { name: t.license.activateSubmit }),
    );

    // Persian, operation-scoped copy — no internals, no stack trace, no
    // crypto detail — plus the correlation id for support.
    expect(
      await screen.findByText(t.license.activateRejected),
    ).toBeInTheDocument();
    expect(screen.getByText('corr-activate')).toBeInTheDocument();
    expect(screen.queryByText(/Ed25519/)).not.toBeInTheDocument();
    expect(screen.queryByText(/signature/i)).not.toBeInTheDocument();

    // The screen stays, the gate is not released, and the rejected value is
    // cleared so the next attempt starts clean.
    expect(screen.getByText(t.license.activateTitle)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText(t.license.activateCodeLabel)).toHaveValue('');

    await user.type(
      screen.getByLabelText(t.license.activateCodeLabel),
      VALID_CODE,
    );
    await user.click(
      screen.getByRole('button', { name: t.license.activateSubmit }),
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
    expect(licensingApi.activateLicense).toHaveBeenCalledTimes(2);
  });

  it('stays blocked and retryable when the license re-read fails after a successful activation', async () => {
    vi.mocked(licensingApi.getLicenseState)
      .mockResolvedValueOnce(testUnlicensedLicenseState)
      .mockRejectedValueOnce(
        new ApiError({ code: 'ServiceUnavailable', message: 'x', status: 503 }),
      )
      .mockResolvedValue(testActiveLicenseState);
    vi.mocked(licensingApi.activateLicense).mockResolvedValue({
      ...testActiveLicenseState,
      changed: true,
    });
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.type(
      await screen.findByLabelText(t.license.activateCodeLabel),
      VALID_CODE,
    );
    await user.click(
      screen.getByRole('button', { name: t.license.activateSubmit }),
    );

    // The POST succeeded, but the authoritative read did not: the license is
    // NOT assumed active and the workspace stays closed.
    expect(await screen.findByText(t.license.errorTitle)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t.app.retry }));

    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
  });

  it('fabricates no activation when the session expired mid-request', async () => {
    // The real 401 reaction belongs to the transport layer
    // (`setUnauthorizedHandler` in `api/client.ts`, covered end-to-end by
    // `features/auth/session-expiry.test.tsx`). What matters here: the
    // activation surface itself never treats a 401 as a success, and says so
    // in the existing authentication copy.
    vi.mocked(licensingApi.activateLicense).mockRejectedValue(
      new ApiError({ code: 'Unauthorized', message: 'x', status: 401 }),
    );
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.type(
      await screen.findByLabelText(t.license.activateCodeLabel),
      VALID_CODE,
    );
    await user.click(
      screen.getByRole('button', { name: t.license.activateSubmit }),
    );

    expect(await screen.findByText(t.errors.unauthorized)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(t.license.activateSuccess),
    ).not.toBeInTheDocument();
  });

  it('never persists, exposes or logs the raw license code', async () => {
    const backend = serveLicenseState(testUnlicensedLicenseState);
    vi.mocked(licensingApi.activateLicense).mockImplementation(async () => {
      backend.state = testActiveLicenseState;
      return { ...testActiveLicenseState, changed: true };
    });
    const localSetItem = vi.spyOn(Storage.prototype, 'setItem');
    const consoleSpies = (
      ['log', 'info', 'warn', 'error', 'debug'] as const
    ).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const user = userEvent.setup();

    const { queryClient } = renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app'],
    });

    await user.type(
      await screen.findByLabelText(t.license.activateCodeLabel),
      VALID_CODE,
    );
    await user.click(
      screen.getByRole('button', { name: t.license.activateSubmit }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();

    const containsCode = (value: unknown): boolean =>
      typeof value === 'string' && value.includes(VALID_CODE);

    // Browser storage: nothing written at all with the code in it.
    for (const call of localSetItem.mock.calls) {
      expect(call.some(containsCode)).toBe(false);
    }
    expect(JSON.stringify(globalThis.localStorage)).not.toContain(VALID_CODE);
    expect(JSON.stringify(globalThis.sessionStorage)).not.toContain(VALID_CODE);

    // URL: neither the browser location nor the router entry carries it.
    expect(globalThis.location.href).not.toContain(VALID_CODE);
    expect(globalThis.location.search).toBe('');

    // Application logging introduced by this task: none.
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        expect(call.some(containsCode)).toBe(false);
      }
    }

    // Query cache: only the backend's evaluated state is cached, never the
    // code or the activation receipt.
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state),
      ),
    ).not.toContain(VALID_CODE);
    expect(
      JSON.stringify(
        queryClient
          .getMutationCache()
          .getAll()
          .map((mutation) => mutation.state.variables),
      ),
    ).not.toContain(VALID_CODE);
  });
});
