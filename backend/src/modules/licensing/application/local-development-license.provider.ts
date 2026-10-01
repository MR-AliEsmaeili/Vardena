import { Inject, Injectable } from '@nestjs/common';
import {
  APP_CONFIG,
  type AppConfig,
} from '../../../kernel/config/app-config.js';
import type { InstallationLicense } from '../domain/license.js';
import type { LicenseProvider } from './license-provider.js';

/**
 * Explicit, auditable local provider. It does not inspect NODE_ENV, users,
 * roles, or email addresses. Production may select a future provider at the
 * same token without changing consumers.
 */
@Injectable()
export class LocalDevelopmentLicenseProvider implements LicenseProvider {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async getLicense(): Promise<InstallationLicense> {
    const configured = this.config.licensing;
    return {
      customerId: '01JLOCALCUSTOMER0000000000',
      installationId: '01JLOCALINSTALLATION000000',
      licenseId: '01JLOCALDEVELOPMENT0000000',
      status: configured.status,
      validFrom: configured.validFrom,
      validUntil: configured.validUntil,
      organizationLimit: configured.organizationLimit,
      userLimit: configured.userLimit,
      entitlements: [
        ...configured.moduleEntitlements.map((code) => ({
          kind: 'MODULE' as const,
          code,
        })),
        ...configured.featureEntitlements.map((code) => ({
          kind: 'FEATURE' as const,
          code,
        })),
      ],
      provider: 'local-development',
    };
  }
}
