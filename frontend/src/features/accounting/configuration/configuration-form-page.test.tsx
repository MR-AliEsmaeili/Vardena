import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAccountingConfiguration,
  getAccountingConfiguration,
  updateAccountingConfiguration,
} from '@/api/accounting.api';
import { useOrganizationId } from '@/features/organization/use-organization';
import { usePermissions } from '@/features/permissions/use-permissions';
import { setDateTimeSettings } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { testAccountingConfiguration, testOrganization } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { ToastProvider } from '@/ui/patterns/toast';
import { ConfigurationFormPage } from './configuration-form-page';

vi.mock('@/api/accounting.api', () => ({
  createAccountingConfiguration: vi.fn(),
  updateAccountingConfiguration: vi.fn(),
  getAccountingConfiguration: vi.fn(),
}));
vi.mock('@/features/organization/use-organization', () => ({
  useOrganizationId: vi.fn(),
}));
vi.mock('@/features/permissions/use-permissions', () => ({
  usePermissions: vi.fn(),
}));

const LIST_PATH = '/app/accounting/configurations';

function renderForm(entry: string) {
  const routes: ReactElement = (
    <Routes>
      <Route
        path={`${LIST_PATH}/new`}
        element={<ConfigurationFormPage mode="create" />}
      />
      <Route
        path={`${LIST_PATH}/:configurationId/edit`}
        element={<ConfigurationFormPage mode="edit" />}
      />
      <Route
        path={`${LIST_PATH}/:configurationId`}
        element={<p>{t.accountingConfig.detailTitle}</p>}
      />
      <Route path={LIST_PATH} element={<p>{t.accountingConfig.title}</p>} />
    </Routes>
  );
  renderWithProviders(<ToastProvider>{routes}</ToastProvider>, {
    initialEntries: [entry],
    withProviders: false,
  });
}

beforeEach(() => {
  // The organization zone decides the Instant an effective day maps to.
  setDateTimeSettings({ timeZone: 'Asia/Tehran' });
  vi.mocked(useOrganizationId).mockReturnValue(testOrganization.id);
  vi.mocked(usePermissions).mockReturnValue({
    codes: [],
    loaded: true,
    has: () => true,
    hasAll: () => true,
    hasAny: () => true,
  });
  vi.mocked(createAccountingConfiguration).mockResolvedValue({
    ...testAccountingConfiguration,
    id: 'config-new',
  });
  vi.mocked(updateAccountingConfiguration).mockResolvedValue(
    testAccountingConfiguration,
  );
  vi.mocked(getAccountingConfiguration).mockResolvedValue(
    testAccountingConfiguration,
  );
});

describe('ConfigurationFormPage', () => {
  it('creates a draft with levels and the effective day as an ISO UTC instant', async () => {
    const user = userEvent.setup();
    renderForm(`${LIST_PATH}/new`);

    await user.type(screen.getByLabelText(t.accountingConfig.code), 'DEFAULT');
    await user.type(
      screen.getByLabelText(t.accountingConfig.name),
      'پیکربندی اصلی',
    );
    await user.type(
      screen.getByLabelText(t.accountingConfig.effectiveFrom),
      '1405/01/01',
    );
    await user.type(
      screen.getAllByLabelText(t.accountingConfig.levelTitle)[0]!,
      'گروه',
    );
    await user.click(
      screen.getByRole('button', { name: t.accountingConfig.save }),
    );

    await waitFor(() =>
      expect(createAccountingConfiguration).toHaveBeenCalledWith({
        organizationId: testOrganization.id,
        code: 'DEFAULT',
        name: 'پیکربندی اصلی',
        // 1405-01-01 Jalali = 2026-03-21; local midnight in Asia/Tehran.
        effectiveFrom: '2026-03-20T20:30:00.000Z',
        levels: [
          {
            levelIndex: 1,
            title: 'گروه',
            digitLength: 2,
            defaultIsPostable: false,
            levelKind: null,
          },
        ],
      }),
    );
  });

  it('omits effectiveFrom when the operator leaves the day empty', async () => {
    const user = userEvent.setup();
    renderForm(`${LIST_PATH}/new`);

    await user.type(screen.getByLabelText(t.accountingConfig.code), 'MAIN');
    await user.type(screen.getByLabelText(t.accountingConfig.name), 'نسخهٔ یک');
    await user.type(
      screen.getAllByLabelText(t.accountingConfig.levelTitle)[0]!,
      'گروه',
    );
    await user.click(
      screen.getByRole('button', { name: t.accountingConfig.save }),
    );

    await waitFor(() =>
      expect(createAccountingConfiguration).toHaveBeenCalled(),
    );
    expect(
      vi.mocked(createAccountingConfiguration).mock.calls[0]?.[0],
    ).not.toHaveProperty('effectiveFrom');
  });

  it('blocks a request when a level is invalid or a required field is empty', async () => {
    const user = userEvent.setup();
    renderForm(`${LIST_PATH}/new`);

    await user.type(screen.getByLabelText(t.accountingConfig.code), 'DEFAULT');
    await user.click(
      screen.getByRole('button', { name: t.accountingConfig.save }),
    );
    expect(
      await screen.findByText(t.accountingConfig.nameRequired),
    ).toBeInTheDocument();
    expect(createAccountingConfiguration).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(t.accountingConfig.name), 'نسخه');
    await user.type(
      screen.getAllByLabelText(t.accountingConfig.levelTitle)[0]!,
      'گروه',
    );
    await user.clear(
      screen.getAllByLabelText(t.accountingConfig.digitLength)[0]!,
    );
    await user.click(
      screen.getByRole('button', { name: t.accountingConfig.save }),
    );
    expect(
      await screen.findByText(t.accountingConfig.digitLengthInvalid),
    ).toBeInTheDocument();
    expect(createAccountingConfiguration).not.toHaveBeenCalled();
  });

  it('edits a draft through PATCH without the immutable code', async () => {
    const user = userEvent.setup();
    renderForm(`${LIST_PATH}/${testAccountingConfiguration.id}/edit`);

    const name = await screen.findByLabelText(t.accountingConfig.name);
    await user.clear(name);
    await user.type(name, 'نام تازه');
    await user.click(
      screen.getByRole('button', { name: t.accountingConfig.save }),
    );

    await waitFor(() =>
      expect(updateAccountingConfiguration).toHaveBeenCalledWith(
        testOrganization.id,
        testAccountingConfiguration.id,
        {
          name: 'نام تازه',
          effectiveFrom: '2026-03-20T20:30:00.000Z',
          levels: [
            {
              levelIndex: 1,
              title: 'گروه',
              digitLength: 2,
              defaultIsPostable: false,
              levelKind: 'group',
            },
            {
              levelIndex: 2,
              title: 'کل',
              digitLength: 2,
              defaultIsPostable: false,
              levelKind: 'general',
            },
            {
              levelIndex: 3,
              title: 'معین',
              digitLength: 4,
              defaultIsPostable: true,
              levelKind: null,
            },
          ],
        },
      ),
    );
    const body = vi.mocked(updateAccountingConfiguration).mock.calls[0]?.[2];
    expect(body).not.toHaveProperty('code');
  });

  it('keeps a published version read-only', async () => {
    vi.mocked(getAccountingConfiguration).mockResolvedValue({
      ...testAccountingConfiguration,
      status: 'ACTIVE',
    });
    renderForm(`${LIST_PATH}/${testAccountingConfiguration.id}/edit`);

    expect(
      await screen.findByText(t.accountingConfig.readOnlyPublished),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.accountingConfig.save }),
    ).toBeDisabled();
    expect(screen.getByLabelText(t.accountingConfig.name)).toBeDisabled();
    expect(updateAccountingConfiguration).not.toHaveBeenCalled();
  });
});
