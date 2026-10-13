import { describe, expect, it } from 'vitest';
import { ApiError, type ApiFailureCode } from '@/api/errors';
import { t } from '@/lib/i18n';
import { adminErrorMessage } from './admin-error-messages';

/**
 * The failure of an organization write is classified by its STABLE CODE, in
 * the context of the resource and the operation — never by reading the
 * backend `message`.
 *
 * Registered contract gap: `AppException.businessRule()` and
 * `AppException.conflict()` in the organization services carry no `details`
 * payload, so there is no finer discriminator to branch on. These tests pin
 * the honest mapping that follows from that, and pin that an English server
 * message never reaches the user.
 */

function apiError(
  code: ApiFailureCode,
  status: number,
  message: string,
): ApiError {
  return new ApiError({ code, status, message });
}

describe('adminErrorMessage', () => {
  it('maps a duplicate code conflict to the duplicate-code copy on a write', () => {
    const result = adminErrorMessage(
      'branch',
      'create',
      apiError('Conflict', 409, 'Unique constraint failed'),
    );
    expect(result.message).toBe(t.orgAdmin.errors.duplicateCode);
  });

  it('keeps the generic conflict copy for a lifecycle conflict', () => {
    expect(
      adminErrorMessage('branch', 'disable', apiError('Conflict', 409, 'x'))
        .message,
    ).toBe(t.errors.conflict);
  });

  it('answers 404 with "not found" — the out-of-scope answer of the backend', () => {
    expect(
      adminErrorMessage(
        'employee',
        'load',
        apiError('EntityNotFound', 404, 'not in organization'),
      ).message,
    ).toBe(t.errors.notFound);
  });

  it('explains the business rule of the resource that raised it', () => {
    expect(
      adminErrorMessage(
        'department',
        'update',
        apiError('BusinessRuleViolation', 422, 'cycle'),
      ).message,
    ).toBe(t.orgAdmin.errors.departmentParentRejected);
    expect(
      adminErrorMessage(
        'employee',
        'create',
        apiError('BusinessRuleViolation', 422, 'inactive department'),
      ).message,
    ).toBe(t.orgAdmin.errors.employeeReferenceRejected);
    expect(
      adminErrorMessage(
        'party',
        'create',
        apiError('BusinessRuleViolation', 422, 'no capability'),
      ).message,
    ).toBe(t.orgAdmin.errors.partyCapabilityRejected);
  });

  it('does not pretend to know which rule failed during a lifecycle transition', () => {
    expect(
      adminErrorMessage(
        'department',
        'enable',
        apiError('BusinessRuleViolation', 422, 'whatever'),
      ).message,
    ).toBe(t.orgAdmin.errors.businessRule);
  });

  it('falls back to operation-scoped copy for an unknown code', () => {
    expect(
      adminErrorMessage(
        'branch',
        'update',
        apiError('InternalError', 500, 'Prisma exploded'),
      ).message,
    ).toBe(t.orgAdmin.errors.updateFailed);
  });

  it('carries the correlation id without ever carrying the server message', () => {
    const error = new ApiError({
      code: 'Conflict',
      status: 409,
      message: 'Unique constraint failed on (organizationId, code)',
      correlationId: 'corr-42',
    });
    const result = adminErrorMessage('party', 'create', error);
    expect(result.correlationId).toBe('corr-42');
    expect(result.message).not.toContain('Unique');
  });

  it('maps a permission failure to the shared forbidden copy', () => {
    expect(
      adminErrorMessage(
        'organization',
        'disable',
        apiError('PermissionDenied', 403, 'missing permission'),
      ).message,
    ).toBe(t.errors.forbidden);
  });
});
