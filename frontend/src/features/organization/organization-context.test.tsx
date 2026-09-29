import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  secondOrganization,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { OrganizationSwitcher } from './organization-switcher';
import { useOrganization } from './use-organization';

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

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');

function OrganizationProbe() {
  const organization = useOrganization();
  return (
    <div>
      <span data-testid="status">{organization.status}</span>
      <span data-testid="organization-id">
        {organization.organizationId ?? 'none'}
      </span>
      <span data-testid="can-switch">
        {organization.canSwitch ? 'yes' : 'no'}
      </span>
      <button type="button" onClick={() => organization.refresh()}>
        refresh
      </button>
      <button
        type="button"
        onClick={() => organization.selectOrganization('org-2')}
      >
        select-second
      </button>
      <OrganizationSwitcher />
    </div>
  );
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
});

describe('organization context', () => {
  it('uses the single organization the API returns, without a switcher', async () => {
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([testOrganization]),
    );

    renderWithProviders(<OrganizationProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });
    expect(screen.getByTestId('organization-id')).toHaveTextContent('org-1');
    expect(screen.getByTestId('can-switch')).toHaveTextContent('no');
    expect(
      screen.queryByRole('combobox', { name: t.organization.switcher }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(testOrganization.name)).toBeInTheDocument();
  });

  it('requires an explicit selection while several organizations exist', async () => {
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([testOrganization, secondOrganization]),
    );

    renderWithProviders(<OrganizationProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('selecting');
    });
    // No organization scope is active before the user confirms a choice, so
    // no organization-scoped request can be sent with the wrong scope.
    expect(screen.getByTestId('organization-id')).toHaveTextContent('none');
    expect(screen.getByTestId('can-switch')).toHaveTextContent('yes');
  });

  it('activates the confirmed organization and then allows switching', async () => {
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([testOrganization, secondOrganization]),
    );
    const user = userEvent.setup();

    renderWithProviders(<OrganizationProbe />);

    // Wait until the list has actually arrived (the probe buttons exist from
    // the first paint, but selecting before the list resolves is a no-op by
    // design — only API-returned ids can ever be selected).
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('selecting');
    });

    await user.click(screen.getByText('select-second'));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });
    expect(screen.getByTestId('organization-id')).toHaveTextContent('org-2');

    const switcher = screen.getByRole('combobox', {
      name: t.organization.switcher,
    });
    expect(switcher).toHaveValue('org-2');

    await user.selectOptions(switcher, 'org-1');
    await waitFor(() => {
      expect(screen.getByTestId('organization-id')).toHaveTextContent('org-1');
    });
  });

  it('drops an organization selection that is no longer in the API list', async () => {
    vi.mocked(organizationApi.listOrganizations)
      .mockResolvedValueOnce(paginated([testOrganization, secondOrganization]))
      .mockResolvedValueOnce(paginated([testOrganization]));
    const user = userEvent.setup();

    renderWithProviders(<OrganizationProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('selecting');
    });
    await user.click(screen.getByText('select-second'));
    await waitFor(() => {
      expect(screen.getByTestId('organization-id')).toHaveTextContent('org-2');
    });

    // The list is refreshed and the selected organization is gone.
    await user.click(screen.getByText('refresh'));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('invalid');
    });
    expect(screen.getByTestId('organization-id')).toHaveTextContent('none');
  });

  it('reports an error state when the organization list cannot be fetched', async () => {
    vi.mocked(organizationApi.listOrganizations).mockRejectedValue(
      new ApiError({
        code: 'InternalError',
        message: 'x',
        status: 500,
        correlationId: 'corr-org',
      }),
    );

    renderWithProviders(<OrganizationProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('error');
    });
    expect(screen.getByTestId('organization-id')).toHaveTextContent('none');
  });

  it('reports a forbidden context and sends no request when the view permission is missing', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: ['Accounting.GeneralLedger.View'],
    });
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([testOrganization]),
    );

    renderWithProviders(<OrganizationProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('forbidden');
    });
    expect(screen.getByTestId('organization-id')).toHaveTextContent('none');
    expect(organizationApi.listOrganizations).not.toHaveBeenCalled();
  });

  it('reports an empty context when the API returns no organization', async () => {
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([]),
    );

    renderWithProviders(<OrganizationProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('empty');
    });
    expect(screen.getByTestId('organization-id')).toHaveTextContent('none');
  });
});
