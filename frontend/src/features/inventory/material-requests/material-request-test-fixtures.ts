import type {
  InventoryItem,
  InventoryUnit,
  InventoryWarehouse,
  MaterialRequest,
  MaterialRequestDetail,
  MaterialRequestEvent,
  MaterialRequestLine,
  Paginated,
} from '@/api/contracts';

export const materialRequestLine = (
  overrides: Partial<MaterialRequestLine> = {},
): MaterialRequestLine => ({
  id: 'line-1',
  materialRequestId: 'request-1',
  organizationId: 'org-1',
  branchId: 'branch-1',
  lineNumber: 1,
  itemId: 'item-1',
  warehouseId: 'wh-1',
  quantity: '5.0000',
  unitId: 'unit-1',
  baseQuantity: '5.0000',
  baseUnitId: 'unit-1',
  conversionFactor: '1',
  reservationRequested: true,
  reservationId: null,
  invokedBaseQuantity: '0.0000',
  remainingBaseQuantity: '5.0000',
  invocationCount: 0,
  createdAt: '2026-10-28T08:00:00.000Z',
  updatedAt: '2026-10-28T08:00:00.000Z',
  ...overrides,
});

/** Header fields shared by the list row and the detail record. */
const headerFields = {
  id: 'request-1',
  organizationId: 'org-1',
  number: null,
  status: 'draft' as const,
  description: 'درخواست نمونه',
  requestedBy: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  submittedAt: null,
  submittedBy: null,
  returnedAt: null,
  returnedBy: null,
  returnReason: null,
  approvedAt: null,
  approvedBy: null,
  rejectedAt: null,
  rejectedBy: null,
  rejectionReason: null,
  approvalReversedAt: null,
  approvalReversedBy: null,
  approvalReversalReason: null,
  cancelledAt: null,
  cancelledBy: null,
  cancellationReason: null,
  createdAt: '2026-10-28T08:00:00.000Z',
  updatedAt: '2026-10-28T08:00:00.000Z',
};

export const materialRequest = (
  overrides: Partial<MaterialRequest> = {},
): MaterialRequest => ({ ...headerFields, ...overrides });

export const materialRequestDetail = (
  overrides: Partial<MaterialRequestDetail> = {},
): MaterialRequestDetail => ({
  ...headerFields,
  lines: [materialRequestLine()],
  ...overrides,
});

export const materialRequestEvent = (
  overrides: Partial<MaterialRequestEvent> = {},
): MaterialRequestEvent => ({
  id: 'event-1',
  materialRequestId: 'request-1',
  organizationId: 'org-1',
  eventType: 'created',
  fromStatus: null,
  toStatus: 'draft',
  actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  reason: null,
  referenceId: null,
  occurredAt: '2026-10-28T08:00:00.000Z',
  createdAt: '2026-10-28T08:00:00.000Z',
  ...overrides,
});

export function materialRequestsResponse(
  items: MaterialRequest[] = [materialRequest()],
): Paginated<MaterialRequest> {
  return { items, total: items.length, page: 1, pageSize: 50 };
}

export const materialRequestWarehouse: InventoryWarehouse = {
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

export const materialRequestItem: InventoryItem = {
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

export const materialRequestUnit: InventoryUnit = {
  id: 'unit-1',
  organizationId: 'org-1',
  code: 'عدد',
  name: 'عدد',
  symbol: null,
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

export const materialRequestAlternateUnit: InventoryUnit = {
  id: 'unit-2',
  organizationId: 'org-1',
  code: 'بسته',
  name: 'بسته',
  symbol: null,
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};
