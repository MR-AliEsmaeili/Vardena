import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import {
  allOrganizationAdminPermissions,
  paginated,
  testBranch,
  testOrganization,
  testParty,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { BranchesPage } from './branches/branches-page';
import { PartiesPage } from './parties/parties-page';

/**
 * List behavior of the organization master-data screens.
 *
 * The contract under test: paging, search, status and sort are the SERVER's
 * (`PageQueryDto` + each controller's own filters) and the URL's — never a
 * client-side filter over a fetched window — and every request carries the
 * active organization.
 */

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('@/api/organization.api', () => ({
  MAX_PAGE_SIZE: 500,
  BRANCH_SORT_FIELDS: ['code', 'name', 'createdAt', 'updatedAt'],
  PARTY_SORT_FIELDS: ['code', 'displayName', 'createdAt', 'updatedAt'],
  listOrganizations: vi.fn(),
  listBranches: vi.fn(),
  getBranch: vi.fn(),
  createBranch: vi.fn(),
  updateBranch: vi.fn(),
  enableBranch: vi.fn(),
  disableBranch: vi.fn(),
  listParties: vi.fn(),
  getParty: vi.fn(),
  createParty: vi.fn(),
  updateParty: vi.fn(),
  enableParty: vi.fn(),
  disableParty: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');

function CurrentSearch() {
  const location = useLocation();
  return <output aria-label="location-search">{location.search}</output>;
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allOrganizationAdminPermissions,
  });
  vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
    paginated([testOrganization]),
  );
  vi.mocked(organizationApi.listBranches).mockResolvedValue(
    paginated([testBranch]),
  );
  vi.mocked(organizationApi.listParties).mockResolvedValue(
    paginated([testParty]),
  );
});

describe('branch list', () => {
  it('asks the server for the active organization with the default page and sort', async () => {
    renderWithProviders(<BranchesPage />, {
      initialEntries: ['/app/organization/branches'],
    });

    expect(await screen.findByText(testBranch.name)).toBeInTheDocument();
    expect(organizationApi.listBranches).toHaveBeenCalledWith(
      {
        organizationId: testOrganization.id,
        page: 1,
        pageSize: 50,
        sort: 'code:asc',
      },
      expect.any(AbortSignal),
    );
  });

  it('initializes controls and the server query from a deep-linked URL', async () => {
    renderWithProviders(<BranchesPage />, {
      initialEntries: [
        '/app/organization/branches?search=مرکزی&status=inactive&page=3&pageSize=25&sort=name:desc',
      ],
    });

    await waitFor(() =>
      expect(organizationApi.listBranches).toHaveBeenCalledWith(
        {
          organizationId: testOrganization.id,
          page: 3,
          pageSize: 25,
          sort: 'name:desc',
          search: 'مرکزی',
          isActive: false,
        },
        expect.any(AbortSignal),
      ),
    );
    expect(screen.getByDisplayValue('مرکزی')).toBeInTheDocument();
  });

  it('writes an applied filter into the URL and re-queries the server', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <BranchesPage />
        <CurrentSearch />
      </>,
      { initialEntries: ['/app/organization/branches'] },
    );

    await screen.findByText(testBranch.name);
    await user.type(
      screen.getByPlaceholderText(t.orgAdmin.searchPlaceholder),
      'BR-01',
    );
    await user.selectOptions(
      screen.getByDisplayValue(t.orgAdmin.allStatuses),
      'active',
    );
    await user.click(screen.getByRole('button', { name: t.orgAdmin.filter }));

    await waitFor(() =>
      expect(screen.getByLabelText('location-search')).toHaveTextContent(
        'search=BR-01',
      ),
    );
    expect(screen.getByLabelText('location-search')).toHaveTextContent(
      'status=active',
    );
    await waitFor(() =>
      expect(organizationApi.listBranches).toHaveBeenLastCalledWith(
        {
          organizationId: testOrganization.id,
          page: 1,
          pageSize: 50,
          sort: 'code:asc',
          search: 'BR-01',
          isActive: true,
        },
        expect.any(AbortSignal),
      ),
    );
  });

  it('returns to page 1 when a filter changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <BranchesPage />
        <CurrentSearch />
      </>,
      { initialEntries: ['/app/organization/branches?page=4'] },
    );

    await screen.findByText(testBranch.name);
    await user.click(screen.getByRole('button', { name: t.orgAdmin.filter }));

    await waitFor(() =>
      expect(screen.getByLabelText('location-search')).not.toHaveTextContent(
        'page=4',
      ),
    );
    expect(organizationApi.listBranches).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
      expect.any(AbortSignal),
    );
  });

  it('sorts on the server through the URL, using only allow-listed fields', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <BranchesPage />
        <CurrentSearch />
      </>,
      { initialEntries: ['/app/organization/branches'] },
    );

    await screen.findByText(testBranch.name);
    await user.click(screen.getByRole('button', { name: /^نام/ }));

    await waitFor(() =>
      expect(screen.getByLabelText('location-search')).toHaveTextContent(
        'sort=name%3Aasc',
      ),
    );
    expect(organizationApi.listBranches).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'name:asc' }),
      expect.any(AbortSignal),
    );
  });

  it('ignores a sort field the backend would reject and falls back to the default', async () => {
    renderWithProviders(<BranchesPage />, {
      initialEntries: ['/app/organization/branches?sort=secretColumn:desc'],
    });

    await waitFor(() =>
      expect(organizationApi.listBranches).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'code:asc' }),
        expect.any(AbortSignal),
      ),
    );
  });

  it('shows the empty state instead of an empty grid', async () => {
    vi.mocked(organizationApi.listBranches).mockResolvedValue(paginated([]));

    renderWithProviders(<BranchesPage />, {
      initialEntries: ['/app/organization/branches'],
    });

    expect(await screen.findByText(t.orgAdmin.noBranches)).toBeInTheDocument();
  });

  it('shows a retryable failure and never the raw backend message', async () => {
    vi.mocked(organizationApi.listBranches).mockRejectedValue(
      new ApiError({
        code: 'InternalError',
        status: 500,
        message: 'Prisma exploded',
      }),
    );

    renderWithProviders(<BranchesPage />, {
      initialEntries: ['/app/organization/branches'],
    });

    expect(
      await screen.findByText(t.orgAdmin.branchesLoadFailed),
    ).toBeInTheDocument();
    expect(screen.queryByText('Prisma exploded')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.app.retry }),
    ).toBeInTheDocument();
  });
});

describe('party list', () => {
  it('maps the capability filter onto the endpoint booleans', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PartiesPage />, {
      initialEntries: ['/app/organization/parties'],
    });

    await screen.findByText(testParty.displayName);
    await user.selectOptions(
      screen.getByDisplayValue(t.orgAdmin.allCapabilities),
      'supplier',
    );

    await waitFor(() =>
      expect(organizationApi.listParties).toHaveBeenLastCalledWith(
        {
          organizationId: testOrganization.id,
          page: 1,
          pageSize: 50,
          sort: 'code:asc',
          isSupplier: true,
        },
        expect.any(AbortSignal),
      ),
    );
    // One record with two capability flags — never two resources.
    expect(organizationApi.listParties).not.toHaveBeenCalledWith(
      expect.objectContaining({ isCustomer: true, isSupplier: true }),
      expect.any(AbortSignal),
    );
  });

  it('sends the party type declared by the DTO and nothing else', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PartiesPage />, {
      initialEntries: ['/app/organization/parties'],
    });

    await screen.findByText(testParty.displayName);
    await user.selectOptions(
      screen.getByDisplayValue(t.orgAdmin.allPartyTypes),
      'person',
    );

    await waitFor(() =>
      expect(organizationApi.listParties).toHaveBeenLastCalledWith(
        expect.objectContaining({ partyType: 'person' }),
        expect.any(AbortSignal),
      ),
    );
  });

  it('drops an unknown party type from the URL instead of forwarding it', async () => {
    renderWithProviders(<PartiesPage />, {
      initialEntries: ['/app/organization/parties?partyType=alien'],
    });

    await waitFor(() => expect(organizationApi.listParties).toHaveBeenCalled());
    expect(organizationApi.listParties).toHaveBeenLastCalledWith(
      {
        organizationId: testOrganization.id,
        page: 1,
        pageSize: 50,
        sort: 'code:asc',
      },
      expect.any(AbortSignal),
    );
  });

  it('shows the capabilities of the row as badges', async () => {
    renderWithProviders(<PartiesPage />, {
      initialEntries: ['/app/organization/parties'],
    });

    const row = (await screen.findByText(testParty.displayName)).closest('tr');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent(t.orgAdmin.customer);
    expect(row).not.toHaveTextContent(t.orgAdmin.supplier);
  });
});
