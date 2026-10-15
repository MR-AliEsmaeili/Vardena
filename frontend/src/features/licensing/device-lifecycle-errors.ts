import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

export type DeviceOperation =
  | 'load'
  | 'enrollment'
  | 'activation'
  | 'deactivation'
  | 'replacement'
  | 'replacement-proof'
  | 'replacement-export'
  | 'replacement-import'
  | 'replacement-cancel';

export interface DeviceErrorMessage {
  message: string;
  /** Support correlation id only; never render the backend message. */
  correlationId?: string;
}

const OPERATION_FAILURE: Record<DeviceOperation, string> = {
  load: t.deviceLicensing.errorLoad,
  enrollment: t.deviceLicensing.errorEnrollment,
  activation: t.deviceLicensing.errorActivation,
  deactivation: t.deviceLicensing.errorDeactivation,
  replacement: t.deviceLicensing.errorReplacement,
  'replacement-proof': t.deviceLicensing.errorReplacementProof,
  'replacement-export': t.deviceLicensing.errorReplacementExport,
  'replacement-import': t.deviceLicensing.errorReplacementImport,
  'replacement-cancel': t.deviceLicensing.errorReplacementCancel,
};

function reasonOf(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const reason = (details as Record<string, unknown>)['reason'];
  return typeof reason === 'string' ? reason : undefined;
}

/** Stable envelope codes/reasons select Persian copy; server messages never do. */
export function deviceLifecycleErrorMessage(
  error: unknown,
  operation: DeviceOperation,
): DeviceErrorMessage {
  const apiError = normalizeApiError(error);
  const correlation =
    apiError.correlationId === undefined
      ? {}
      : { correlationId: apiError.correlationId };
  const reason = reasonOf(apiError.details);

  if (apiError.code === 'PermissionDenied') {
    return { message: t.errors.forbidden, ...correlation };
  }
  if (apiError.code === 'Unauthorized') {
    return { message: t.errors.unauthorized, ...correlation };
  }
  if (apiError.code === 'NetworkError') {
    return { message: t.errors.network, ...correlation };
  }
  if (apiError.code === 'EntityNotFound') {
    return { message: t.errors.notFound, ...correlation };
  }
  if (apiError.code === 'ValidationFailed' || apiError.code === 'BadRequest') {
    return {
      message:
        operation === 'replacement-import'
          ? t.deviceLicensing.errorInvalidDocument
          : t.deviceLicensing.errorEnrollment,
      ...correlation,
    };
  }

  const reasonCopy: Record<string, string> = {
    'device-limit-reached': t.deviceLicensing.errorDeviceLimit,
    'device-key-already-registered': t.deviceLicensing.errorKeyAlreadyUsed,
    'replacement-device-key-used': t.deviceLicensing.errorKeyAlreadyUsed,
    'device-operation-conflict': t.deviceLicensing.errorOperationConflict,
    'replacement-already-pending': t.deviceLicensing.errorOperationConflict,
    'enrollment-challenge-expired': t.deviceLicensing.errorExpired,
    'replacement-request-expired': t.deviceLicensing.errorExpired,
    'enrollment-challenge-consumed': t.deviceLicensing.errorAlreadyUsed,
    'replacement-response-replayed': t.deviceLicensing.errorAlreadyUsed,
    'replacement-request-cancelled': t.deviceLicensing.errorCancelled,
    'replacement-request-not-pending': t.deviceLicensing.errorNotPending,
    'device-not-active': t.deviceLicensing.errorDeviceNotActive,
    'device-entitlement-unspecified': t.deviceLicensing.errorNoEntitlement,
    'license-required': t.deviceLicensing.errorNoEntitlement,
    'license-not-active': t.deviceLicensing.licenseInactive,
    'replacement-response-invalid': t.deviceLicensing.errorInvalidDocument,
    'invalid-signature': t.deviceLicensing.errorActivation,
    'unknown-signing-key': t.deviceLicensing.errorInvalidDocument,
    'response-signature': t.deviceLicensing.errorInvalidDocument,
  };
  if (reason !== undefined && reasonCopy[reason] !== undefined) {
    return { message: reasonCopy[reason]!, ...correlation };
  }

  if (apiError.code === 'Conflict') {
    return {
      message:
        operation === 'replacement-import'
          ? t.deviceLicensing.errorReplacementImport
          : OPERATION_FAILURE[operation],
      ...correlation,
    };
  }
  if (apiError.code === 'BusinessRuleViolation') {
    return {
      message:
        operation === 'replacement-import'
          ? t.deviceLicensing.errorInvalidDocument
          : OPERATION_FAILURE[operation],
      ...correlation,
    };
  }
  return { message: OPERATION_FAILURE[operation], ...correlation };
}
