/**
 * Accounting document (voucher) — the accounting-owned aggregate (Task 10.4,
 * contract §12/§15/§16/§18, ADR-0026, AC-D-16…AC-D-24).
 *
 * There is exactly ONE registered document type in v1 — `accounting_voucher` —
 * written by two origins (`manual` | `system`). Origin is an ATTRIBUTE, not a
 * second table: the invariants are identical for both, which is what makes the
 * books trustworthy (§12.1). No production system-posting integration exists
 * before OQ-39 is resolved (§16.6, AC-D-26), so the HTTP surface composes
 * `manual` documents only — the aggregate itself can represent (and the domain
 * validates) the system shape, because Task 10.4's row must be able to.
 *
 * Lifecycle (AC-D-20): the Document Foundation's phase/state model VERBATIM —
 * `draft (phase) → temporary → final (states)`. Nothing is re-implemented
 * here: the planners below compose the Foundation's pure decision functions
 * (`documents/domain/document-lifecycle.ts`) with Accounting's own rules
 * (which type, which deletable phases) and Accounting's own RBAC permissions
 * (§15.1: "the Foundation supplies the state half of the decision, Accounting
 * supplies the authority half"). The Foundation's vocabulary is a shared,
 * framework-free contract, not another module's data (AR-07 forbids reading
 * another module's tables/models; this is the documented composition point of
 * ADR-0023 §2/§6 — the owning module owns the lifecycle actions).
 *
 * What is deliberately ABSENT (§15.4, AR-29 — no speculative behavior):
 * - no reopen (final → temporary): Accounting refuses it, corrections are
 *   counter-documents (AC-D-22 rule 5);
 * - Task 15 ships REVERSAL only (a new Final document with debit/credit
 *   swapped, original immutable except `reversed_by`). Correction /
 *   replacement / adjustment / opening / carry-forward stay out of scope;
 * - no approval state (`Accounting.Document.Approve` is not registered: the
 *   Workflow Foundation owns approvals and OQ-42 owns the policy);
 * - no posting/ledger/balance behavior (contract §19/§20).
 *
 * Framework-free (AR-05): no Nest, no Prisma, no HTTP.
 */

import {
  DRAFT_PHASE,
  DOCUMENT_STATES,
  defaultEntryState,
  type DocumentPhase,
  type DocumentState,
  type DocumentTypeDefinition,
} from '../../documents/domain/document-type.js';
import {
  lifecycleProblemMessage,
  planDelete,
  planDocumentAction,
  planEdit,
  planEntry,
  requiresDraft,
  type DocumentLifecycleContext,
  type DocumentLifecycleProblem,
} from '../../documents/domain/document-lifecycle.js';
import { formatDateOnly } from './date-range.js';
import type { BusinessDate } from '../../../kernel/datetime/business-date.js';
import { canonicalizeAmount, sumAmounts } from './money.js';
import type { AccountingDocumentLine } from './voucher-lines.js';
import type { AccountingCorrectionKind } from './document-reversal.js';

/** The one registered accounting document type of v1 (§12.1, AC-D-16). */
export const ACCOUNTING_VOUCHER_DOCUMENT_TYPE = 'accounting_voucher';

/**
 * The type as the Accounting module registers it in the Foundation's registry
 * at startup (`application/accounting-document-type-registration.ts`).
 *
 * - `entryStates: ['temporary']` — a directly-created (non-draft) voucher
 *   enters issuance in `temporary`; `final` is reached only by finalizing, so
 *   Mode A "direct final" (§17.2) is a system-posting configuration this task
 *   does NOT enable (OQ-42 + OQ-39).
 * - `deletablePhases: ['draft', 'temporary']` — AC-D-21 verbatim; `final` is
 *   never deletable and is therefore deliberately not declared.
 */
export const ACCOUNTING_VOUCHER_TYPE_DEFINITION: DocumentTypeDefinition = {
  code: ACCOUNTING_VOUCHER_DOCUMENT_TYPE,
  module: 'accounting',
  name: 'Accounting voucher',
  description:
    'A balanced double-entry accounting document (temporary or final), owned by the Accounting module.',
  draftCapable: true,
  entryStates: ['temporary'],
  deletablePhases: [DRAFT_PHASE, 'temporary'],
};

/**
 * The numbering scope key for a financial area (§18: `scope_key` = the
 * financial area).
 *
 * The Foundation's scope token is opaque but its grammar is lowercase
 * (`domain/numbering.ts`: `^[a-z0-9_-]{0,64}$`), while a ULID is uppercase
 * Crockford base32. The area's IDENTITY is its ULID, and lowercasing a ULID is
 * lossless and injective (the alphabet has no case-ambiguous pairs), so the
 * encoding is `financialAreaId.toLowerCase()` — one series per area, stable
 * forever, and never the area `code` (a business code may contain characters
 * the token grammar refuses, and codes are editable while IDs are not).
 * Series configuration therefore uses this exact token; see `docs/modules.md`.
 */
export function voucherScopeKey(financialAreaId: string): string {
  return financialAreaId.toLowerCase();
}

/** Where a document sits: the Foundation's phases (§15.1). */
export const ACCOUNTING_DOCUMENT_PHASES = [
  DRAFT_PHASE,
  ...DOCUMENT_STATES,
] as const;

export type AccountingDocumentPhase = DocumentPhase;

export function isAccountingDocumentPhase(
  value: string,
): value is AccountingDocumentPhase {
  return (ACCOUNTING_DOCUMENT_PHASES as readonly string[]).includes(value);
}

/** True when the phase is editable (draft and temporary are, §15.2). */
export function isEditablePhase(phase: AccountingDocumentPhase): boolean {
  return phase === DRAFT_PHASE || phase === 'temporary';
}

// ---------------------------------------------------------------------------
// Origin and system-source identity (§12.1, §16.1/§16.3)
// ---------------------------------------------------------------------------

export const ACCOUNTING_DOCUMENT_ORIGINS = ['manual', 'system'] as const;

export type AccountingDocumentOrigin =
  (typeof ACCOUNTING_DOCUMENT_ORIGINS)[number];

export function isAccountingDocumentOrigin(
  value: string,
): value is AccountingDocumentOrigin {
  return (ACCOUNTING_DOCUMENT_ORIGINS as readonly string[]).includes(value);
}

/** The logical source identity of a system-origin document (§16.3). */
export interface AccountingDocumentSource {
  /** Code-defined module name, lowercase snake_case (`inventory`). */
  module: string;
  /** Code-defined entity type, lowercase snake_case (`inventory_movement`). */
  entityType: string;
  /** ULID of the source entity — a logical reference, never an FK. */
  entityId: string;
  /** Code-defined operation (`post`, `reverse`, `adjust`, …). */
  operation: string;
}

/** Column widths the source identity must respect (`accounting_documents`). */
export const MAX_SOURCE_MODULE_LENGTH = 64;
export const MAX_SOURCE_ENTITY_TYPE_LENGTH = 64;
export const MAX_SOURCE_ENTITY_ID_LENGTH = 128;
export const MAX_SOURCE_OPERATION_LENGTH = 32;

/** The snake_case grammar shared with the Document Foundation's vocabulary. */
const SOURCE_TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export type AccountingDocumentOriginProblem =
  /** A `system` document must carry its full source identity (§16.3). */
  | 'source_required_for_system'
  /** A `manual` document must NOT carry source identity (§16.1). */
  | 'source_forbidden_for_manual'
  /** A malformed source identity (grammar or column width). */
  | 'malformed_source';

export function originProblemMessage(
  problem: AccountingDocumentOriginProblem,
): string {
  switch (problem) {
    case 'source_required_for_system':
      return 'A system-origin accounting document requires sourceModule, sourceEntityType, sourceEntityId and sourceOperation.';
    case 'source_forbidden_for_manual':
      return 'A manual accounting document must not carry a system source identity.';
    case 'malformed_source':
      return `A source identity must be lowercase snake_case tokens (module/entity type, operation) within the column widths (${MAX_SOURCE_MODULE_LENGTH}/${MAX_SOURCE_ENTITY_TYPE_LENGTH}/${MAX_SOURCE_ENTITY_ID_LENGTH}/${MAX_SOURCE_OPERATION_LENGTH}).`;
  }
}

/**
 * Decide whether the origin/source-identity pair is consistent (§12.1,
 * §16.3). Manual documents prove WHO wrote them through the actor columns;
 * system documents prove WHERE the posting came from through the logical
 * source identity, and the two are mutually exclusive on purpose.
 */
export function checkOriginEvidence(
  origin: AccountingDocumentOrigin,
  source: AccountingDocumentSource | null,
): AccountingDocumentOriginProblem | null {
  if (origin === 'manual') {
    return source === null ? null : 'source_forbidden_for_manual';
  }
  if (source === null) return 'source_required_for_system';
  const malformed =
    !SOURCE_TOKEN_PATTERN.test(source.module) ||
    !SOURCE_TOKEN_PATTERN.test(source.entityType) ||
    source.entityId.trim() === '' ||
    source.entityId.length > MAX_SOURCE_ENTITY_ID_LENGTH ||
    !SOURCE_TOKEN_PATTERN.test(source.operation) ||
    source.operation.length > MAX_SOURCE_OPERATION_LENGTH;
  return malformed ? 'malformed_source' : null;
}

// ---------------------------------------------------------------------------
// Lifecycle decisions (composed Foundation vocabulary, §15.1/§15.2/§15.3)
// ---------------------------------------------------------------------------

export interface VoucherCreatePlan {
  problem: DocumentLifecycleProblem | null;
  /** The phase a directly-created voucher lands in. */
  phase: AccountingDocumentPhase;
}

/**
 * Where a created voucher starts (§15.1): `draft` when the organization
 * requires it, otherwise the type's entry state (`temporary`) — issuance
 * happens at create in that case, so a number is allocated then.
 *
 * `forceDraft` (C-62, PDR-10 C62-OD-02) is the EXPLICIT request to start in
 * `draft` regardless of the organization's `draft_required` selection. It is
 * Accounting-owned policy: the Warehouse-configured posting mode arrives
 * through the approved application contract, and Accounting — which owns draft
 * classification and lifecycle — decides what that mode means for the phase.
 * It is never client-supplied over HTTP.
 */
export function planVoucherCreate(ctx: {
  draftRequired: boolean;
  forceDraft?: boolean | undefined;
}): VoucherCreatePlan {
  if (ctx.forceDraft === true) {
    return { problem: null, phase: DRAFT_PHASE };
  }
  if (requiresDraft(ACCOUNTING_VOUCHER_TYPE_DEFINITION, ctx.draftRequired)) {
    return { problem: null, phase: DRAFT_PHASE };
  }
  const target: DocumentState = defaultEntryState(
    ACCOUNTING_VOUCHER_TYPE_DEFINITION,
  );
  const plan = planEntry(ACCOUNTING_VOUCHER_TYPE_DEFINITION, target);
  return plan.problem === null
    ? { problem: null, phase: target }
    : { problem: plan.problem, phase: DRAFT_PHASE };
}

/**
 * The one lifecycle context every planner composes with: the registered type
 * plus the organization's `draft_required` selection. Planners take the
 * document's PHASE (or `null` when it does not exist yet) rather than a whole
 * context object, so a caller cannot pass a draft-requirement that the
 * decision does not depend on.
 */
function contextFor(
  phase: AccountingDocumentPhase | null,
): DocumentLifecycleContext {
  return {
    definition: ACCOUNTING_VOUCHER_TYPE_DEFINITION,
    // Only `requiresDraft` reads this, and `create` is planned before any row
    // exists; every other planner is phase-only, so the flag is inert here.
    draftRequired: false,
    phase,
  };
}

/** Edit: allowed while editable, `final_protected` afterwards (§15.2). */
export function planVoucherEdit(phase: AccountingDocumentPhase): {
  problem: DocumentLifecycleProblem | null;
} {
  return planEdit(contextFor(phase));
}

/**
 * Delete: the Foundation's declared policy decides (§15.3, AC-D-21) —
 * `draft` and `temporary` are deletable, `final` is `final_protected`.
 */
export function planVoucherDelete(phase: AccountingDocumentPhase): {
  problem: DocumentLifecycleProblem | null;
} {
  return planDelete(contextFor(phase));
}

/**
 * The financial area is immutable once the document is issued (AC-D-03): the
 * serial's scope is the area (§18), so re-homing a numbered voucher would move
 * a number across series. A draft has no serial yet, so it may still move.
 */
export function planVoucherAreaChange(input: {
  phase: AccountingDocumentPhase;
  areaChanged: boolean;
}): { problem: 'area_immutable_after_issuance' | null } {
  if (!input.areaChanged || input.phase === DRAFT_PHASE) {
    return { problem: null };
  }
  return { problem: 'area_immutable_after_issuance' };
}

export const AREA_IMMUTABLE_AFTER_ISSUANCE_MESSAGE =
  'The financial area of an issued accounting document cannot change: the document number belongs to that area’s series. Discard the document while it is a draft or a temporary voucher and compose a new one instead.';

/** Finalization problem codes for the accounting surface. */
export const FINAL_PROTECTED_MESSAGE =
  'Final accounting documents are immutable: no field, line, date, number or period change is possible, and they cannot be deleted (contract §15.2/§15.3, AC-I-05/06).';

export type VoucherIssuePlan =
  /** Draft → temporary: allocate the number (§18). */
  | { kind: 'issue' }
  /**
   * The voucher is already issued. Issuance is idempotent on its POST-state
   * (the number was allocated once, at issuance, and never changes): a retry
   * replays instead of allocating a second serial (AC-I-22).
   */
  | { kind: 'replay' }
  | { kind: 'refused'; problem: DocumentLifecycleProblem };

/**
 * Issuance (draft → temporary, §15.2). A numbered `temporary` document is the
 * post-state of this operation, so a repeat call is a replay; `final` is
 * protected (a final document's number is immutable, and re-issuing it is not
 * an operation the contract defines).
 */
export function planVoucherIssue(
  phase: AccountingDocumentPhase,
): VoucherIssuePlan {
  if (phase === 'temporary') return { kind: 'replay' };
  if (phase === 'final') {
    return { kind: 'refused', problem: 'final_protected' };
  }
  const plan = planDocumentAction('submit', contextFor(phase), 'temporary');
  return plan.problem === null
    ? { kind: 'issue' }
    : { kind: 'refused', problem: plan.problem };
}

/** Finalization (temporary → final) — the authoritative re-check runs in the
 * finalization transaction (§15.5); this decides the state half only. */
export function planVoucherFinalize(phase: AccountingDocumentPhase): {
  problem: DocumentLifecycleProblem | null;
} {
  return planDocumentAction('finalize', contextFor(phase));
}

export function lifecycleProblemText(
  problem: DocumentLifecycleProblem,
): string {
  return lifecycleProblemMessage(problem);
}

// ---------------------------------------------------------------------------
// Aggregate + DTO
// ---------------------------------------------------------------------------

export interface AccountingDocument {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  documentType: string;
  /** Numeric-only serial; `null` until issuance (§18). */
  documentNumber: string | null;
  /** Business date (`date`-only); no time or zone. */
  documentDate: BusinessDate;
  description: string;
  phase: AccountingDocumentPhase;
  origin: AccountingDocumentOrigin;
  branchId: string | null;
  source: AccountingDocumentSource | null;
  /** System-origin idempotency evidence (§16.4); `null` for manual. */
  idempotencyReference: string | null;
  requestHash: string | null;
  finalizedAt: Date | null;
  finalizedBy: string | null;
  correctionKind: AccountingCorrectionKind | null;
  correctionReason: string | null;
  reversesDocumentId: string | null;
  reversedByDocumentId: string | null;
  correlationId: string | null;
  lines: AccountingDocumentLine[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountingDocumentLineDto {
  id: string;
  lineNo: number;
  accountId: string;
  detailId: string | null;
  /** Canonical decimal strings (`numeric(18,2)` values, never floats). */
  debitAmount: string;
  creditAmount: string;
  description: string | null;
  sourceLineReference: string | null;
}

export interface AccountingDocumentDto {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  documentType: string;
  documentNumber: string | null;
  /** `YYYY-MM-DD` — a business date, never an instant (§12.3). */
  documentDate: string;
  description: string;
  state: AccountingDocumentPhase;
  origin: AccountingDocumentOrigin;
  branchId: string | null;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  sourceOperation: string | null;
  finalizedAt: string | null;
  finalizedBy: string | null;
  correctionKind: AccountingCorrectionKind | null;
  correctionReason: string | null;
  reversesDocumentId: string | null;
  reversedByDocumentId: string | null;
  correlationId: string | null;
  lines: AccountingDocumentLineDto[];
  /** Derived totals — never client-supplied (§13.5). */
  totalDebit: string;
  totalCredit: string;
  createdAt: string;
  updatedAt: string;
}

export function toAccountingDocumentDto(
  document: AccountingDocument,
): AccountingDocumentDto {
  const lines = [...document.lines]
    .sort((left, right) => left.lineNo - right.lineNo)
    .map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      accountId: line.accountId,
      detailId: line.detailId ?? null,
      debitAmount: canonicalizeAmount(line.debitAmount),
      creditAmount: canonicalizeAmount(line.creditAmount),
      description: line.description,
      sourceLineReference: line.sourceLineReference,
    }));
  return {
    id: document.id,
    organizationId: document.organizationId,
    financialAreaId: document.financialAreaId,
    fiscalYearId: document.fiscalYearId,
    accountingPeriodId: document.accountingPeriodId,
    documentType: document.documentType,
    documentNumber: document.documentNumber,
    documentDate: formatDateOnly(document.documentDate),
    description: document.description,
    state: document.phase,
    origin: document.origin,
    branchId: document.branchId,
    sourceModule: document.source?.module ?? null,
    sourceEntityType: document.source?.entityType ?? null,
    sourceEntityId: document.source?.entityId ?? null,
    sourceOperation: document.source?.operation ?? null,
    finalizedAt: document.finalizedAt?.toISOString() ?? null,
    finalizedBy: document.finalizedBy,
    correctionKind: document.correctionKind,
    correctionReason: document.correctionReason,
    reversesDocumentId: document.reversesDocumentId,
    reversedByDocumentId: document.reversedByDocumentId,
    correlationId: document.correlationId,
    lines,
    totalDebit: sumAmounts(lines.map((line) => line.debitAmount)),
    totalCredit: sumAmounts(lines.map((line) => line.creditAmount)),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
