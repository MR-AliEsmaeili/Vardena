import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  evaluateLicense,
  permissionModuleCode,
  type EntitlementKind,
  type EvaluatedLicense,
} from '../domain/license.js';
import { LICENSE_PROVIDER, type LicenseProvider } from './license-provider.js';

export interface LicensedAllocation {
  installationId: string;
  limit: number | null;
}

@Injectable()
export class LicensingService {
  constructor(
    @Inject(LICENSE_PROVIDER) private readonly provider: LicenseProvider,
  ) {}

  async current(at = new Date()): Promise<EvaluatedLicense> {
    return evaluateLicense(await this.provider.getLicense(), at);
  }

  async isEntitled(
    kind: EntitlementKind,
    code: string,
    at = new Date(),
  ): Promise<boolean> {
    const license = await this.current(at);
    return (
      license.active &&
      license.entitlements.some(
        (entry) => entry.kind === kind && entry.code === code.toLowerCase(),
      )
    );
  }

  async isPermissionLicensed(
    permissionCode: string,
    at = new Date(),
  ): Promise<boolean> {
    return this.isEntitled('MODULE', permissionModuleCode(permissionCode), at);
  }

  async filterLicensedPermissions(
    permissionCodes: readonly string[],
    at = new Date(),
  ): Promise<string[]> {
    const license = await this.current(at);
    if (!license.active) return [];
    const modules = new Set(
      license.entitlements
        .filter((entry) => entry.kind === 'MODULE')
        .map((entry) => entry.code),
    );
    return permissionCodes.filter((code) =>
      modules.has(permissionModuleCode(code)),
    );
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
      installationId: license.installationId,
      limit: license.organizationLimit,
    };
  }

  async activeUserAllocation(): Promise<LicensedAllocation> {
    const license = await this.requireActive();
    await this.requireModule('users');
    return { installationId: license.installationId, limit: license.userLimit };
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

  async requireModule(code: string): Promise<void> {
    if (!(await this.isEntitled('MODULE', code))) {
      throw AppException.businessRule(
        `Module "${code}" is not available under the active installation license.`,
      );
    }
  }

  private async requireActive(): Promise<EvaluatedLicense> {
    const license = await this.current();
    if (!license.active) {
      throw AppException.businessRule(
        'An active installation license is required for this capability.',
      );
    }
    return license;
  }
}
