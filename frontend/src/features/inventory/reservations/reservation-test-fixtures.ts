import type {
  InventoryItem,
  InventoryReservation,
  InventoryUnit,
  InventoryWarehouse,
  Paginated,
} from '@/api/contracts';

export const reservation = (
  overrides: Partial<InventoryReservation> = {},
): InventoryReservation => ({
  id: 'res-1',
  organizationId: 'org-1',
  branchId: 'branch-1',
  warehouseId: 'wh-1',
  itemId: 'item-1',
  quantity: '2.5000',
  enteredUnitId: 'unit-1',
  baseQuantity: '30.0000',
  baseUnitId: 'unit-1',
  conversionFactor: '12.0000',
  status: 'active',
  referenceType: null,
  referenceId: null,
  reason: null,
  operationKey: 'op-create-1',
  releasedAt: null,
  releasedBy: null,
  releaseOperationKey: null,
  createdAt: '2026-10-26T08:00:00.000Z',
  updatedAt: '2026-10-26T08:00:00.000Z',
  ...overrides,
});

export function reservationsResponse(
  items: InventoryReservation[] = [reservation()],
): Paginated<InventoryReservation> {
  return { items, total: items.length, page: 1, pageSize: 50 };
}

export const reservationWarehouse: InventoryWarehouse = {
  id: 'wh-1',
  organizationId: 'org-1',
  branchId: 'branch-1',
  code: 'WH-01',
  name: 'انبار مرکزی',
  allowNegativeStock: false,
  reservationsReduceAvailable: false,
  accountingPostingMode: 'direct_final',
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

export const reservationItem: InventoryItem = {
  id: 'item-1',
  organizationId: 'org-1',
  code: 'KAL-01',
  name: 'کالای نمونه',
  description: null,
  itemKind: 'goods',
  itemGroupId: null,
  baseUnitId: 'unit-1',
  isStockable: true,
  isPurchasable: true,
  isSellable: true,
  isValued: true,
  requiresLot: false,
  requiresSerial: false,
  requiresExpiry: false,
  allowNegativeStock: null,
  barcode: null,
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

export const reservationUnit: InventoryUnit = {
  id: 'unit-1',
  organizationId: 'org-1',
  code: 'عدد',
  name: 'عدد',
  symbol: null,
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

export const reservationAlternateUnit: InventoryUnit = {
  id: 'unit-2',
  organizationId: 'org-1',
  code: 'بسته',
  name: 'بسته',
  symbol: null,
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};
