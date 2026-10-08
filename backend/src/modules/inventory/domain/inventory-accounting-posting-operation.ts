/**
 * Inventory → Accounting posting operation — the C-62 integration's durable
 * state machine and its idempotency contract (PDR-09 PO-04/PO-09/PO-10,
 * PDR-10 C62-OD-05/OD-06, ADR-0041).
 *
 * Framework-free (AR-05): the vocabulary, the legal transitions, the canonical
 * request hash and the replay-or-reject rule live here so the application
 * service only sequences them.
 *
 * ## Why a durable operation at all
 *
 * ADR-0041 selects a synchronous in-process application-service call as the
 * PRIMARY mechanism, and C62-OD-01 gates whether that call can share ONE
 * database transaction with the Inventory write. It cannot (see
 * `docs/tasks/c-62-inventory-accounting-posting-implementation.md` §OD-01):
 * Inventory's transaction, Accounting's guarded writes and the Documents
 * Foundation's number allocation each own an independent, non-composable
 * Prisma transaction. The consequence is that the Inventory state change and
 * the Accounting effect can never commit together, so the ONLY correct design
 * is a durable, restart-safe operation that
 *
 *   * records the intent BEFORE Accounting is asked,
 *   * records Accounting's authoritative result AFTER it answers,
 *   * never lets a timeout, a crash or a retry invent a second effect, and
 *   * never lets Inventory claim `accountingPosted` without Accounting's
 *     persisted success (C62-OD-01/PO-10).
 *
 * ## State machine
 *
 *   REQUESTED ──▶ PENDING ──▶ DRAFT_CREATED ──▶ POSTED
 *                     │            │  ▲
 *                     │            │  └── (the Accounting draft was
 *                     │            │       registered/finalized later)
 *                     ├──▶ POSTED  │
 *                     ├──▶ REFUSED (terminal)
 *                     └──▶ FAILED
 *                                  DRAFT_CREATED ──▶ CANCELLED (terminal)
 *
 *   - `REQUESTED` — the intent is durable; Accounting has not been invoked.
 *   - `PENDING`   — Accounting has been invoked and has not answered. A
 *                   caller whose request timed out MUST re-query this row and
 *                   never infer failure from the timeout (C62-OD-06).
 *   - `DRAFT_CREATED` — Accounting owns a draft. Inventory is NOT posted.
 *   - `POSTED`   — Accounting reported a FINAL voucher; Inventory may now
 *                   become Accounting Posted. Terminal.
 *   - `REFUSED`  — a deterministic business refusal (not eligible, missing
 *                   mapping, missing authority). Terminal for this key/hash.
 *   - `FAILED`   — Accounting could not complete (closed period, unusable
 *                   account, infrastructure). Retryable under the same key.
 *   - `CANCELLED`— the Accounting draft was cancelled. Terminal for this
 *                   key/hash; the row is kept as audit evidence and a new
 *                   attempt uses a NEW operation key.
 *
 * Only the states the C-62 slice actually reaches are declared: no generic
 * workflow engine, no states that nothing writes.
 */

/** `inventory_accounting_posting_operations.action` width. */
export const MAX_ACCOUNTING_POSTING_ACTION_LENGTH = 32;

/** The one action the C-62 slice implements (PO-03: an explicit, approved
 *  document command — never a raw movement or a repository call). */
export const ACCOUNTING_POST_ACTION = 'accounting_post';

export const INVENTORY_ACCOUNTING_POSTING_STATES = [
  'REQUESTED',
  'PENDING',
  'DRAFT_CREATED',
  'POSTED',
  'REFUSED',
  'FAILED',
  'CANCELLED',
] as const;

export type InventoryAccountingPostingState =
  (typeof INVENTORY_ACCOUNTING_POSTING_STATES)[number];

export function isInventoryAccountingPostingState(
  value: string,
): value is InventoryAccountingPostingState {
  return (INVENTORY_ACCOUNTING_POSTING_STATES as readonly string[]).includes(
    value,
  );
}

/** States from which Accounting may still be (re-)invoked under this key. */
const RETRYABLE: readonly InventoryAccountingPostingState[] = [
  'REQUESTED',
  'PENDING',
  'FAILED',
];

/** States that are final for this (key, hash) pair. */
const TERMINAL: readonly InventoryAccountingPostingState[] = [
  'POSTED',
  'REFUSED',
  'CANCELLED',
];

export function isTerminalAccountingPostingState(
  state: InventoryAccountingPostingState,
): boolean {
  return TERMINAL.includes(state);
}

export function isRetryableAccountingPostingState(
  state: InventoryAccountingPostingState,
): boolean {
  return RETRYABLE.includes(state);
}

/**
 * The legal transitions. Everything not listed is refused — there is no
 * generic "set state" path, exactly like the document lifecycle
 * (`domain/inventory-business-document.ts`).
 */
export const INVENTORY_ACCOUNTING_POSTING_TRANSITIONS: Readonly<
  Record<
    InventoryAccountingPostingState,
    readonly InventoryAccountingPostingState[]
  >
> = {
  REQUESTED: ['PENDING', 'REFUSED', 'FAILED'],
  PENDING: ['DRAFT_CREATED', 'POSTED', 'REFUSED', 'FAILED'],
  DRAFT_CREATED: ['POSTED', 'CANCELLED', 'FAILED'],
  POSTED: [],
  REFUSED: [],
  FAILED: ['PENDING'],
  CANCELLED: [],
};

export function canTransitionAccountingPostingState(
  from: InventoryAccountingPostingState,
  to: InventoryAccountingPostingState,
): boolean {
  return INVENTORY_ACCOUNTING_POSTING_TRANSITIONS[from].includes(to);
}

export function assertAccountingPostingTransition(
  from: InventoryAccountingPostingState,
  to: InventoryAccountingPostingState,
): void {
  if (!canTransitionAccountingPostingState(from, to)) {
    throw new Error(
      `An accounting posting operation cannot move from "${from}" to "${to}".`,
    );
  }
}

/**
 * The document-level Accounting standing the UI reads (PDR-10 state/ownership
 * contract). Deliberately NOT the operation state: a draft is a draft, a
 * cancelled draft is history, and only a final Accounting voucher is
 * «ثبت‌شده».
 */
export const INVENTORY_DOCUMENT_ACCOUNTING_POSTING_STATES = [
  'not_posted',
  'draft_created',
  'final_posted',
  'draft_cancelled',
] as const;

export type InventoryDocumentAccountingPostingState =
  (typeof INVENTORY_DOCUMENT_ACCOUNTING_POSTING_STATES)[number];

export function isInventoryDocumentAccountingPostingState(
  value: string,
): value is InventoryDocumentAccountingPostingState {
  return (
    INVENTORY_DOCUMENT_ACCOUNTING_POSTING_STATES as readonly string[]
  ).includes(value);
}

/**
 * The document standing an Accounting outcome establishes. `null` means "the
 * document's standing does not change" (a refusal or a failure leaves it
 * exactly where the lifecycle says it belongs).
 */
export function documentAccountingPostingStateFor(
  operationState: InventoryAccountingPostingState,
): InventoryDocumentAccountingPostingState | null {
  switch (operationState) {
    case 'DRAFT_CREATED':
      return 'draft_created';
    case 'POSTED':
      return 'final_posted';
    case 'CANCELLED':
      return 'draft_cancelled';
    case 'REQUESTED':
    case 'PENDING':
    case 'REFUSED':
    case 'FAILED':
      return null;
  }
}

/**
 * The wire shape of one durable posting operation.
 *
 * It lives beside the state machine on purpose: the operation IS the record of
 * the crossing, and the mapping from row to wire must not be able to invent a
 * state the state machine does not know. Every field is passed through
 * verbatim — in particular the refusal reason is never softened, because an
 * operator deciding whether to retry needs the real one.
 */
export interface AccountingPostingOperationDto {
  id: string;
  organizationId: string;
  documentId: string;
  action: string;
  operationKey: string;
  requestHash: string;
  documentVersion: string;
  postingMode: string;
  state: InventoryAccountingPostingState;
  refusalCode: string | null;
  refusalReason: string | null;
  accountingDocumentId: string | null;
  accountingDocumentNumber: string | null;
  accountingDocumentPhase: string | null;
  accountingOperationKey: string | null;
  glPosted: boolean;
  replayed: boolean;
  actorUserId: string | null;
  actorPermission: string;
  requestedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Row → wire. Dates become ISO strings; nothing is derived or defaulted. */
export function toAccountingPostingOperationDto(operation: {
  id: string;
  organizationId: string;
  documentId: string;
  action: string;
  operationKey: string;
  requestHash: string;
  documentVersion: string;
  postingMode: string;
  state: InventoryAccountingPostingState;
  refusalCode: string | null;
  refusalReason: string | null;
  accountingDocumentId: string | null;
  accountingDocumentNumber: string | null;
  accountingDocumentPhase: string | null;
  accountingOperationKey: string | null;
  glPosted: boolean;
  replayed: boolean;
  actorUserId: string | null;
  actorPermission: string;
  requestedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AccountingPostingOperationDto {
  return {
    id: operation.id,
    organizationId: operation.organizationId,
    documentId: operation.documentId,
    action: operation.action,
    operationKey: operation.operationKey,
    requestHash: operation.requestHash,
    documentVersion: operation.documentVersion,
    postingMode: operation.postingMode,
    state: operation.state,
    refusalCode: operation.refusalCode,
    refusalReason: operation.refusalReason,
    accountingDocumentId: operation.accountingDocumentId,
    accountingDocumentNumber: operation.accountingDocumentNumber,
    accountingDocumentPhase: operation.accountingDocumentPhase,
    accountingOperationKey: operation.accountingOperationKey,
    glPosted: operation.glPosted,
    replayed: operation.replayed,
    actorUserId: operation.actorUserId,
    actorPermission: operation.actorPermission,
    requestedAt: operation.requestedAt.toISOString(),
    completedAt: operation.completedAt?.toISOString() ?? null,
    createdAt: operation.createdAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString(),
  };
}
