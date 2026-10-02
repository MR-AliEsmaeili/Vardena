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
 * Invocation totals (C-50 §3.8) — `invokedBaseQuantity`/`invocationCount` —
 * ARE stored columns, maintained transactionally by
 * `MaterialRequestsRepository.reserveInvocationCapacity`/
 * `releaseInvocationCapacity` under this request's own row lock. This is a
 * deliberate design, not a convenience: an earlier version derived them by
 * reading `documents.document_relations` on every response, which (a) made
 * every mutation's response-building depend on `Documents.Relation.View`, a
 * permission unrelated to the Material Request action the caller actually
 * holds, and (b) read only the first page (1000 rows) of relations, silently
 * under-counting a heavily-invoked line. The Document Relation written by
 * `invokeLine` remains the cross-module TRACEABILITY record (which
 * downstream document/line, visible via the Documents module's own relation
 * APIs to a caller who holds that permission) — this module just never reads
 * it back to compute its own state, so there is exactly one place
 * (this line's own counters) that decides how much of it has been invoked.
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
  /** Authoritative, transactionally-maintained cumulative invoked base-unit
   *  quantity (C-50 §3.8). Decimal string, always `<= baseQuantity`. */
  invokedBaseQuantity: string;
  /** Authoritative, transactionally-maintained cumulative invocation count. */
  invocationCount: number;
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
