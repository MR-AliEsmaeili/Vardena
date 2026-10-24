import { screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { paginated, testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import {
  type ReferenceOptions,
  useActiveBranchOptions,
  useActiveItemGroupOptions,
  useActiveItemOptions,
  useActiveUnitOptions,
  useActiveWarehouseOptions,
} from './master-data-references';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('@/api/organization.api', () => ({
  listMyOrganizations: vi.fn(),
  listBranches: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));

vi.mock('@/api/inventory-master.api', () => ({
  listItemsAdmin: vi.fn(),
  listItemGroupsAdmin: vi.fn(),
  listUnitsAdmin: vi.fn(),
  listWarehousesAdmin: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryApi = await import('@/api/inventory-master.api');

const ORGANIZATION_ID = testOrganization.id;

function reference(code: string) {
  return {
    id: `${code.toLowerCase()}-1`,
    organizationId: ORGANIZATION_ID,
    code,
    name: code,
    isActive: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  };
}

type Option = { id: string; code: string; name: string };

/**
 * Renders one reference hook and prints what it exposes.
 *
 * The assertion is on rendered output, not on the request: the defect this
 * covers was a picker that stayed empty after its read had already succeeded,
 * so a test that only awaited the API call would have passed.
 */
function Probe({ use }: { use: () => ReferenceOptions<Option> }) {
  const options = use();
  return (
    <p data-testid="probe">
      {JSON.stringify({
        codes: options.items.map((item) => item.code),
        truncated: options.truncated,
        unavailable: options.unavailable,
      })}
    </p>
  );
}

function renderProbe(use: () => ReferenceOptions<Option>) {
  const ui: ReactElement = <Probe use={use} />;
  return renderWithProviders(ui, { initialEntries: ['/app'] });
}

function readProbe() {
  return JSON.parse(screen.getByTestId('probe').textContent ?? '{}');
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: [
      PERMISSIONS.inventory.itemView,
      PERMISSIONS.inventory.itemGroupView,
      PERMISSIONS.inventory.unitView,
      PERMISSIONS.inventory.warehouseView,
      PERMISSIONS.organization.branchView,
    ],
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(organizationApi.listBranches).mockResolvedValue(
    paginated([reference('BRANCH') as never]),
  );
  vi.mocked(inventoryApi.listItemsAdmin).mockResolvedValue(
    paginated([reference('ITEM') as never]),
  );
  vi.mocked(inventoryApi.listItemGroupsAdmin).mockResolvedValue(
    paginated([reference('PAPER') as never]),
  );
  vi.mocked(inventoryApi.listUnitsAdmin).mockResolvedValue(
    paginated([reference('UNIT') as never]),
  );
  vi.mocked(inventoryApi.listWarehousesAdmin).mockResolvedValue(
    paginated([reference('WH') as never]),
  );
});

describe('inventory reference pickers', () => {
  /**
   * Regression: the shared `toOptions` read `items`/`total` off the query
   * result instead of its `data`, so every picker on the items page and every
   * master-data form rendered only its placeholder while the read had already
   * succeeded.
   */
  it('offers the rows of the item group reference read', async () => {
    renderProbe(() => useActiveItemGroupOptions(ORGANIZATION_ID));
    await waitFor(() => {
      expect(readProbe()).toEqual({
        codes: ['PAPER'],
        truncated: false,
        unavailable: false,
      });
    });
  });

  it('offers the rows of the unit reference read', async () => {
    renderProbe(() => useActiveUnitOptions(ORGANIZATION_ID));
    await waitFor(() => {
      expect(readProbe()).toEqual({
        codes: ['UNIT'],
        truncated: false,
        unavailable: false,
      });
    });
  });

  it('offers the rows of the warehouse reference read', async () => {
    renderProbe(() => useActiveWarehouseOptions(ORGANIZATION_ID));
    await waitFor(() => {
      expect(readProbe()).toEqual({
        codes: ['WH'],
        truncated: false,
        unavailable: false,
      });
    });
  });

  it('offers the rows of the item reference read', async () => {
    renderProbe(() => useActiveItemOptions(ORGANIZATION_ID));
    await waitFor(() => {
      expect(readProbe()).toEqual({
        codes: ['ITEM'],
        truncated: false,
        unavailable: false,
      });
    });
  });

  it('offers the rows of the branch reference read', async () => {
    renderProbe(() => useActiveBranchOptions(ORGANIZATION_ID));
    await waitFor(() => {
      expect(readProbe()).toEqual({
        codes: ['BRANCH'],
        truncated: false,
        unavailable: false,
      });
    });
  });
});
