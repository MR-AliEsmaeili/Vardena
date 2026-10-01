import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import { AppRoutes } from '@/app/router';
import { useLicenseState } from '@/features/licensing/use-license-state';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testActiveLicenseState,
  testInactiveLicenseState,
  testUnlicensedLicenseState,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';

/**
 * Licensing bootstrap stage (ADR-0030, `docs/licensing-architecture.md`).
 *
 * The real providers, router, gates and query cache run; only `src/api/*` is
 * stubbed. What is asserted here is the BOOTSTRAP ORDER
 *
 * `login → session → license → organization → workspace`
 *
 * and the four license states the stage can be in. The organization stage
 * itself (selection, empty, forbidden, switching) keeps its own suite in
 * `app-shell.test.tsx`; here it only matters whether it is reachable at all.
 */

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('@/api/organization.api', () => ({
  listOrganizations: vi.fn(),
  createOrganization: vi.fn(),
  grantMembership: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));

vi.mock('@/api/licensing.api', () => ({
  getLicenseState: vi.fn(),
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
const licensingApi = await import('@/api/licensing.api');

/** Permissions of a session that may create the very first organization. */
const firstOrganizationPermissions = [
  ...allAccountingPermissions,
  'Organization.Organization.Create',
  'Organization.Membership.Grant',
];

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(identityApi.logout).mockResolvedValue(undefined);
  vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
    paginated([testOrganization]),
  );
  vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
    testActiveLicenseState,
  );
});

describe('licensing bootstrap stage', () => {
  it('reads no license state before a session exists', async () => {
    vi.mocked(identityApi.getCurrentUser).mockRejectedValue(
      new ApiError({ code: 'Unauthorized', message: 'x', status: 401 }),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    // The visitor is sent to the login screen and the authenticated
    // self-read is never attempted — `GET /license/current` requires a
    // session, so asking before login would be a guaranteed 401.
    expect(
      await screen.findByRole('heading', { name: t.auth.loginTitle }),
    ).toBeInTheDocument();
    expect(licensingApi.getLicenseState).not.toHaveBeenCalled();
  });

  it('shows the license check state while the read is in flight, with no organization UI and no workspace', async () => {
    vi.mocked(licensingApi.getLicenseState).mockImplementation(
      () => new Promise(() => {}),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    expect(await screen.findByText(t.license.checking)).toBeInTheDocument();
    // Neither organization stage state may appear while the license is
    // unknown, and the workspace must not render around it.
    expect(
      screen.queryByText(t.organization.resolving),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(t.organization.selectingTitle),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: t.nav.dashboard }),
    ).not.toBeInTheDocument();
    expect(organizationApi.createOrganization).not.toHaveBeenCalled();
  });

  it('continues to the existing organization gate once the license is active', async () => {
    // Zero organizations and no create permission: the organization gate's
    // own terminal explainer. Seeing it proves the organization stage was
    // reached — through, not around, the licensing stage.
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([]),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const main = await screen.findByRole('main');
    expect(
      await within(main).findByText(t.organization.emptyTitle),
    ).toBeInTheDocument();
    expect(screen.queryByText(t.license.checking)).not.toBeInTheDocument();
    expect(screen.queryByText(t.license.inactiveTitle)).not.toBeInTheDocument();
    expect(licensingApi.getLicenseState).toHaveBeenCalled();
  });

  it('tells a never-licensed installation how to get licensed', async () => {
    // L-02: a fresh installation has an identity but no license. That is a
    // distinct state from "the license stopped being valid", and the screen
    // must name the installation id the operator has to quote.
    //
    // BEHAVIOR CHANGE (frontend license activation slice): a session that
    // holds `Licensing.License.Activate` — as this one does — is now offered
    // the activation step itself instead of a terminal explainer, so the
    // assertion moved from the explainer title to the activation surface.
    // Everything the original test protected is still asserted: the
    // installation id is on screen, the state is never reported as a
    // permission problem, and the workspace stays closed.
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: ['Licensing.License.Activate'],
    });
    vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
      testUnlicensedLicenseState,
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const main = await screen.findByRole('main');
    expect(
      await within(main).findByText(t.license.activateTitle),
    ).toBeInTheDocument();
    expect(
      within(main).getByText(
        testUnlicensedLicenseState.installationId ?? 'missing',
      ),
    ).toBeInTheDocument();
    expect(
      within(main).queryByText(t.license.inactiveTitle),
    ).not.toBeInTheDocument();
    expect(
      within(main).queryByText(t.permissions.forbiddenTitle),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
  });

  it('keeps the terminal explainer for a never-licensed installation the session may not activate', async () => {
    // The same backend state, without `Licensing.License.Activate`: the
    // original explainer — including the installation id — is unchanged.
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [],
    });
    vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
      testUnlicensedLicenseState,
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const main = await screen.findByRole('main');
    expect(
      await within(main).findByText(t.license.unlicensedTitle),
    ).toBeInTheDocument();
    expect(
      within(main).getByText(
        (_content, element) =>
          element?.textContent?.startsWith(t.license.unlicensedBody) === true &&
          element.textContent.includes(
            testUnlicensedLicenseState.installationId ?? 'missing',
          ),
      ),
    ).toBeInTheDocument();
    expect(
      within(main).queryByText(t.license.activateTitle),
    ).not.toBeInTheDocument();
    expect(
      within(main).queryByText(t.license.inactiveTitle),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
  });

  it('stops before organization bootstrap when the license is inactive', async () => {
    // The real backend empties the effective permission set while the
    // license is inactive (`AuthorizationService.effectivePermissionCodes` →
    // `LicensingService.filterLicensedPermissions`), so this is the
    // production shape of an inactive installation.
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [],
    });
    vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
      testInactiveLicenseState,
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const main = await screen.findByRole('main');
    expect(
      await within(main).findByText(t.license.inactiveTitle),
    ).toBeInTheDocument();
    // The body carries the licensing explanation plus the installation id an
    // operator must quote to obtain a license.
    expect(
      within(main).getByText(
        (_content, element) =>
          element?.textContent?.startsWith(t.license.inactiveBody) === true &&
          element.textContent.includes(
            testInactiveLicenseState.installationId ?? 'missing',
          ),
      ),
    ).toBeInTheDocument();

    // No organization stage, no organization bootstrap, no workspace.
    expect(
      within(main).queryByRole('heading', {
        name: t.organization.createFirstTitle,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(t.organization.emptyTitle),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(t.organization.resolving),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
    expect(organizationApi.listOrganizations).not.toHaveBeenCalled();
    expect(organizationApi.createOrganization).not.toHaveBeenCalled();
    expect(organizationApi.grantMembership).not.toHaveBeenCalled();

    // The only recovery the contract offers is logging out (activation is a
    // backend/administrative act — the UI invents no activation form).
    expect(
      within(main).getByRole('button', { name: new RegExp(t.auth.logout) }),
    ).toBeInTheDocument();
  });

  it('explains an inactive license as a license state, never as a permission denial', async () => {
    // A session that genuinely holds every organization permission: the only
    // possible cause of the block is the installation license, so the copy
    // must say exactly that (ADR-0030 / FE-UX-02 §7.4 — a permission message
    // here would send the user to the wrong fix).
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: firstOrganizationPermissions,
    });
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([]),
    );
    vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
      testInactiveLicenseState,
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const main = await screen.findByRole('main');
    expect(
      await within(main).findByText(t.license.inactiveTitle),
    ).toBeInTheDocument();
    for (const permissionCopy of [
      t.permissions.forbiddenTitle,
      t.permissions.forbiddenBody,
      t.organization.permissionHint,
      t.organization.emptyBody,
    ]) {
      expect(screen.queryByText(permissionCopy)).not.toBeInTheDocument();
    }
    // …and it is not an error state either.
    expect(screen.queryByText(t.license.errorTitle)).not.toBeInTheDocument();
    expect(organizationApi.createOrganization).not.toHaveBeenCalled();
  });

  it('separates a failed license read from an inactive license and offers a retry', async () => {
    vi.mocked(licensingApi.getLicenseState).mockRejectedValue(
      new ApiError({
        code: 'InternalError',
        message: 'x',
        status: 500,
        correlationId: 'corr-license',
      }),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    expect(await screen.findByText(t.license.errorTitle)).toBeInTheDocument();
    // The correlation id of the failed read is offered for support, and the
    // state is never reported as "inactive" or silently treated as active.
    expect(screen.getByText(/corr-license/)).toBeInTheDocument();
    expect(screen.queryByText(t.license.inactiveTitle)).not.toBeInTheDocument();
    expect(
      screen.queryByText(t.license.unlicensedTitle),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(t.organization.emptyTitle),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.app.retry }),
    ).toBeInTheDocument();
  });

  it('recovers through retry: a failed read, then an active license, then the organization gate', async () => {
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([]),
    );
    vi.mocked(licensingApi.getLicenseState)
      .mockRejectedValueOnce(
        new ApiError({ code: 'InternalError', message: 'x', status: 500 }),
      )
      .mockResolvedValue(testActiveLicenseState);
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    expect(await screen.findByText(t.license.errorTitle)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t.app.retry }));

    // The same query is retried — not a second license source — and the
    // bootstrap continues into the organization stage.
    expect(
      await screen.findByText(t.organization.emptyTitle),
    ).toBeInTheDocument();
    expect(screen.queryByText(t.license.errorTitle)).not.toBeInTheDocument();
    expect(licensingApi.getLicenseState).toHaveBeenCalledTimes(2);
  });

  it('consumes the contract entitlement collection from the one license query', async () => {
    // Two consumers (the shell and this probe) share a single query key, so
    // the entitlements the UI can read are exactly the ones the contract
    // returned — there is no second entitlement registry, no derived
    // `*Enabled` flags and no per-feature license request.
    function EntitlementProbe() {
      const { status, license } = useLicenseState();
      return (
        <output>
          {status}:
          {(license?.entitlements ?? [])
            .map((entitlement) => `${entitlement.kind}/${entitlement.code}`)
            .join(',')}
        </output>
      );
    }

    renderWithProviders(
      <>
        <AppRoutes />
        <EntitlementProbe />
      </>,
      { initialEntries: ['/app'] },
    );

    expect(
      await screen.findByText(
        `active:${testActiveLicenseState.entitlements
          .map((entitlement) => `${entitlement.kind}/${entitlement.code}`)
          .join(',')}`,
      ),
    ).toBeInTheDocument();
    expect(licensingApi.getLicenseState).toHaveBeenCalledTimes(1);
  });

  it('keeps the FE-ORG-01 first-organization flow intact behind an active license', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: firstOrganizationPermissions,
    });
    vi.mocked(organizationApi.listOrganizations).mockResolvedValueOnce(
      paginated([]),
    );
    const createdOrganization = {
      ...testOrganization,
      id: 'org-created',
      code: 'MAIN',
      name: 'سازمان اصلی',
    };
    vi.mocked(organizationApi.createOrganization).mockResolvedValue(
      createdOrganization,
    );
    vi.mocked(organizationApi.grantMembership).mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const main = await screen.findByRole('main');
    expect(
      await within(main).findByRole('heading', {
        name: t.organization.createFirstTitle,
      }),
    ).toBeInTheDocument();

    await user.type(
      within(main).getByLabelText(t.organization.createFirstCode),
      'MAIN',
    );
    await user.type(
      within(main).getByLabelText(t.organization.createFirstName),
      'سازمان اصلی',
    );
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([createdOrganization]),
    );

    await user.click(
      within(main).getByRole('button', {
        name: t.organization.createFirstSubmit,
      }),
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
    expect(organizationApi.createOrganization).toHaveBeenCalledWith({
      code: 'MAIN',
      name: 'سازمان اصلی',
    });
    expect(organizationApi.grantMembership).toHaveBeenCalledWith(
      'org-created',
      { userId: testUser.id },
    );
    // The licensing stage added no extra read per route or per step.
    expect(licensingApi.getLicenseState).toHaveBeenCalledTimes(1);
  });

  it('drops the cached license state on logout and re-reads it for the next session', async () => {
    vi.mocked(identityApi.login).mockResolvedValue(testUser);
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app'],
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
    expect(queryClient.getQueryData(queryKeys.licenseState())).toStrictEqual(
      testActiveLicenseState,
    );

    // Log out through the shell's own affordance: the session's existing
    // cache reset (`SessionProvider` → `queryClient.clear()`) owns the
    // eviction; licensing adds no second logout mechanism and no license
    // copy survives in storage.
    await user.click(
      screen.getAllByRole('button', { name: new RegExp(t.auth.logout) })[0]!,
    );

    expect(
      await screen.findByRole('heading', { name: t.auth.loginTitle }),
    ).toBeInTheDocument();
    expect(queryClient.getQueryData(queryKeys.licenseState())).toBeUndefined();

    // The next session re-reads the license instead of inheriting it: a
    // license that was active for the previous session is not evidence for
    // this one.
    vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
      testInactiveLicenseState,
    );

    await user.type(
      await screen.findByLabelText(t.auth.username),
      'accountant',
    );
    await user.type(screen.getByLabelText(t.auth.password), 'secret');
    await user.click(screen.getByRole('button', { name: t.auth.submit }));

    expect(
      await screen.findByText(t.license.inactiveTitle),
    ).toBeInTheDocument();
    expect(queryClient.getQueryData(queryKeys.licenseState())).toStrictEqual(
      testInactiveLicenseState,
    );
  });
});
