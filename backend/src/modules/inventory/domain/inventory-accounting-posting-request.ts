import { createHash } from 'node:crypto';
import {
  absMoney,
  addMoney,
  compareMoney,
  divideToScale,
  UNIT_COST_DISPLAY_DIGITS,
} from './money.js';
import { ACCOUNTING_POST_ACTION } from './inventory-accounting-posting-operation.js';

/**
 * The Inventory side of the Inventory → Accounting posting contract (C-62;
 * PDR-09 PO-01/PO-04/PO-09, PDR-10 C62-OD-04/OD-05/OD-06, ADR-0041).
 *
 * Framework-free (AR-05): the canonical request, its hash, the derived
 * Accounting operation keys and the immutable snapshot shape live here so the
 * application service only sequences them and so the tests can assert on them
 * without a database.
 *
 * ## What Inventory sends
 *
 * FACTS ONLY — organization, the organizational (Legal Entity) context,
 * document identity/type/number/date, warehouse, the movement ids, item
 * identity, quantities, units, the authoritative values and unit costs, the
 * valuation state, the valuation run reference, the valuation basis and the
 * stale verdict, plus the acting human. NO account, NO financial area, NO
 * journal structure, no other accounting decision (C62-OD-04). Accounting
 * resolves those from its own configuration.
 *
 * ## Idempotency (C62-OD-06)
 *
 * The request hash is sha256 over a canonical payload with a FIXED key order
 * and canonical values (trimmed strings, `YYYY-MM-DD` dates, exact decimal
 * strings, explicit `null`s, sorted movement rows). It deliberately contains
 * no generated ids and no server clock, so a retry of one logical operation
 * hashes identically while any material difference changes the hash. The
 * source document's revision IS part of the payload: an edit between two
 * attempts of the same key is a conflict, never a silent re-post.
 */

/** `inventory_accounting_posting_operations.operation_key` width. */
export const MAX_ACCOUNTING_POSTING_OPERATION_KEY_LENGTH = 128;

/**
 * The source document type Inventory declares to Accounting. The C-62 first
 * slice implements exactly one — the operational, fully priced, non-tax
 * Receipt. Every other kind has no Accounting mapping, so it can only be
 * refused (fail closed), never posted.
 */
export const INVENTORY_RECEIPT_SOURCE_DOCUMENT_TYPE = 'inventory_receipt';

/** One ledger movement, as Inventory authoritatively knows it. */
export interface AccountingPostingMovementFact {
  movementId: string;
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
  valuationStatus: string;
  valuationSource: string | null;
  valuationRunId: string | null;
}

/** The valuation verdict Inventory enforced before asking Accounting. */
export interface AccountingPostingValuationFacts {
  state: string;
  documentStale: boolean;
  keyStaleVerdict: 'not_stale' | 'stale';
  valuationRunId: string | null;
  basis: string;
  totalValue: string;
}

/** The canonical request the hash is computed over (C62-OD-06). */
export interface AccountingPostingCanonicalRequest {
  organizationId: string;
  branchId: string;
  sourceDocumentId: string;
  sourceDocumentType: string;
  sourceDocumentNumber: string | null;
  sourceDocumentDate: string;
  sourceDocumentVersion: string;
  warehouseId: string;
  postingMode: string;
  action: string;
  valuation: AccountingPostingValuationFacts;
  movements: readonly AccountingPostingMovementFact[];
}

/** The canonical payload of ONE movement, in a fixed key order. */
function canonicalMovement(movement: AccountingPostingMovementFact) {
  return {
    movementId: movement.movementId,
    lineId: movement.lineId,
    itemId: movement.itemId,
    quantity: movement.quantity.trim(),
    unitId: movement.unitId,
    baseQuantity: movement.baseQuantity.trim(),
    baseUnitId: movement.baseUnitId,
    value: movement.value.trim(),
    unitCost: movement.unitCost.trim(),
    valuationStatus: movement.valuationStatus,
    valuationSource: movement.valuationSource,
    valuationRunId: movement.valuationRunId,
  };
}

/**
 * sha256 over the canonical request. Movements are sorted by id so the order
 * the repository returned them in cannot change the hash, and every optional
 * value is written as an explicit `null` — an omitted value and a stored `null`
 * must hash the same way or a retry could conflict with itself.
 */
export function buildAccountingPostingRequestHash(
  request: AccountingPostingCanonicalRequest,
): string {
  const payload = {
    organizationId: request.organizationId,
    branchId: request.branchId,
    sourceDocumentId: request.sourceDocumentId,
    sourceDocumentType: request.sourceDocumentType,
    sourceDocumentNumber: request.sourceDocumentNumber,
    sourceDocumentDate: request.sourceDocumentDate,
    sourceDocumentVersion: request.sourceDocumentVersion,
    warehouseId: request.warehouseId,
    postingMode: request.postingMode,
    action: request.action,
    valuation: {
      state: request.valuation.state,
      documentStale: request.valuation.documentStale,
      keyStaleVerdict: request.valuation.keyStaleVerdict,
      valuationRunId: request.valuation.valuationRunId,
      basis: request.valuation.basis,
      totalValue: request.valuation.totalValue.trim(),
    },
    movements: request.movements
      .map(canonicalMovement)
      .sort((left, right) => left.movementId.localeCompare(right.movementId)),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Derive the per-step operation keys Accounting's OWN idempotency ledger is
 * written under (`document_create`, `document_issue`, `document_finalize`).
 *
 * Derived, not caller-supplied, so the Inventory operation identity determines
 * the Accounting one deterministically: the same Inventory operation can never
 * produce two Accounting ledgers, and two different Inventory operations can
 * never collide on one Accounting key. The derivation is bounded to the
 * column width and stays readable for normal keys; an over-long key is
 * truncated with a digest suffix so the result is still unique and stable.
 */
export function deriveAccountingOperationKey(input: {
  documentId: string;
  action: string;
  operationKey: string;
  step: 'create' | 'issue' | 'finalize';
}): string {
  const raw = `inv-acct:${input.action}:${input.documentId}:${input.operationKey}:${input.step}`;
  return boundKey(raw);
}

function boundKey(raw: string): string {
  const codePoints = Array.from(raw);
  if (codePoints.length <= MAX_ACCOUNTING_POSTING_OPERATION_KEY_LENGTH) {
    return raw;
  }
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 32);
  const head = codePoints
    .slice(0, MAX_ACCOUNTING_POSTING_OPERATION_KEY_LENGTH - digest.length - 1)
    .join('');
  return `${head}:${digest}`;
}

/**
 * Whether a caller-supplied idempotency key is usable at all. Pure, so the
 * application service is the single place that turns a `false` into the
 * standard 400 envelope.
 */
export function isValidAccountingPostingOperationKey(value: string): boolean {
  const key = value.trim();
  return (
    key !== '' &&
    Array.from(key).length <= MAX_ACCOUNTING_POSTING_OPERATION_KEY_LENGTH
  );
}

/** Trim a validated key (the stored form). */
export function normalizeAccountingPostingOperationKey(value: string): string {
  return value.trim();
}

/** The action the C-62 slice implements (re-exported for call sites). */
export { ACCOUNTING_POST_ACTION };

/**
 * Σ of the signed authoritative values. Exact decimal arithmetic on strings —
 * no float ever touches a posted amount (the module's one rule).
 *
 * The result is the module's canonical decimal spelling (unpadded, like every
 * other value in this module), so it is deterministic: the same facts always
 * produce the same string, which is what the canonical request hash needs.
 */
export function totalMovementValue(
  movements: readonly AccountingPostingMovementFact[],
): string {
  let total = '0.00';
  for (const movement of movements) {
    total = addMoney(total, movement.value.trim());
  }
  return total;
}

/**
 * The derived per-base-unit unit cost. `divideToScale` is presentation-only by
 * the module's own contract, and that is exactly what this is: the ledger
 * stores `total_cost` and no unit cost of its own, so the snapshot is the one
 * place the derived figure is frozen for audit. A zero base quantity has no
 * unit cost and yields `0.000000` rather than a fabricated value.
 */
export function deriveUnitCost(value: string, baseQuantity: string): string {
  const derived = divideToScale(
    value.trim(),
    absMoney(baseQuantity.trim()),
    UNIT_COST_DISPLAY_DIGITS,
  );
  // Canonical spelling, same as every other derived figure here.
  return derived ?? '0';
}

/**
 * The valuation basis of a movement — the closed ledger vocabulary, so the
 * snapshot keeps its meaning after the live row is re-priced.
 */
export function valuationBasisOf(valuationSource: string | null): string {
  return valuationSource ?? 'unvalued';
}

/** True when a movement's value is non-zero (a zero-value fact posts nothing). */
export function hasPostableValue(
  movement: AccountingPostingMovementFact,
): boolean {
  return compareMoney(movement.value.trim(), '0.00') !== 0;
}
