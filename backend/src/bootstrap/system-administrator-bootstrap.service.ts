import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  APP_CONFIG,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type AppConfig,
} from '../kernel/config/app-config.js';
import { AppException } from '../kernel/errors/app-exception.js';
import { OrganizationMembershipsService } from '../modules/organization/application/organization-memberships.service.js';
import { OrganizationsService } from '../modules/organization/application/organizations.service.js';
import { SystemAdministratorRbacService } from '../modules/rbac/application/system-administrator-rbac.service.js';
import { InstallationIdentityService } from '../modules/licensing/application/installation-identity.service.js';
import { UsersService } from '../modules/users/application/users.service.js';

export const BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME = 'مدیر';

export interface SystemAdministratorBootstrapResult {
  /** The installation identity this deployment runs as (L-02). */
  installationId: string;
  userId: string;
  roleId: string;
  permissionCount: number;
  userCreated: boolean;
  roleCreated: boolean;
  userRoleCreated: boolean;
  /** The pinned deployment organization, or null in unpinned (ADR-0021) mode. */
  organizationId: string | null;
  organizationCreated: boolean;
  membershipCreated: boolean;
}

/**
 * Installation orchestrator for the real bootstrap administrator.
 *
 * The user is an ordinary Users-domain record; its role and grants are
 * ordinary RBAC records; its organization access is an ordinary
 * `organization.organization_memberships` row created through the module that
 * owns it. There is no wildcard permission, username check, role-name check,
 * or organization-scope bypass anywhere in this flow.
 *
 * Re-running the command reconciles missing registered permissions, the role
 * assignment, and the deployment membership, but deliberately does NOT reset
 * an existing user's password or lifecycle state, so an operator's post-install
 * password change is never undone by a later deployment.
 */
@Injectable()
export class SystemAdministratorBootstrapService {
  constructor(
    private readonly installation: InstallationIdentityService,
    private readonly users: UsersService,
    private readonly rbac: SystemAdministratorRbacService,
    private readonly organizations: OrganizationsService,
    private readonly memberships: OrganizationMembershipsService,
    @Optional()
    @Inject(APP_CONFIG)
    private readonly config?: Pick<AppConfig, 'bootstrapSystemAdminPassword'>,
  ) {}

  async run(): Promise<SystemAdministratorBootstrapResult> {
    // The installation identity is provisioned first and exactly once: every
    // later start loads the same row, and a license can only be bound to an
    // installation that already exists (L-02). It is independent of the
    // administrator — replacing the bootstrap user never changes it.
    const installation = await this.installation.current();
    const user = await this.ensureUser();
    const rbac = await this.rbac.ensureForUser(user.userId);
    const organization = await this.ensureDeploymentMembership(user.userId);
    return {
      installationId: installation.installationId,
      ...user,
      ...rbac,
      ...organization,
    };
  }

  private async ensureUser(): Promise<{
    userId: string;
    userCreated: boolean;
  }> {
    const existing = await this.users.findByUsername(
      BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
    );
    if (existing !== null) {
      // Lifecycle is never silently overridden: a deliberately disabled or
      // soft-deleted administrator stays disabled/deleted. Reviving it here
      // would let a redeployment undo an operator's security decision, so the
      // command fails loudly instead and an operator re-enables the account
      // through the ordinary Users administration API.
      if (!existing.isActive || existing.deletedAt !== null) {
        throw new Error(
          'The bootstrap system administrator exists but is disabled or deleted. Bootstrap will not silently reactivate it; re-enable the account through the Users administration API and re-run.',
        );
      }
      return { userId: existing.id, userCreated: false };
    }

    const initialPassword = this.resolveInitialPassword();

    try {
      const created = await this.users.createUser({
        username: BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
        password: initialPassword,
        mustChangePassword: true,
      });
      return { userId: created.id, userCreated: true };
    } catch (error) {
      // Concurrent bootstrap commands may both observe an empty database. The
      // username unique constraint chooses one creator; the loser adopts the
      // same real user and continues with idempotent RBAC reconciliation.
      if (error instanceof AppException && error.code === 'Conflict') {
        const raced = await this.users.findByUsername(
          BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
        );
        if (raced !== null) {
          return { userId: raced.id, userCreated: false };
        }
      }
      throw error;
    }
  }

  private resolveInitialPassword(): string {
    const raw = this.config?.bootstrapSystemAdminPassword ?? null;
    if (raw === null || raw.trim().length === 0) {
      throw new Error(
        `Cannot provision the bootstrap system administrator "${BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME}": BOOTSTRAP_SYSTEM_ADMIN_PASSWORD must be explicitly configured (minimum ${MIN_PASSWORD_LENGTH} characters) when creating a new initial administrator account.`,
      );
    }
    if (
      raw.length < MIN_PASSWORD_LENGTH ||
      raw.length > MAX_PASSWORD_LENGTH ||
      raw.trim().toUpperCase() === 'CHANGE_ME'
    ) {
      throw new Error(
        `Cannot provision the bootstrap system administrator "${BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME}": BOOTSTRAP_SYSTEM_ADMIN_PASSWORD must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} non-blank characters and must not use a placeholder value.`,
      );
    }
    return raw;
  }

  /**
   * Ensure the administrator is an ordinary member of the pinned deployment
   * organization (ADR-0025 + ODR-3), so organization-scoped APIs authorize it
   * through `assertOrganizationInScope` like any other principal.
   *
   * In an unpinned deployment there is no canonical organization to join;
   * nothing is invented, and the administrator creates the first organization
   * through the ordinary API and takes the existing ODR-3 first-member grant.
   */
  private async ensureDeploymentMembership(userId: string): Promise<{
    organizationId: string | null;
    organizationCreated: boolean;
    membershipCreated: boolean;
  }> {
    const ensured = await this.organizations.ensureDeploymentOrganization();
    if (ensured === null) {
      return {
        organizationId: null,
        organizationCreated: false,
        membershipCreated: false,
      };
    }

    const organizationId = ensured.organization.id;
    try {
      await this.memberships.grantMembership(organizationId, userId);
      return {
        organizationId,
        organizationCreated: ensured.created,
        membershipCreated: true,
      };
    } catch (error) {
      // The composite primary key is the authority: an existing membership is
      // reported by the owning service as a conflict, which is exactly the
      // idempotent "already correct" case. Other memberships of the same user
      // or organization are untouched.
      if (error instanceof AppException && error.code === 'Conflict') {
        return {
          organizationId,
          organizationCreated: ensured.created,
          membershipCreated: false,
        };
      }
      throw error;
    }
  }
}
