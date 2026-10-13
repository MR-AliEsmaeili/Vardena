/**
 * Document lifecycle — the shared state/action model (Task 8 §7/§8/§9/§14/§15).
 *
 * This is the FOUNDATIONAL state/capability model, not a workflow engine:
 * approval chains, versioned transition configuration and transition *history*
 * belong to the Workflow Foundation (Task 9, ADR-0018). What lives here is the
 * stable spine every owning module composes with its own RBAC permission for
 * each action (Task 8 §9: user → permission → scope → document type →
 * document state → action).
 *
 * The model (Task 8 §7):
 *
 *     draft (optional pre-issuance) ──submit──▶ temporary ──finalize──▶ final
 *                                                ▲                        │
 *                                                └──────reopen────────────┘
 *
 * - `initial` is NOT a state and must never be introduced here.
 * - `final` is protected: no edit, no delete, no re-numbering (Task 8 §15).
 * - Whether a document starts in draft is configuration (`draft_required`).
 *
 * Everything here is a pure function returning a problem code — framework-free
 * (AR-05). The application layer maps problems onto `AppException` (422) and
 * the owning module maps actions onto permission codes (AR-22).
 */

import type {
  DocumentAction,
  DocumentPhase,
  DocumentState,
  DocumentTypeDefinition,
} from './document-type.js';
import {
  DRAFT_PHASE,
  DOCUMENT_ACTIONS,
  DOCUMENT_PHASES,
  isDocumentState,
} from './document-type.js';

export type DocumentLifecycleProblem =
  | 'unknown_action'
  | 'unknown_phase'
  | 'document_does_not_exist'
  | 'not_draft'
  | 'not_temporary'
  | 'not_final'
  | 'already_final'
  | 'already_temporary'
  | 'invalid_entry_state'
  | 'final_protected'
  | 'not_deletable'
  | 'draft_not_configured';

export interface DocumentLifecycleContext {
  definition: DocumentTypeDefinition;
  /** Organization-level selection (Task 8 §8): does issuance require draft? */
  draftRequired: boolean;
  /**
   * The document's current phase, or `null` when it does not exist yet (only
   * `create` is meaningful against a non-existent document).
   */
  phase: DocumentPhase | null;
}

export interface DocumentLifecyclePlan {
  problem: DocumentLifecycleProblem | null;
}

function plan(problem: DocumentLifecycleProblem | null): DocumentLifecyclePlan {
  return { problem };
}

/** Human-readable message for a lifecycle problem (for `AppException`). */
export function lifecycleProblemMessage(
  problem: DocumentLifecycleProblem,
): string {
  switch (problem) {
    case 'unknown_action':
      return 'The document action is not supported by the Foundation.';
    case 'unknown_phase':
      return 'The document is in an unknown phase.';
    case 'document_does_not_exist':
      return 'The document does not exist yet, so this action cannot apply to it.';
    case 'not_draft':
      return 'This action applies to draft documents only.';
    case 'not_temporary':
      return 'This action applies to temporary documents only.';
    case 'not_final':
      return 'This action applies to final documents only.';
    case 'already_final':
      return 'The document is already final. Final is a protected state (Task 8 §15).';
    case 'already_temporary':
      return 'The document is already temporary.';
    case 'invalid_entry_state':
      return 'The requested state is not a declared entry state for this document type.';
    case 'final_protected':
      return 'Final documents are protected: edit, delete and re-numbering are not allowed. Reopen the document first (where the owning module permits it).';
    case 'not_deletable':
      return 'This document type does not allow deletion in its current state.';
    case 'draft_not_configured':
      return 'Draft is not available for this document type in this organization.';
  }
}

/**
 * Whether a document of this type is created in the Draft phase for an
 * organization (`draft_required` and the type's capability together).
 */
export function requiresDraft(
  definition: DocumentTypeDefinition,
  draftRequired: boolean,
): boolean {
  return draftRequired && definition.draftCapable;
}

/**
 * Validate the state a document is about to ENTER issuance in (the target of a
 * draft `submit`, or the state a directly-created document lands in).
 */
export function planEntry(
  definition: DocumentTypeDefinition,
  target: DocumentState,
): DocumentLifecyclePlan {
  if (!isDocumentState(target)) return plan('unknown_phase');
  if (!definition.entryStates.includes(target)) {
    return plan('invalid_entry_state');
  }
  return plan(null);
}

/** Draft → temporary/final (Task 8 §7: the issuance transition). */
export function planSubmit(
  ctx: DocumentLifecycleContext,
  target: DocumentState,
): DocumentLifecyclePlan {
  if (ctx.phase === null) return plan('document_does_not_exist');
  if (ctx.phase !== DRAFT_PHASE) return plan('not_draft');
  return planEntry(ctx.definition, target);
}

/** temporary → final (Task 8 §7). */
export function planFinalize(
  ctx: DocumentLifecycleContext,
): DocumentLifecyclePlan {
  if (ctx.phase === null) return plan('document_does_not_exist');
  if (ctx.phase === 'final') return plan('already_final');
  if (ctx.phase !== 'temporary') return plan('not_temporary');
  return plan(null);
}

/** final → temporary (Task 8 §9: the controlled reopen). */
export function planReopen(
  ctx: DocumentLifecycleContext,
): DocumentLifecyclePlan {
  if (ctx.phase === null) return plan('document_does_not_exist');
  if (ctx.phase === 'temporary') return plan('already_temporary');
  if (ctx.phase !== 'final') return plan('not_final');
  return plan(null);
}

/**
 * Final protection (Task 8 §15): edit, delete and re-numbering are refused for
 * final documents. This is the casual-mutation guard; the controlled `reopen`
 * (with the owning module's permission) is the only way back.
 */
export function planEdit(ctx: DocumentLifecycleContext): DocumentLifecyclePlan {
  if (ctx.phase === null) return plan('document_does_not_exist');
  if (ctx.phase === 'final') return plan('final_protected');
  if (!isKnownPhase(ctx.phase)) return plan('unknown_phase');
  return plan(null);
}

/**
 * Deletion policy (Task 8 §14): the owning module declares, per type, which
 * phases are deletable; the Foundation enforces the declaration. `final` is
 * deletable only if explicitly declared.
 */
export function planDelete(
  ctx: DocumentLifecycleContext,
): DocumentLifecyclePlan {
  if (ctx.phase === null) return plan('document_does_not_exist');
  if (!isKnownPhase(ctx.phase)) return plan('unknown_phase');
  if (ctx.phase === 'final') return plan('final_protected');
  if (!ctx.definition.deletablePhases.includes(ctx.phase)) {
    return plan('not_deletable');
  }
  return plan(null);
}

/**
 * The state/action authorization hook (Task 8 §9): the Foundation's half of
 * "may this action run on a document in this state?". The owning module adds
 * its RBAC permission code for the action; the configuration half (which
 * permission, which approval) belongs to Workflow (Task 9).
 */
export function planDocumentAction(
  action: DocumentAction,
  ctx: DocumentLifecycleContext,
  target?: DocumentState,
): DocumentLifecyclePlan {
  if (!DOCUMENT_ACTIONS.includes(action)) return plan('unknown_action');
  switch (action) {
    case 'create':
      // Creating is permitted at the type level regardless of the target; the
      // entry-state choice is validated separately with `planEntry`.
      return plan(null);
    case 'view':
    case 'print':
    case 'export':
      if (ctx.phase === null) return plan('document_does_not_exist');
      return isKnownPhase(ctx.phase) ? plan(null) : plan('unknown_phase');
    case 'edit':
      return planEdit(ctx);
    case 'delete':
      return planDelete(ctx);
    case 'assign_number':
      // A number is assigned before/at issuance; a final document keeps its
      // number forever (Task 8 §15, ADR-0019 §7).
      return planEdit(ctx);
    case 'submit':
      if (target === undefined) return plan('unknown_phase');
      return planSubmit(ctx, target);
    case 'finalize':
      return planFinalize(ctx);
    case 'reopen':
      return planReopen(ctx);
  }
}

function isKnownPhase(phase: DocumentPhase): boolean {
  return DOCUMENT_PHASES.includes(phase);
}
