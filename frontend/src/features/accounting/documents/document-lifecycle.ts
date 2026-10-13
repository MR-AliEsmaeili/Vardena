import type { AccountingDocument } from '@/api/contracts';
import { t } from '@/lib/i18n';

/**
 * Accounting document lifecycle vocabulary and action rules (FE-UX-08).
 *
 * The model is the BACKEND's, verbatim — never a frontend invention:
 *
 * - phases/states: `draft` (pre-issuance phase, no serial yet), `temporary`
 *   (issued, numbered, still editable) and `final` (posted to the books,
 *   immutable). There is NO `initial` and NO generic `void` state, and the UI
 *   never derives a state itself — it renders the `state` string the API
 *   returned, narrowed through `parseDocumentState`.
 * - "reversed" is NOT a state: a reversed document is a `final` document whose
 *   `reversedByDocumentId` is set, and the reversal itself is a new `final`
 *   document (`correctionKind: 'reversal'`, `reversesDocumentId` set).
 * - transitions: issue (draft → temporary), finalize (temporary → final),
 *   reverse (final → new final counter-document). There is no reopen.
 *
 * Action visibility is computed from exactly three inputs the standard allows
 * — document state, session permission and backend capability (which every
 * action here has, because it maps 1:1 onto an existing endpoint). The
 * frontend never decides accounting eligibility ("this document is ready to
 * finalize"): the backend re-validates inside its own locked transaction.
 */

/** The backend's document phases (`ACCOUNTING_DOCUMENT_PHASES`). */
export const DOCUMENT_STATES = ['draft', 'temporary', 'final'] as const;

export type DocumentState = (typeof DOCUMENT_STATES)[number];

/**
 * Narrow the API's `state` string. An unrecognized value (a newer backend
 * vocabulary this UI does not know) renders honestly as `null` instead of
 * being guessed into a label.
 */
export function parseDocumentState(value: string): DocumentState | null {
  return (DOCUMENT_STATES as readonly string[]).includes(value)
    ? (value as DocumentState)
    : null;
}

export const DOCUMENT_ORIGINS = ['manual', 'system'] as const;

export type DocumentOrigin = (typeof DOCUMENT_ORIGINS)[number];

export function parseDocumentOrigin(value: string): DocumentOrigin | null {
  return (DOCUMENT_ORIGINS as readonly string[]).includes(value)
    ? (value as DocumentOrigin)
    : null;
}

/** State badge presentation per phase (the existing dashboard vocabulary). */
export const documentStatePresentation: Record<
  DocumentState,
  { label: string; variant: 'neutral' | 'info' | 'success' }
> = {
  draft: { label: t.documents.stateDraft, variant: 'neutral' },
  temporary: { label: t.documents.stateTemporary, variant: 'info' },
  final: { label: t.documents.stateFinal, variant: 'success' },
};

export function documentOriginLabel(origin: string): string {
  return parseDocumentOrigin(origin) === 'system'
    ? t.documents.originSystem
    : t.documents.originManual;
}

/** True when the backend would accept an edit of this state (§15.2). */
export function isEditableDocumentState(state: DocumentState): boolean {
  return state === 'draft' || state === 'temporary';
}

/** True when the document already has a reversal counter-document. */
export function isReversedDocument(document: AccountingDocument): boolean {
  return document.reversedByDocumentId !== null;
}

/** The permission codes the lifecycle endpoints enforce, by action. */
export interface DocumentActionPermissions {
  /** `Accounting.Document.Edit` — edit + issue (an edit-phase action). */
  edit: boolean;
  /** `Accounting.Document.Delete` — discard a pre-final voucher. */
  delete: boolean;
  /** `Accounting.Document.Finalize`. */
  finalize: boolean;
  /** `Accounting.Document.Reverse`. */
  reverse: boolean;
}

export type ActionStatus =
  /** Rendered enabled. */
  | 'available'
  /** Not rendered: the document state makes the action inapplicable. */
  | 'hidden'
  /** Rendered disabled with the missing-permission explanation (FE-UX-02 §8.2). */
  | 'forbidden';

export interface DocumentActions {
  edit: ActionStatus;
  issue: ActionStatus;
  finalize: ActionStatus;
  reverse: ActionStatus;
  delete: ActionStatus;
}

/**
 * Action visibility per state. Exhaustive by design: adding a backend state
 * without touching this switch is a compile error, so «سند قطعی با دکمۀ
 * ویرایش» cannot happen (standards.md §4).
 */
export function computeDocumentActions(
  state: DocumentState,
  permissions: DocumentActionPermissions,
  alreadyReversed: boolean,
): DocumentActions {
  switch (state) {
    case 'draft':
      return {
        edit: permissions.edit ? 'available' : 'forbidden',
        issue: permissions.edit ? 'available' : 'forbidden',
        finalize: 'hidden',
        reverse: 'hidden',
        delete: permissions.delete ? 'available' : 'forbidden',
      };
    case 'temporary':
      return {
        edit: permissions.edit ? 'available' : 'forbidden',
        // Already issued: the serial exists; re-issuing is a server-side
        // replay of the same state, not a user action.
        issue: 'hidden',
        finalize: permissions.finalize ? 'available' : 'forbidden',
        reverse: 'hidden',
        delete: permissions.delete ? 'available' : 'forbidden',
      };
    case 'final':
      return {
        edit: 'hidden',
        issue: 'hidden',
        finalize: 'hidden',
        delete: 'hidden',
        reverse: alreadyReversed
          ? 'hidden'
          : permissions.reverse
            ? 'available'
            : 'forbidden',
      };
  }
}
