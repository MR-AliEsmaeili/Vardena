import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

export interface LicenseActivationErrorMessage {
  /** Persian dictionary copy — never a backend `message`. */
  message: string;
  /** Support correlation id; never the reason for the failure. */
  correlationId?: string | undefined;
  /**
   * Whether the backend REJECTED the submitted code itself (as opposed to a
   * transport/authorization failure). The form clears the field only in that
   * case: the value is known-bad, while a network failure must keep the code
   * the operator just pasted so the retry costs nothing.
   */
  rejectedCode: boolean;
}

/**
 * Operation-scoped error presentation for license activation
 * (FE-UX-02 §2.1, mirrors `admin-error-messages.ts`).
 *
 * Classification is by the STABLE error code of the normalized envelope
 * (`kernel/errors/error-codes.ts`), never by reading the backend message.
 * `LicenseActivationService` raises every rejection — malformed code, bad
 * signature, wrong installation, expired/suspended license — through
 * `AppException.businessRule(...)` without a structured `details`
 * discriminator, so all of them map to one honest Persian sentence.
 *
 * Nothing the backend could say about keys, signatures, hashes, SQL or
 * internal state can reach the screen through this function: the copy is
 * chosen from the dictionary and the raw message is dropped.
 */
export function licenseActivationErrorMessage(
  error: unknown,
): LicenseActivationErrorMessage {
  const apiError = normalizeApiError(error);
  const correlation =
    apiError.correlationId !== undefined
      ? { correlationId: apiError.correlationId }
      : {};

  switch (apiError.code) {
    case 'BusinessRuleViolation':
      // The code was verified and refused (format/signature/binding/
      // lifecycle). The installation keeps whatever license it had.
      return {
        message: t.license.activateRejected,
        rejectedCode: true,
        ...correlation,
      };
    case 'ValidationFailed':
    case 'BadRequest':
      return {
        message: t.license.activateInvalid,
        rejectedCode: true,
        ...correlation,
      };
    case 'PermissionDenied':
      return {
        message: t.license.activateForbidden,
        rejectedCode: false,
        ...correlation,
      };
    case 'Unauthorized':
      // The session expired mid-activation. The Axios interceptor already
      // handed this to the existing session handling; the copy here is only
      // what the form shows until the login flow takes over.
      return {
        message: t.errors.unauthorized,
        rejectedCode: false,
        ...correlation,
      };
    case 'NetworkError':
      return {
        message: t.errors.network,
        rejectedCode: false,
        ...correlation,
      };
    default:
      return {
        message: t.license.activateFailed,
        rejectedCode: false,
        ...correlation,
      };
  }
}
