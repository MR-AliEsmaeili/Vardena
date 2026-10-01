import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  secondOrganization,
  testFinancialArea,
  testFiscalYear,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { OrganizationSelection } from './organization-selection';
import { OrganizationSwitcher } from './organization-switcher';
import { useOrganization } from './use-organization';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('@/api/organization.api', () => ({
  listMyOrganizations: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));

vi.mock('@/api/accounting.api', () => ({
  listFinancialAreas: vi.fn(),
  listFiscalYears: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

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
      {(organization.status === 'selecting' ||
        organization.status === 'invalid') && (
        <OrganizationSelection invalid={organization.status === 'invalid'} />
      )}
    </div>
  );
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(
    paginated([testFiscalYear]),
  );
});

describe('organization context', () => {
  it('uses the single organization the API returns, without a switcher', async () => {
    vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
      testOrganization,
    ]);

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
    vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
      testOrganization,
      secondOrganization,
    ]);

    renderWithProviders(<OrganizationProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('selecting');
    });
    // No organization scope or visual default exists before the user chooses:
    // the local radio state and the confirmed context state are both empty.
    expect(screen.getByTestId('organization-id')).toHaveTextContent('none');
    expect(screen.getByTestId('can-switch')).toHaveTextContent('yes');
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).not.toBeChecked();
    expect(radios[1]).not.toBeChecked();
    expect(
      screen.getByRole('button', { name: t.organization.selectingSubmit }),
    ).toBeDisabled();
  });

  it('keeps radio choices local until Continue confirms the organization', async () => {
    vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
      testOrganization,
      secondOrganization,
    ]);
    const user = userEvent.setup();

    renderWithProviders(<OrganizationProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('selecting');
    });

    const firstRadio = screen.getByRole('radio', {
      name: new RegExp(testOrganization.name),
    });
    const secondRadio = screen.getByRole('radio', {
      name: new RegExp(secondOrganization.name),
    });
    const continueButton = screen.getByRole('button', {
      name: t.organization.selectingSubmit,
    });

    // Native keyboard activation selects only the local radio value.
    firstRadio.focus();
    await user.keyboard('[Space]');
    expect(firstRadio).toBeChecked();
    expect(secondRadio).not.toBeChecked();
    expect(continueButton).toBeEnabled();
    expect(screen.getByTestId('status')).toHaveTextContent('selecting');
    expect(screen.getByTestId('organization-id')).toHaveTextContent('none');

    // Changing the local choice still must not activate an organization.
    await user.click(secondRadio);
    expect(secondRadio).toBeChecked();
    expect(firstRadio).not.toBeChecked();
    expect(screen.getByTestId('status')).toHaveTextContent('selecting');
    expect(screen.getByTestId('organization-id')).toHaveTextContent('none');

    await user.click(continueButton);

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });
    expect(screen.getByTestId('organization-id')).toHaveTextContent('org-2');
  });

  it('activates the confirmed organization and then allows switching', async () => {
    vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
      testOrganization,
      secondOrganization,
    ]);
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
    vi.mocked(organizationApi.listMyOrganizations)
      .mockResolvedValueOnce([testOrganization, secondOrganization])
      .mockResolvedValueOnce([testOrganization]);
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
    vi.mocked(organizationApi.listMyOrganizations).mockRejectedValue(
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

  it('resolves organizations by membership alone — no RBAC permission is required', async () => {
    // Organization Bootstrap & Context Foundation: `GET /organizations/mine`
    // (AR-21) is a membership-based read, not an
    // `Organization.Organization.View` administration read. A session that
    // holds NO permission whatsoever must still resolve its organization
    // scope.
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [],
    });
    vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
      testOrganization,
    ]);

    renderWithProviders(<OrganizationProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });
    expect(screen.getByTestId('organization-id')).toHaveTextContent('org-1');
    expect(organizationApi.listMyOrganizations).toHaveBeenCalled();
  });

  it('reports an empty context when the API returns no organization', async () => {
    vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([]);

    renderWithProviders(<OrganizationProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('empty');
    });
    expect(screen.getByTestId('organization-id')).toHaveTextContent('none');
  });
});
