import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicenseRevocation, LicenseState } from '@/api/contracts';
import { ApiError } from '@/api/errors';
import { AppRoutes } from '@/app/router';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testActiveLicenseState,
  testFinancialArea,
  testFiscalYear,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';

/**
 * Signed revocation import (OD-LIC-17 frontend slice).
 *
 * The whole application runs — providers, router, license gate, status card,
 * the real form — and only `src/api/*` is stubbed, so what is asserted is the
 * product flow:
 *
 * `active license → operator registers a signed revocation artifact →
 *  POST /license/revocations/import → awaited re-read of GET /license/current
 *  → revoked → the gate blocks the workspace`
 *
 * The backend's own verification (signature, canonical form, installation /
 * customer / license binding, staleness, replay, single-transaction write) is
 * covered by `backend/src/modules/licensing` and its integration suites. This
 * file owns the surface, its permission gate, its error copy and the rule that
 * the UI believes the re-read rather than the receipt.
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
  importLicenseDocument: vi.fn(),
  importLicenseRevocation: vi.fn(),
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
const accountingApi = await import('@/api/accounting.api');

/** A session that may import a license AND register a signed revocation. */
const fullLicensingPermissions = [
  ...allAccountingPermissions,
  PERMISSIONS.licensing.licenseActivate,
  PERMISSIONS.licensing.licenseRevoke,
];

/** A plausible revocation envelope; nothing about its shape is checked here. */
const REVOCATION_DOCUMENT =
  '{"format":"vardena-revocation","fileVersion":1,"revocation":"VREV1.eyJ2IjoxfQ.c2lnbmF0dXJl"}';

const STORED_REVOCATION: LicenseRevocation = {
  revocationId: '01K7REVOCATIONAAAAAAAAAAAA',
  licenseId: testActiveLicenseState.licenseId ?? '01K7LICENSEAAAAAAAAAAAAAAA',
  installationId:
    testActiveLicenseState.installationId ?? '01K7INSTALLATIONAAAAAAAAAA',
  customerId: testActiveLicenseState.customerId ?? '01K7CUSTOMERAAAAAAAAAAAAAA',
  customerCode: testActiveLicenseState.customerCode ?? 'CUST-ACME-01',
  targetOperationId: '01K7OPERATIONAAAAAAAAAAAAA',
  reason: 'contract-ended',
  reasonDetail: null,
  issuerKeyId: 'owner-key-2026-01',
  issuedAt: '2026-10-21T08:00:00.000Z',
  importedAt: '2026-10-21T09:00:00.000Z',
  importedBy: testUser.id,
  artifactSha256: 'a'.repeat(64),
  canonicalPayloadSha256: 'b'.repeat(64),
};

/** The state the backend persists once the revocation has been applied. */
const REVOKED_STATE: LicenseState = {
  ...testActiveLicenseState,
  active: false,
  inactiveReason: 'revoked',
  accessMode: 'BLOCKED',
  graceEndsAt: null,
  revokedAt: '2026-10-21T09:00:00.000Z',
};

function revocationFile(
  content: string = REVOCATION_DOCUMENT,
  name = 'vardena-revocation.json',
): File {
  return new File([content], name, { type: 'application/json' });
}

/**
 * `GET /license/current` answers what the (mocked) backend persists. The
 * import is what changes it — never the frontend, and never the receipt.
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
    permissions: fullLicensingPermissions,
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
  serveLicenseState(testActiveLicenseState);
});

describe('signed revocation import', () => {
  it('offers the form on an active installation to a session holding the revoke permission', async () => {
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });

    expect(
      await screen.findByText(t.license.revocationTitle),
    ).toBeInTheDocument();
    expect(screen.getByText(t.license.revocationBody)).toBeInTheDocument();
    expect(
      screen.getByLabelText(t.license.revocationFileLabel),
    ).toHaveAttribute('type', 'file');
    expect(
      screen.getByRole('button', { name: t.license.revocationSubmit }),
    ).toBeInTheDocument();
    // Rendering the surface imports nothing.
    expect(licensingApi.importLicenseRevocation).not.toHaveBeenCalled();
  });

  it('does not offer the form to a session without Licensing.License.Revoke', async () => {
    // Activation and revocation are separate permissions: being able to load a
    // license file must not imply being able to switch the installation off.
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        ...allAccountingPermissions,
        PERMISSIONS.licensing.licenseActivate,
      ],
    });

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });
    // The license import form is still there; only the revocation surface is
    // withheld.
    expect(await screen.findByText(t.license.importTitle)).toBeInTheDocument();
    expect(
      screen.queryByText(t.license.revocationTitle),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(t.license.revocationFileLabel),
    ).not.toBeInTheDocument();
  });

  it('does not offer the form once the license is already revoked', async () => {
    serveLicenseState(REVOKED_STATE);

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const main = await screen.findByRole('main');
    expect(
      await within(main).findByText(t.license.revokedTitle),
    ).toBeInTheDocument();
    // A revoked license refuses every later artifact; showing the form would
    // imply a recovery path that does not exist.
    expect(
      within(main).queryByLabelText(t.license.revocationFileLabel),
    ).not.toBeInTheDocument();
  });

  it('rejects an empty submission without calling the backend', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.click(
      await screen.findByRole('button', { name: t.license.revocationSubmit }),
    );

    expect(
      await screen.findByText(t.license.revocationDocumentRequired),
    ).toBeInTheDocument();
    expect(licensingApi.importLicenseRevocation).not.toHaveBeenCalled();
  });

  it('submits the artifact text once and blocks the workspace only on the backend-confirmed revoked state', async () => {
    const backend = serveLicenseState(testActiveLicenseState);
    vi.mocked(licensingApi.importLicenseRevocation).mockImplementation(
      async () => {
        backend.state = REVOKED_STATE;
        return {
          changed: true,
          outcome: 'APPLIED',
          revocation: STORED_REVOCATION,
          alreadyApplied: false,
        };
      },
    );
    const user = userEvent.setup();

    const { queryClient } = renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app'],
    });

    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });
    await user.upload(
      screen.getByLabelText(t.license.revocationFileLabel),
      revocationFile(),
    );
    expect(
      await screen.findByText(t.license.importSelectedFile),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: t.license.revocationSubmit }),
    );

    // Exactly one request, carrying the file's TEXT as the single field: no
    // filename, no metadata, nothing the client could use to describe a
    // revocation it wants.
    await waitFor(() =>
      expect(licensingApi.importLicenseRevocation).toHaveBeenCalledTimes(1),
    );
    expect(licensingApi.importLicenseRevocation).toHaveBeenCalledWith({
      document: REVOCATION_DOCUMENT,
    });

    // The workspace disappears because the re-read says revoked — the receipt
    // alone never drives the gate.
    expect(await screen.findByText(t.license.revokedTitle)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 1, name: t.dashboard.title }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText(t.license.revocationSuccess),
    ).toBeInTheDocument();

    // The artifact is not retained anywhere the frontend could leak it from.
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((entry) => entry.state),
      ),
    ).not.toContain('VREV1.');
  });

  it('keeps the license working and explains a conflicting replay', async () => {
    // 409: the artifact is authentic but retained state refuses it. Nothing was
    // written, so the installation keeps the license it had.
    vi.mocked(licensingApi.importLicenseRevocation).mockRejectedValue(
      new ApiError({
        code: 'Conflict',
        message: 'conflicting-replay',
        status: 409,
        correlationId: 'corr-conflict',
        details: { reason: 'conflicting-replay' },
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });
    await user.click(
      screen.getByRole('button', { name: t.license.revocationPasteToggle }),
    );
    // `paste`, not `type`: userEvent reads `{` as a key descriptor, and the
    // document is JSON. Pasting is also how an operator actually supplies it.
    await user.click(screen.getByLabelText(t.license.revocationDocumentLabel));
    await user.paste(REVOCATION_DOCUMENT);
    await user.click(
      screen.getByRole('button', { name: t.license.revocationSubmit }),
    );

    expect(
      await screen.findByText(t.license.revocationConflict),
    ).toBeInTheDocument();
    expect(screen.getByText('corr-conflict')).toBeInTheDocument();
    // The license is untouched and the workspace is still open.
    expect(
      screen.getByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
    // A conflicting (authentic) artifact is not "invalid": the text stays so
    // the operator can compare it, and the licence keeps working.
    expect(
      screen.getByLabelText(t.license.revocationDocumentLabel),
    ).toHaveValue(REVOCATION_DOCUMENT);
  });

  it('tells the operator to obtain a current artifact when the revocation is stale', async () => {
    // 422 `stale-revocation`: a genuine revocation outside the accepted window.
    // The remedy differs from "this file is invalid", so the copy differs.
    vi.mocked(licensingApi.importLicenseRevocation).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        message: 'stale-revocation',
        status: 422,
        correlationId: 'corr-stale',
        details: { reason: 'stale-revocation' },
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });
    await user.upload(
      screen.getByLabelText(t.license.revocationFileLabel),
      revocationFile(),
    );
    await user.click(
      screen.getByRole('button', { name: t.license.revocationSubmit }),
    );

    expect(
      await screen.findByText(t.license.revocationStale),
    ).toBeInTheDocument();
    // A refused artifact is cleared so the same bytes cannot be resubmitted by
    // reflex; the license is unchanged.
    expect(
      screen.queryByText(t.license.importSelectedFile),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
  });

  it('explains the refusal of a malformed artifact and refuses a second submit while pending', async () => {
    let release: (() => void) | undefined;
    vi.mocked(licensingApi.importLicenseRevocation).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          release = () =>
            reject(
              new ApiError({
                code: 'ValidationFailed',
                message: 'malformed',
                status: 400,
                correlationId: 'corr-malformed',
              }),
            );
        }),
    );
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });
    await user.upload(
      screen.getByLabelText(t.license.revocationFileLabel),
      revocationFile(),
    );
    const submit = screen.getByRole('button', {
      name: t.license.revocationSubmit,
    });
    await user.click(submit);

    // In flight: the control is disabled and reports progress, so a second
    // click cannot produce a second import.
    expect(
      await screen.findByRole('button', {
        name: t.license.revocationSubmitting,
      }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: t.license.revocationSubmitting }),
    );
    expect(licensingApi.importLicenseRevocation).toHaveBeenCalledTimes(1);

    release?.();
    expect(
      await screen.findByText(t.license.revocationInvalid),
    ).toBeInTheDocument();
  });
});
