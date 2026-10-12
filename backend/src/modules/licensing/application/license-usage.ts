import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core/index.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { UsersService } from '../../users/application/users.service.js';

/**
 * The §8.6 usage snapshot (PDR-11 §8.6, L-04): how many organizations and how
 * many active users the installation currently has, for the
 * capacity-conflict check on a version that shrinks its predecessor's grant.
 *
 * `activeUserCount` is nullable ON PURPOSE: `null` means "the count could not
 * be produced", and the conflict evaluation fails CLOSED on it — an
 * unavailable count is a conflict (`usage-unavailable`), never a silent
 * accept. There is no device dimension: OQ-83 is still open, so §8.6 checks
 * organizations and active users only (the allocation guards enforce the same
 * two limits).
 */
export interface LicenseUsageSnapshot {
  organizationCount: number;
  activeUserCount: number | null;
}

/** Nest injection token for the port (LicensingModule provides the adapter). */
export const LICENSE_USAGE_PORT = Symbol('LICENSE_USAGE_PORT');

/** The port `LicensesRepository` receives with the importing transaction. */
export type LicenseUsagePort = {
  snapshot: () => Promise<LicenseUsageSnapshot>;
};

/**
 * The advisory-lock keys for the licensed allocations, shared with the
 * allocation guards: an importing transaction takes the SAME transaction-
 * scoped locks organization creation and active-user activation hold, so a
 * concurrent creation is either committed and counted, or waiting and not —
 * it can never slip between the conflict check and the commit. Both sides
 * build the key from this one function (AR-11 names the raw-SQL exemption).
 */
export function licenseAllocationLockKey(
  installationId: string,
  resource: 'organizations' | 'active-users',
): string {
  return `vardena:license:${installationId}:${resource}`;
}

/**
 * The production adapter for {@link LicenseUsagePort}: it counts through the
 * OTHER modules' published application contracts (AR-07 — application-service
 * contracts, never their tables): `OrganizationsService.countLicensedOrganizations`
 * (the same count the organization-creation guard enforces) and
 * `UsersService.countLicensedActiveUsers` (the same count the active-user
 * guard enforces). Both carry no permission of their own: the calling import
 * has already performed its own authorization.
 *
 * The services are resolved LAZILY through `ModuleRef` with `strict: false`
 * instead of being constructor-injected: OrganizationModule and UsersModule
 * already import LicensingModule (the allocation guards), so constructor
 * injection would need `forwardRef` module imports whose class bindings are
 * not reliably initialized under every module loader (a module-graph cycle
 * for a read-only count). A lazy lookup keeps the Licensing → Organization/
 * Users edge at the application-contract level and one-directional at the
 * module level: no module imports back into Licensing because of this port.
 */
@Injectable()
export class CrossModuleLicenseUsage implements LicenseUsagePort {
  constructor(private readonly modules: ModuleRef) {}

  async snapshot(): Promise<LicenseUsageSnapshot> {
    // `strict: false` looks the whole container up: the services live in
    // OrganizationModule/UsersModule, not in LicensingModule. The lookup is
    // lazy AND repeated — it is a map read, and a snapshot is taken at most
    // twice per import (pre-check + in-transaction).
    const [organizationCount, activeUserCount] = await Promise.all([
      this.modules
        .get<OrganizationsService>(OrganizationsService, { strict: false })
        .countLicensedOrganizations(),
      this.modules
        .get<UsersService>(UsersService, { strict: false })
        .countLicensedActiveUsers(),
    ]);
    return { organizationCount, activeUserCount };
  }
}
