import { Module } from '@nestjs/common';
import { HealthController } from './api/health.controller.js';
import { HealthService } from './application/health.service.js';

/**
 * Health module: liveness + readiness probes for orchestrators.
 *
 * Deliberately thin (api + application only): probes have no domain rules,
 * own no data, and publish no events. It doubles as the reference example
 * of module anatomy (AR-02) and transport-only controllers (AR-03) until
 * the first business module lands. It is NOT a business module.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
