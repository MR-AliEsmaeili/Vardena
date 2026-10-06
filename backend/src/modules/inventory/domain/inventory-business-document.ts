/**
 * Inventory Business Documents — the C-58 aggregate rules (framework-free,
 * AR-05).
 *
 * Receipt, Issue and Transfer are Inventory-owned business documents layered
 * OVER the authoritative movement ledger (ADR-0017/ADR-0022). This file owns
 * the vocabulary, the lifecycle state machine, the per-kind invariants and the
 * OQ-54/ADR-0040 side-effect classification. It owns no persistence, no HTTP
 * and no movement logic: the ledger stays the single source of stock truth and
 * `inventory-business-documents.service.ts` composes the effects.
 *
 * Lifecycle (C-58 Owner decision — no approval workflow in this slice; a
 * holder of the finalize permission self-finalizes):
 *
 *   draft ──finalize──▶ operational ──accounting post──▶ accounting_posted
 *     │                      │                                   │
 *     └──cancel──▶ cancelled ◀──cancel (reverses the ledger)      └──seal──▶ immutable
 *
 * `cancelled` and `immutable` are terminal. A cancelled document keeps its
 * number and stays visible (OD-54-07/08/09); numbers are never reused.
 */

export const INVENTORY_DOCUMENT_KINDS = [
  'receipt',
  'issue',
  'transfer',
] as const;
export type InventoryDocumentKind = (typeof INVENTORY_DOCUMENT_KINDS)[number];

export function isInventoryDocumentKind(
  value: string,
): value is InventoryDocumentKind {
  return (INVENTORY_DOCUMENT_KINDS as readonly string[]).includes(value);
}

export const INVENTORY_DOCUMENT_STATUSES = [
  'draft',
  'operational',
  'accounting_posted',
  'immutable',
  'cancelled',
] as const;
export type InventoryDocumentStatus =
  (typeof INVENTORY_DOCUMENT_STATUSES)[number];

export function isInventoryDocumentStatus(
  value: string,
): value is InventoryDocumentStatus {
  return (INVENTORY_DOCUMENT_STATUSES as readonly string[]).includes(value);
}

/** Free-text bounds, mirroring the stored column widths. */
export const MAX_DOCUMENT_DESCRIPTION_LENGTH = 1000;
export const MAX_DOCUMENT_REFERENCE_LENGTH = 128;
export const MAX_DOCUMENT_CANCELLATION_REASON_LENGTH = 1000;

export type InventoryDocumentLine = {
  id: string;
  lineNumber: number;
  itemId: string;
  /** Entered magnitude in `unitId`, exact decimal string, always > 0. */
  quantity: string;
  unitId: string;
  /** `quantity × conversionFactor`, resolved at write time (D-26). */
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  /** The ledger fact this line currently owns, or `null` while unposted. */
  movementId: string | null;
  /** Transfer legs; both null for receipt/issue and while unposted. */
  outMovementId: string | null;
  inMovementId: string | null;
};

export type InventoryDocumentBase = {
  id: string;
  organizationId: string;
  /** Allocated by the Documents Foundation at finalize; null while draft. */
  number: string | null;
  businessDate: Date;
  lines: readonly InventoryDocumentLine[];
  description: string | null;
  reference: string | null;
  status: InventoryDocumentStatus;
  /** The idempotency key the finalize used; null while never finalized. */
  operationKey: string | null;
  /**
   * Honest representation of OD-54-06: the operator continued without
   * repricing, so this document's valuation consequence is known-stale.
   */
  valuationStale: boolean;
  finalizedAt: Date | null;
  finalizedBy: string | null;
  accountingPostedAt: Date | null;
  accountingPostedBy: string | null;
  sealedAt: Date | null;
  sealedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

export type InventoryReceipt = InventoryDocumentBase & {
  kind: 'receipt';
  warehouseId: string;
  sourceWarehouseId: null;
  destinationWarehouseId: null;
  /** OPTIONAL valuation assignment (PDR-05 OD-VAL-05), never a purchase price. */
  cost: string | null;
};
export type InventoryIssue = InventoryDocumentBase & {
  kind: 'issue';
  warehouseId: string;
  sourceWarehouseId: null;
  destinationWarehouseId: null;
  /** Deliberately absent as a writable concept; valuation derives issue cost. */
  cost: null;
};
export type InventoryTransfer = InventoryDocumentBase & {
  kind: 'transfer';
  warehouseId: null;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  cost: null;
};
export type InventoryBusinessDocument =
  InventoryReceipt | InventoryIssue | InventoryTransfer;

export class InventoryDocumentRuleError extends Error {
  readonly code: string;
  constructor(message: string, code = 'inventory.document.rule_violation') {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const INVENTORY_DOCUMENT_TRANSITIONS: Readonly<
  Record<InventoryDocumentStatus, readonly InventoryDocumentStatus[]>
> = {
  draft: ['operational', 'cancelled'],
  operational: ['accounting_posted', 'cancelled'],
  accounting_posted: ['immutable'],
  immutable: [],
  cancelled: [],
};

export function canTransition(
  from: InventoryDocumentStatus,
  to: InventoryDocumentStatus,
): boolean {
  return INVENTORY_DOCUMENT_TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: InventoryDocumentStatus,
  to: InventoryDocumentStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InventoryDocumentRuleError(
      `An inventory document cannot move from "${from}" to "${to}".`,
      'inventory.document.illegal_transition',
    );
  }
}

export function transitionDocument<
  T extends { status: InventoryDocumentStatus },
>(document: T, target: InventoryDocumentStatus): T {
  assertTransition(document.status, target);
  return { ...document, status: target };
}

/** Statuses whose ledger effect exists (finalize posted it, cancel undid it). */
export function hasLedgerEffect(status: InventoryDocumentStatus): boolean {
  return (
    status === 'operational' ||
    status === 'accounting_posted' ||
    status === 'immutable'
  );
}

/**
 * OD-54-01/02: editable until Accounting Post, never afterwards. A cancelled
 * document is history and is never edited either.
 */
export function assertEditable(document: {
  status: InventoryDocumentStatus;
}): void {
  if (document.status === 'draft' || document.status === 'operational') return;
  if (document.status === 'cancelled') {
    throw new InventoryDocumentRuleError(
      'A cancelled document is historical and cannot be edited.',
      'inventory.document.cancelled_is_immutable',
    );
  }
  throw new InventoryDocumentRuleError(
    'Accounting-posted documents are immutable; use an explicit correction or reversal.',
    'inventory.document.accounting_posted_is_immutable',
  );
}

/** OD-54-02/07: no direct delete once anything has happened to the document. */
export function assertDeletable(document: {
  status: InventoryDocumentStatus;
}): void {
  if (document.status === 'draft') return;
  throw new InventoryDocumentRuleError(
    'Only a draft can be deleted. A document with business history is cancelled, never removed.',
    'inventory.document.delete_forbidden',
  );
}

/**
 * Cancellation boundary (OQ-54). Before Accounting Post a cancellation is
 * supported and reverses the document's own ledger effect; after Accounting
 * Post the economic result is immutable and the correction convention is NOT
 * invented here (OQ-27 accounting correction windows remain open).
 */
export function assertCancellable(document: {
  status: InventoryDocumentStatus;
}): void {
  if (document.status === 'draft' || document.status === 'operational') return;
  if (document.status === 'cancelled') {
    throw new InventoryDocumentRuleError(
      'The document is already cancelled.',
      'inventory.document.already_cancelled',
    );
  }
  throw new InventoryDocumentRuleError(
    'An accounting-posted document cannot be cancelled. Its economic result is immutable and may only be changed by an explicit accounting correction, which Vardena does not implement yet (OQ-27).',
    'inventory.document.accounting_posted_requires_correction',
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type ValidatableLine = {
  itemId: string;
  unitId: string;
  quantity: string;
  conversionFactor: string;
};

type ValidatableDocument = {
  organizationId: string;
  kind: InventoryDocumentKind;
  lines: readonly ValidatableLine[];
  warehouseId?: string | null;
  sourceWarehouseId?: string | null;
  destinationWarehouseId?: string | null;
  cost?: string | null;
};

function isPositiveDecimal(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value.trim()) && Number(value) > 0;
}

function isNonNegativeDecimal(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value.trim());
}

/**
 * The invariants every persisted document must satisfy, independent of the
 * transport that produced it. Master-data existence/activity is NOT checked
 * here — that is the application service's job through the public Inventory
 * contracts.
 */
export function validateDocument(document: ValidatableDocument): void {
  if (document.organizationId.trim() === '') {
    throw new InventoryDocumentRuleError(
      'A document requires an organization.',
      'inventory.document.organization_required',
    );
  }
  if (document.lines.length === 0) {
    throw new InventoryDocumentRuleError(
      'A document requires at least one line.',
      'inventory.document.lines_required',
    );
  }
  for (const line of document.lines) {
    if (line.itemId.trim() === '' || line.unitId.trim() === '') {
      throw new InventoryDocumentRuleError(
        'Every document line requires an item and a unit.',
        'inventory.document.line_reference_required',
      );
    }
    if (!isPositiveDecimal(line.quantity)) {
      throw new InventoryDocumentRuleError(
        'Document lines require a positive quantity.',
        'inventory.document.line_quantity_invalid',
      );
    }
    if (!isPositiveDecimal(line.conversionFactor)) {
      throw new InventoryDocumentRuleError(
        'Document lines require a positive conversion factor.',
        'inventory.document.line_conversion_invalid',
      );
    }
  }
  if (document.kind === 'transfer') {
    const source = document.sourceWarehouseId ?? '';
    const destination = document.destinationWarehouseId ?? '';
    if (source === '' || destination === '') {
      throw new InventoryDocumentRuleError(
        'A transfer requires both a source and a destination warehouse.',
        'inventory.document.transfer_warehouses_required',
      );
    }
    if (source === destination) {
      throw new InventoryDocumentRuleError(
        'Transfer source and destination warehouses must differ.',
        'inventory.document.transfer_same_warehouse',
      );
    }
  } else {
    if ((document.warehouseId ?? '') === '') {
      throw new InventoryDocumentRuleError(
        'A receipt or issue requires a warehouse.',
        'inventory.document.warehouse_required',
      );
    }
  }
  if (document.kind === 'receipt') {
    const cost = document.cost;
    if (cost !== null && cost !== undefined && !isNonNegativeDecimal(cost)) {
      throw new InventoryDocumentRuleError(
        'Receipt cost must be a non-negative amount when supplied; it is optional.',
        'inventory.document.receipt_cost_invalid',
      );
    }
  } else if (document.cost !== null && document.cost !== undefined) {
    throw new InventoryDocumentRuleError(
      'Only a receipt may carry a cost. Issue cost is derived by Inventory valuation and transfers are value-neutral.',
      'inventory.document.manual_cost_forbidden',
    );
  }
}

/**
 * Issue deliberately has no cost property: an issue is valued by the Moving
 * Weighted Average state, never by a number a user typed (PDR-05 rule 5).
 */
export function assertNoManualIssueCost(value: unknown): void {
  if (value !== undefined && value !== null) {
    throw new InventoryDocumentRuleError(
      'Issue cost is derived by Inventory valuation and cannot be entered.',
      'inventory.document.manual_issue_cost',
    );
  }
}

// ---------------------------------------------------------------------------
// OQ-54 / ADR-0040 side-effect classification
// ---------------------------------------------------------------------------

/**
 * ADR-0040 §3: an explicit, testable classification, never an implicit
 * by-product of persistence.
 *
 * - `safe` — nothing the ledger cares about changed (or the document never
 *   produced an effect, i.e. it is still a draft).
 * - `material` — the already-posted effect changes: quantities, items, units,
 *   warehouses, the business date, or the receipt's assigned cost. The caller
 *   must acknowledge it explicitly before anything is written (OD-54-05).
 */
export type DocumentChangeClass = 'safe' | 'material';

export interface DocumentSideEffectAssessment {
  classification: DocumentChangeClass;
  /** Stable, translatable reason codes — never user-facing English. */
  reasons: readonly string[];
  /** True when the effect must be reversed and re-posted on apply. */
  requiresLedgerReconciliation: boolean;
  /** True when the valuation state of a key can change. */
  affectsValuation: boolean;
}

type EffectShape = {
  businessDate: Date;
  warehouseId: string | null;
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  cost: string | null;
  lines: readonly {
    itemId: string;
    unitId: string;
    quantity: string;
    baseQuantity: string;
  }[];
};

function normalizedLines(shape: EffectShape): string {
  return JSON.stringify(
    shape.lines
      .map((line) => ({
        itemId: line.itemId,
        unitId: line.unitId,
        quantity: line.quantity.trim(),
        baseQuantity: line.baseQuantity.trim(),
      }))
      .sort((left, right) =>
        `${left.itemId}:${left.unitId}:${left.quantity}`.localeCompare(
          `${right.itemId}:${right.unitId}:${right.quantity}`,
        ),
      ),
  );
}

/**
 * Compare the effect the document currently has against the effect the edit
 * would produce.
 *
 * `hasPostedEffect` is false for a draft: a draft has no movements, so every
 * change to it is safe by construction (OD-54-01).
 */
export function classifyDocumentEdit(params: {
  hasPostedEffect: boolean;
  before: EffectShape;
  after: EffectShape;
}): DocumentSideEffectAssessment {
  const reasons: string[] = [];
  if (
    params.before.businessDate.getTime() !== params.after.businessDate.getTime()
  ) {
    reasons.push('inventory.document.change.business_date');
  }
  if (params.before.warehouseId !== params.after.warehouseId) {
    reasons.push('inventory.document.change.warehouse');
  }
  if (params.before.sourceWarehouseId !== params.after.sourceWarehouseId) {
    reasons.push('inventory.document.change.source_warehouse');
  }
  if (
    params.before.destinationWarehouseId !== params.after.destinationWarehouseId
  ) {
    reasons.push('inventory.document.change.destination_warehouse');
  }
  if ((params.before.cost ?? '') !== (params.after.cost ?? '')) {
    reasons.push('inventory.document.change.cost');
  }
  if (normalizedLines(params.before) !== normalizedLines(params.after)) {
    reasons.push('inventory.document.change.lines');
  }

  if (!params.hasPostedEffect || reasons.length === 0) {
    return {
      classification: 'safe',
      reasons,
      requiresLedgerReconciliation: false,
      affectsValuation: false,
    };
  }
  // Every material change — including a changed receipt cost, which the
  // movement row itself carries — is reconciled by reversing the posted
  // facts and re-posting the new ones. There is no in-place ledger edit
  // (AR-13): corrections are counter-movements.
  return {
    classification: 'material',
    reasons,
    requiresLedgerReconciliation: true,
    affectsValuation: true,
  };
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface InventoryDocumentLineDto {
  id: string;
  lineNumber: number;
  itemId: string;
  quantity: string;
  unitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  movementId: string | null;
  outMovementId: string | null;
  inMovementId: string | null;
}

export interface InventoryDocumentDto {
  id: string;
  organizationId: string;
  kind: InventoryDocumentKind;
  number: string | null;
  businessDate: string;
  warehouseId: string | null;
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  /** Receipt only, and only for a caller allowed to see inventory value. */
  cost?: string | null;
  status: InventoryDocumentStatus;
  description: string | null;
  reference: string | null;
  operationKey: string | null;
  valuationStale: boolean;
  /** What the caller may do next, computed from the lifecycle alone. The
   *  frontend uses it for UX; the backend re-checks every command anyway. */
  canEdit: boolean;
  canFinalize: boolean;
  canAccountingPost: boolean;
  canSeal: boolean;
  canCancel: boolean;
  canDelete: boolean;
  finalizedAt: string | null;
  finalizedBy: string | null;
  accountingPostedAt: string | null;
  accountingPostedBy: string | null;
  sealedAt: string | null;
  sealedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  lines: InventoryDocumentLineDto[];
}

/**
 * Map the aggregate to its wire representation.
 *
 * `includeCost` mirrors the movement DTO rule (PDR-05): inventory VALUE is
 * permission-gated, so a caller without `Inventory.Valuation.View` receives
 * the document without the money field rather than a `null` that would be
 * indistinguishable from "no cost was assigned".
 */
export function toInventoryDocumentDto(
  document: InventoryBusinessDocument,
  includeCost: boolean,
): InventoryDocumentDto {
  const status = document.status;
  return {
    id: document.id,
    organizationId: document.organizationId,
    kind: document.kind,
    number: document.number,
    businessDate: document.businessDate.toISOString(),
    warehouseId: document.warehouseId,
    sourceWarehouseId: document.sourceWarehouseId,
    destinationWarehouseId: document.destinationWarehouseId,
    ...(document.kind === 'receipt' && includeCost
      ? { cost: document.cost }
      : {}),
    status,
    description: document.description,
    reference: document.reference,
    operationKey: document.operationKey,
    valuationStale: document.valuationStale,
    canEdit: status === 'draft' || status === 'operational',
    canFinalize: canTransition(status, 'operational'),
    canAccountingPost: canTransition(status, 'accounting_posted'),
    canSeal: canTransition(status, 'immutable'),
    canCancel: canTransition(status, 'cancelled'),
    canDelete: status === 'draft',
    finalizedAt: document.finalizedAt?.toISOString() ?? null,
    finalizedBy: document.finalizedBy,
    accountingPostedAt: document.accountingPostedAt?.toISOString() ?? null,
    accountingPostedBy: document.accountingPostedBy,
    sealedAt: document.sealedAt?.toISOString() ?? null,
    sealedBy: document.sealedBy,
    cancelledAt: document.cancelledAt?.toISOString() ?? null,
    cancelledBy: document.cancelledBy,
    cancellationReason: document.cancellationReason,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    lines: document.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      itemId: line.itemId,
      quantity: line.quantity,
      unitId: line.unitId,
      baseQuantity: line.baseQuantity,
      baseUnitId: line.baseUnitId,
      conversionFactor: line.conversionFactor,
      movementId: line.movementId,
      outMovementId: line.outMovementId,
      inMovementId: line.inMovementId,
    })),
  };
}
