/**
 * Explicit, bounded, in-process SERVICE AUTHORITY (C-62, PDR-10 C62-OD-03;
 * OQ-72 candidate (c)).
 *
 * When one module's application service performs an effect on another
 * module's behalf, the callee must NOT silently inherit the caller's
 * interactive permissions — the initiating human holds
 * `Inventory.Document.AccountingPost`, not `Accounting.Document.Create`, and
 * a callee that checked the interactive code would refuse a legitimate
 * operation while a callee that checked nothing would be an unlogged bypass.
 *
 * So the authority is EXPLICIT and BOUNDED:
 *
 *   * it names ONE service code the callee requires, compared exactly — no
 *     wildcard, no prefix match, no "any Accounting permission will do";
 *   * it carries the initiating HUMAN's identity, which must be the principal
 *     actually making the request (no identity laundering: a service cannot
 *     post on behalf of a user who is not the caller);
 *   * it carries the initiating permission whose grant the initiator already
 *     verified, and the RBAC evaluator re-verifies it database-backed at the
 *     boundary, so a revoked permission is never carried across by a cached
 *     eligibility flag;
 *   * it carries the organization scope the initiation was authorized in.
 *
 * It is deliberately NOT a role, NOT a session, and NOT the License: the
 * licensing entitlement filter (`filterLicensedPermissions`) applies to
 * interactive permission codes only. A License is not a Permission
 * (PDR-10 C62-OD-03), so nothing here consults it.
 *
 * OQ-72 remains OPEN for the final system-origin authorization contract and
 * for unattended-worker actor semantics; this type implements only the
 * Owner-approved OD-03 shape for a human-initiated, in-process call.
 */

/** The service authority an initiator hands to a callee. */
export interface ServiceAuthority {
  /** The bounded service code the callee requires (exact match). */
  readonly code: string;
  /** The authenticated human who initiated the operation. */
  readonly initiatedByUserId: string;
  /** The initiating permission whose grant was already verified. */
  readonly initiatingPermission: string;
  /** The organization scope the initiation was authorized in. */
  readonly organizationId: string;
}

/** What a callee declares it will accept. */
export interface ExpectedServiceAuthority {
  readonly code: string;
  readonly initiatingPermission: string;
}

/**
 * Why a service authority was refused. Closed, code-defined and mapped onto
 * the standard error envelope — never a stack trace, never a silent pass.
 */
export type ServiceAuthorityRejection =
  /** No authenticated principal is making this call. */
  | 'missing_principal'
  /** The authority names a human who is not the caller. */
  | 'initiator_mismatch'
  /** The authority's code is not the one this callee requires. */
  | 'service_code_mismatch'
  /** The authority's initiating permission is not the one expected. */
  | 'initiating_permission_mismatch'
  /** The initiating human no longer holds the initiating permission. */
  | 'initiating_permission_revoked'
  /** The authority's organization is not the scope of this operation. */
  | 'organization_mismatch';

export function serviceAuthorityRejectionMessage(
  rejection: ServiceAuthorityRejection,
): string {
  switch (rejection) {
    case 'missing_principal':
      return 'The Accounting posting operation requires an authenticated initiating user.';
    case 'initiator_mismatch':
      return 'The Accounting posting operation must be initiated by the authenticated user it is recorded against.';
    case 'service_code_mismatch':
      return 'The Accounting posting operation requires the explicit internal Accounting service authority.';
    case 'initiating_permission_mismatch':
      return 'The Accounting posting operation must be initiated by the Inventory document accounting-post command.';
    case 'initiating_permission_revoked':
      return 'The initiating user no longer holds the permission required to post this document to Accounting.';
    case 'organization_mismatch':
      return 'The Accounting posting operation must stay inside the organization it was authorized in.';
  }
}

/**
 * The structural half of the check — pure, framework-free (AR-05). The
 * database-backed re-verification of the initiating permission is the RBAC
 * service's job and runs after this.
 */
export function checkServiceAuthorityStructure(input: {
  authority: ServiceAuthority;
  expected: ExpectedServiceAuthority;
  principalUserId: string | null;
  organizationId: string;
}): ServiceAuthorityRejection | null {
  if (input.principalUserId === null) return 'missing_principal';
  if (input.authority.initiatedByUserId !== input.principalUserId) {
    return 'initiator_mismatch';
  }
  if (input.authority.code !== input.expected.code) {
    return 'service_code_mismatch';
  }
  if (
    input.authority.initiatingPermission !== input.expected.initiatingPermission
  ) {
    return 'initiating_permission_mismatch';
  }
  if (input.authority.organizationId !== input.organizationId) {
    return 'organization_mismatch';
  }
  return null;
}
