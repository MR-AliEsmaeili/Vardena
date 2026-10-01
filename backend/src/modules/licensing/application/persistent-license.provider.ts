import { Injectable } from '@nestjs/common';
import { LicensesRepository } from '../data/licenses.repository.js';
import type { InstallationLicense } from '../domain/license.js';
import { InstallationIdentityService } from './installation-identity.service.js';
import type { LicenseProvider } from './license-provider.js';

export const PERSISTENT_LICENSE_PROVIDER_NAME = 'persistent';

/**
 * The default licensing authority: the license this installation has
 * actually activated, read from `licensing.licenses` (L-02).
 *
 * Properties that matter:
 * - **restart-safe** — the license lives in the database, so a backend,
 *   container or frontend restart re-reads the same license and never asks
 *   for the code again;
 * - **no startup activation** — reading is a query; activation happens only
 *   through `POST /api/v1/license/activate`;
 * - **no implicit grant** — no persisted license means `UNLICENSED`,
 *   whatever `NODE_ENV` says;
 * - **offline** — no CRM or external licensing server is contacted.
 *
 * The row is the evaluation input, not the verdict: expiry, suspension and
 * validity windows are decided by `evaluateLicense` on every read, so a
 * license that expires while the process runs becomes inactive without any
 * restart or background job.
 */
@Injectable()
export class PersistentLicenseProvider implements LicenseProvider {
  readonly name = PERSISTENT_LICENSE_PROVIDER_NAME;

  constructor(
    private readonly identity: InstallationIdentityService,
    private readonly licenses: LicensesRepository,
  ) {}

  async getLicense(): Promise<InstallationLicense | null> {
    const installation = await this.identity.current();
    const persisted = await this.licenses.findCurrent(
      installation.installationId,
    );
    if (persisted === null) return null;
    return {
      customerId: persisted.customerId,
      installationId: persisted.installationId,
      licenseId: persisted.licenseId,
      status: persisted.status,
      validFrom: persisted.validFrom,
      validUntil: persisted.validUntil,
      organizationLimit: persisted.organizationLimit,
      userLimit: persisted.userLimit,
      entitlements: persisted.entitlements,
      provider: PERSISTENT_LICENSE_PROVIDER_NAME,
    };
  }

  async installationId(): Promise<string | null> {
    return this.identity.currentIdOrNull();
  }
}
