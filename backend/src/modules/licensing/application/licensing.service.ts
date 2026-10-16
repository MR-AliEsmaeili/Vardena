import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  evaluateLicense,
  isPlatformPermission,
  isReadPermissionCode,
  permissionModuleCode,
  unlicensedEvaluation,
  type EntitlementKind,
  type EvaluatedLicense,
  type InstallationLicense,
} from '../domain/license.js';
import {
  LICENSE_PROVIDER,
  type LicenseProvider,
  type LicenseVersionSnapshot,
} from './license-provider.js';

/**
 * The evaluated state plus the retained-version evidence behind it (L-03).
 * `versions` is null for a provider without retained versions (the
 * configuration-backed development authority).
 */
export interface LicenseStateSnapshot {
  license: EvaluatedLicense;
  versions: LicenseVersionSnapshot | null;
}

export interface LicensedAllocation {
  installationId: string;
  limit: number | null;
}

/**
 * Active users an installation may hold before it has EVER been licensed.
 *
 * Installation bootstrap must be able to create the single administrator who
 * then activates the license — requiring a license to create the only account
 * that can install one is a deadlock. The allowance is deliberately the
 * smallest possible (one active user), applies only to a never-licensed
 * installation (an expired or suspended license gets nothing), grants no
 * permission whatsoever, and does not unlock organizations or any other
 * licensed capability.
 */
export const UNLICENSED_BOOTSTRAP_ACTIVE_USERS = 1;

/** Lock key used while no installation identity is readable. */
const UNLICENSED_ALLOCATION_KEY = 'unlicensed-installation';

@Injectable()
export class LicensingService {
  constructor(
    @Inject(LICENSE_PROVIDER) private readonly provider: LicenseProvider,
  ) {}

  /** Name reported when there is no license to report one. */
  private get providerName(): string {
    return this.provider.name ?? 'unknown';
  }

  /**
   * The evaluated installation state. A provider that reports no license
   * yields the explicit `UNLICENSED` evaluation — the installation identity
   * is still reported, because it exists independently of licensing and is
   * what an operator needs to obtain a license (L-02).
   */
  async current(at = new Date()): Promise<EvaluatedLicense> {
    const license = await this.provider.getLicense(at);
    if (license === null) {
      return unlicensedEvaluation({
        installationId: (await this.provider.installationId?.()) ?? null,
        provider: this.providerName,
      });
    }
    return evaluateLicense(license, at);
  }

  /**
   * The state endpoint's read: the canonical evaluation plus the retained
   * versions it was derived from. Version history is read FIRST so the
   * evaluation is the freshest of the two reads; a concurrent import can make
   * the pair inconsistent for one response, never the gate itself (every
   * consumer that decides something calls `current()`).
   */
  async currentState(at = new Date()): Promise<LicenseStateSnapshot> {
    const versions =
      this.provider.versionHistory === undefined
        ? null
        : await this.provider.versionHistory(at);
    return { license: await this.current(at), versions };
  }

  /** Evaluate a candidate license with the same rules as the read path. */
  evaluate(license: InstallationLicense, at = new Date()): EvaluatedLicense {
    return evaluateLicense(license, at);
  }

  async isEntitled(
    kind: EntitlementKind,
    code: string,
    at = new Date(),
  ): Promise<boolean> {
    const license = await this.current(at);
    return (
      (license.accessMode === 'ACTIVE' || license.accessMode === 'GRACE') &&
      license.entitlements.some(
        (entry) => entry.kind === kind && entry.code === code.toLowerCase(),
      )
    );
  }

  /** Fail-closed mutation gate for non-permission-checked/async paths. */
  async assertBusinessMutationAllowed(at = new Date()): Promise<void> {
    const license = await this.current(at);
    if (license.accessMode === 'ACTIVE' || license.accessMode === 'GRACE')
      return;
    if (license.accessMode === 'READ_ONLY') {
      throw AppException.forbidden(
        'The installation license is in read-only mode after the grace period. Renew the license to make changes.',
        {
          reason: 'license_read_only',
          graceEndsAt: license.graceEndsAt?.toISOString() ?? null,
        },
      );
    }
    throw AppException.businessRule(
      'An active installation license is required for this capability.',
    );
  }

  async isPermissionLicensed(
    permissionCode: string,
    at = new Date(),
  ): Promise<boolean> {
    if (isPlatformPermission(permissionCode)) return true;
    const license = await this.current(at);
    if (license.accessMode === 'READ_ONLY') {
      return (
        isReadPermissionCode(permissionCode) &&
        license.entitlements.some(
          (e) =>
            e.kind === 'MODULE' &&
            e.code === permissionModuleCode(permissionCode),
        )
      );
    }
    return this.isEntitled('MODULE', permissionModuleCode(permissionCode), at);
  }

  /**
   * Keep only the permission codes the license makes effective.
   *
   * Platform permissions (`Licensing.*`) are never filtered out: they are
   * ordinary RBAC codes that must still be granted, but gating the capability
   * that installs a license behind a license would make an unlicensed
   * installation impossible to license. Nothing else is exempt — no wildcard,
   * no role name, no username, no NODE_ENV.
   */
  async filterLicensedPermissions(
    permissionCodes: readonly string[],
    at = new Date(),
  ): Promise<string[]> {
    const license = await this.current(at);
    const platform = permissionCodes.filter(isPlatformPermission);
    if (license.accessMode === 'BLOCKED') return platform;
    const modules = new Set(
      license.entitlements
        .filter((entry) => entry.kind === 'MODULE')
        .map((entry) => entry.code),
    );
    return permissionCodes.filter((code) => {
      if (isPlatformPermission(code)) return true;
      if (!modules.has(permissionModuleCode(code))) return false;
      return license.accessMode !== 'READ_ONLY' || isReadPermissionCode(code);
    });
  }

  async requirePermissionLicensed(permissionCode: string): Promise<void> {
    if (!(await this.isPermissionLicensed(permissionCode))) {
      throw AppException.businessRule(
        `Permission "${permissionCode}" is not assignable under the active installation license.`,
      );
    }
  }

  async organizationAllocation(): Promise<LicensedAllocation> {
    const license = await this.requireActive();
    await this.requireModule('organization');
    return {
      installationId: requireInstallationId(license),
      limit: license.organizationLimit,
    };
  }

  async activeUserAllocation(): Promise<LicensedAllocation> {
    const current = await this.current();
    if (current.status === 'UNLICENSED') {
      // Bootstrap allowance (see UNLICENSED_BOOTSTRAP_ACTIVE_USERS). The
      // repository still enforces it atomically under the same advisory
      // lock as a licensed limit, so it cannot be exceeded by a race.
      return {
        installationId: current.installationId ?? UNLICENSED_ALLOCATION_KEY,
        limit: UNLICENSED_BOOTSTRAP_ACTIVE_USERS,
      };
    }
    const license = await this.requireActive();
    await this.requireModule('users');
    return {
      installationId: requireInstallationId(license),
      limit: license.userLimit,
    };
  }

  /** True when this installation has never activated a license. */
  async isUnlicensed(): Promise<boolean> {
    return (await this.current()).status === 'UNLICENSED';
  }

  async assertCanCreateOrganization(currentCount: number): Promise<void> {
    const allocation = await this.organizationAllocation();
    if (allocation.limit !== null && currentCount >= allocation.limit) {
      this.throwOrganizationLimitReached();
    }
  }

  async assertCanActivateUser(currentActiveCount: number): Promise<void> {
    const allocation = await this.activeUserAllocation();
    if (allocation.limit !== null && currentActiveCount >= allocation.limit) {
      this.throwActiveUserLimitReached();
    }
  }

  throwOrganizationLimitReached(): never {
    throw AppException.businessRule(
      'The installation license organization limit has been reached.',
    );
  }

  throwActiveUserLimitReached(): never {
    throw AppException.businessRule(
      'The installation license active-user limit has been reached.',
    );
  }

  throwUnlicensedBootstrapLimitReached(): never {
    throw AppException.businessRule(
      'This installation is not licensed yet. Activate an installation license before adding more users.',
    );
  }

  async requireModule(code: string): Promise<void> {
    if (!(await this.isEntitled('MODULE', code))) {
      throw AppException.businessRule(
        `Module "${code}" is not available under the active installation license.`,
      );
    }
  }

  private async requireActive(): Promise<EvaluatedLicense> {
    const license = await this.current();
    // Grace preserves normal operation (OQ-45); Read-Only/Blocked refuse
    // with the pre-existing allocation error semantics.
    if (license.accessMode !== 'ACTIVE' && license.accessMode !== 'GRACE') {
      throw AppException.businessRule(
        'An active installation license is required for this capability.',
      );
    }
    return license;
  }
}

/**
 * An active license always carries its installation. The guard exists so a
 * future provider cannot silently hand allocation code an empty lock key
 * (the advisory lock that serializes finite limits is derived from it).
 */
function requireInstallationId(license: EvaluatedLicense): string {
  if (license.installationId === null) {
    throw AppException.businessRule(
      'The active installation license does not identify an installation.',
    );
  }
  return license.installationId;
}
