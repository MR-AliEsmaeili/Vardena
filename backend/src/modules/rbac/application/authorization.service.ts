import { Injectable } from '@nestjs/common';
import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  getCorrelationId,
  getPrincipal,
  getRequestContext,
} from '../../../kernel/correlation/request-context.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { UserRolesRepository } from '../data/user-roles.repository.js';
import { LicensingService } from '../../licensing/application/licensing.service.js';
import {
  isPlatformPermission,
  isReadPermissionCode,
} from '../../licensing/domain/license.js';
import {
  checkServiceAuthorityStructure,
  serviceAuthorityRejectionMessage,
  type ExpectedServiceAuthority,
  type ServiceAuthority,
} from '../domain/service-authority.js';

/**
 * Authorization service — RBAC's public evaluation surface (ADR-0006,
 * docs/modules.md §RBAC).
 *
 * This is the single place that answers "may this user do this?"; every module
 * consumes it instead of implementing permission logic (task §3, AR-21).
 *
 * Evaluation is **database-backed on every request**: permission codes are
 * read from `rbac.user_roles → rbac.role_permissions → rbac.permissions`.
 * There is deliberately no cache: revocation is immediate, which is the
 * behaviour the security model promises (ADR-0006 speaks of a per-session
 * cache; that is an optimisation the repository does not need yet, and a wrong
 * cache is an access-control bug — see the caching note in docs/security.md).
 *
 * Semantics of `requireAllPermissions` (the application-service check):
 * - **system context** (no request context — bootstrap, worker, tests calling
 *   services directly): no check. This is what lets the first role and the
 *   first assignment be created before any user holds a permission; it is not
 *   reachable from HTTP because every HTTP request runs inside a request
 *   context.
 * - **anonymous HTTP request** (request context, no principal): 401 — the
 *   caller is not authenticated, which is an authentication failure and must
 *   not be reported as a permission failure.
 * - **authenticated request without all required codes**: 403 — a valid
 *   session does not imply authorization (task §14).
 */
@Injectable()
export class AuthorizationService {
  constructor(
    private readonly userRoles: UserRolesRepository,
    private readonly logger: JsonLogger,
    private readonly licensing: LicensingService,
  ) {}

  /** Effective permission codes of a user (union over their roles). */
  async effectivePermissionCodes(userId: string): Promise<string[]> {
    const stored = await this.userRoles.listPermissionCodesForUser(userId);
    // Assignments remain stored; licensing only removes them from the
    // effective set and they become effective again if entitlement returns.
    return this.licensing.filterLicensedPermissions(stored);
  }

  /** True when the user holds every one of `codes`. */
  async hasAllPermissions(
    userId: string,
    codes: readonly string[],
  ): Promise<boolean> {
    if (codes.length === 0) return true;
    const effective = new Set(await this.effectivePermissionCodes(userId));
    return codes.every((code) => effective.has(code));
  }

  /** True when the user holds any of `codes`. */
  async hasAnyPermission(
    userId: string,
    codes: readonly string[],
  ): Promise<boolean> {
    if (codes.length === 0) return false;
    const effective = new Set(await this.effectivePermissionCodes(userId));
    return codes.some((code) => effective.has(code));
  }

  /**
   * Application-service authorization check (AR-04, AR-21). Multiple required
   * permissions mean **ALL of them** are required (task §13) — there is no
   * "any" policy, and no permission expressions.
   *
   * @throws AppException.unauthorized when the request is anonymous.
   * @throws AppException.forbidden when the principal lacks a required code.
   */
  async requireAllPermissions(codes: readonly string[]): Promise<void> {
    if (codes.length === 0) return;
    const context = getRequestContext();
    if (context === undefined) {
      // System/internal context: historically trusted (bootstrap/worker).
      // OQ-45 exception: a job queued during Grace must not execute a
      // prohibited mutation after the deadline, so mutation permissions are
      // refused in READ_ONLY even without an HTTP principal. Reads and
      // bootstrap in other modes keep the trusted-system semantics.
      if (
        codes.some((c) => !isPlatformPermission(c) && !isReadPermissionCode(c))
      ) {
        await this.licensing.assertBusinessMutationAllowed();
      }
      return;
    }
    const principal = getPrincipal();
    if (principal === undefined) {
      throw AppException.unauthorized('Authentication is required.');
    }
    if (principal.mustChangePassword === true) {
      throw AppException.forbidden(
        'Password change is required before accessing this resource.',
        { reason: 'password_change_required' },
      );
    }
    const allowed = await this.hasAllPermissions(principal.userId, codes);
    if (!allowed) {
      this.logger.warn(
        'Authorization denied',
        {
          userId: principal.userId,
          requiredPermissions: [...codes],
          layer: 'application-service',
          correlationId: getCorrelationId(),
        },
        AuthorizationService.name,
      );
      throw AppException.forbidden();
    }
  }

  /**
   * Assert an explicit, bounded in-process SERVICE AUTHORITY (C-62,
   * PDR-10 C62-OD-03; `domain/service-authority.ts`).
   *
   * This is NOT a bypass and NOT a wildcard: the callee names the ONE service
   * code and the ONE initiating permission it accepts, the authority must
   * carry the authenticated human who is making the call, and that human's
   * initiating permission is re-read from the assignment tables right here —
   * a permission revoked after the operation was planned cannot be carried
   * across on a cached eligibility flag.
   *
   * Nothing consults the License: entitlement filtering applies to interactive
   * permission codes, and a License is not a Permission (C62-OD-03).
   *
   * @throws AppException.unauthorized when the request is anonymous.
   * @throws AppException.forbidden when the authority does not hold.
   */
  async requireServiceAuthority(
    authority: ServiceAuthority,
    expected: ExpectedServiceAuthority,
    organizationId: string,
  ): Promise<void> {
    const context = getRequestContext();
    if (context === undefined) {
      // No request in flight means no human initiated this operation, and a
      // service authority is by definition the record of a human initiation.
      // Refuse rather than fall back to "trusted system context": that
      // fallback exists for bootstrap and worker paths, never for a posting
      // that claims a human author.
      throw AppException.unauthorized(
        'The Accounting posting operation requires an authenticated initiating user.',
      );
    }
    const principal = getPrincipal();
    if (principal === undefined) {
      // Same refusal as a missing request context, stated once here so the
      // type of `principal` is narrowed for the whole method instead of being
      // re-checked at every use.
      throw AppException.unauthorized(
        'The Accounting posting operation requires an authenticated initiating user.',
      );
    }
    if (principal.mustChangePassword === true) {
      throw AppException.forbidden(
        'Password change is required before accessing this resource.',
        { reason: 'password_change_required' },
      );
    }
    const structural = checkServiceAuthorityStructure({
      authority,
      expected,
      principalUserId: principal.userId,
      organizationId,
    });
    if (structural !== null) {
      this.logger.warn(
        'Service authority denied',
        {
          userId: principal.userId,
          reason: structural,
          serviceCode: authority.code,
          initiatingPermission: authority.initiatingPermission,
          organizationId,
          layer: 'application-service',
          correlationId: getCorrelationId(),
        },
        AuthorizationService.name,
      );
      throw structural === 'missing_principal'
        ? AppException.unauthorized(
            serviceAuthorityRejectionMessage(structural),
          )
        : AppException.forbidden(serviceAuthorityRejectionMessage(structural));
    }
    // The initiating human must STILL hold the initiating permission. Read
    // from the assignment tables on every call: no cache, same rule as
    // `requireAllPermissions`.
    const stillGranted = await this.hasAllPermissions(principal.userId, [
      authority.initiatingPermission,
    ]);
    if (!stillGranted) {
      this.logger.warn(
        'Service authority denied',
        {
          userId: principal.userId,
          reason: 'initiating_permission_revoked',
          initiatingPermission: authority.initiatingPermission,
          organizationId,
          layer: 'application-service',
          correlationId: getCorrelationId(),
        },
        AuthorizationService.name,
      );
      throw AppException.forbidden(
        serviceAuthorityRejectionMessage('initiating_permission_revoked'),
      );
    }
    this.logger.log(
      'Service authority granted',
      {
        userId: principal.userId,
        serviceCode: authority.code,
        initiatingPermission: authority.initiatingPermission,
        organizationId,
        layer: 'application-service',
        correlationId: getCorrelationId(),
      },
      AuthorizationService.name,
    );
  }
}
