import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadAppConfig } from './config/app-config.js';
import { DOMAIN_EVENT_BUS, DomainEventBus } from './events/domain-event-bus.js';
import { JsonLogger } from './logging/json-logger.service.js';

/**
 * Kernel module: global technical infrastructure (AR-06).
 * Config + logging + technical utilities only. No business logic may ever
 * live here.
 */
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadAppConfig() },
    JsonLogger,
    { provide: DOMAIN_EVENT_BUS, useFactory: () => new DomainEventBus() },
  ],
  exports: [APP_CONFIG, JsonLogger, DOMAIN_EVENT_BUS],
})
export class KernelModule {}
