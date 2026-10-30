import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createUnitConversion,
  listItemsAdmin,
  listUnitsAdmin,
  listUnitConversions,
  listWarehousesAdmin,
  resolveUnitConversion,
} from './inventory-master.api';
import {
  configureInventoryValuationMethod,
  createMaterialRequest,
  createReservation,
  deleteMaterialRequest,
  getMaterialRequest,
  getReservation,
  listInventoryUnits,
  listInventoryValuationMethods,
  listMaterialRequestEvents,
  listMaterialRequests,
  listReservations,
  releaseReservation,
  resolveInventoryValuationMethod,
  submitMaterialRequest,
  updateMaterialRequest,
} from './inventory.api';

vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
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

  it('calls reservation list, detail, create and release endpoints with the declared scope and body keys', async () => {
    await listReservations({
      organizationId: org,
      page: 2,
      pageSize: 100,
      sort: 'status:asc',
      warehouseId: from,
      itemId: to,
      status: 'active',
    });
    expect(client.apiGet).toHaveBeenLastCalledWith('/inventory/reservations', {
      params: {
        organizationId: org,
        page: 2,
        pageSize: 100,
        sort: 'status:asc',
        warehouseId: from,
        itemId: to,
        status: 'active',
      },
    });

    await getReservation(org, to);
    expect(client.apiGet).toHaveBeenLastCalledWith(
      `/inventory/reservations/${to}`,
      { params: { organizationId: org } },
    );

    const createBody = {
      organizationId: org,
      warehouseId: from,
      itemId: to,
      quantity: '9007199254740993.0001',
      unitId: from,
      operationKey: 'reservation-create-op-1',
      reason: 'cycle count',
      referenceType: 'external_order',
      referenceId: 'ORDER-7',
    };
    await createReservation(createBody);
    expect(client.apiPost).toHaveBeenLastCalledWith(
      '/inventory/reservations',
      createBody,
    );

    const releaseBody = { operationKey: 'reservation-release-op-1' };
    await releaseReservation(org, to, releaseBody);
    expect(client.apiPost).toHaveBeenLastCalledWith(
      `/inventory/reservations/${to}/release`,
      releaseBody,
      { params: { organizationId: org } },
    );
  });

  it('calls valuation-method list, resolve, and configure endpoints under /inventory/valuation/methods', async () => {
    await listInventoryValuationMethods({
      organizationId: org,
      itemId: from,
      activeAt: '2026-10-29',
      sort: 'validFrom:desc',
    });
    expect(client.apiGet).toHaveBeenLastCalledWith(
      '/inventory/valuation/methods',
      {
        params: {
          organizationId: org,
          itemId: from,
          activeAt: '2026-10-29',
          sort: 'validFrom:desc',
        },
      },
    );

    await resolveInventoryValuationMethod({
      organizationId: org,
      itemId: from,
      asOf: '2026-10-29',
    });
    expect(client.apiGet).toHaveBeenLastCalledWith(
      '/inventory/valuation/methods/resolve',
      {
        params: {
          organizationId: org,
          itemId: from,
          asOf: '2026-10-29',
        },
      },
    );

    await configureInventoryValuationMethod({
      organizationId: org,
      itemId: from,
      method: 'moving_weighted_average',
      validFrom: '2026-10-29',
    });
    expect(client.apiPost).toHaveBeenLastCalledWith(
      '/inventory/valuation/methods',
      {
        organizationId: org,
        itemId: from,
        method: 'moving_weighted_average',
        validFrom: '2026-10-29',
      },
    );
  });

  it('calls the material-request authoring endpoints with their declared scope', async () => {
    await listMaterialRequests({
      organizationId: org,
      page: 1,
      pageSize: 50,
      sort: 'createdAt:desc',
      status: 'draft',
      requestedBy: from,
    });
    expect(client.apiGet).toHaveBeenLastCalledWith(
      '/inventory/material-requests',
      {
        params: {
          organizationId: org,
          page: 1,
          pageSize: 50,
          sort: 'createdAt:desc',
          status: 'draft',
          requestedBy: from,
        },
      },
    );

    await getMaterialRequest(org, to);
    expect(client.apiGet).toHaveBeenLastCalledWith(
      `/inventory/material-requests/${to}`,
      { params: { organizationId: org } },
    );

    await listMaterialRequestEvents(org, to);
    expect(client.apiGet).toHaveBeenLastCalledWith(
      `/inventory/material-requests/${to}/events`,
      { params: { organizationId: org } },
    );

    const createBody = {
      organizationId: org,
      description: 'line demand',
      lines: [
        {
          itemId: from,
          warehouseId: to,
          quantity: '9007199254740993.0001',
          unitId: from,
          reservationRequested: true,
        },
      ],
    };
    await createMaterialRequest(createBody);
    expect(client.apiPost).toHaveBeenLastCalledWith(
      '/inventory/material-requests',
      createBody,
    );

    const updateBody = {
      description: null,
      lines: [
        {
          itemId: from,
          warehouseId: to,
          quantity: '5.0000',
          unitId: from,
        },
      ],
    };
    await updateMaterialRequest(org, to, updateBody);
    expect(client.apiPatch).toHaveBeenLastCalledWith(
      `/inventory/material-requests/${to}`,
      updateBody,
      { params: { organizationId: org } },
    );

    await deleteMaterialRequest(org, to);
    expect(client.apiDelete).toHaveBeenLastCalledWith(
      `/inventory/material-requests/${to}`,
      { params: { organizationId: org } },
    );

    await submitMaterialRequest(org, to);
    expect(client.apiPost).toHaveBeenLastCalledWith(
      `/inventory/material-requests/${to}/submit`,
      {},
      { params: { organizationId: org } },
    );
  });
});
