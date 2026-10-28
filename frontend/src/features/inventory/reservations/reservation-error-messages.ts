import { normalizeApiError, type ApiError } from '@/api/errors';
import type { UseFormReturn } from 'react-hook-form';
import type { Path } from 'react-hook-form';
import { t } from '@/lib/i18n';

/**
 * Operation-scoped error presentation for inventory reservations.
 * Backend contract messages are stable strings emitted from
 * `inventory-reservations.service.ts`; the frontend branches on the stable
 * `code` and matches the known contract phrases only to enrich the copy —
 * the raw server English is never rendered.
 */

export type ReservationOperation = 'createReservation' | 'releaseReservation';

const OPERATION_FAILURE: Record<ReservationOperation, string> = {
  createReservation: t.reservations.errors.saveFailed,
  releaseReservation: t.reservations.errors.saveFailed,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function contractPhrase(message: string, phrase: string): boolean {
  return typeof message === 'string' && message.includes(phrase);
}

/**
 * Map a reservation operation failure to its Persian UX message.
 * Session expiry (401) is owned by the global session-expiry flow; callers
 * check `isUnauthorized` separately and must not render a dialog error for it.
 */
export function reservationErrorMessage(
  operation: ReservationOperation,
  error: unknown,
): { message: string; correlationId?: string } {
  const apiError: ApiError = normalizeApiError(error);

  switch (apiError.code) {
    case 'PermissionDenied':
      return {
        message:
          operation === 'releaseReservation'
            ? t.errors.forbidden
            : t.errors.forbidden,
      };
    case 'EntityNotFound':
      return { message: t.errors.notFound };
    case 'Conflict':
      return {
        message: t.reservations.errors.operationKeyReused,
        ...(apiError.correlationId !== undefined
          ? { correlationId: apiError.correlationId }
          : {}),
      };
    case 'BusinessRuleViolation': {
      const message =
        apiError.message === undefined ? '' : String(apiError.message);
      if (contractPhrase(message, 'already released')) {
        return { message: t.reservations.errors.releasedAlready };
      }
      if (contractPhrase(message, 'Material Request line')) {
        return { message: t.reservations.errors.materialRequestOwnedBody };
      }
      if (contractPhrase(message, 'Insufficient available stock')) {
        // The server message already carries warehouse code and quantities:
        // render it verbatim as the authoritative business fact.
        return { message };
      }
      if (contractPhrase(message, 'referenceType and referenceId')) {
        return { message: t.reservations.errors.referencePairHint };
      }
      return {
        message: t.reservations.errors.businessRule,
        ...(apiError.correlationId !== undefined
          ? { correlationId: apiError.correlationId }
          : {}),
      };
    }
    default:
      return {
        message: OPERATION_FAILURE[operation],
        ...(apiError.correlationId !== undefined
          ? { correlationId: apiError.correlationId }
          : {}),
      };
  }
}

/**
 * Server validation → form fields (`ValidationFailed`/`BadRequest` with
 * `details` as `ValidationIssue[]`). Reference pair and other business rules
 * are reported through the operation message above.
 */
export interface ReservationValidationResult {
  mappedToFields: boolean;
  summary: string;
}

export function applyServerValidationToForm<TFieldValues extends object>(
  error: unknown,
  form: UseFormReturn<TFieldValues>,
): ReservationValidationResult | null {
  // `Path<TFieldValues>` is nominally narrower than the validation-issue
  // field strings, so the cast keeps the helper generic and dependency-free.
  const setFieldError = (field: string, message: string): void =>
    form.setError(field as unknown as Path<TFieldValues>, {
      type: 'server',
      message,
    });
  const apiError = normalizeApiError(error);
  if (apiError.code !== 'ValidationFailed' && apiError.code !== 'BadRequest') {
    return null;
  }
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
  const issues = Array.isArray(apiError.details)
    ? apiError.details.filter(isValidationIssue)
    : [];
  if (issues.length === 0) {
    return { mappedToFields: false, summary: t.reservations.errors.saveFailed };
  }

  let mappedToFields = false;
  for (const issue of issues) {
    const field = issue.field;
    if (
      field === 'referenceType' ||
      field === 'referenceId' ||
      field === 'reference'
    ) {
      setFieldError(field, t.reservations.errors.referencePairHint);
      mappedToFields = true;
    }
  }
  return {
    mappedToFields,
    summary: t.reservations.errors.saveFailed,
  };
}
