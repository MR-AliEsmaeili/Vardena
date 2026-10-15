import { Module, forwardRef } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../kernel/config/app-config.js';
import { LicensingService } from './application/licensing.service.js';
import { LICENSE_PROVIDER } from './application/license-provider.js';
import {
  CrossModuleLicenseUsage,
  LICENSE_USAGE_PORT,
} from './application/license-usage.js';
import { LocalDevelopmentLicenseProvider } from './application/local-development-license.provider.js';
import { PersistentLicenseProvider } from './application/persistent-license.provider.js';
import { InstallationIdentityService } from './application/installation-identity.service.js';
import { LicenseActivationService } from './application/license-activation.service.js';
import { LicenseImportService } from './application/license-import.service.js';
import { LicensingPermissionRegistration } from './application/licensing-permission-registration.js';
import { InstallationsRepository } from './data/installations.repository.js';
import { LicensesRepository } from './data/licenses.repository.js';
import { LicenseStateController } from './api/license-state.controller.js';
import { LicenseActivationController } from './api/license-activation.controller.js';
import { LicenseImportController } from './api/license-import.controller.js';
import { LicenseCustomerTransferController } from './api/license-customer-transfer.controller.js';
import { LicenseGapRecoveryController } from './api/license-gap-recovery.controller.js';
import { LicenseReductionResolutionController } from './api/license-reduction-resolution.controller.js';
import { ClientDevicesController } from './api/client-devices.controller.js';
import { ClientDeviceLifecycleService } from './application/client-device-lifecycle.service.js';
import { ClientDevicesRepository } from './data/client-devices.repository.js';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';

/**
 * Licensing module (docs/licensing-architecture.md, ADR-0030, L-02).
 *
 * Owns schema `licensing`: the installation identity of this deployment, the
 * commercial customer, the retained license versions and their entitlements —
 * and the endpoints over them. No other module reads those tables (AR-07);
 * consumers depend on `LicensingService` only, so replacing the authority
 * (a future commercial provider at the same `LICENSE_PROVIDER` token)
 * changes nothing for them.
 *
 * Provider selection is explicit configuration, never `NODE_ENV`:
 * - `persistent` (default) — the license actually activated on this
 *   installation; absent ⇒ `UNLICENSED`;
 * - `local-development` — the configuration-backed development authority.
 *
 * `IdentityModule` is imported with `forwardRef` for `AuthGuard` (Identity
 * imports Licensing for the capability gate — a composition cycle, not a data
 * cycle); `RbacModule` supplies `AuthorizationService`, the authorization
 * guard and the permission registry. The L-04 usage counts (§8.6) do NOT add
 * module imports: `CrossModuleLicenseUsage` resolves
 * `OrganizationsService`/`UsersService` lazily through `ModuleRef` — they are
 * published application contracts (AR-07), and the allocation-guard edge
 * Organization/Users → Licensing stays one-directional at the module level.
 */
@Module({
  imports: [forwardRef(() => IdentityModule), forwardRef(() => RbacModule)],
  controllers: [
    LicenseStateController,
    LicenseActivationController,
    LicenseImportController,
    LicenseCustomerTransferController,
    LicenseGapRecoveryController,
    LicenseReductionResolutionController,
    ClientDevicesController,
  ],
  providers: [
    InstallationsRepository,
    LicensesRepository,
    ClientDevicesRepository,
    InstallationIdentityService,
    LocalDevelopmentLicenseProvider,
    PersistentLicenseProvider,
    {
      provide: LICENSE_PROVIDER,
      inject: [
        APP_CONFIG,
        PersistentLicenseProvider,
        LocalDevelopmentLicenseProvider,
      ],
      useFactory: (
        config: AppConfig,
        persistent: PersistentLicenseProvider,
        local: LocalDevelopmentLicenseProvider,
      ) =>
        config.licensing.provider === 'local-development' ? local : persistent,
    },
    {
      provide: LICENSE_USAGE_PORT,
      useClass: CrossModuleLicenseUsage,
    },
    LicensingService,
    LicenseImportService,
    LicenseActivationService,
    ClientDeviceLifecycleService,
    LicensingPermissionRegistration,
  ],
  exports: [LicensingService, InstallationIdentityService],
})
export class LicensingModule {}
