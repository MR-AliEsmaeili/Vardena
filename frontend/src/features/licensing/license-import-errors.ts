import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

export interface LicenseImportErrorMessage {
  /** Persian dictionary copy — never a backend `message`. */
  message: string;
  /** Support correlation id; never the reason for the failure. */
  correlationId?: string | undefined;
  /**
   * Whether the backend REJECTED the submitted document itself (as opposed to
   * a transport/authorization failure). The form clears the selected file only
   * in that case: the document is known-bad, while a network failure must keep
   * what the operator just selected so the retry costs nothing.
   */
  rejectedDocument: boolean;
}

/**
 * Operation-scoped error presentation for license import (ADR-0046).
 *
 * Classification is by the STABLE error code of the normalized envelope
 * (`kernel/errors/error-codes.ts`), never by reading the backend message:
 *
 * - `404`-class isn't expected here; `409 Conflict` is the retained-state
 *   conflict class — a repeated operation, an overlapping range without an
 *   explicit supersession, or an unknown supersession target. It is presented
 *   apart from a bad document because the submitted license is *authentic*:
 *   the operator must not be told to re-check the file, and the current
 *   license is unchanged;
 * - `422 BusinessRuleViolation` is a verified document the installation
 *   refused (wrong installation, ended, not active, unknown capabilities);
 * - `400` is malformed input (empty/oversized/unreadable).
 *
 * Nothing the backend could say about keys, signatures, hashes, SQL or
 * internal state can reach the screen through this function: the copy is
 * chosen from the dictionary and the raw message is dropped.
 */
export function licenseImportErrorMessage(
  error: unknown,
): LicenseImportErrorMessage {
  const apiError = normalizeApiError(error);
  const correlation =
    apiError.correlationId !== undefined
      ? { correlationId: apiError.correlationId }
      : {};

  switch (apiError.code) {
    case 'Conflict':
      // Authentic document, conflicting with retained state. The current
      // license keeps working; nothing was written.
      return {
        message: t.license.importConflict,
        rejectedDocument: false,
        ...correlation,
      };
    case 'BusinessRuleViolation':
      // The document was verified and refused (binding, validity, payload,
      // lifecycle). The installation keeps whatever license it had.
      return {
        message: t.license.importRejected,
        rejectedDocument: true,
        ...correlation,
      };
    case 'ValidationFailed':
    case 'BadRequest':
      return {
        message: t.license.importInvalid,
        rejectedDocument: true,
        ...correlation,
      };
    case 'PermissionDenied':
      return {
        message: t.license.importForbidden,
        rejectedDocument: false,
        ...correlation,
      };
    case 'Unauthorized':
      // The session expired mid-import. The Axios interceptor already handed
      // this to the existing session handling; the copy here is only what the
      // form shows until the login flow takes over.
      return {
        message: t.errors.unauthorized,
        rejectedDocument: false,
        ...correlation,
      };
    case 'NetworkError':
      return {
        message: t.errors.network,
        rejectedDocument: false,
        ...correlation,
      };
    default:
      return {
        message: t.license.importFailed,
        rejectedDocument: false,
        ...correlation,
      };
  }
}
