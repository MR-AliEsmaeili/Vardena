import { Inject, Injectable } from '@nestjs/common';
import {
  APP_CONFIG,
  type AppConfig,
} from '../../../kernel/config/app-config.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';

export interface LivenessResult {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
}

export interface ReadinessResult {
  status: 'ok';
  version: string;
  checks: { database: 'up' };
}

/**
 * Probe logic. Liveness never touches the database; readiness does, mapping
 * ANY database failure onto 503 `ServiceUnavailable` so orchestrators get a
 * clear signal (the underlying cause is logged, never exposed — AR-24).
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: JsonLogger,
  ) {}

  checkLiveness(): LivenessResult {
    return {
      status: 'ok',
      version: this.config.appVersion,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  async checkReadiness(): Promise<ReadinessResult> {
    try {
      await this.prisma.checkHealth();
    } catch (error) {
      // Message-only: driver messages contain no secrets (verified: pg/Prisma
      // never echo the connection string), and the 503 response stays generic.
      this.logger.warn(
        'Readiness check failed: database unreachable',
        { error: error instanceof Error ? error.message : String(error) },
        HealthService.name,
      );
      throw AppException.serviceUnavailable(
        'The database is temporarily unreachable. Please try again later.',
      );
    }
    return {
      status: 'ok',
      version: this.config.appVersion,
      checks: { database: 'up' },
    };
  }
}
