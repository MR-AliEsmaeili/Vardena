import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { ApiError } from '@/api/errors';
import type { DashboardSummary } from '@/api/dashboard.api';
import * as dashboardApi from '@/api/dashboard.api';
import * as identity from '@/api/identity.api';
import { o } from '@/lib/owner-i18n';
import { DashboardPage } from './dashboard-page';

/**
 * Owner dashboard (TS-8.2).
 *
 * The rule under test is "the dashboard shows what the database counted":
 * the component prints the server payload and computes nothing. So these tests
 * assert (a) the printed figures are exactly the served ones, (b) the
 * "needs action" list is derived only from non-zero counts, (c) the three
 * states (loading / error+retry / genuinely empty) are distinct and that a
 * failed read never renders a zero — a misleading "all clear".
 */

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('@/api/dashboard.api', () => ({
  getDashboardSummary: vi.fn(),
}));

const admin = {
  id: '01K7OWNER0000000000000000',
  username: 'owner',
  role: 'OWNER_ADMIN' as const,
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-10-15T00:00:00.000Z',
};

const busySummary: DashboardSummary = {
  generatedAt: '2026-10-21T09:30:00.000Z',
  customers: { active: 4, inactive: 1 },
  installationIdentities: { active: 6, retired: 2 },
  issuances: { prepared: 3, signed: 9, abandoned: 1 },
  preparedRequests: { eligible: 2, expired: 1 },
  revocations: { requested: 1, recorded: 2 },
  signingKeys: { active: 2, needsReview: 1 },
  licenseArtifacts: { pending: 1, quarantined: 0 },
};

const emptySummary: DashboardSummary = {
  generatedAt: '2026-10-21T09:30:00.000Z',
  customers: { active: 0, inactive: 0 },
  installationIdentities: { active: 0, retired: 0 },
  issuances: { prepared: 0, signed: 0, abandoned: 0 },
  preparedRequests: { eligible: 0, expired: 0 },
  revocations: { requested: 0, recorded: 0 },
  signingKeys: { active: 0, needsReview: 0 },
  licenseArtifacts: { pending: 0, quarantined: 0 },
};

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <AppProviders queryClient={client}>
      <MemoryRouter initialEntries={['/app']}>
        <DashboardPage />
      </MemoryRouter>
    </AppProviders>,
  );
}

beforeEach(() => {
  vi.mocked(identity.getCurrentUser).mockResolvedValue(admin);
  vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
    permissions: ['licenses.view'],
  });
  vi.mocked(dashboardApi.getDashboardSummary).mockResolvedValue(busySummary);
});

describe('owner dashboard', () => {
  it('prints the served counts and marks only the non-zero items as needing action', async () => {
    mount();

    expect(await screen.findByText(o.dashboard.customers)).toBeInTheDocument();
    // Values are the server's, not recomputed: 4 active customers, 6 active
    // installations, 3 prepared requests, 9 signed licenses.
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();

    // The partition of prepared requests is shown explicitly, so a reader can
    // see that eligible + expired equals prepared (3 = 2 + 1).
    expect(
      screen.getByText(
        `${o.dashboard.preparedEligible}: 2 · ${o.dashboard.preparedExpired}: 1`,
      ),
    ).toBeInTheDocument();

    const attention = screen.getByRole('region', {
      name: o.dashboard.attention,
    });
    expect(
      within(attention).getByText(o.dashboard.attentionPrepared),
    ).toBeInTheDocument();
    expect(
      within(attention).getByText(o.dashboard.attentionExpired),
    ).toBeInTheDocument();
    expect(
      within(attention).getByText(o.dashboard.attentionRevocations),
    ).toBeInTheDocument();
    expect(
      within(attention).getByText(o.dashboard.attentionKeys),
    ).toBeInTheDocument();
    expect(
      within(attention).getByText(o.dashboard.attentionArtifacts),
    ).toBeInTheDocument();
    expect(
      within(attention).queryByText(o.dashboard.attentionNone),
    ).not.toBeInTheDocument();
    // Nothing claims a delivery/connection fact: the copy is about recorded
    // state only.
    expect(within(attention).queryByText(/آنلاین/)).not.toBeInTheDocument();
  });

  it('shows the genuine empty state for a workspace with nothing recorded', async () => {
    vi.mocked(dashboardApi.getDashboardSummary).mockResolvedValue(emptySummary);
    mount();

    expect(await screen.findByText(o.dashboard.empty)).toBeInTheDocument();
    expect(
      screen.getByText(o.dashboard.attentionNone, { exact: false }),
    ).toBeInTheDocument();
    // The counting time still comes from the database, never from the browser.
    expect(
      screen.getByText(o.dashboard.generatedAt, { exact: false }),
    ).toBeInTheDocument();
  });

  it('reports a failed read as an error with a retry, never as zero', async () => {
    vi.mocked(dashboardApi.getDashboardSummary).mockRejectedValueOnce(
      new ApiError({
        code: 'ServiceUnavailable',
        message: 'unavailable',
        status: 503,
        correlationId: 'corr-dashboard',
      }),
    );
    vi.mocked(dashboardApi.getDashboardSummary).mockResolvedValue(busySummary);
    const user = userEvent.setup();
    mount();

    expect(await screen.findByText(o.dashboard.error)).toBeInTheDocument();
    expect(screen.getByText('corr-dashboard')).toBeInTheDocument();
    // A zero would read as "nothing to do" — the opposite of the truth.
    expect(screen.queryByText(o.dashboard.empty)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /تلاش|retry/i }));
    expect(await screen.findByText(o.dashboard.customers)).toBeInTheDocument();
    expect(dashboardApi.getDashboardSummary).toHaveBeenCalledTimes(2);
  });

  it('renders nothing at all for a session without licenses.view', async () => {
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: ['customers.view'],
    });
    mount();

    // Wait for the permission read to settle, then assert only its outcome: no
    // section, and no request issued on the strength of a guess.
    await waitFor(() =>
      expect(identity.getEffectivePermissions).toHaveBeenCalled(),
    );
    await waitFor(() =>
      expect(screen.queryByText(o.dashboard.title)).not.toBeInTheDocument(),
    );
    expect(dashboardApi.getDashboardSummary).not.toHaveBeenCalled();
  });
});
