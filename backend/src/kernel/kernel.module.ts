import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadAppConfig } from './config/app-config.js';
import { JsonLogger } from './logging/json-logger.service.js';

/**
 * Kernel module: global technical infrastructure (AR-06).
 * Config + logging only. No business logic may ever live here.
 */
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadAppConfig() },
    JsonLogger,
  ],
  exports: [APP_CONFIG, JsonLogger],
})
export class KernelModule {}
