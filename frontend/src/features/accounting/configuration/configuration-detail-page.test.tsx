import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAccountingConfiguration,
  getAccountingConfiguration,
  publishAccountingConfiguration,
} from '@/api/accounting.api';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { setDateTimeSettings } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { testAccountingConfiguration, testOrganization } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { ToastProvider } from '@/ui/patterns/toast';
import { ConfigurationDetailPage } from './configuration-detail-page';

vi.mock('@/api/accounting.api', () => ({
  getAccountingConfiguration: vi.fn(),
  publishAccountingConfiguration: vi.fn(),
  deleteAccountingConfiguration: vi.fn(),
}));
vi.mock('@/features/organization/use-organization', () => ({
  useOrganizationId: vi.fn(),
}));
vi.mock('@/features/permissions/use-permissions', () => ({
  usePermissions: vi.fn(),
}));

function renderDetail() {
  const routes: ReactElement = (
    <Routes>
      <Route
        path="/app/accounting/configurations/:configurationId"
        element={<ConfigurationDetailPage />}
      />
      <Route path="/app/accounting/configurations" element={<p>list</p>} />
    </Routes>
  );
  renderWithProviders(<ToastProvider>{routes}</ToastProvider>, {
    initialEntries: [
      `/app/accounting/configurations/${testAccountingConfiguration.id}`,
    ],
    withProviders: false,
  });
}

beforeEach(() => {
  setDateTimeSettings({ timeZone: testOrganization.timeZone });
  vi.mocked(useOrganizationId).mockReturnValue(testOrganization.id);
  vi.mocked(usePermissions).mockReturnValue({
    codes: [
      PERMISSIONS.accounting.accountingConfigurationView,
      PERMISSIONS.accounting.accountingConfigurationConfigure,
    ],
    loaded: true,
    has: () => true,
    hasAll: () => true,
    hasAny: () => true,
  });
  vi.mocked(getAccountingConfiguration).mockResolvedValue(
    testAccountingConfiguration,
  );
  vi.mocked(publishAccountingConfiguration).mockResolvedValue({
    ...testAccountingConfiguration,
    status: 'ACTIVE',
  });
  vi.mocked(deleteAccountingConfiguration).mockResolvedValue(undefined);
});

describe('ConfigurationDetailPage', () => {
  it('renders the version header and its levels from the server', async () => {
    renderDetail();

    expect(
      await screen.findByText(
        `${t.accountingConfig.detailTitle} — ${testAccountingConfiguration.code}`,
      ),
    ).toBeInTheDocument();
    // The pattern shown is the server's own field, never recomputed here.
    expect(screen.getByTestId('configuration-pattern')).toHaveTextContent(
      testAccountingConfiguration.pattern,
    );

    const table = screen.getByRole('table');
    const grid = within(table);
    for (const level of testAccountingConfiguration.levels) {
      // A level title may equal its kind label («گروه»), so assert presence.
      expect(grid.getAllByText(level.title).length).toBeGreaterThan(0);
    }
    expect(
      grid.getAllByText(t.accountingConfig.levelKindGroup).length,
    ).toBeGreaterThan(0);
    expect(
      grid.getByText(t.accountingConfig.levelKindNone),
    ).toBeInTheDocument();
  });

  it('confirms a publish and names the supersede consequence', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(
      await screen.findByRole('button', { name: t.accountingConfig.publish }),
    );
    expect(
      screen.getByText(
        'نسخهٔ فعال فعلی (در صورت وجود) به SUPERSEDED منتقل می‌شود و این نسخه شکل کد حساب را تعیین می‌کند. حساب‌های موجود تغییر نمی‌کنند.',
      ),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: t.accountingConfig.publishConfirm }),
    );
    await waitFor(() =>
      expect(publishAccountingConfiguration).toHaveBeenCalledWith(
        testOrganization.id,
        testAccountingConfiguration.id,
      ),
    );
  });

  it('offers delete for a draft that was never used operationally', async () => {
    renderDetail();
    expect(
      await screen.findByRole('button', { name: t.accountingConfig.delete }),
    ).toBeInTheDocument();
  });

  it('hides delete once the version has been used operationally', async () => {
    vi.mocked(getAccountingConfiguration).mockResolvedValue({
      ...testAccountingConfiguration,
      isOperationallyUsed: true,
      operationallyUsedAt: '2026-03-05T08:00:00.000Z',
    });
    renderDetail();

    expect(
      await screen.findByText(t.accountingConfig.operationallyUsed),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.accountingConfig.delete }),
    ).not.toBeInTheDocument();
    // Publishing a never-published draft stays possible.
    expect(
      screen.getByRole('button', { name: t.accountingConfig.publish }),
    ).toBeInTheDocument();
  });

  it('shows the read-only notice and no write actions for a published version', async () => {
    vi.mocked(getAccountingConfiguration).mockResolvedValue({
      ...testAccountingConfiguration,
      status: 'SUPERSEDED',
    });
    renderDetail();

    expect(
      await screen.findByText(t.accountingConfig.readOnlyPublished),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.accountingConfig.publish }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.accountingConfig.delete }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: t.accountingConfig.edit }),
    ).not.toBeInTheDocument();
  });
});
