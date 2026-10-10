/**
 * Posting & Ledger Contract Foundation (Task 10.6,
 * contract §12…§19, §15.5/§16.4/§19.3, ADR-0026, AC-D-16…AC-D-35).
 *
 * This file defines the CONTRACT BOUNDARY between finalized vouchers,
 * posting, and the future ledger. It is NOT the posting engine and NOT the
 * ledger engine (task §1). It is framework-free (AR-05) and deterministic.
 *
 * =============================================================================
 * 1. What is the definition of a Posting? (task §3 Q1)
 * =============================================================================
 *
 * Posting is the act that makes a FINALIZED, numbered, balanced voucher part
 * of the historical books. Per contract §15.5 AC-D-23, finalization IS that
 * act: inside one locked transaction it re-validates balance (§13.1), lines,
 * account eligibility (postable, leaf, §14), resolved calendar scope
 * (open year/period, §6.2/§7.2), description and origin evidence, allocates
 * the number (§18), sets state=final + finalized_at/by, updates balance
 * projections if materialized (§19.3), writes the posting-operation row
 * (§16.4), and publishes `AccountingDocument.Finalized`.
 *
 * Therefore:
 * - Posting consumes a FINAL voucher that passed posting readiness
 *   (`domain/posting-readiness.ts` — the eligibility seam, task 10.5).
 * - Posting produces ledger entries (one per voucher line) that are immutable
 *   historical evidence (see `ledger-entry.ts`).
 * - There is NO separate `posted` state. The current lifecycle
 *   `draft → temporary → final` (AC-D-20) is sufficient. Final = posted.
 *   Adding `posted` would be a convenience invention contradicting AC-D-20
 *   and task §13.
 *
 * =============================================================================
 * 2. What is the definition of a Ledger Entry? (Q2) — see ledger-entry.ts
 * =============================================================================
 *
 * A ledger entry is an immutable, organization-scoped, area-scoped,
 * year/period-resolved, voucher-referenced, account-referenced, amount-bearing
 * historical fact derived from ONE voucher line. It carries both business
 * date (`documentDate`) and system timestamp (`postingTimestamp` = finalizedAt)
 * for audit (Class C3, §12.3), plus origin/source/correlation for traceability
 * (AC-D-35). Dimensions are deferred via OQ-41 seam.
 *
 * =============================================================================
 * 3. Relationship Voucher Line → Ledger Entry (Q3) + Voucher → Ledger (Q4)
 * =============================================================================
 *
 * ```
 * AccountingDocument (final)
 *   1
 *   │ posting (finalization)
 *   ▼
 * LedgerEntry
 *   N   (N = lines.length, ≥2)
 * ```
 *
 * - One voucher → N ledger entries (one per line).
 * - One voucher line → exactly ONE ledger entry (1:1 traceability via
 *   `voucherLineId`).
 * - One voucher can be posted at most once. Posting is one-to-one with a
 *   finalized voucher. Retry returns existing posting (idempotent).
 * - Correction/reversal creates NEW vouchers and NEW ledger entries; originals
 *   stay immutable (AC-D-22, AC-I-15).
 *
 * =============================================================================
 * 4. Posting operation identity (Q5) + Idempotency (Q6) — CORRECTED
 * =============================================================================
 *
 * The existing `accounting_posting_operations` ledger (contract §16.4,
 * AC-I-12, ADR-0022 §3/§4) is SUFFICIENT as idempotency/evidence
 * infrastructure. No second ledger, no second key scheme (task §11).
 *
 * CRITICAL DISTINCTION (correction):
 * - `accounting_posting_operations` is idempotency/evidence infrastructure,
 *   NOT a Posting entity and NOT the canonical identity of a future Posting
 *   domain object or persistent Posting record.
 * - `operationKey` / `requestHash` = idempotency identity/evidence:
 *   (organization_id, operation_key) unique, request_hash = sha256 over
 *   canonical client intent only (no generated ids, no clocks, omitted
 *   optional as explicit null). Replay: same key+same hash ⇒ replay stored
 *   result (re-reading current rows, never stale snapshot); same key+different
 *   hash ⇒ 409, nothing applied.
 * - Posting = business/domain act that makes a final voucher part of the
 *   books (finalization, §15.5 AC-D-23). It is NOT the idempotency row.
 * - LedgerEntry = resulting historical accounting evidence (immutable).
 *
 * The accepted contract does NOT require a canonical Posting persistence
 * identity in this foundation task. Therefore PostingResult carries NO
 * artificial `id = accounting_posting_operations.id`. The persistence
 * identity of a future Posting record, if such a record is eventually
 * required, is DEFERRED to the Posting Engine / Ledger persistence task and
 * must not be inferred from `accounting_posting_operations`.
 *
 * Idempotency reuse:
 * - In the atomic model where finalization and ledger materialization occur
 *   in one transaction (current §15.5), the same business operation can use
 *   the existing `document_finalize` idempotency evidence.
 * - If a future architecture intentionally separates ledger materialization
 *   into another durable transaction, the idempotency boundary and operation
 *   kind must be decided as part of that future transaction design (OQ-39
 *   dependent). This contract does NOT pre-commit to `ledger-post-${voucherId}`
 *   or any specific future kind — that decision belongs to the future task.
 *
 * =============================================================================
 * 5. State transition (Q7)
 * =============================================================================
 *
 * `temporary → final` (via `planVoucherFinalize`) is the successful posting
 * transition. It is the single act that makes the voucher part of the books.
 * No `posted` state exists nor is required.
 *
 * =============================================================================
 * 6. Reversible/correctable? (Q8)
 * =============================================================================
 *
 * No. Original ledger entries are immutable. Correction mechanisms (reversal,
 * correction/difference, replacement pair, adjustment) produce NEW final
 * vouchers with typed links and mandatory reason (AC-D-22, §15.4). Each
 * mechanism is idempotent per (original, mechanism, operationKey) via the same
 * ledger.
 *
 * =============================================================================
 * 7. What must remain immutable? (Q9)
 * =============================================================================
 *
 * - Final voucher header + lines (AC-I-05/06)
 * - Posting record (`accounting_posting_operations`) — append-only
 * - Ledger entries — immutable, never updated/deleted
 * - Numbering allocation ledger — append-only (AC-I-22)
 *
 * =============================================================================
 * 8. What must be retained permanently for audit/history? (Q10)
 * =============================================================================
 *
 * See ledger-entry.ts header: organization, area, year, period, voucher
 * id+number, line id+no, account, amounts, descriptions, origin/source,
 * correlation, finalized evidence, numbering evidence, pinned coding-structure
 * version (via account), all stored on voucher and preserved in ledger entry.
 *
 * =============================================================================
 * 9. What does future balance projection consume? (Q11)
 * =============================================================================
 *
 * Final document lines (or ledger entries) as authoritative source.
 * Materialized balances per (org, area, year, period, account) — and per
 * dimension when OQ-41 resolved — are rebuildable projections (AC-D-31,
 * AC-I-19). Consumers must NOT read operational docs or other modules' tables.
 *
 * =============================================================================
 * 10. Which parts depend on OQ-39…43? (Q12)
 * =============================================================================
 *
 * - OQ-39 durable delivery: system-origin voucher composition and its posting
 *   to ledger are blocked until resolved (AC-D-26). Contract is delivery-
 *   agnostic, interface identical for both shapes.
 * - OQ-40 financial area: multiplicity, chart scope, area applicability,
 *   grants, defaults, consolidation. We use only accepted semantics:
 *   area = bookkeeping scope, document belongs to exactly one area (AC-D-02/03),
 *   chart organization-scoped with area applicability deferred.
 * - OQ-41 dimensions: cardinality, requiredness, binding. Ledger entry carries
 *   deferred seam, no fixed columns, no EAV/JSONB.
 * - OQ-42 posting mode/approval: default Mode A vs B, who may finalize,
 *   rejection meaning. We keep lifecycle unchanged, no approval state;
 *   Mode A/B are configuration over existing Foundation entry states + Workflow.
 * - OQ-43 statutory/e-ledger: legal books, timing, language/currency,
 *   deletion prohibition, branch recording, retention. We keep business date +
 *   system timestamps, numbering evidence, immutability, branch column, so
 *   requirements remain expressible, but no rule is hardcoded.
 *
 * =============================================================================
 * TRANSACTION BOUNDARY (future, not implemented — task §12) — CORRECTED WORDING
 * =============================================================================
 *
 * Conceptual atomic posting transaction. The current accepted model
 * (§15.5 AC-D-23) is atomic: finalization IS posting and already follows
 * this boundary. If a future architecture separates ledger materialization
 * into another durable transaction, its idempotency boundary and operation
 * kind are decided then (OQ-39 dependent) — this contract does not pre-commit.
 *
 * Atomic model (finalization + ledger materialization in one transaction,
 * §15.5):
 *
 * ```
 * validate readiness (pure, no locks, domain/posting-readiness.ts)
 *   ↓
 * acquire locks in fixed order (data/accounting-locks.ts):
 *   financial area → fiscal year → accounting period → accounts (FOR SHARE)
 *   → document (FOR UPDATE)
 *   ↓
 * re-validate readiness inside transaction (ADR-0022 evaluate-inside-tx)
 *   ↓
 * create posting evidence (state=final, finalized_at/by)
 *   ↓
 * create ledger entries (one per line, preserving traceability) — if
 *   materialized as separate rows; otherwise final lines ARE the ledger
 *   (§19.2 source of truth = final lines)
 *   ↓
 * record idempotency evidence (accounting_posting_operations insert LAST,
 *   operation = document_finalize in atomic model)
 *   ↓
 * commit (all or nothing)
 *   ↓
 * publish AccountingDocument.Finalized + audit facts (AC-D-35, §23)
 * ```
 *
 * Separated model (future, if ever required):
 * - The idempotency boundary (operation kind, key derivation, evidence
 *   placement) and whether a Posting persistence record is needed must be
 *   decided as part of that future transaction design. No specific key
 *   pattern like `ledger-post-${voucherId}` is mandated here.
 *
 * No contradictory locking order. Posting readiness evaluation itself takes
 * no locks, so it can never participate in deadlock (task 10.5 §10).
 *
 * =============================================================================
 * POSTING RULES (task §15)
 * =============================================================================
 *
 * Posting rules are NOT part of the voucher→ledger input contract. They belong
 * to the source→voucher step (contract §16.3, §20.2): Accounting-owned
 * configuration mapping source facts (or control roles) to balanced vouchers.
 * They conceptually execute BEFORE finalization, during voucher composition.
 * They transform/validate source payload into a balanced voucher; output must
 * satisfy same invariants as manual voucher (balanced, postable accounts,
 * legal dimensions, open period). No unrestricted scripting, no EAV, no JSON
 * rule storage, no user code execution. If a Posting Rules Foundation must
 * exist separately, that is a future task boundary (recorded here).
 *
 * =============================================================================
 * SYSTEM-ORIGIN POSTING (task §16, OQ-39)
 * =============================================================================
 *
 * Inventory → Accounting, Sales → Accounting, etc., durable event delivery,
 * Outbox — NOT implemented. Contract seam is §16.3 PostingRequest (scope,
 * source identity, operationKey, business date, description, payload with
 * accounts or control roles). Interface is delivery-agnostic (transactional
 * subscription vs durable queue) and identical for both, so choice is swappable
 * (AC-D-26). No production system posting enabled before OQ-39.
 *
 * =============================================================================
 * The implementation below is the machine-readable contract.
 * =============================================================================
 */

import type { AccountingDocument } from './accounting-document.js';
import {
  isGregorianBusinessDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import {
  checkOriginEvidence,
  isAccountingDocumentOrigin,
} from './accounting-document.js';
import { checkVoucherLines, type VoucherLineProblem } from './voucher-lines.js';
import { canonicalizeAmount, isZeroAmount, sumAmounts } from './money.js';
import type { LedgerEntry } from './ledger-entry.js';
import { checkLedgerEntry } from './ledger-entry.js';

// ---------------------------------------------------------------------------
// Posting Source (same shape as AccountingDocumentSource, re-declared for
// contract clarity — same grammar, same column widths)
// ---------------------------------------------------------------------------

export interface PostingSource {
  readonly module: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: string;
}

// ---------------------------------------------------------------------------
// Posting Line Input (snapshot of a stored voucher line)
// ---------------------------------------------------------------------------

export interface PostingLineInput {
  /** Voucher line identity (ULID). */
  readonly id: string;
  /** 1-based dense rendering order (legal-book order, §12.5). */
  readonly lineNo: number;
  /** Postable account reference (AC-I-09). */
  readonly accountId: string;
  /** Optional detail reference (OD-29-03). */
  readonly detailId?: string | null | undefined;
  /** Non-negative exact decimal string. */
  readonly debitAmount: string;
  /** Non-negative exact decimal string. */
  readonly creditAmount: string;
  /** Optional line narration. */
  readonly description: string | null;
  /** Optional logical line reference for system origin (§12.5). */
  readonly sourceLineReference: string | null;
}

// ---------------------------------------------------------------------------
// Posting Input — immutable snapshot required by posting
// ---------------------------------------------------------------------------

/**
 * Minimum immutable input required by posting (task §6).
 *
 * Every field has domain justification (see file header and inline comments).
 * No database column is blindly included; no Prisma, no HTTP, no DTO.
 *
 * This is a snapshot/reference model: the future Posting Engine must consume
 * THIS contract, not Prisma models or controller objects (task §5).
 */
export interface PostingInput {
  /** Tenant scope (AC-I-01). */
  readonly organizationId: string;
  /** Bookkeeping scope (AC-D-02/03). */
  readonly financialAreaId: string;
  /** Stored fiscal year resolution (AC-I-02/14). */
  readonly fiscalYearId: string;
  /** Stored accounting period resolution (AC-I-02/14). */
  readonly accountingPeriodId: string;
  /** Voucher identity (AC-I-14). */
  readonly voucherId: string;
  /** Numeric-only serial, immutable after final (AC-I-22, §18). */
  readonly voucherNumber: string;
  /** Business date, date-only (Class C3, §12.3). */
  readonly documentDate: BusinessDate;
  /** Header narration, required non-blank (§12.2). */
  readonly description: string;
  /** Optional operational scope dimension (AC-D-17, Class C5). */
  readonly branchId: string | null;
  /** Manual vs system origin (AC-D-24). */
  readonly origin: 'manual' | 'system';
  /** Logical source identity for system origin (AC-D-25, §16.3). */
  readonly source: PostingSource | null;
  /** End-to-end traceability (architecture §9). */
  readonly correlationId: string | null;
  /** Finalization evidence: when voucher became final (§15.5, §23). */
  readonly finalizedAt: Date;
  /** Actor who finalized (audit, §23). */
  readonly finalizedBy: string | null;
  /** Accounting facts: ≥2 lines, balanced (AC-I-07/08). */
  readonly lines: readonly PostingLineInput[];
  /**
   * Posting operation identity (task §11, §16.4 AC-I-12).
   * Reuses existing `accounting_posting_operations` ledger:
   * (organizationId, operationKey) unique, same scheme as Inventory.
   * This is the finalization's operationKey for voucher→ledger posting.
   */
  readonly operationKey: string;
  /** sha256 over canonical client intent only (ADR-0022 §4). */
  readonly requestHash: string;
}

// ---------------------------------------------------------------------------
// Posting Output — CORRECTED: no artificial id = accounting_posting_operations.id
// ---------------------------------------------------------------------------

/**
 * Posting result — stable machine-readable result of posting (task §7).
 *
 * CORRECTED CONTRACT (review):
 * - `accounting_posting_operations` is idempotency/evidence infrastructure,
 *   NOT a Posting entity identity.
 * - Posting = business/domain act (finalization makes voucher part of books,
 *   §15.5 AC-D-23).
 * - LedgerEntry = resulting historical evidence (immutable).
 * - The persistence identity of a future Posting record, if ever required,
 *   is DEFERRED to the Posting Engine / Ledger persistence task and must not
 *   be inferred from `accounting_posting_operations`.
 *
 * Therefore PostingResult carries NO `id = accounting_posting_operations.id`.
 * The accepted contract does NOT require a canonical Posting persistence id
 * in this foundation task; result is identified by voucher + operationKey
 * (idempotency evidence) + postedAt, plus the ledger entries.
 *
 * Balances are NOT part of result — they are rebuildable projections
 * (§19.3 AC-D-31).
 */
export interface PostingResult {
  /** Tenant scope. */
  readonly organizationId: string;
  /** Bookkeeping scope. */
  readonly financialAreaId: string;
  /** Source voucher identity. */
  readonly voucherId: string;
  /** Voucher number (numbering evidence). */
  readonly voucherNumber: string;
  /** Operation key that made posting idempotent (AC-I-12) — idempotency identity. */
  readonly operationKey: string;
  /** Request hash over canonical intent (ADR-0022 §4) — idempotency evidence. */
  readonly requestHash: string;
  /** When posting happened (finalizedAt). */
  readonly postedAt: Date;
  /** Resulting ledger entries (N = lines.length, 1:1 traceability). */
  readonly ledgerEntries: readonly LedgerEntry[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type PostingInputProblem =
  | 'missing_organization'
  | 'missing_financial_area'
  | 'missing_fiscal_year'
  | 'missing_accounting_period'
  | 'missing_voucher_id'
  | 'missing_voucher_number'
  | 'missing_document_date'
  | 'missing_description'
  | 'blank_description'
  | 'missing_finalized_at'
  | 'invalid_origin'
  | 'source_required_for_system'
  | 'source_forbidden_for_manual'
  | 'malformed_source'
  | 'missing_operation_key'
  | 'missing_request_hash'
  | VoucherLineProblem;

export function postingInputProblemMessage(
  problem: PostingInputProblem,
): string {
  switch (problem) {
    case 'missing_organization':
      return 'Posting input requires an organization scope.';
    case 'missing_financial_area':
      return 'Posting input requires a financial area scope.';
    case 'missing_fiscal_year':
      return 'Posting input requires a fiscal year resolution.';
    case 'missing_accounting_period':
      return 'Posting input requires an accounting period resolution.';
    case 'missing_voucher_id':
      return 'Posting input requires a voucher identity.';
    case 'missing_voucher_number':
      return 'Posting input requires a voucher number (numbering evidence).';
    case 'missing_document_date':
      return 'Posting input requires a business date (document date).';
    case 'missing_description':
      return 'Posting input requires a header description.';
    case 'blank_description':
      return 'Posting input description must be non-blank.';
    case 'missing_finalized_at':
      return 'Posting input requires a finalization timestamp.';
    case 'invalid_origin':
      return 'Posting origin must be manual or system.';
    case 'source_required_for_system':
      return 'System-origin posting requires a source identity.';
    case 'source_forbidden_for_manual':
      return 'Manual posting must not carry a source identity.';
    case 'malformed_source':
      return 'Posting source identity is malformed.';
    case 'missing_operation_key':
      return 'Posting input requires an operation key (idempotency).';
    case 'missing_request_hash':
      return 'Posting input requires a request hash (idempotency).';
    default:
      // VoucherLineProblem messages are defined in voucher-lines.ts
      return `Voucher line problem: ${problem}`;
  }
}

/**
 * Validate posting input against minimum invariants (every problem at once).
 */
export function checkPostingInput(input: PostingInput): PostingInputProblem[] {
  const problems: PostingInputProblem[] = [];

  if (input.organizationId.trim() === '') problems.push('missing_organization');
  if (input.financialAreaId.trim() === '')
    problems.push('missing_financial_area');
  if (input.fiscalYearId.trim() === '') problems.push('missing_fiscal_year');
  if (input.accountingPeriodId.trim() === '')
    problems.push('missing_accounting_period');
  if (input.voucherId.trim() === '') problems.push('missing_voucher_id');
  if (input.voucherNumber.trim() === '')
    problems.push('missing_voucher_number');

  if (!isGregorianBusinessDate(input.documentDate)) {
    problems.push('missing_document_date');
  }

  if (input.description === undefined || input.description === null) {
    problems.push('missing_description');
  } else if (input.description.trim() === '') {
    problems.push('blank_description');
  }

  if (
    !(input.finalizedAt instanceof Date) ||
    Number.isNaN(input.finalizedAt.getTime())
  ) {
    problems.push('missing_finalized_at');
  }

  if (!isAccountingDocumentOrigin(input.origin)) {
    problems.push('invalid_origin');
  } else {
    const originProblem = checkOriginEvidence(
      input.origin,
      input.source as any,
    );
    if (originProblem !== null) {
      problems.push(originProblem as PostingInputProblem);
    }
  }

  if (input.operationKey.trim() === '') problems.push('missing_operation_key');
  if (input.requestHash.trim() === '') problems.push('missing_request_hash');

  // Reuse the single decision table for line composition (no second implementation)
  const lineProblems = checkVoucherLines(
    input.lines.map((line) => ({
      lineNo: line.lineNo,
      accountId: line.accountId,
      debitAmount: line.debitAmount,
      creditAmount: line.creditAmount,
      description: line.description,
      sourceLineReference: line.sourceLineReference,
    })),
  );
  problems.push(...(lineProblems as PostingInputProblem[]));

  return [...new Set(problems)];
}

export function isValidPostingInput(input: PostingInput): boolean {
  return checkPostingInput(input).length === 0;
}

// ---------------------------------------------------------------------------
// Conversion: AccountingDocument (final) → PostingInput
// ---------------------------------------------------------------------------

/**
 * Convert a FINALIZED accounting document into a posting input snapshot.
 *
 * Pure, non-mutating: does not modify the source document, allocates no
 * number, writes no ledger row. Returns a deep-copied snapshot that the future
 * engine can consume without depending on Prisma or DTOs (task §5).
 *
 * Throws if document is not final or not numbered — those are preconditions
 * for posting (AC-I-05, §18).
 */
export function toPostingInput(params: {
  document: AccountingDocument;
  operationKey: string;
  requestHash: string;
}): PostingInput {
  const { document, operationKey, requestHash } = params;

  if (document.phase !== 'final') {
    throw new Error(
      `Cannot create posting input for non-final document "${document.id}" (phase=${document.phase}). Only final vouchers may be posted (AC-D-20).`,
    );
  }
  if (document.documentNumber === null) {
    throw new Error(
      `Cannot create posting input for unnumbered final document "${document.id}". A final document always has a number (§18, AC-I-22).`,
    );
  }
  if (document.finalizedAt === null) {
    throw new Error(
      `Cannot create posting input for final document "${document.id}" without finalizedAt evidence (§15.5).`,
    );
  }

  // Deep copy lines to guarantee immutability — mutating the returned input
  // must not affect the source document (task §22 immutability).
  const lines: PostingLineInput[] = [...document.lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      accountId: line.accountId,
      detailId: line.detailId ?? null,
      debitAmount: line.debitAmount,
      creditAmount: line.creditAmount,
      description: line.description,
      sourceLineReference: line.sourceLineReference,
    }));

  return {
    organizationId: document.organizationId,
    financialAreaId: document.financialAreaId,
    fiscalYearId: document.fiscalYearId,
    accountingPeriodId: document.accountingPeriodId,
    voucherId: document.id,
    voucherNumber: document.documentNumber,
    documentDate: document.documentDate,
    description: document.description,
    branchId: document.branchId,
    origin: document.origin,
    source: document.source
      ? {
          module: document.source.module,
          entityType: document.source.entityType,
          entityId: document.source.entityId,
          operation: document.source.operation,
        }
      : null,
    correlationId: document.correlationId,
    finalizedAt: new Date(document.finalizedAt.getTime()),
    finalizedBy: document.finalizedBy,
    lines,
    operationKey,
    requestHash,
  };
}

// ---------------------------------------------------------------------------
// Conversion: PostingInput → LedgerEntry[] (future engine's pure transform)
// ---------------------------------------------------------------------------

/**
 * Convert a valid posting input into ledger entries (1 line → 1 entry).
 *
 * Pure, deterministic, non-mutating: same input yields same entries (except
 * generated ids). Preserves full traceability Voucher Line → Ledger Entry via
 * `voucherLineId` and `lineNo`, `accountId`, amounts, etc.
 *
 * This function does NOT write to database — it is the contract of what the
 * future engine will produce. The engine will create entries inside the
 * atomic posting transaction (see file header transaction boundary) and record
 * idempotency evidence last.
 *
 * @param input Valid posting input (check with `checkPostingInput` first)
 * @param generateId Function to generate ledger entry ids (ULID). Injected to
 *                   keep function pure and testable; production uses `generateId`.
 */
export function toLedgerEntries(
  input: PostingInput,
  generateId: () => string,
): LedgerEntry[] {
  const entries: LedgerEntry[] = input.lines.map((line) => ({
    id: generateId(),
    organizationId: input.organizationId,
    financialAreaId: input.financialAreaId,
    fiscalYearId: input.fiscalYearId,
    accountingPeriodId: input.accountingPeriodId,
    voucherId: input.voucherId,
    voucherNumber: input.voucherNumber,
    voucherLineId: line.id,
    lineNo: line.lineNo,
    accountId: line.accountId,
    detailId: line.detailId ?? null,
    debitAmount: canonicalizeAmount(line.debitAmount),
    creditAmount: canonicalizeAmount(line.creditAmount),
    description: line.description,
    documentDate: input.documentDate,
    postingTimestamp: new Date(input.finalizedAt.getTime()),
    branchId: input.branchId,
    origin: input.origin,
    source: input.source
      ? {
          module: input.source.module,
          entityType: input.source.entityType,
          entityId: input.source.entityId,
          operation: input.source.operation,
        }
      : null,
    correlationId: input.correlationId,
    finalizedBy: input.finalizedBy,
    dimensionAssignments: [], // OQ-41 deferred seam, empty until resolved
  }));

  // Defensive: ensure resulting entries themselves satisfy ledger invariants
  // and that they balance (Σ debit = Σ credit) per voucher (AC-I-07).
  // This is a contract-level assertion, not a runtime guard that would hide bugs.
  for (const entry of entries) {
    const problems = checkLedgerEntry(entry);
    if (problems.length > 0) {
      throw new Error(
        `Generated ledger entry "${entry.id}" violates invariants: ${problems.join(', ')}`,
      );
    }
  }

  const totalDebit = sumAmounts(entries.map((e) => e.debitAmount));
  const totalCredit = sumAmounts(entries.map((e) => e.creditAmount));
  if (canonicalizeAmount(totalDebit) !== canonicalizeAmount(totalCredit)) {
    throw new Error(
      `Generated ledger entries are unbalanced: debit=${totalDebit} credit=${totalCredit} (AC-I-07).`,
    );
  }
  if (
    entries.some(
      (e) => isZeroAmount(e.debitAmount) && isZeroAmount(e.creditAmount),
    )
  ) {
    throw new Error('Generated ledger entries contain zero line (AC-I-08).');
  }

  return entries;
}

/**
 * Convert posting input to a posting result.
 *
 * CORRECTED: no `postingId = accounting_posting_operations.id`. The result
 * is identified by voucher + operationKey/requestHash (idempotency evidence)
 * + postedAt, plus ledger entries. If a future Posting persistence record is
 * ever required, its identity is deferred to that future task and must not be
 * inferred from `accounting_posting_operations`.
 *
 * @param input Valid posting input
 * @param generateId Id generator for ledger entries
 */
export function toPostingResult(params: {
  input: PostingInput;
  generateId: () => string;
}): PostingResult {
  const { input, generateId } = params;
  const ledgerEntries = toLedgerEntries(input, generateId);
  return {
    organizationId: input.organizationId,
    financialAreaId: input.financialAreaId,
    voucherId: input.voucherId,
    voucherNumber: input.voucherNumber,
    operationKey: input.operationKey,
    requestHash: input.requestHash,
    postedAt: new Date(input.finalizedAt.getTime()),
    ledgerEntries,
  };
}
