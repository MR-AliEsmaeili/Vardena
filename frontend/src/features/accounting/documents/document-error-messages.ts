import type { UseFormReturn } from 'react-hook-form';
import { normalizeApiError, type ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import type { DocumentFormValues } from './document-form-schema';

/**
 * Operation-scoped error presentation for the document lifecycle
 * (FE-UX-02 §2.1).
 *
 * The decision order is mandatory and implemented exactly:
 * 1. classify by the STABLE ERROR CODE — never by searching `message`
 *    (`if (error.message.includes(...))` is forbidden);
 * 2. use the allow-listed, documented structured `details` the backend's
 *    `mapDocumentGuardError` emits (`details.problem`, `details.problems`,
 *    `details.scope/status`, `details.documentDate`, `details.state`) to pick
 *    a more precise Persian message — anything else in `details` is ignored;
 * 3. fall back to the safe, operation-specific dictionary copy.
 *
 * The backend `message` is NEVER user copy and is never rendered.
 */

export type DocumentOperation =
  | 'loadList'
  | 'loadDocument'
  | 'create'
  | 'update'
  | 'issue'
  | 'finalize'
  | 'reverse'
  | 'delete';

const OPERATION_FAILURE: Record<DocumentOperation, string> = {
  loadList: t.documents.loadListFailed,
  loadDocument: t.documents.loadDocumentFailed,
  create: t.documents.createFailed,
  update: t.documents.updateFailed,
  issue: t.documents.issueFailed,
  finalize: t.documents.finalizeFailed,
  reverse: t.documents.reverseFailed,
  delete: t.documents.deleteFailed,
};

/** The allow-listed line-composition problems (`details.problems`). */
const LINE_PROBLEM_MESSAGES: Record<string, string> = {
  ...t.documents.lineProblems,
};

/** The allow-listed single-problem discriminators (`details.problem`). */
const PROBLEM_MESSAGES: Record<string, string> = {
  already_reversed: t.documents.business.alreadyReversed,
  not_final: t.documents.business.reverseNotFinal,
  account_not_postable: t.documents.business.accountNotPostable,
  account_disabled: t.documents.business.accountDisabled,
  area_immutable_after_issuance: t.documents.areaImmutableHint,
};

export interface DocumentErrorMessage {
  message: string;
  /** Support correlation id — never the reason for the failure. */
  correlationId?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isKnownScope(value: unknown): value is 'area' | 'year' | 'period' {
  return value === 'area' || value === 'year' || value === 'period';
}

/**
 * Map a lifecycle failure to the Persian UX message for that operation.
 * Session expiry (401) is owned by the global session-expiry flow and must
 * not produce a dialog error — callers check `isUnauthorized` separately.
 */
export function documentErrorMessage(
  operation: DocumentOperation,
  error: unknown,
): DocumentErrorMessage {
  const apiError: ApiError = normalizeApiError(error);

  switch (apiError.code) {
    case 'PermissionDenied':
      return { message: t.errors.forbidden };
    case 'EntityNotFound':
      return { message: t.errors.notFound };
    case 'Conflict':
      // 409 family: concurrent modification, phase conflict, or an
      // operationKey reused with a different intent. The recovery is the
      // same for all three: refresh and re-check.
      return {
        message: t.documents.business.conflict,
        ...(apiError.correlationId !== undefined
          ? { correlationId: apiError.correlationId }
          : {}),
      };
    case 'BusinessRuleViolation':
      return {
        message: businessRuleMessage(operation, apiError.details),
        ...(apiError.correlationId !== undefined
          ? { correlationId: apiError.correlationId }
          : {}),
      };
    case 'ValidationFailed':
    case 'BadRequest':
      return { message: t.documents.validation.serverSummary };
    default:
      // Network / 5xx / anything unrecognized: the operation-scoped safe copy.
      return {
        message: OPERATION_FAILURE[operation],
        ...(apiError.correlationId !== undefined
          ? { correlationId: apiError.correlationId }
          : {}),
      };
  }
}

function businessRuleMessage(
  operation: DocumentOperation,
  details: unknown,
): string {
  if (!isRecord(details)) return t.documents.business.generic;

  // Structured discriminator `details.problem` (allow-listed above).
  if (typeof details['problem'] === 'string') {
    const mapped = PROBLEM_MESSAGES[details['problem']];
    if (mapped !== undefined) return mapped;
  }

  // Line-composition problems (`details.problems: VoucherLineProblem[]`).
  const problems = details['problems'];
  if (Array.isArray(problems)) {
    const messages = [
      ...new Set(
        problems
          .filter((problem): problem is string => typeof problem === 'string')
          .map((problem) => LINE_PROBLEM_MESSAGES[problem])
          .filter((message): message is string => message !== undefined),
      ),
    ];
    if (messages.length > 0) return messages.join('؛ ');
    return t.documents.business.generic;
  }

  // Fiscal lock: `details.scope` + `details.status`
  // (`AccountingDocumentScopeRejectedError`). Finalize gets the finalize
  // wording; compose/edit get the registration wording.
  if (isKnownScope(details['scope']) && typeof details['status'] === 'string') {
    const sealed = details['status'] === 'sealed';
    if (operation === 'finalize') {
      return sealed
        ? t.documents.business.sealedScope
        : t.documents.business.closedPeriod;
    }
    return sealed
      ? t.documents.business.scopeSealed
      : t.documents.business.scopeClosed;
  }

  // Unresolvable date (`details.documentDate`).
  if (typeof details['documentDate'] === 'string') {
    return t.documents.business.dateUnresolvable;
  }

  return t.documents.business.generic;
}

// ---------------------------------------------------------------------------
// Server validation → form fields (FE-UX-02 §4.3)
// ---------------------------------------------------------------------------

/** The backend's stable `ValidationIssue { field, message, code }` shape. */
interface ServerValidationIssue {
  field: string;
  message: string;
  code: string;
}

function isValidationIssue(value: unknown): value is ServerValidationIssue {
  return (
    isRecord(value) &&
    typeof value['field'] === 'string' &&
    typeof value['message'] === 'string' &&
    typeof value['code'] === 'string'
  );
}

/**
 * Field paths the form knows. Only these are mapped inline; an issue on any
 * other path (e.g. `organizationId`, `operationKey` — not user-editable
 * here) lands in the form summary instead of being guessed onto a field.
 */
const LINE_FIELD_PATH =
  /^lines\.(\d+)\.(accountId|detailId|debitAmount|creditAmount|description)$/;

function fieldMessage(field: string, code: string): string | undefined {
  if (field === 'financialAreaId') return t.documents.validation.areaRequired;
  if (field === 'documentDate') {
    return code === 'matches'
      ? t.documents.validation.dateInvalid
      : t.documents.validation.dateRequired;
  }
  if (field === 'description') {
    return code === 'maxLength'
      ? t.documents.validation.descriptionTooLong
      : t.documents.validation.descriptionRequired;
  }
  if (field === 'lines') return t.documents.validation.minLines;
  if (field.endsWith('accountId'))
    return t.documents.validation.accountRequired;
  if (field.endsWith('detailId')) return t.documents.validation.detailRequired;
  if (field.endsWith('debitAmount') || field.endsWith('creditAmount')) {
    return t.documents.validation.amountInvalid;
  }
  if (field.endsWith('description')) {
    return t.documents.validation.lineDescriptionTooLong;
  }
  return undefined;
}

export interface ServerValidationResult {
  /** True when at least one issue was mapped onto a form field. */
  mappedToFields: boolean;
  /** Persian summary for the form banner (always set when issues exist). */
  summary: string;
}

/**
 * Apply a server `ValidationFailed` to the form: allow-listed field paths get
 * inline errors, everything else is surfaced through the form summary. The
 * raw backend `message` is never displayed (FE-UX-02 §4.3 rule 3/4).
 */
export function applyServerValidationToForm(
  error: unknown,
  form: UseFormReturn<DocumentFormValues>,
): ServerValidationResult | null {
  const apiError = normalizeApiError(error);
  if (apiError.code !== 'ValidationFailed' && apiError.code !== 'BadRequest') {
    return null;
  }
  const issues = Array.isArray(apiError.details)
    ? apiError.details.filter(isValidationIssue)
    : [];
  if (issues.length === 0) {
    return {
      mappedToFields: false,
      summary: t.documents.validation.serverSummary,
    };
  }

  let mappedToFields = false;
  type DocumentFormPath = Parameters<typeof form.setError>[0];
  for (const issue of issues) {
    const message = fieldMessage(issue.field, issue.code);
    if (message === undefined) continue;
    if (
      issue.field === 'financialAreaId' ||
      issue.field === 'documentDate' ||
      issue.field === 'description' ||
      issue.field === 'lines' ||
      LINE_FIELD_PATH.test(issue.field)
    ) {
      form.setError(issue.field as DocumentFormPath, {
        type: 'server',
        message,
      });
      mappedToFields = true;
    }
  }
  return {
    mappedToFields,
    summary: t.documents.validation.serverSummary,
  };
}
