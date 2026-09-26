import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('offers a switcher only when the API returns several organizations', async () => {
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([testOrganization, secondOrganization]),
    );
    const user = userEvent.setup();

    renderWithProviders(<OrganizationProbe />);

    const switcher = await screen.findByRole('combobox', {
      name: t.organization.switcher,
    });
    expect(screen.getByTestId('organization-id')).toHaveTextContent('org-1');

    await user.selectOptions(switcher, 'org-2');

    await waitFor(() => {
      expect(screen.getByTestId('organization-id')).toHaveTextContent('org-2');
    });
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
