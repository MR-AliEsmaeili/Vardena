import { Module } from '@nestjs/common';
import { LicensingService } from './application/licensing.service.js';
import { LICENSE_PROVIDER } from './application/license-provider.js';
import { LocalDevelopmentLicenseProvider } from './application/local-development-license.provider.js';

@Module({
  providers: [
    LocalDevelopmentLicenseProvider,
    { provide: LICENSE_PROVIDER, useExisting: LocalDevelopmentLicenseProvider },
    LicensingService,
  ],
  exports: [LicensingService],
})
export class LicensingModule {}
