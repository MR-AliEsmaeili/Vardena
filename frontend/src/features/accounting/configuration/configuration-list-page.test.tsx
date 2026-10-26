import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listAccountingConfigurations } from '@/api/accounting.api';
import { ApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { setDateTimeSettings } from '@/lib/datetime';
import {
  paginated,
  testAccountingConfiguration,
  testOrganization,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { ConfigurationListPage } from './configuration-list-page';

vi.mock('@/api/accounting.api', () => ({
  listAccountingConfigurations: vi.fn(),
  getAccountingConfiguration: vi.fn(),
  publishAccountingConfiguration: vi.fn(),
  deleteAccountingConfiguration: vi.fn(),
  createAccountingConfiguration: vi.fn(),
  updateAccountingConfiguration: vi.fn(),
}));
vi.mock('@/features/organization/use-organization', () => ({
  useOrganizationId: vi.fn(),
}));
vi.mock('@/features/permissions/use-permissions', () => ({
  usePermissions: vi.fn(),
}));

const draft = { ...testAccountingConfiguration };
const active = {
  ...testAccountingConfiguration,
  id: 'config-2',
  name: 'نسخهٔ فعال سازمان',
  versionNumber: 2,
  status: 'ACTIVE' as const,
};
const superseded = {
  ...testAccountingConfiguration,
  id: 'config-3',
  name: 'نسخهٔ جایگزین‌شده',
  versionNumber: 0,
  status: 'SUPERSEDED' as const,
};
const usedDraft = {
  ...testAccountingConfiguration,
  id: 'config-4',
  name: 'پیش‌نویس استفاده‌شده',
  isOperationallyUsed: true,
  operationallyUsedAt: '2026-03-05T08:00:00.000Z',
};

function grantPermissions(codes: string[]) {
  vi.mocked(usePermissions).mockReturnValue({
    codes,
    loaded: true,
    has: (code) => codes.includes(code),
    hasAll: (list) => list.every((code) => codes.includes(code)),
    hasAny: (list) => list.some((code) => codes.includes(code)),
  });
}

function renderPage(entry = '/app/accounting/configurations') {
  return renderWithProviders(<ConfigurationListPage />, {
    initialEntries: [entry],
  });
}

beforeEach(() => {
  setDateTimeSettings({ timeZone: testOrganization.timeZone });
  vi.mocked(useOrganizationId).mockReturnValue(testOrganization.id);
  grantPermissions([
    PERMISSIONS.accounting.accountingConfigurationView,
    PERMISSIONS.accounting.accountingConfigurationConfigure,
  ]);
  vi.mocked(listAccountingConfigurations).mockResolvedValue(
    paginated([draft, active, superseded]),
  );
});

describe('ConfigurationListPage', () => {
  it('renders every version with its backend status and the server pattern', async () => {
    renderPage();

    // Wait for a ROW, not for a status label: the same labels also exist in the
    // status filter's options, so they are not a reliable readiness signal.
    const table = await screen.findByRole('table');
    const grid = within(table);
    expect(
      grid.getByText(testAccountingConfiguration.name),
    ).toBeInTheDocument();
    expect(
      grid.getByText(t.accountingConfig.statusNames.DRAFT),
    ).toBeInTheDocument();
    expect(
      grid.getByText(t.accountingConfig.statusNames.ACTIVE),
    ).toBeInTheDocument();
    expect(
      grid.getByText(t.accountingConfig.statusNames.SUPERSEDED),
    ).toBeInTheDocument();
    // `pattern` is displayed exactly as the server computed it.
    expect(grid.getAllByText(testAccountingConfiguration.pattern)).toHaveLength(
      3,
    );
    expect(listAccountingConfigurations).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: testOrganization.id,
        page: 1,
        pageSize: 50,
        sort: 'code:asc,versionNumber:desc',
      }),
      expect.anything(),
    );
  });

  it('offers write actions only on drafts and never on published versions', async () => {
    renderPage();
    await screen.findByTestId(`configuration-publish-${draft.id}`);

    // DRAFT: view + edit + publish + delete.
    expect(
      screen.getByTestId(`configuration-publish-${draft.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`configuration-delete-${draft.id}`),
    ).toBeInTheDocument();
    // ACTIVE / SUPERSEDED: no write action at all.
    expect(
      screen.queryByTestId(`configuration-publish-${active.id}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`configuration-delete-${active.id}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`configuration-publish-${superseded.id}`),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: t.accountingConfig.edit }),
    ).toHaveLength(1);
  });

  it('hides delete for a draft that is already used operationally', async () => {
    vi.mocked(listAccountingConfigurations).mockResolvedValue(
      paginated([usedDraft]),
    );
    renderPage();

    await screen.findByText(t.accountingConfig.operationallyUsed);
    expect(
      screen.getByTestId(`configuration-publish-${usedDraft.id}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`configuration-delete-${usedDraft.id}`),
    ).not.toBeInTheDocument();
  });

  it('shows no write action at all without the Configure permission', async () => {
    grantPermissions([PERMISSIONS.accounting.accountingConfigurationView]);
    renderPage();

    await screen.findByText(testAccountingConfiguration.name);
    expect(
      screen.queryByRole('link', { name: t.accountingConfig.newVersion }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`configuration-publish-${draft.id}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`configuration-delete-${draft.id}`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: t.accountingConfig.edit }),
    ).not.toBeInTheDocument();
    // Read access still works (one view link per row).
    expect(
      screen.getAllByRole('link', { name: t.accountingConfig.view }),
    ).toHaveLength(3);
  });

  it('renders the first-run empty state with its create action', async () => {
    vi.mocked(listAccountingConfigurations).mockResolvedValue(paginated([]));
    renderPage();

    expect(
      await screen.findByText(t.accountingConfig.noConfiguration),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: t.accountingConfig.emptyAction }),
    ).toBeInTheDocument();
  });

  it('shows the failure with a working retry', async () => {
    const user = userEvent.setup();
    vi.mocked(listAccountingConfigurations)
      .mockRejectedValueOnce(
        new ApiError({ code: 'InternalError', message: 'boom' }),
      )
      .mockResolvedValueOnce(paginated([draft]));
    renderPage();

    expect(
      await screen.findByText(t.accountingConfig.loadFailed),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.app.retry }));

    await waitFor(() =>
      expect(
        screen.getByText(testAccountingConfiguration.name),
      ).toBeInTheDocument(),
    );
    expect(listAccountingConfigurations).toHaveBeenCalledTimes(2);
  });
});
