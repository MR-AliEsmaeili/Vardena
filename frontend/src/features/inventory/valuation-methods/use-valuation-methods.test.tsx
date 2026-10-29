import { renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import { RequirePermission } from '@/app/routes/require-permission';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { paginated, testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import {
  buildValuationMethodsListQuery,
  DEFAULT_VALUATION_METHOD_SORT,
  useValuationMethodsListState,
} from './use-valuation-methods';
import { ValuationMethodFormPage } from './valuation-method-form-page';
import { ValuationMethodsPage } from './valuation-methods-page';

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
vi.mock('@/api/inventory-master.api', () => ({
  listItemsAdmin: vi.fn(),
  listItemGroupsAdmin: vi.fn(),
  listUnitsAdmin: vi.fn(),
  listWarehousesAdmin: vi.fn(),
}));
vi.mock('@/api/inventory.api', () => ({
  listInventoryValuationMethods: vi.fn(),
  resolveInventoryValuationMethod: vi.fn(),
  configureInventoryValuationMethod: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryMasterApi = await import('@/api/inventory-master.api');
const inventoryApi = await import('@/api/inventory.api');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(inventoryMasterApi.listItemsAdmin).mockResolvedValue(paginated([]));
  vi.mocked(inventoryApi.listInventoryValuationMethods).mockResolvedValue(
    paginated([]),
  );
});

describe('queryKeys.inventory valuation-methods organization scoping', () => {
  it('partitions list and resolve keys by organizationId so cross-org placeholder data is rejected', () => {
    const orgAKey = queryKeys.inventory.valuationMethods('org-a', {
      page: 1,
      pageSize: 25,
      sort: 'validFrom:desc',
    });
    const orgAResolveKey = queryKeys.inventory.valuationMethodResolve('org-a', {
      itemId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      asOf: '2026-10-29',
    });

    expect(orgAKey.slice(0, 3)).toEqual(
      queryKeys.inventory.valuationMethodsPrefix('org-a'),
    );
    expect(orgAResolveKey.slice(0, 3)).toEqual(
      queryKeys.inventory.valuationMethodsPrefix('org-a'),
    );
    expect(isOtherOrganizationScope(orgAKey, 'org-a')).toBe(false);
    expect(isOtherOrganizationScope(orgAKey, 'org-b')).toBe(true);
  });
});

describe('useValuationMethodsListState & buildValuationMethodsListQuery', () => {
  function routerWrapper(initialEntry: string) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
      );
    };
  }

  it('normalizes unsupported sort parameters (such as validTo:desc) back to validFrom:desc', () => {
    const { result } = renderHook(() => useValuationMethodsListState(), {
      wrapper: routerWrapper(
        '/app/inventory/valuation-methods?sort=validTo:desc&page=-3',
      ),
    });

    expect(result.current.sort).toBe(DEFAULT_VALUATION_METHOD_SORT);
    expect(result.current.page).toBe(1);
    expect(result.current.hasInvalidActiveAt).toBe(false);
  });

  it('flags malformed activeAt dates without silently coercing them', () => {
    const { result } = renderHook(() => useValuationMethodsListState(), {
      wrapper: routerWrapper(
        '/app/inventory/valuation-methods?activeAt=1405/08/07',
      ),
    });

    expect(result.current.activeAt).toBe('1405/08/07');
    expect(result.current.hasInvalidActiveAt).toBe(true);
  });

  it('omits empty optional filters from the wire query', () => {
    expect(
      buildValuationMethodsListQuery('org-1', {
        itemId: '',
        activeAt: '',
        sort: 'createdAt:asc',
        page: 2,
        pageSize: 50,
      }),
    ).toEqual({
      organizationId: 'org-1',
      page: 2,
      pageSize: 50,
      sort: 'createdAt:asc',
    });
  });
});

describe('RequirePermission route enforcement for INV-04 routes', () => {
  it('blocks /app/inventory/valuation-methods without Inventory.Valuation.View', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [PERMISSIONS.organization.view],
    });

    renderWithProviders(
      <Routes>
        <Route
          element={
            <RequirePermission
              permissions={[PERMISSIONS.inventory.valuationView]}
            />
          }
        >
          <Route
            path="/app/inventory/valuation-methods"
            element={<ValuationMethodsPage />}
          />
        </Route>
      </Routes>,
      { initialEntries: ['/app/inventory/valuation-methods'] },
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(PERMISSIONS.inventory.valuationView);
    expect(
      screen.queryByTestId('valuation-methods-page'),
    ).not.toBeInTheDocument();
  });

  it('blocks /app/inventory/valuation-methods/new for View-only sessions and allows Configure-only sessions', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValueOnce({
      userId: testUser.id,
      permissions: [
        PERMISSIONS.organization.view,
        PERMISSIONS.inventory.valuationView,
      ],
    });

    const viewOnlyRender = renderWithProviders(
      <Routes>
        <Route
          element={
            <RequirePermission
              permissions={[PERMISSIONS.inventory.valuationConfigure]}
            />
          }
        >
          <Route
            path="/app/inventory/valuation-methods/new"
            element={<ValuationMethodFormPage />}
          />
        </Route>
      </Routes>,
      { initialEntries: ['/app/inventory/valuation-methods/new'] },
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(PERMISSIONS.inventory.valuationConfigure);
    viewOnlyRender.unmount();

    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValueOnce({
      userId: testUser.id,
      permissions: [
        PERMISSIONS.organization.view,
        PERMISSIONS.inventory.valuationConfigure,
      ],
    });

    renderWithProviders(
      <Routes>
        <Route
          element={
            <RequirePermission
              permissions={[PERMISSIONS.inventory.valuationConfigure]}
            />
          }
        >
          <Route
            path="/app/inventory/valuation-methods/new"
            element={<ValuationMethodFormPage />}
          />
        </Route>
      </Routes>,
      { initialEntries: ['/app/inventory/valuation-methods/new'] },
    );

    expect(
      await screen.findByTestId('valuation-method-form-page'),
    ).toBeInTheDocument();
  });
});
