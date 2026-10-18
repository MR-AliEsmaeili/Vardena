import { describe, expect, it, vi } from 'vitest';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { MOVEMENT_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import { KARDEX_PERMISSIONS } from '../domain/inventory-kardex-permissions.js';
import { InventoryKardexService } from './inventory-kardex.service.js';

const baseQuery = {
  organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  itemId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  warehouseId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  page: 1,
  pageSize: 2,
};

function fixture(overrides: Record<string, unknown> = {}) {
  const repository = {
    read: vi.fn().mockResolvedValue({
      items: [
        {
          movementId: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
          movementDate: '2026-01-05',
          createdAt: new Date('2026-01-05T01:00:00Z'),
          movementType: 'outbound',
          signedBaseQuantity: '-30.0000',
          baseUnitId: 'base',
          runningBaseQuantity: '90.0000',
          transferId: null,
          reversalOfMovementId: null,
          referenceType: null,
          referenceId: null,
        },
      ],
      total: 3,
      openingBaseQuantity: '100.0000',
      closingBaseQuantity: '140.0000',
      baseUnitId: 'base',
      closingMovementDate: '2026-01-05',
      snapshot: '10:20:',
    }),
  };
  const organizations = { assertOrganizationInScope: vi.fn() };
  const items = {
    requireUsableItemInOrganization: vi.fn().mockResolvedValue({
      baseUnitId: 'base',
    }),
  };
  const warehouses = { requireUsableWarehouseInOrganization: vi.fn() };
  const units = { requireUsableUnitInOrganization: vi.fn() };
  const authorization = { requireAllPermissions: vi.fn() };
  const service = new InventoryKardexService(
    repository as never,
    {
      findItemVersions: vi.fn().mockResolvedValue([]),
      findGlobalVersions: vi.fn().mockResolvedValue([]),
    } as never,
    organizations as never,
    items as never,
    warehouses as never,
    units as never,
    authorization as never,
  );
  Object.assign(repository, overrides);
  return {
    service,
    repository,
    organizations,
    items,
    warehouses,
    units,
    authorization,
  };
}

describe('InventoryKardexService', () => {
  it('preserves the legacy permission and opening/page/closing response contract', async () => {
    const { service, authorization } = fixture();
    const result = await service.read({
      ...baseQuery,
      dateFrom: '2026-01-02',
    });
    expect(authorization.requireAllPermissions).toHaveBeenCalledWith([
      MOVEMENT_PERMISSIONS.VIEW,
    ]);
    expect(result).toMatchObject({
      opening: '100.0000',
      closing: '140.0000',
      total: 3,
      items: [{ signedQuantity: '-30.0000', runningQuantity: '90.0000' }],
      openingBasis: 'ledger_movements_before_date_from',
    });
  });

  it('requires the original snapshot on later pages', async () => {
    const { service, repository } = fixture();
    await expect(service.read({ ...baseQuery, page: 2 })).rejects.toMatchObject(
      {
        code: 'BadRequest',
      },
    );
    expect(repository.read).not.toHaveBeenCalled();
  });

  it('rejects an inverted inclusive date range', async () => {
    const { service } = fixture();
    await expect(
      service.read({
        ...baseQuery,
        dateFrom: '2026-01-03',
        dateTo: '2026-01-02',
      }),
    ).rejects.toMatchObject({ code: 'BadRequest' });
  });

  it('uses the dedicated permission and returns chronological base-unit lines', async () => {
    const { service, authorization, organizations, repository } = fixture();
    const result = await service.readQuantity(baseQuery);

    expect(authorization.requireAllPermissions).toHaveBeenCalledWith([
      KARDEX_PERMISSIONS.VIEW,
    ]);
    expect(organizations.assertOrganizationInScope).toHaveBeenCalledWith(
      baseQuery.organizationId,
    );
    expect(repository.read).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      total: 3,
      page: 1,
      pageSize: 2,
      opening: '100.0000',
      closing: '140.0000',
      items: [
        {
          movementId: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
          date: '2026-01-05',
          movementType: 'outbound',
          quantityChange: '-30.0000',
          quantityAfter: '90.0000',
        },
      ],
      unitId: 'base',
    });
  });

  it('returns an empty result without querying the balance projection', async () => {
    const { service, repository } = fixture();
    repository.read.mockResolvedValueOnce({
      items: [],
      total: 0,
      openingBaseQuantity: '0.0000',
      closingBaseQuantity: '0.0000',
      baseUnitId: null,
      closingMovementDate: null,
      snapshot: '10:20:',
    });

    await expect(service.readQuantity(baseQuery)).resolves.toMatchObject({
      items: [],
      total: 0,
      opening: '0.0000',
      closing: '0.0000',
      unitId: 'base',
    });
  });

  it('stops before resource lookup when the principal is outside organization scope', async () => {
    const { service, organizations, items, warehouses, repository } = fixture();
    organizations.assertOrganizationInScope.mockRejectedValueOnce(
      AppException.notFound('Organization', baseQuery.organizationId),
    );

    await expect(service.readQuantity(baseQuery)).rejects.toMatchObject({
      code: 'EntityNotFound',
    });
    expect(items.requireUsableItemInOrganization).not.toHaveBeenCalled();
    expect(
      warehouses.requireUsableWarehouseInOrganization,
    ).not.toHaveBeenCalled();
    expect(repository.read).not.toHaveBeenCalled();
  });

  it('returns not found when the warehouse is outside the requested organization', async () => {
    const { service, warehouses, repository } = fixture();
    warehouses.requireUsableWarehouseInOrganization.mockRejectedValueOnce(
      AppException.notFound('Warehouse', baseQuery.warehouseId),
    );

    await expect(service.readQuantity(baseQuery)).rejects.toMatchObject({
      code: 'EntityNotFound',
    });
    expect(repository.read).not.toHaveBeenCalled();
  });

  it('returns not found when the item is outside the requested organization', async () => {
    const { service, items, repository } = fixture();
    items.requireUsableItemInOrganization.mockRejectedValueOnce(
      AppException.notFound('Item', baseQuery.itemId),
    );

    await expect(service.readQuantity(baseQuery)).rejects.toMatchObject({
      code: 'EntityNotFound',
    });
    expect(repository.read).not.toHaveBeenCalled();
  });

  it('returns 403 before organization access when the dedicated permission is absent', async () => {
    const { service, authorization, organizations, repository } = fixture();
    authorization.requireAllPermissions.mockRejectedValueOnce(
      AppException.forbidden(),
    );

    await expect(service.readQuantity(baseQuery)).rejects.toMatchObject({
      code: 'PermissionDenied',
    });
    expect(organizations.assertOrganizationInScope).not.toHaveBeenCalled();
    expect(repository.read).not.toHaveBeenCalled();
  });

  it('requires the page-one snapshot for subsequent quantity pages', async () => {
    const { service, repository } = fixture();
    await expect(
      service.readQuantity({ ...baseQuery, page: 2 }),
    ).rejects.toMatchObject({ code: 'BadRequest' });
    expect(repository.read).not.toHaveBeenCalled();
  });

  it('allows the page ending at row 50,000 and rejects any page beyond it', async () => {
    const { service, repository } = fixture();
    await service.readQuantity({
      ...baseQuery,
      page: 100,
      pageSize: 500,
      snapshot: '10:20:',
    });
    expect(repository.read).toHaveBeenCalledOnce();

    repository.read.mockClear();
    await expect(
      service.readQuantity({
        ...baseQuery,
        page: 101,
        pageSize: 500,
        snapshot: '10:20:',
      }),
    ).rejects.toMatchObject({ code: 'BadRequest' });
    expect(repository.read).not.toHaveBeenCalled();
  });

  it('keeps the report ordering fixed instead of accepting a client sort', async () => {
    const { service, repository } = fixture();
    await expect(
      service.readQuantity({ ...baseQuery, sort: 'date:desc' }),
    ).rejects.toMatchObject({ code: 'BadRequest' });
    expect(repository.read).not.toHaveBeenCalled();
  });
});
