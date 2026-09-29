import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { AccountsPage } from './accounts-page';

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
vi.mock('@/api/accounting.api', () => ({ listAccounts: vi.fn() }));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

function HistoryControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="location-search">{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        forward
      </button>
    </>
  );
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
    paginated([testOrganization]),
  );
  vi.mocked(accountingApi.listAccounts).mockResolvedValue(paginated([]));
});

describe('Accounts URL-owned filters', () => {
  it('initializes controls and server query from a deep-linked URL', async () => {
    renderWithProviders(
      <>
        <AccountsPage />
        <HistoryControls />
      </>,
      {
        initialEntries: [
          '/app/accounting/accounts?search=cash&level=3&postable=true',
        ],
      },
    );

    expect(await screen.findByLabelText(t.app.search)).toHaveValue('cash');
    expect(screen.getByLabelText(t.masterData.level)).toHaveValue(3);
    expect(screen.getByLabelText(t.masterData.postability)).toHaveValue('true');
    await waitFor(() =>
      expect(accountingApi.listAccounts).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'cash', level: 3, isPostable: true }),
        expect.any(AbortSignal),
      ),
    );
  });

  it('keeps Apply and Clear synchronized with URL and controls', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AccountsPage />
        <HistoryControls />
      </>,
      {
        initialEntries: ['/app/accounting/accounts'],
      },
    );

    await user.type(await screen.findByLabelText(t.app.search), 'bank');
    await user.type(screen.getByLabelText(t.masterData.level), '2');
    await user.selectOptions(
      screen.getByLabelText(t.masterData.postability),
      'false',
    );
    await user.click(screen.getByRole('button', { name: t.masterData.filter }));

    await waitFor(() =>
      expect(screen.getByLabelText(t.app.search)).toHaveValue('bank'),
    );
    expect(screen.getByLabelText(t.masterData.level)).toHaveValue(2);
    expect(screen.getByLabelText(t.masterData.postability)).toHaveValue(
      'false',
    );
    expect(screen.getByLabelText('location-search')).toHaveTextContent(
      'search=bank',
    );
    expect(screen.getByLabelText('location-search')).toHaveTextContent(
      'level=2',
    );
    expect(screen.getByLabelText('location-search')).toHaveTextContent(
      'postable=false',
    );

    await user.click(screen.getByRole('button', { name: t.masterData.clear }));
    await waitFor(() =>
      expect(screen.getByLabelText(t.app.search)).toHaveValue(''),
    );
    expect(screen.getByLabelText(t.masterData.level)).toHaveValue(null);
    expect(screen.getByLabelText(t.masterData.postability)).toHaveValue('');
    expect(screen.getByLabelText('location-search')).toBeEmptyDOMElement();
  });

  it('follows browser Back and Forward URL changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AccountsPage />
        <HistoryControls />
      </>,
      {
        initialEntries: ['/app/accounting/accounts?search=first'],
      },
    );

    const applySearch = async (value: string) => {
      const input = await screen.findByLabelText(t.app.search);
      await user.clear(input);
      await user.type(input, value);
      await user.click(
        screen.getByRole('button', { name: t.masterData.filter }),
      );
      await waitFor(() =>
        expect(screen.getByLabelText(t.app.search)).toHaveValue(value),
      );
    };

    await applySearch('second');
    await applySearch('third');
    await user.click(screen.getByRole('button', { name: 'back' }));
    await waitFor(() =>
      expect(screen.getByLabelText(t.app.search)).toHaveValue('second'),
    );
    await user.click(screen.getByRole('button', { name: 'forward' }));
    await waitFor(() =>
      expect(screen.getByLabelText(t.app.search)).toHaveValue('third'),
    );
  });
});
