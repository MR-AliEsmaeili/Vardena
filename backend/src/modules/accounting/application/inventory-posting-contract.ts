/**
 * The Inventory → Accounting posting contract (C-62; PDR-09 PO-01/PO-04,
 * PDR-10 C62-OD-02/OD-03/OD-04, ADR-0041 §2).
 *
 * This file is the ONLY seam between the two modules, and it is deliberately
 * shaped as SOURCE FACTS IN → ACCOUNTING RESULT OUT:
 *
 *   * Inventory supplies document identity, movement facts, quantities,
 *     authoritative values/unit costs, the valuation verdict and the acting
 *     human. It supplies NO account, NO financial area, NO journal structure
 *     and no other accounting decision (C62-OD-04).
 *   * Accounting owns the account mapping, the journal policy, the financial
 *     area, the period validation, the posting mode's finalization behaviour
 *     and the voucher itself. A missing mapping is a fail-closed refusal, not
 *     a guessed account.
 *
 * Neither module reads or writes the other's tables. Inventory persists the
 * Accounting REFERENCE this contract returns; Accounting persists its own
 * idempotency ledger under the operation key derived from the Inventory
 * operation, so the two ledgers reconcile without sharing a table (AR-07).
 *
 * No generic envelope: the outcome is a closed, code-defined union, because
 * «a draft was created», «a final voucher is in the books», «the request was
 * refused» and «the operation could not complete» are different facts and the
 * Inventory lifecycle depends on telling them apart (C62-OD-02/PO-10).
 */

/** Code-defined source module name (`accounting_documents.source_module`). */
export const INVENTORY_POSTING_SOURCE_MODULE = 'inventory';

/**
 * Code-defined source document types. The C-62 first slice implements exactly
 * one — the operational, fully priced, non-tax Receipt. Every other Inventory
 * document type is out of scope for this slice and has no mapping, so it can
 * only ever be refused (fail closed), never posted.
 */
export const INVENTORY_POSTING_SOURCE_DOCUMENT_TYPES = [
  'inventory_receipt',
] as const;

export type InventoryPostingSourceDocumentType =
  (typeof INVENTORY_POSTING_SOURCE_DOCUMENT_TYPES)[number];

export function isInventoryPostingSourceDocumentType(
  value: string,
): value is InventoryPostingSourceDocumentType {
  return (
    INVENTORY_POSTING_SOURCE_DOCUMENT_TYPES as readonly string[]
  ).includes(value);
}

/** The Accounting operation the source posting performs (§16.3 vocabulary). */
export const INVENTORY_POSTING_SOURCE_OPERATION = 'accounting_post';

/**
 * The explicit, bounded service authority this contract requires
 * (PDR-10 C62-OD-03; OQ-72 candidate (c): a dedicated system-posting code that
 * is never granted to interactive users).
 *
 * It is a named constant compared EXACTLY at the boundary — not a wildcard,
 * not "any Accounting permission", and not the absence of a check. It is
 * deliberately NOT registered in the RBAC permission catalog: an interactive
 * grant of it would make the boundary meaningless, and the System
 * Administrator bootstrap grants every registered code.
 */
export const ACCOUNTING_SOURCE_POSTING_AUTHORITY_CODE =
  'Accounting.Document.SourcePost';

/** The initiating permission the authority must name. */
export const INVENTORY_ACCOUNTING_POST_INITIATING_PERMISSION =
  'Inventory.Document.AccountingPost';

export const EXPECTED_ACCOUNTING_SOURCE_POSTING_AUTHORITY = {
  code: ACCOUNTING_SOURCE_POSTING_AUTHORITY_CODE,
  initiatingPermission: INVENTORY_ACCOUNTING_POST_INITIATING_PERMISSION,
} as const;

/** The Accounting document phases, as Accounting reports them (§15). */
export type AccountingDocumentPhase = 'draft' | 'temporary' | 'final';

/** The Accounting document state as Accounting reports it (§15.2). */
export type AccountingDocumentState =
  'draft' | 'temporary' | 'final' | 'reversed';

/**
 * ONE ledger movement as Inventory authoritatively knows it.
 *
 * `value` is the SIGNED inventory value effect of the movement (+ inbound,
 * − outbound), copied verbatim from `inventory_movements.total_cost`; it is
 * never recomputed, rounded or netted here. `unitCost` is the derived
 * per-base-unit figure (`value / baseQuantity`) frozen for the audit trail —
 * the ledger deliberately stores no unit cost of its own.
 */
export interface InventoryPostingMovementFact {
  movementId: string;
  /** The document line that owns this movement. */
  lineId: string;
  itemId: string;
  /** Entered magnitude in `unitId`, always > 0. Exact decimal string. */
  quantity: string;
  unitId: string;
  /** Signed base-unit effect in `baseUnitId`. Exact decimal string. */
  baseQuantity: string;
  baseUnitId: string;
  /** Signed authoritative inventory value. Exact decimal string, scale 2. */
  value: string;
  /** Derived authoritative per-base-unit cost. Exact decimal string. */
  unitCost: string;
  /** `unvalued` | `provisional` | `valued`. */
  valuationStatus: string;
  /** `entered_cost` | `average_cost` | `transfer` | `reversal` | null. */
  valuationSource: string | null;
  /** The recalculation run that last assigned the value, when any. */
  valuationRunId: string | null;
}

/** The valuation verdict Inventory enforced before asking Accounting. */
export interface InventoryPostingValuationFacts {
  /** OD-PRC-12 completeness (`priced` for an eligible document). */
  state: string;
  /** The document's own OD-54-06 stale flag. */
  documentStale: boolean;
  /**
   * The KEY-level verdict: `not_stale` | `stale`. Any relevant stale key
   * blocks eligibility (C-59/C-60 correction), so Accounting receives the
   * verdict that was actually enforced rather than inferring one.
   */
  keyStaleVerdict: 'not_stale' | 'stale';
  /** The recalculation run that last assigned the values, when any. */
  valuationRunId: string | null;
  /**
   * The basis the values were produced under — the closed ledger vocabulary
   * (`entered_cost` | `average_cost` | `transfer` | `reversal`).
   */
  basis: string;
  /** Σ of the per-movement authoritative values. Exact decimal string. */
  totalValue: string;
}

/** The initiating human, as recorded for audit (C62-OD-03). */
export interface InventoryPostingActor {
  userId: string;
  /** The permission whose grant was verified before the operation. */
  permission: string;
  /** The organization scope the initiation was authorized in. */
  organizationId: string;
}

/** What Inventory asks Accounting to do. */
export interface InventoryPostingRequest {
  /** Organization scope; cross-organization requests fail closed. */
  organizationId: string;
  /**
   * The organizational (Legal Entity) context. Vardena has no separate Legal
   * Entity model: `branch` is the first-class organizational scope a
   * warehouse belongs to (ADR-0020 §1).
   */
  branchId: string;
  warehouseId: string;

  /** Source document identity. */
  sourceDocumentId: string;
  sourceDocumentType: InventoryPostingSourceDocumentType;
  sourceDocumentNumber: string | null;
  /** `YYYY-MM-DD`, the document's own business date. */
  sourceDocumentDate: string;
  /** The source document revision the request was built from. */
  sourceDocumentVersion: string;

  /**
   * The Warehouse-configured posting mode (C62-OD-02). Accounting owns how
   * each mode is realized; it does not get to choose the mode.
   */
  postingMode: 'direct_final' | 'draft';

  /**
   * The operation identity. `operationKey` is the key Accounting's OWN
   * idempotency ledger is written under (derived deterministically from the
   * Inventory operation key), and `requestHash` is the canonical hash of this
   * request — same key + same hash replays, same key + different hash is 409.
   */
  operationKey: string;
  requestHash: string;

  actor: InventoryPostingActor;
  movements: readonly InventoryPostingMovementFact[];
  valuation: InventoryPostingValuationFacts;
}

/**
 * Why Accounting refused or failed. Closed and code-defined, so the Inventory
 * UI can render one deterministic experience per reason and a caller can act
 * on it without parsing a message.
 */
export type InventoryPostingRefusalCode =
  /** No mapping is configured for this source document type. */
  | 'accounting.mapping_missing'
  /** The mapping names an account or area that is not usable. */
  | 'accounting.mapping_unusable'
  /** The document's date does not resolve to an open period. */
  | 'accounting.period_not_open'
  /** The request is outside the organization scope. */
  | 'accounting.organization_scope_rejected'
  /** The request carries no postable value. */
  | 'accounting.no_postable_value'
  /** The initiating authority is not the expected explicit service authority. */
  | 'accounting.authority_rejected'
  /** The source document type is not implemented in this slice. */
  | 'accounting.source_type_unsupported'
  /** Accounting could not complete (retryable under the same key). */
  | 'accounting.operation_failed'
  /** The operation produced no Accounting draft that can be cancelled. */
  | 'accounting.no_draft_to_cancel'
  /** The Accounting document is no longer a cancellable draft. */
  | 'accounting.draft_not_cancellable';

/**
 * The answer to «cancel the draft this operation created» (C62-OD-02: a Draft
 * stays an Accounting-owned draft until an accountant registers or cancels
 * it, and Inventory asks Accounting to do that THROUGH this contract).
 *
 * `cancelled: false` with a refusal code means Accounting still owns the draft
 * — Inventory must therefore keep its own `draft_created` standing rather than
 * claim the draft was discarded.
 */
export interface InventoryPostingDraftCancellation {
  operationKey: string;
  cancelled: boolean;
  refusalCode: InventoryPostingRefusalCode | null;
  refusalReason: string | null;
}

/** The Accounting document a posting produced or found. */
export interface InventoryPostingAccountingDocument {
  id: string;
  /** The allocated serial; `null` while the document is still a draft. */
  number: string | null;
  phase: AccountingDocumentPhase;
  state: AccountingDocumentState;
  /** True when the voucher is part of the books (`final` = posted). */
  final: boolean;
}

/**
 * What Accounting answers. `outcome` is the authoritative fact Inventory
 * persists its state from — never an HTTP status, an emitted event or an
 * Inventory-side flag.
 */
export interface InventoryPostingResult {
  /** Echoes the operation identity the result belongs to. */
  operationKey: string;
  requestHash: string;
  /** The Warehouse-configured mode the request was executed under. */
  postingMode: 'direct_final' | 'draft';

  outcome:
    /** A FINAL voucher is in the books — the only outcome that may make an
     *  Inventory document Accounting Posted. */
    | 'final_posted'
    /** Accounting owns a draft. NOT Accounting Posted. */
    | 'draft_created'
    /** A deterministic business refusal; nothing was created. */
    | 'refused'
    /** Accounting could not complete; retryable under the same key. */
    | 'failed';

  accountingDocument: InventoryPostingAccountingDocument | null;
  /** True only for `final_posted`. */
  glPosted: boolean;
  /** True when this answer replays an earlier identical request. */
  replayed: boolean;
  /** Present for `refused` and `failed`. */
  refusalCode: InventoryPostingRefusalCode | null;
  refusalReason: string | null;
  requestedAt: string;
  completedAt: string;
}
