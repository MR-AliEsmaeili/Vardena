import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core/index.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { UsersService } from '../../users/application/users.service.js';
import { ClientDevicesRepository } from '../data/client-devices.repository.js';

export { licenseAllocationLockKey } from '../domain/license-allocation-lock.js';

/**
 * The §8.6 usage snapshot (PDR-11 §8.6, L-04): organization, active-user and
 * registered-device counts for the capacity-conflict check on a signed
 * version that reduces its predecessor's grant. Counts are obtained through
 * the modules that own them; Licensing owns the device records itself.
 *
 * A nullable count means "unknown" and fails closed as `usage-unavailable`.
 */
export interface LicenseUsageSnapshot {
  organizationCount: number | null;
  activeUserCount: number | null;
  registeredDeviceCount: number | null;
}

/** Nest injection token for the port (LicensingModule provides the adapter). */
export const LICENSE_USAGE_PORT = Symbol('LICENSE_USAGE_PORT');

/** The port `LicensesRepository` receives with the importing transaction. */
export type LicenseUsagePort = {
  snapshot: (installationId: string) => Promise<LicenseUsageSnapshot>;
};

/**
 * The production adapter counts organizations and users through their owning
 * modules' published application contracts (AR-07), and active devices through
 * Licensing's own repository. The owning write paths and license import take
 * the same installation-scoped advisory locks before count + mutation.
 *
 * Organization and Users are looked up lazily through ModuleRef because those
 * modules already import Licensing for their allocation guards. Device data is
 * owned by this module and has no cross-module table read.
 */
@Injectable()
export class CrossModuleLicenseUsage implements LicenseUsagePort {
  constructor(private readonly modules: ModuleRef) {}

  async snapshot(installationId: string): Promise<LicenseUsageSnapshot> {
    const [organizationCount, activeUserCount, registeredDeviceCount] =
      await Promise.all([
        this.modules
          .get<OrganizationsService>(OrganizationsService, { strict: false })
          .countLicensedOrganizations(),
        this.modules
          .get<UsersService>(UsersService, { strict: false })
          .countLicensedActiveUsers(),
        this.modules
          .get<ClientDevicesRepository>(ClientDevicesRepository, {
            strict: false,
          })
          .countActiveDevices(installationId),
      ]);
    return { organizationCount, activeUserCount, registeredDeviceCount };
  }
}
