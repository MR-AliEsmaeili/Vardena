import { describe, expect, it, vi } from 'vitest';
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
      snapshot: '10:20:',
    }),
  };
  const service = new InventoryKardexService(
    repository as never,
    {
      findItemVersions: vi.fn().mockResolvedValue([]),
      findGlobalVersions: vi.fn().mockResolvedValue([]),
    } as never,
    { assertOrganizationInScope: vi.fn() } as never,
    {
      requireUsableItemInOrganization: vi.fn().mockResolvedValue({
        baseUnitId: 'base',
      }),
    } as never,
    { requireUsableWarehouseInOrganization: vi.fn() } as never,
    { requireUsableUnitInOrganization: vi.fn() } as never,
    { requireAllPermissions: vi.fn() } as never,
  );
  Object.assign(repository, overrides);
  return { service, repository };
}

describe('InventoryKardexService', () => {
  it('keeps opening, page running quantity, and whole-report closing distinct', async () => {
    const { service } = fixture();
    const result = await service.read({
      ...baseQuery,
      dateFrom: '2026-01-02',
    });
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
});
