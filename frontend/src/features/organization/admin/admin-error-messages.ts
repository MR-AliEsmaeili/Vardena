import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { normalizeApiError, type ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

/**
 * Operation-scoped error presentation for organization administration
 * (`docs/frontend/ux/ux-flow-matrix.md` §2, FE-UX-02 §2.1).
 *
 * Decision order, implemented exactly:
 * 1. classify by the STABLE ERROR CODE of the normalized envelope — never by
 *    searching the backend `message` (which is never user copy);
 * 2. pick the Persian copy for that code in the context of THIS resource and
 *    THIS operation;
 * 3. fall back to the safe operation-scoped failure copy.
 *
 * **Registered contract gap.** The organization master-data services raise
 * their business-rule and conflict failures through
 * `AppException.businessRule(...)` / `AppException.conflict(...)` *without*
 * a `details` payload (see `backend/src/modules/organization/application/
 * {departments,employees,parties,branches,organizations}.service.ts`), so —
 * unlike the accounting document guards — there is no structured
 * discriminator to branch on. The only honest mapping is therefore
 * resource + operation scoped copy. Nothing here parses the message text, and
 * no sub-case is invented.
 */

export type AdminResource =
  'organization' | 'branch' | 'department' | 'employee' | 'party';

export type AdminOperation =
  'load' | 'create' | 'update' | 'enable' | 'disable';

export interface AdminErrorMessage {
  message: string;
  /** Support correlation id — never the reason for the failure. */
  correlationId?: string | undefined;
}

const OPERATION_FAILURE: Record<AdminOperation, string> = {
  load: t.errors.unknown,
  create: t.orgAdmin.errors.createFailed,
  update: t.orgAdmin.errors.updateFailed,
  enable: t.orgAdmin.errors.enableFailed,
  disable: t.orgAdmin.errors.disableFailed,
};

/**
 * The 422 the backend can raise for a WRITE on each resource, in the words of
 * the rule the service actually enforces:
 * - department: parent must exist, be in the same organization, be active at
 *   assignment time, and must not create a cycle;
 * - employee: `departmentId` / `branchId` must be usable references of the
 *   same organization;
 * - party: at least one of `isCustomer` / `isSupplier`;
 * - organization: refused by the pinned-deployment rule (ADR-0025) or another
 *   organization-level rule.
 */
const BUSINESS_RULE_COPY: Record<AdminResource, string> = {
  organization: t.orgAdmin.errors.organizationUpdateRejected,
  branch: t.orgAdmin.errors.businessRule,
  department: t.orgAdmin.errors.departmentParentRejected,
  employee: t.orgAdmin.errors.employeeReferenceRejected,
  party: t.orgAdmin.errors.partyCapabilityRejected,
};

export function adminErrorMessage(
  resource: AdminResource,
  operation: AdminOperation,
  error: unknown,
): AdminErrorMessage {
  const apiError: ApiError = normalizeApiError(error);
  const correlation =
    apiError.correlationId !== undefined
      ? { correlationId: apiError.correlationId }
      : {};

  switch (apiError.code) {
    case 'PermissionDenied':
      return { message: t.errors.forbidden };
    case 'EntityNotFound':
      // Also the answer for a record of another organization: the backend
      // reports out-of-scope as 404, never 403 (`assertOrganizationInScope`).
      return { message: t.errors.notFound };
    case 'Conflict':
      return {
        message:
          operation === 'create' || operation === 'update'
            ? t.orgAdmin.errors.duplicateCode
            : t.errors.conflict,
        ...correlation,
      };
    case 'BusinessRuleViolation':
      return {
        message:
          operation === 'enable' || operation === 'disable'
            ? t.orgAdmin.errors.businessRule
            : BUSINESS_RULE_COPY[resource],
        ...correlation,
      };
    case 'ValidationFailed':
    case 'BadRequest':
      return { message: t.orgAdmin.validation.serverSummary, ...correlation };
    default:
      return { message: OPERATION_FAILURE[operation], ...correlation };
  }
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
  if (typeof value !== 'object' || value === null) return false;
  const issue = value as Record<string, unknown>;
  return (
    typeof issue['field'] === 'string' &&
    typeof issue['message'] === 'string' &&
    typeof issue['code'] === 'string'
  );
}

/**
 * Dictionary copy for one rejected DTO field. The backend `message` is never
 * rendered; only the field name and the class-validator constraint `code`
 * select the Persian text.
 */
function fieldMessage(field: string, code: string): string | undefined {
  const tooLong = code === 'maxLength';
  switch (field) {
    case 'code':
      return tooLong
        ? t.orgAdmin.validation.codeTooLong
        : t.orgAdmin.validation.codeRequired;
    case 'name':
      return tooLong
        ? t.orgAdmin.validation.nameTooLong
        : t.orgAdmin.validation.nameRequired;
    case 'employeeCode':
      return tooLong
        ? t.orgAdmin.validation.employeeCodeTooLong
        : t.orgAdmin.validation.employeeCodeRequired;
    case 'firstName':
      return tooLong
        ? t.orgAdmin.validation.personNameTooLong
        : t.orgAdmin.validation.firstNameRequired;
    case 'lastName':
      return tooLong
        ? t.orgAdmin.validation.personNameTooLong
        : t.orgAdmin.validation.lastNameRequired;
    case 'displayName':
      return tooLong
        ? t.orgAdmin.validation.partyNameTooLong
        : t.orgAdmin.validation.displayNameRequired;
    case 'legalName':
      return t.orgAdmin.validation.partyNameTooLong;
    case 'partyType':
      return t.orgAdmin.validation.partyTypeRequired;
    case 'email':
      return tooLong
        ? t.orgAdmin.validation.emailTooLong
        : t.orgAdmin.validation.emailInvalid;
    case 'phone':
      return t.orgAdmin.validation.phoneTooLong;
    case 'isCustomer':
    case 'isSupplier':
      return t.orgAdmin.validation.capabilityRequired;
    default:
      // `organizationId`, `parentDepartmentId`, `departmentId`, `branchId`
      // and anything unknown are not guessed onto a control: they surface in
      // the form summary instead.
      return undefined;
  }
}

export interface ServerValidationResult {
  /** True when at least one issue landed on a form control. */
  mappedToFields: boolean;
  /** Persian summary for the form banner (always present). */
  summary: string;
}

/**
 * Apply a server `ValidationFailed` / `BadRequest` to a form: allow-listed
 * field names get an inline error, everything else only feeds the summary.
 * Returns `null` when the failure is not a validation failure, so the caller
 * can fall back to `adminErrorMessage`.
 */
export function applyServerValidation<TValues extends FieldValues>(
  error: unknown,
  form: UseFormReturn<TValues>,
  knownFields: readonly string[],
): ServerValidationResult | null {
  const apiError = normalizeApiError(error);
  if (apiError.code !== 'ValidationFailed' && apiError.code !== 'BadRequest') {
    return null;
  }

  const issues = Array.isArray(apiError.details)
    ? apiError.details.filter(isValidationIssue)
    : [];

  let mappedToFields = false;
  for (const issue of issues) {
    if (!knownFields.includes(issue.field)) continue;
    const message = fieldMessage(issue.field, issue.code);
    if (message === undefined) continue;
    // The allow-list above guarantees the name is a field of this form; RHF
    // cannot infer that from a `string`, hence the narrow assertion.
    form.setError(issue.field as Path<TValues>, { type: 'server', message });
    mappedToFields = true;
  }

  return { mappedToFields, summary: t.orgAdmin.validation.serverSummary };
}
