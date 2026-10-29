import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { InventoryHomePage } from './inventory-home-page';

/**
 * Licensing regression coverage for the inventory landing page.
 *
 * Module licensing needs no separate frontend check: an installation whose
 * license lacks the `inventory` module has every `Inventory.*` code filtered
 * out of the effective permission set by the backend
 * (`LicensingService.filterLicensedPermissions`), and the page derives its
 * entire surface list from those codes. This is the licensed-vs-unlicensed
 * difference as the UI can observe it — AR-21 still holds: the gate is a
 * convenience, every endpoint re-authorizes.
 */

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

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');

const inventoryPermissions = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.warehouseView,
  PERMISSIONS.inventory.itemView,
  PERMISSIONS.inventory.unitView,
  PERMISSIONS.inventory.movementView,
  PERMISSIONS.inventory.movementCreate,
  PERMISSIONS.inventory.transferCreate,
  PERMISSIONS.inventory.valuationView,
];

function renderHome() {
  return renderWithProviders(<InventoryHomePage />, {
    initialEntries: ['/app/inventory'],
  });
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
});

describe('Inventory home — module licensing surfaces as filtered permissions', () => {
  it('offers every surface a fully-permitted warehouse session can open', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: inventoryPermissions,
    });
    renderHome();

    // Each surface card: the title heading, and a link INTO the surface.
    const expected: readonly [string, string][] = [
      [t.inventory.newReceipt, '/app/inventory/movements/new?type=receipt'],
      [t.inventory.newIssue, '/app/inventory/movements/new?type=issue'],
      [t.inventory.newTransfer, '/app/inventory/transfers/new'],
      [t.inventory.movementsTitle, '/app/inventory/movements'],
      [t.inventory.kardexTitle, '/app/inventory/kardex'],
      [t.inventory.valuationTitle, '/app/inventory/valuation'],
      [t.inventoryValuationMethods.title, '/app/inventory/valuation-methods'],
    ];
    const headingWaiters = expected.map(([title]) =>
      screen.findByRole('heading', { name: title }),
    );
    for (const heading of await Promise.all(headingWaiters)) {
      expect(heading).toBeInTheDocument();
    }
    const hrefs = screen
      .getAllByRole('link', { name: t.home.openSection })
      .map((link) => link.getAttribute('href'));
    for (const [, href] of expected) {
      expect(hrefs).toContain(href);
    }
  });

  it('renders NO surfaces when the license filtered every Inventory.* code out of the session', async () => {
    // What `GET /permissions/effective` returns on an installation whose
    // license has no inventory module entitlement.
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        PERMISSIONS.organization.view,
        PERMISSIONS.accounting.accountView,
      ],
    });
    renderHome();

    await screen.findByText(t.inventory.title);
    expect(
      screen.queryByRole('heading', { name: t.inventory.newReceipt }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.inventory.newTransfer }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.inventory.valuationTitle }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: t.home.openSection }),
    ).not.toBeInTheDocument();
  });

  it('hides only the surfaces the session is missing codes for', async () => {
    // A receiving clerk: may post movements, may not transfer or value.
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        PERMISSIONS.organization.view,
        PERMISSIONS.inventory.movementView,
        PERMISSIONS.inventory.movementCreate,
      ],
    });
    renderHome();

    expect(
      await screen.findByRole('heading', { name: t.inventory.newReceipt }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.inventory.newTransfer }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.inventory.valuationTitle }),
    ).not.toBeInTheDocument();
  });
});
