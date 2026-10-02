/**
 * Material Request line — one requested item × warehouse × quantity
 * (C-50 §3.2).
 *
 * Owner decision 3.2: every line picks its OWN warehouse; the system never
 * auto-splits a line across warehouses — a 100-unit request split 60/40
 * across two warehouses is two lines the USER created, never an automatic
 * split.
 *
 * Owner decision 3.5: reservation is OPTIONAL per line
 * (`reservationRequested`), never implied by the request existing. A line
 * that does not request a reservation NEVER reserves stock on approval.
 *
 * Invocation status (C-50 §3.8) is intentionally NOT a column here — it is
 * DERIVED at read time from `documents.document_relations` (kind `fulfill`,
 * sourced from this line), so there is exactly one source of truth for how
 * much of a line has been invoked into a downstream process.
 *
 * Framework-free (AR-05).
 */

export interface MaterialRequestLine {
  id: string;
  materialRequestId: string;
  organizationId: string;
  branchId: string;
  lineNumber: number;
  itemId: string;
  warehouseId: string;
  /** Entered magnitude, always > 0. Decimal string. */
  quantity: string;
  unitId: string;
  /** Base-unit equivalent, always > 0. Decimal string. */
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  reservationRequested: boolean;
  /** Set only once a flagged line's approval successfully reserved stock. */
  reservationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Read-time invocation summary for one line, derived from
 * `document_relations` (never stored). `remainingBaseQuantity` is the cap
 * `invokeLine` enforces: `baseQuantity − invokedBaseQuantity`.
 */
export interface MaterialRequestLineInvocationSummary {
  invokedBaseQuantity: string;
  remainingBaseQuantity: string;
  invocationCount: number;
}

export interface MaterialRequestLineDto {
  id: string;
  materialRequestId: string;
  organizationId: string;
  branchId: string;
  lineNumber: number;
  itemId: string;
  warehouseId: string;
  quantity: string;
  unitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  reservationRequested: boolean;
  reservationId: string | null;
  invokedBaseQuantity: string;
  remainingBaseQuantity: string;
  invocationCount: number;
  createdAt: string;
  updatedAt: string;
}

export function toMaterialRequestLineDto(
  line: MaterialRequestLine,
  invocation: MaterialRequestLineInvocationSummary,
): MaterialRequestLineDto {
  return {
    id: line.id,
    materialRequestId: line.materialRequestId,
    organizationId: line.organizationId,
    branchId: line.branchId,
    lineNumber: line.lineNumber,
    itemId: line.itemId,
    warehouseId: line.warehouseId,
    quantity: line.quantity,
    unitId: line.unitId,
    baseQuantity: line.baseQuantity,
    baseUnitId: line.baseUnitId,
    conversionFactor: line.conversionFactor,
    reservationRequested: line.reservationRequested,
    reservationId: line.reservationId,
    invokedBaseQuantity: invocation.invokedBaseQuantity,
    remainingBaseQuantity: invocation.remainingBaseQuantity,
    invocationCount: invocation.invocationCount,
    createdAt: line.createdAt.toISOString(),
    updatedAt: line.updatedAt.toISOString(),
  };
}
