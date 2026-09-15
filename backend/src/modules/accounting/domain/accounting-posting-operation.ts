/**
 * The Accounting posting-operation ledger's vocabulary (Task 10.4, contract
 * §16.4, AC-I-12, ADR-0022 §3/§4).
 *
 * One row per completed posting operation, unique on
 * `(organization_id, operation_key)`; same key + same `request_hash` replays,
 * the same key with a different hash is refused with 409 and nothing is
 * applied. The ledger is written INSIDE the transaction that performs the
 * effect (inserted last), so a committed effect always has its key.
 *
 * Kinds are a CLOSED, code-defined list of the operations this module actually
 * performs. The contract's list is explicitly illustrative (`§16.4` "e.g.
 * `document_finalize`, `document_reverse`, …"); declaring a kind no code writes
 * would be a lie of exactly the sort `docs/security.md` §3 forbids for
 * permission codes. The correction kinds (`document_reverse`,
 * `document_correct`, `document_replace`), `system_post` and the year-transition
 * kinds arrive with the tasks that implement them.
 *
 * Why `document_create` is a member even though finalization is the act that
 * makes a voucher part of the books: creation is where the number is allocated
 * when the organization does not require a draft (§15.1/§18), and it is the
 * only operation whose retry could otherwise persist a second document. The
 * ledger gives both operations the same, testable replay rule (§16.4).
 *
 * Framework-free (AR-05).
 */

/** Column width of `accounting_posting_operations.operation_key`. */
export const MAX_OPERATION_KEY_LENGTH = 128;

/** Column width of `accounting_posting_operations.operation`. */
export const MAX_POSTING_OPERATION_LENGTH = 32;

export const ACCOUNTING_POSTING_OPERATIONS = [
  /** Creates the aggregate (and issues it when draft is not required). */
  'document_create',
  /** Makes the voucher part of the books (§15.5). */
  'document_finalize',
] as const;

export type AccountingPostingOperationKind =
  (typeof ACCOUNTING_POSTING_OPERATIONS)[number];

export function isAccountingPostingOperationKind(
  value: string,
): value is AccountingPostingOperationKind {
  return (ACCOUNTING_POSTING_OPERATIONS as readonly string[]).includes(value);
}

/**
 * The stored result envelope. It holds the created document's id so a replay
 * can re-read the CURRENT rows instead of returning a stale snapshot
 * (`§16.4` "replay the stored result (re-reading current rows, never a stale
 * snapshot)"). Opaque to the database — no query pattern reads inside it.
 */
export interface AccountingPostingOperationResult {
  documentId: string;
}

export function toPostingOperationResult(
  documentId: string,
): AccountingPostingOperationResult {
  return { documentId };
}

/**
 * Parse the stored envelope. The envelope is written by this module only, so a
 * malformed one means a hand-edited database: fail loudly rather than
 * replaying garbage (the `inventory_operations` posture).
 */
export function parsePostingOperationResult(
  value: unknown,
): AccountingPostingOperationResult {
  if (typeof value !== 'object' || value === null) {
    throw new Error(
      'Stored accounting posting operation has a malformed result.',
    );
  }
  const record = value as Record<string, unknown>;
  if (typeof record['documentId'] !== 'string') {
    throw new Error(
      'Stored accounting posting operation has a malformed result.',
    );
  }
  return { documentId: record['documentId'] };
}

/** The ledger row as the domain reads it. */
export interface AccountingPostingOperation {
  id: string;
  organizationId: string;
  operationKey: string;
  operation: AccountingPostingOperationKind;
  requestHash: string;
  result: AccountingPostingOperationResult;
  createdAt: Date;
  updatedAt: Date;
}
