import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import type { LicenseImportErrorMessage } from './license-import-errors';

/**
 * Operation-scoped error presentation for signed revocation import
 * (OD-LIC-17).
 *
 * Same contract as `licenseImportErrorMessage`: classification is by the
 * STABLE error code of the normalized envelope, never by reading the backend
 * message, and the copy always comes from the dictionary. The words differ
 * because the act differs — a refused revocation is not a refused license, and
 * telling an operator to "check the license file" would be wrong advice.
 *
 * Boundaries:
 * - `409 Conflict` — authentic artifact, refused by retained state
 *   (`conflicting-replay`: same revocation identity, different bytes;
 *   `already-revoked`: this license is already revoked). The revocation
 *   evidence in the envelope is genuine, so the operator is never told the
 *   file is invalid and the current state is unchanged;
 * - `422 BusinessRuleViolation` — a genuine artifact this installation refused:
 *   bad signature, unknown/untrusted key, non-canonical payload, another
 *   installation or customer, an unknown target operation, a future-dated or
 *   stale revocation. Only the narrow `stale-revocation` case gets its own
 *   copy, because the remedy (obtain a current artifact) differs;
 * - `400` — malformed input (empty/oversized/unreadable);
 * - `403` — the session lacks `Licensing.License.Revoke`.
 *
 * Nothing the backend says about keys, hashes, SQL or internal state can reach
 * the screen: only the correlation id is forwarded, as support data.
 */
export function licenseRevocationImportErrorMessage(
  error: unknown,
): LicenseImportErrorMessage {
  const apiError = normalizeApiError(error);
  const correlation =
    apiError.correlationId !== undefined
      ? { correlationId: apiError.correlationId }
      : {};

  const reason =
    typeof apiError.details === 'object' && apiError.details !== null
      ? (apiError.details as Record<string, unknown>)['reason']
      : undefined;

  switch (apiError.code) {
    case 'Conflict':
      // The submitted artifact is authentic. Its revocation identity is
      // already recorded (possibly with different bytes) or the license is
      // already revoked; in both cases nothing was written by this call and
      // the state the operator sees is the durable truth.
      return {
        message: t.license.revocationConflict,
        rejectedDocument: false,
        ...correlation,
      };
    case 'BusinessRuleViolation':
      if (reason === 'stale-revocation') {
        return {
          message: t.license.revocationStale,
          rejectedDocument: true,
          ...correlation,
        };
      }
      return {
        message: t.license.revocationRejected,
        rejectedDocument: true,
        ...correlation,
      };
    case 'ValidationFailed':
    case 'BadRequest':
      return {
        message: t.license.revocationInvalid,
        rejectedDocument: true,
        ...correlation,
      };
    case 'PermissionDenied':
      return {
        message: t.license.revocationForbidden,
        rejectedDocument: false,
        ...correlation,
      };
    case 'Unauthorized':
      // The Axios interceptor already handed this to the session handling;
      // this copy only covers the moment before the login flow takes over.
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
        message: t.license.revocationFailed,
        rejectedDocument: false,
        ...correlation,
      };
  }
}
