import { Inject, Injectable } from '@nestjs/common';
import {
  APP_CONFIG,
  type AppConfig,
} from '../../../kernel/config/app-config.js';
import type { InstallationLicense } from '../domain/license.js';
import type { LicenseProvider } from './license-provider.js';

export const LOCAL_DEVELOPMENT_LICENSE_PROVIDER_NAME = 'local-development';

/**
 * Fixed identifiers of the configuration-backed development authority. They
 * are deliberately constant and obviously synthetic: this provider never
 * reads or writes the persisted installation identity, so selecting it can
 * never corrupt the real one.
 */
const DEVELOPMENT_INSTALLATION_ID = '01JLOCALINSTALLATION000000';

/**
 * Explicit, auditable local provider — selected ONLY by
 * `LICENSE_PROVIDER=local-development`.
 *
 * It does not inspect NODE_ENV, users, roles, or email addresses, and it is
 * no longer the default: an installation that configures nothing uses the
 * persistent provider and is therefore `UNLICENSED` until a real license is
 * activated (L-02). This provider exists for hermetic test suites and for a
 * local development machine that deliberately opts out of activation.
 */
@Injectable()
export class LocalDevelopmentLicenseProvider implements LicenseProvider {
  readonly name = LOCAL_DEVELOPMENT_LICENSE_PROVIDER_NAME;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async getLicense(): Promise<InstallationLicense> {
    const configured = this.config.licensing;
    return {
      customerId: '01JLOCALCUSTOMER0000000000',
      customerCode: 'CUST-LOCAL-DEV',
      installationId: DEVELOPMENT_INSTALLATION_ID,
      licenseId: '01JLOCALDEVELOPMENT0000000',
      status: configured.status,
      validFrom: configured.validFrom,
      validUntil: configured.validUntil,
      organizationLimit: configured.organizationLimit,
      userLimit: configured.userLimit,
      // A local development license is not a signed LicenseVersion and cannot
      // grant device capacity.
      deviceLimit: null,
      deviceLimitSpecified: false,
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
      provider: LOCAL_DEVELOPMENT_LICENSE_PROVIDER_NAME,
    };
  }

  async installationId(): Promise<string | null> {
    return DEVELOPMENT_INSTALLATION_ID;
  }
}
