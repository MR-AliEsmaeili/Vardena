import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicenseState } from '@/api/contracts';
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
  testScheduledLicenseState,
  testUnlicensedLicenseState,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';

/**
 * License import (L-03 frontend slice, ADR-0046).
 *
 * The real providers, router, gates, forms and query cache run; only the
 * `src/api/*` modules are stubbed, so what is asserted is the application's
 * own flow:
 *
 * `inactive license → file-first import form → POST /license/import →
 *  re-read of GET /license/current → active → organization bootstrap`
 *
 * The four license states themselves (loading / active / inactive / error)
 * and the retry of the license READ keep their suite in
 * `app/layouts/license-gate.test.tsx`; this file owns the import step, its
 * failures and its security behavior.
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

/** A session that may import the installation license. */
const importPermissions = [
  ...allAccountingPermissions,
  PERMISSIONS.licensing.licenseActivate,
];

/** A plausible signed document; nothing about its shape is checked client-side. */
const FILE_DOCUMENT =
  '{"format":"vardena-license","fileVersion":1,"document":"VLIC2.eyJ2IjoyfQ.c2lnbmF0dXJl"}';

/** A plausible legacy code, delivered by paste instead of by file. */
const LEGACY_CODE = 'VLIC1.eyJ2IjoxfQ.c2lnbmF0dXJl';

function licenseFile(
  content: string = FILE_DOCUMENT,
  name = 'vardena-license.vlic',
): File {
  return new File([content], name, { type: 'application/json' });
}

/**
 * `GET /license/current` answers whatever the backend currently persists.
 * The helper makes that explicit: the state is a variable the (mocked)
 * backend owns, and the import is what changes it — never the frontend.
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
    permissions: importPermissions,
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
  serveLicenseState(testUnlicensedLicenseState);
});

describe('license import', () => {
  it('offers the file-first import form when the backend reports no active license', async () => {
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const main = await screen.findByRole('main');
    expect(
      await within(main).findByText(t.license.importTitle),
    ).toBeInTheDocument();
    expect(within(main).getByText(t.license.importBody)).toBeInTheDocument();
    // The installation identity comes from the backend response — the
    // frontend fingerprints nothing and generates no installation id.
    expect(
      within(main).getByText(
        testUnlicensedLicenseState.installationId ?? 'missing',
      ),
    ).toBeInTheDocument();
    // File first: the primary control is a file input, not a code field.
    expect(
      within(main).getByLabelText(t.license.importFileLabel),
    ).toHaveAttribute('type', 'file');
    expect(
      within(main).getByRole('button', { name: t.license.importSubmit }),
    ).toBeInTheDocument();
    // No workspace behind it, and nothing was imported by rendering.
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
    expect(licensingApi.importLicenseDocument).not.toHaveBeenCalled();
  });

  it('keeps the plain explainer for a session without the import permission', async () => {
    // License and permission stay separate facts: a session that may not
    // import is told about the license, not shown a form that could only
    // ever be answered with 403 (the backend authorizes the import anyway).
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
      within(main).queryByLabelText(t.license.importFileLabel),
    ).not.toBeInTheDocument();
    expect(licensingApi.importLicenseDocument).not.toHaveBeenCalled();
  });

  it('rejects an empty submission without calling the backend', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.click(
      await screen.findByRole('button', { name: t.license.importSubmit }),
    );

    expect(
      await screen.findByText(t.license.importDocumentRequired),
    ).toBeInTheDocument();
    expect(licensingApi.importLicenseDocument).not.toHaveBeenCalled();
    // Still on the license screen, still blocked.
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
  });

  it('imports the selected file, submits its content, and releases the gate only on the backend-confirmed re-read', async () => {
    const backend = serveLicenseState(testUnlicensedLicenseState);
    vi.mocked(licensingApi.importLicenseDocument).mockImplementation(
      async () => {
        backend.state = testActiveLicenseState;
        return { ...testActiveLicenseState, changed: true, outcome: 'APPLIED' };
      },
    );
    const user = userEvent.setup();

    const { queryClient } = renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app'],
    });

    const input = await screen.findByLabelText(t.license.importFileLabel);
    await user.upload(input, licenseFile());
    expect(
      await screen.findByText(t.license.importSelectedFile),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: t.license.importSubmit }),
    );

    // Exactly one request, carrying the file's TEXT as the single field.
    await waitFor(() =>
      expect(licensingApi.importLicenseDocument).toHaveBeenCalledTimes(1),
    );
    expect(licensingApi.importLicenseDocument).toHaveBeenCalledWith({
      document: FILE_DOCUMENT,
    });

    // The gate releases because the re-read (the mocked backend state) says
    // active — not because a POST answered 200.
    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(t.license.importSuccess),
    ).toBeInTheDocument();

    // The document is not kept anywhere the frontend can leak it from.
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((entry) => entry.state),
      ),
    ).not.toContain(FILE_DOCUMENT);
  });

  it('reports an unchanged receipt for a repeated document without inventing a new license', async () => {
    serveLicenseState(testActiveLicenseState);
    vi.mocked(licensingApi.importLicenseDocument).mockResolvedValue({
      ...testActiveLicenseState,
      changed: false,
      outcome: 'UNCHANGED',
    });
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    // An active installation renews from the dashboard card.
    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });
    const submitButton = await screen.findByRole('button', {
      name: t.license.importSubmit,
    });
    const form = within(submitButton.closest('form') as HTMLElement);
    await user.upload(
      form.getByLabelText(t.license.importFileLabel),
      licenseFile(LEGACY_CODE, 'renewal.vlic'),
    );
    await user.click(submitButton);

    await waitFor(() =>
      expect(licensingApi.importLicenseDocument).toHaveBeenCalledWith({
        document: LEGACY_CODE,
      }),
    );
    expect(
      await screen.findByText(t.license.importUnchanged),
    ).toBeInTheDocument();
  });

  it('submits a pasted legacy code through the same single route', async () => {
    const backend = serveLicenseState(testUnlicensedLicenseState);
    vi.mocked(licensingApi.importLicenseDocument).mockImplementation(
      async () => {
        backend.state = testActiveLicenseState;
        return { ...testActiveLicenseState, changed: true, outcome: 'APPLIED' };
      },
    );
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.click(
      await screen.findByRole('button', {
        name: t.license.importPasteToggle,
      }),
    );
    await user.type(
      await screen.findByLabelText(t.license.importDocumentLabel),
      LEGACY_CODE,
    );
    await user.click(
      screen.getByRole('button', { name: t.license.importSubmit }),
    );

    await waitFor(() =>
      expect(licensingApi.importLicenseDocument).toHaveBeenCalledWith({
        document: LEGACY_CODE,
      }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
  });

  it('keeps the import screen usable after the backend refuses a document, and succeeds on the next attempt', async () => {
    const backend = serveLicenseState(testUnlicensedLicenseState);
    vi.mocked(licensingApi.importLicenseDocument)
      .mockRejectedValueOnce(
        new ApiError({
          code: 'BusinessRuleViolation',
          // A raw backend sentence that must never reach the screen.
          message:
            'Ed25519 signature verification failed for payload segment 2.',
          status: 422,
          correlationId: 'corr-import',
        }),
      )
      .mockImplementation(async () => {
        backend.state = testActiveLicenseState;
        return { ...testActiveLicenseState, changed: true, outcome: 'APPLIED' };
      });
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.upload(
      await screen.findByLabelText(t.license.importFileLabel),
      licenseFile('{"tampered":true}', 'tampered.vlic'),
    );
    await user.click(
      screen.getByRole('button', { name: t.license.importSubmit }),
    );

    // Persian, operation-scoped copy — no internals, no stack trace, no
    // crypto detail — plus the correlation id for support.
    expect(
      await screen.findByText(t.license.importRejected),
    ).toBeInTheDocument();
    expect(screen.getByText('corr-import')).toBeInTheDocument();
    expect(screen.queryByText(/Ed25519/)).not.toBeInTheDocument();
    expect(screen.queryByText(/signature/i)).not.toBeInTheDocument();

    // The screen stays, the gate is not released, and the refused selection
    // is cleared so the next attempt starts clean.
    expect(screen.getByText(t.license.importTitle)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(t.license.importSelectedFile),
    ).not.toBeInTheDocument();

    await user.upload(
      screen.getByLabelText(t.license.importFileLabel),
      licenseFile(),
    );
    await user.click(
      screen.getByRole('button', { name: t.license.importSubmit }),
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
    expect(licensingApi.importLicenseDocument).toHaveBeenCalledTimes(2);
  });

  it('explains a retained-state conflict (409) apart from a bad document', async () => {
    const backend = serveLicenseState(testUnlicensedLicenseState);
    vi.mocked(licensingApi.importLicenseDocument)
      .mockRejectedValueOnce(
        new ApiError({
          code: 'Conflict',
          message: 'This operation has already been imported.',
          status: 409,
          correlationId: 'corr-conflict',
        }),
      )
      .mockImplementation(async () => {
        backend.state = testActiveLicenseState;
        return { ...testActiveLicenseState, changed: true, outcome: 'APPLIED' };
      });
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.upload(
      await screen.findByLabelText(t.license.importFileLabel),
      licenseFile(),
    );
    await user.click(
      screen.getByRole('button', { name: t.license.importSubmit }),
    );

    // An authentic document refused by retained state: the operator is NOT
    // told to re-check the file, and the selection is kept for the retry.
    expect(
      await screen.findByText(t.license.importConflict),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t.license.importRejected),
    ).not.toBeInTheDocument();
    expect(screen.getByText(t.license.importSelectedFile)).toBeInTheDocument();
  });

  it('explains a reduction conflict (L-04) with its own copy and keeps the file', async () => {
    const backend = serveLicenseState(testUnlicensedLicenseState);
    vi.mocked(licensingApi.importLicenseDocument).mockRejectedValueOnce(
      new ApiError({
        code: 'Conflict',
        message: 'This version reduces the modules or capacity …',
        status: 409,
        correlationId: 'corr-reduction',
        details: {
          reason: 'reduction-requires-resolution',
          reduction: {
            predecessorVersionId: '01K7PREDECESSOR00000000000',
            conflicts: [
              { kind: 'organization-capacity', limit: 3, currentUsage: 5 },
            ],
          },
        },
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.upload(
      await screen.findByLabelText(t.license.importFileLabel),
      licenseFile(),
    );
    await user.click(
      screen.getByRole('button', { name: t.license.importSubmit }),
    );

    // The reduction refusal names the dedicated resolution operation — never
    // the backend's English message — and the selection is kept.
    expect(
      await screen.findByText(t.license.importReductionConflict),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t.license.importConflict),
    ).not.toBeInTheDocument();
    expect(screen.getByText(t.license.importSelectedFile)).toBeInTheDocument();
    void backend;
  });

  it('explains a post-gap refusal (OQ-87) as the dedicated recovery operation', async () => {
    serveLicenseState(testUnlicensedLicenseState);
    vi.mocked(licensingApi.importLicenseDocument).mockRejectedValueOnce(
      new ApiError({
        code: 'Conflict',
        message: 'Post-gap recovery is permitted only …',
        status: 409,
        correlationId: 'corr-postgap',
        details: {
          reason: 'post-gap-recovery-requires-dedicated-operation',
        },
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.upload(
      await screen.findByLabelText(t.license.importFileLabel),
      licenseFile(),
    );
    await user.click(
      screen.getByRole('button', { name: t.license.importSubmit }),
    );

    expect(
      await screen.findByText(t.license.importPostGapConflict),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t.license.importConflict),
    ).not.toBeInTheDocument();
  });

  it('refuses an oversized file before any request is sent', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const oversized = new File(
      ['{"a":"' + 'x'.repeat(70000) + '"}'],
      'huge.vlic',
    );
    await user.upload(
      await screen.findByLabelText(t.license.importFileLabel),
      oversized,
    );

    expect(
      await screen.findByText(t.license.importFileTooLarge),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: t.license.importSubmit }),
    );
    expect(licensingApi.importLicenseDocument).not.toHaveBeenCalled();
  });

  it('shows the scheduled renewal on an active installation and imports the next version without interrupting work', async () => {
    serveLicenseState(testScheduledLicenseState);
    vi.mocked(licensingApi.importLicenseDocument).mockResolvedValue({
      ...testScheduledLicenseState,
      changed: true,
      outcome: 'APPLIED',
    });
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    // The workspace is open (the CURRENT license stays effective; the
    // future-dated version neither replaced it nor blocked anything) and the
    // card reports the scheduled renewal and its hint.
    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(t.license.statusScheduled),
    ).toBeInTheDocument();
    expect(screen.getByText(t.license.statusScheduledHint)).toBeInTheDocument();
    // The chain end is shown separately from the governing version's end, so
    // "renewal applied" is never misread as "the term ends sooner" (PO decision
    // Q-2 = `coverage_end`).
    expect(screen.getByText(t.license.statusCoverageEnd)).toBeInTheDocument();
    expect(
      screen.getByText(t.license.statusCoverageEndHint),
    ).toBeInTheDocument();
    // The retained-version history names each version's signed operation id, so
    // an operator can identify the renewal target unambiguously.
    expect(screen.getByText(t.license.statusHistory)).toBeInTheDocument();
    expect(screen.getByText(t.license.statusHistoryHint)).toBeInTheDocument();
    for (const version of testScheduledLicenseState.versions) {
      expect(screen.getByText(version.operationId)).toBeInTheDocument();
    }
    // Presentation only: the backend's signed validity Instants stay unchanged.
    // The same instant is shown by the status window and by the retained-version
    // history (which now also exposes each version's signed operation id), so
    // every occurrence is asserted rather than the first one only.
    expect(
      (await screen.findAllByText(/۱۴۰۴\/۱۰\/۱۱ ۰۰:۰۰/)).length,
    ).toBeGreaterThan(0);
    expect(testScheduledLicenseState.validFrom).toBe(
      '2026-01-01T00:00:00.000Z',
    );

    const submitButton = screen.getByRole('button', {
      name: t.license.importSubmit,
    });
    const form = within(submitButton.closest('form') as HTMLElement);
    await user.upload(
      form.getByLabelText(t.license.importFileLabel),
      licenseFile(),
    );
    await user.click(submitButton);

    await waitFor(() =>
      expect(licensingApi.importLicenseDocument).toHaveBeenCalledTimes(1),
    );
    expect(
      await screen.findByText(t.license.importSuccess),
    ).toBeInTheDocument();
    // Still working, still the same evaluated license.
    expect(
      screen.getByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
  });

  it('never persists, exposes or logs the imported document', async () => {
    const backend = serveLicenseState(testUnlicensedLicenseState);
    vi.mocked(licensingApi.importLicenseDocument).mockImplementation(
      async () => {
        backend.state = testActiveLicenseState;
        return { ...testActiveLicenseState, changed: true, outcome: 'APPLIED' };
      },
    );
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

    await user.upload(
      await screen.findByLabelText(t.license.importFileLabel),
      licenseFile(),
    );
    await user.click(
      screen.getByRole('button', { name: t.license.importSubmit }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();

    const containsDocument = (value: unknown): boolean =>
      typeof value === 'string' && value.includes(FILE_DOCUMENT);

    // Browser storage: nothing written at all with the document in it.
    for (const call of localSetItem.mock.calls) {
      expect(call.some(containsDocument)).toBe(false);
    }
    expect(JSON.stringify(globalThis.localStorage)).not.toContain(
      FILE_DOCUMENT,
    );
    expect(JSON.stringify(globalThis.sessionStorage)).not.toContain(
      FILE_DOCUMENT,
    );

    // URL: neither the browser location nor the router entry carries it.
    expect(globalThis.location.href).not.toContain(FILE_DOCUMENT);
    expect(globalThis.location.search).toBe('');

    // Application logging introduced by this task: none.
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        expect(call.some(containsDocument)).toBe(false);
      }
    }

    // Query cache: only the backend's evaluated state is cached, never the
    // document or the import receipt.
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((entry) => entry.state),
      ),
    ).not.toContain(FILE_DOCUMENT);
    expect(
      JSON.stringify(queryClient.getMutationCache().getAll()),
    ).not.toContain(FILE_DOCUMENT);
  });
});
