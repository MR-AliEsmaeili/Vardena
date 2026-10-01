import { Module, forwardRef } from '@nestjs/common';
import { LicensingService } from './application/licensing.service.js';
import { LICENSE_PROVIDER } from './application/license-provider.js';
import { LocalDevelopmentLicenseProvider } from './application/local-development-license.provider.js';
import { LicenseStateController } from './api/license-state.controller.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Licensing module (docs/modules.md §Licensing).
 *
 * Owns the installation license capability state and the read endpoint that
 * exposes it (`GET /api/v1/license/current`). The controller lives in this
 * module's `api/` folder, so this module — not a consumer — registers it
 * (AR-02: a module owns its folder; AR-03: controllers are transport-only).
 *
 * `IdentityModule` is imported with `forwardRef` for `AuthGuard`: Identity
 * imports Licensing for the capability gate, so the edge is a composition
 * cycle, not a data cycle (same pattern as `UsersModule`/`OrganizationModule`).
 */
@Module({
  imports: [forwardRef(() => IdentityModule)],
  controllers: [LicenseStateController],
  providers: [
    LocalDevelopmentLicenseProvider,
    { provide: LICENSE_PROVIDER, useExisting: LocalDevelopmentLicenseProvider },
    LicensingService,
  ],
  exports: [LicensingService],
})
export class LicensingModule {}
