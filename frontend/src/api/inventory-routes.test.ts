import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createUnitConversion,
  listItemsAdmin,
  listUnitsAdmin,
  listUnitConversions,
  listWarehousesAdmin,
  resolveUnitConversion,
} from './inventory-master.api';
import { listInventoryUnits } from './inventory.api';

vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
}));
const client = await import('./client');
const org = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const from = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const to = '01ARZ3NDEKTSV4RRFFQ69G5FAX';

beforeEach(() => vi.clearAllMocks());

describe('backend-mounted inventory routes', () => {
  it('reads references under /inventory rather than the nonexistent root resources', async () => {
    await listWarehousesAdmin({ organizationId: org });
    await listUnitsAdmin({ organizationId: org });
    await listItemsAdmin({ organizationId: org });
    await listInventoryUnits({ organizationId: org });
    expect(vi.mocked(client.apiGet).mock.calls.map((call) => call[0])).toEqual([
      '/inventory/warehouses',
      '/inventory/units',
      '/inventory/items',
      '/inventory/units',
    ]);
  });

  it('keeps the resolve request distinct from list and create, preserving the backend query', async () => {
    await listUnitConversions({ organizationId: org, scope: 'global' });
    await resolveUnitConversion({
      organizationId: org,
      fromUnitId: from,
      toUnitId: to,
      asOf: '2026-10-26',
    });
    expect(client.apiGet).toHaveBeenLastCalledWith(
      '/inventory/unit-conversions/resolve',
      {
        params: {
          organizationId: org,
          fromUnitId: from,
          toUnitId: to,
          asOf: '2026-10-26',
        },
      },
    );
    expect(vi.mocked(client.apiGet).mock.calls[0]?.[0]).toBe(
      '/inventory/unit-conversions',
    );
    await createUnitConversion({
      organizationId: org,
      fromUnitId: from,
      toUnitId: to,
      factor: '12',
      validFrom: '2026-10-26',
    });
    expect(vi.mocked(client.apiPost).mock.calls[0]?.[0]).toBe(
      '/inventory/unit-conversions',
    );
  });
});
