import { createHash } from 'node:crypto';
import { AppException } from '../../../kernel/errors/app-exception.js';
import type { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { parseDateOnly } from '../domain/date-range.js';
import { canonicalizeAmount, validateEnteredAmount } from '../domain/money.js';
import {
  assignLineNumbers,
  checkVoucherLines,
  MIN_ACCOUNTING_DOCUMENT_LINES,
  voucherLineProblemMessage,
  type AccountingDocumentLineInput,
} from '../domain/voucher-lines.js';
import {
  checkOriginEvidence,
  originProblemMessage,
  type AccountingDocument,
  type AccountingDocumentOrigin,
  type AccountingDocumentSource,
} from '../domain/accounting-document.js';
import {
  MAX_OPERATION_KEY_LENGTH,
  type AccountingPostingOperationKind,
} from '../domain/accounting-posting-operation.js';
import {
  ACCOUNTING_DOCUMENT_CREATED_EVENT,
  ACCOUNTING_DOCUMENT_DELETED_EVENT,
  ACCOUNTING_DOCUMENT_FINALIZED_EVENT,
  ACCOUNTING_DOCUMENT_UPDATED_EVENT,
} from '../domain/accounting.events.js';
import type { DocumentOperationRow } from '../data/accounting-documents.repository.js';
import { publishEvent } from './accounting-support.js';

/**
 * Shared helpers for the accounting-document application services (Task 10.4;
 * Task 10.8 adds the two shapes the posting seam and the voucher's own
 * operations must not drift on: the idempotency ROW and the event payload).
 *
 * Same role as `inventory-posting-support.ts` for Inventory: the things that
 * must not drift between the voucher's operations — operation-key validation,
 * input normalization (dates, amounts, narrations), the canonical idempotency
 * HASH, and the ONE mapping from the document guard errors onto the API error
 * model (four call sites, one decision table).
 *
 * Two rules are worth restating because they are easy to get subtly wrong:
 *
 * - **Amounts are exact decimal STRINGS** (§13.1/§13.5): a client sends
 *   `"1250.00"`, the service canonicalizes it, and nothing in this path ever
 *   converts to a float. A malformed or over-precise amount is refused, never
 *   rounded.
 * - **The hash covers the client's INTENT only** (§16.4, ADR-0022 §4): no
 *   generated ids, no server clocks, an omitted optional value hashed as an
 *   explicit `null`. A retry of one logical operation must hash identically;
 *   a different intent must not.
 */

/** `accounting_documents.description` / `…_lines.description` width. */
export const MAX_DESCRIPTION_LENGTH = 500;

/** `accounting_documents…_lines.source_line_reference` width. */
export const MAX_SOURCE_LINE_REFERENCE_LENGTH = 128;

/**
 * Validate a client-supplied idempotency key (§16.4). Keys are REQUIRED on the
 * operations that CREATE or CHANGE what the books contain (composition and
 * finalization): without one, a retry could never be told apart from a new
 * intent, and the ledger must never hold a doubled document (AC-I-12).
 */
export function requireOperationKey(value: string): string {
  const key = value.trim();
  if (key === '') {
    throw AppException.badRequest('An operationKey is required.');
  }
  if (key.length > MAX_OPERATION_KEY_LENGTH) {
    throw AppException.badRequest(
      `operationKey must be at most ${MAX_OPERATION_KEY_LENGTH} characters.`,
    );
  }
  return key;
}

/** The header narration is required and non-blank (§12.2). */
export function assertDescription(value: string): string {
  const description = value.trim();
  if (description === '') {
    throw AppException.badRequest('Description is required.');
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw AppException.badRequest(
      `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }
  return description;
}

/** Optional line narration: trimmed, width-capped, `null` when empty. */
export function normalizeLineDescription(
  value: string | null | undefined,
): string | null {
  const description = value?.trim() ?? '';
  if (description === '') return null;
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw AppException.badRequest(
      `A line description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }
  return description;
}

/**
 * Optional logical line reference (§12.5, §20.3): an opaque token stored for
 * audit, never dereferenced. Trimmed; empty becomes `null` (not `''`).
 */
export function normalizeSourceLineReference(
  value: string | null | undefined,
): string | null {
  const reference = value?.trim() ?? '';
  if (reference === '') return null;
  if (reference.length > MAX_SOURCE_LINE_REFERENCE_LENGTH) {
    throw AppException.badRequest(
      `sourceLineReference must be at most ${MAX_SOURCE_LINE_REFERENCE_LENGTH} characters.`,
    );
  }
  return reference;
}

/**
 * Parse the business date. `YYYY-MM-DD` only (§12.3): the module stores
 * date-only values and no path in it accepts an instant, so a datetime string
 * is a bad request rather than a silently truncated timestamp.
 */
export function parseDocumentDate(value: string): Date {
  const parsed = parseDateOnly(value.trim());
  if (parsed === null) {
    throw AppException.badRequest(
      'documentDate must be a valid calendar date (YYYY-MM-DD).',
    );
  }
  return parsed;
}

/** Optional `YYYY-MM-DD` bound (list filters). */
export function parseOptionalDocumentDate(
  value: string | undefined,
  field: string,
): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = parseDateOnly(value.trim());
  if (parsed === null) {
    throw AppException.badRequest(
      `${field} must be a valid calendar date (YYYY-MM-DD).`,
    );
  }
  return parsed;
}

/** One submitted line, before the server assigns its ordinal. */
export interface SubmittedAccountingDocumentLine {
  accountId: string;
  /** Optional Detail item allocation (Task 30 — OD-29-03). */
  detailId?: string | null | undefined;
  debitAmount: string;
  creditAmount: string;
  description?: string | null | undefined;
  sourceLineReference?: string | null | undefined;
}

/**
 * Normalize the submitted line set.
 *
 * The server owns `line_no` (§12.5): the submission ORDER is the intent, the
 * ordinal is derived (dense, 1-based), so a client cannot create gaps or claim
 * a numbering. Amounts are canonicalized to exact `numeric(18,2)` strings; a
 * malformed, negative or over-precise amount is a 400 (the request itself was
 * unusable) — the double-entry decision about the resulting set is a 422 and
 * belongs to `assertVoucherComposition`.
 */
export function normalizeLines(
  lines: readonly SubmittedAccountingDocumentLine[],
): AccountingDocumentLineInput[] {
  if (lines.length < MIN_ACCOUNTING_DOCUMENT_LINES) {
    throw AppException.validation([
      {
        field: 'lines',
        message: voucherLineProblemMessage('too_few_lines'),
        code: 'minItems',
      },
    ]);
  }
  const normalized = lines.map((line, index) => {
    const field = `lines[${index}]`;
    if (line.accountId.trim() === '') {
      throw AppException.badRequest(`${field}.accountId is required.`);
    }
    return {
      accountId: line.accountId.trim(),
      detailId: line.detailId ?? null,
      debitAmount: normalizeAmount(line.debitAmount, `${field}.debitAmount`),
      creditAmount: normalizeAmount(line.creditAmount, `${field}.creditAmount`),
      description: normalizeLineDescription(line.description),
      sourceLineReference: normalizeSourceLineReference(
        line.sourceLineReference,
      ),
    };
  });
  return assignLineNumbers(normalized);
}

function normalizeAmount(value: string, field: string): string {
  const trimmed = value.trim();
  const problem = validateEnteredAmount(trimmed);
  if (problem === 'exceeds_precision') {
    throw AppException.badRequest(
      `${field} must fit numeric(18,2): at most 16 integer digits and 2 decimal places.`,
    );
  }
  if (problem !== null) {
    throw AppException.badRequest(
      `${field} must be a non-negative decimal with at most 2 decimal places (a negative amount is written as the opposite side, never as a sign).`,
    );
  }
  return canonicalizeAmount(trimmed);
}

/**
 * The composition verdict (§13, AC-I-07/08), as a 422 carrying every problem
 * found. The SAME decision table runs inside the guarded transaction; this
 * call is the fast feedback in front of it.
 */
export function assertVoucherComposition(
  lines: readonly AccountingDocumentLineInput[],
): void {
  const problems = checkVoucherLines(lines);
  const [first] = problems;
  if (first === undefined) return;
  throw AppException.businessRule(voucherLineProblemMessage(first), {
    problems,
  });
}

/**
 * Validate the origin/source-identity pair (§12.1, §16.1/§16.3): `manual`
 * carries no system source identity, `system` carries all four fields in the
 * code-defined snake_case grammar.
 */
export function normalizeOriginSource(input: {
  origin: string;
  source?: {
    module?: string | null | undefined;
    entityType?: string | null | undefined;
    entityId?: string | null | undefined;
    operation?: string | null | undefined;
  } | null;
}): {
  origin: AccountingDocumentOrigin;
  source: AccountingDocumentSource | null;
} {
  const origin = input.origin.trim();
  if (origin !== 'manual' && origin !== 'system') {
    throw AppException.badRequest('origin must be "manual" or "system".');
  }
  const raw = input.source;
  const source: AccountingDocumentSource | null =
    raw === null || raw === undefined
      ? null
      : {
          module: raw.module?.trim() ?? '',
          entityType: raw.entityType?.trim() ?? '',
          entityId: raw.entityId?.trim() ?? '',
          operation: raw.operation?.trim() ?? '',
        };
  const problem = checkOriginEvidence(origin, source);
  if (problem !== null) {
    throw AppException.badRequest(originProblemMessage(problem));
  }
  return { origin, source };
}

/**
 * sha256 over the canonical request payload (§16.4). Payloads are built with a
 * fixed key order and canonical values (trimmed strings, `YYYY-MM-DD` dates,
 * canonical decimals, explicit nulls), so two submissions of one logical
 * operation hash identically while any material difference changes the hash.
 *
 * Generated ids (document/line ids) and server clocks are NEVER part of a
 * payload, and neither are server-RESOLVED values (the fiscal year, period,
 * area resolution or the allocated number): a retry runs before the effect
 * exists, so hashing a resolved value would make every retry conflict with
 * itself instead of replaying (ADR-0022 §4).
 */
export function buildRequestHash(
  operation: AccountingPostingOperationKind,
  canonical: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ operation, ...canonical }))
    .digest('hex');
}

/**
 * Build the idempotency row an effect-creating voucher operation persists
 * INSIDE its own transaction (§16.4, AC-I-12).
 *
 * One shape for every kind, because the ledger's contract is one rule: the
 * caller owns the key, the canonical hash and the operation kind; the row's
 * identity is a fresh ULID that is evidence identity ONLY — never the identity
 * of a posting, of a voucher or of a ledger entry (Task 10.6 correction). The
 * `documentId` envelope is what a replay re-reads current rows from, so a
 * replay is never a stale snapshot.
 */
export function documentOperationRow(input: {
  organizationId: string;
  operationKey: string;
  operation: AccountingPostingOperationKind;
  requestHash: string;
  documentId: string;
  actorId: string | null;
  now: Date;
}): DocumentOperationRow {
  return {
    id: generateId(),
    organizationId: input.organizationId,
    operationKey: input.operationKey,
    operation: input.operation,
    requestHash: input.requestHash,
    result: { documentId: input.documentId },
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.actorId,
  };
}

/** The `AccountingDocument.*` event vocabulary this module publishes (§21). */
export type AccountingDocumentEventType =
  | typeof ACCOUNTING_DOCUMENT_CREATED_EVENT
  | typeof ACCOUNTING_DOCUMENT_UPDATED_EVENT
  | typeof ACCOUNTING_DOCUMENT_FINALIZED_EVENT
  | typeof ACCOUNTING_DOCUMENT_DELETED_EVENT;

/**
 * Publish one `AccountingDocument.*` event with the ONE payload shape (§21,
 * AC-D-35). There is deliberately no `AccountingDocument.Posted` event:
 * `final` IS posted (AC-D-20), so `Finalized` is the posting evidence — and
 * the posting seam (Task 10.8) publishes exactly this event, never a second
 * one. The payload is the stored scope plus the numbering/state/origin
 * snapshots; amounts never travel on it (a consumer reads the ledger entries).
 */
export function publishDocumentEvent(
  events: DomainEventBus,
  type: AccountingDocumentEventType,
  document: AccountingDocument,
): Promise<void> {
  return publishEvent(events, {
    type,
    aggregateType: 'AccountingDocument',
    aggregateId: document.id,
    payload: {
      id: document.id,
      organizationId: document.organizationId,
      financialAreaId: document.financialAreaId,
      fiscalYearId: document.fiscalYearId,
      accountingPeriodId: document.accountingPeriodId,
      documentType: document.documentType,
      documentNumber: document.documentNumber,
      state: document.phase,
      origin: document.origin,
    },
  });
}
