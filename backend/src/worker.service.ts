import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { JobsRegistry } from './kernel/jobs/jobs.registry.js';
import { JsonLogger } from './kernel/logging/json-logger.service.js';
import { PrismaService } from './kernel/prisma/prisma.service.js';

/**
 * Worker startup gate. Unlike the API — which reports database state via
 * `/ready` — the worker cannot do useful work without the database, so it
 * fails fast with a clear message when the database is unreachable
 * (ADR-0015). Actual dispatch loops (outbox, jobs) arrive with the Sync and
 * Jobs modules; they resolve handlers through `JobsRegistry`.
 */
@Injectable()
export class WorkerService implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: JobsRegistry,
    private readonly prisma: PrismaService,
    private readonly logger: JsonLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.prisma.checkHealth();
    } catch (error) {
      this.logger.error(
        'Worker startup aborted: database is unreachable',
        {
          connection: this.prisma.describeConnection(),
          error: error instanceof Error ? error.message : String(error),
        },
        WorkerService.name,
      );
      throw new Error(
        `Worker startup aborted: database is unreachable at ${this.prisma.describeConnection()}. ` +
          'Fix DATABASE_URL or start PostgreSQL and retry.',
      );
    }

    const registered = this.jobs.list();
    if (registered.length === 0) {
      this.logger.log(
        'Worker started with no registered job handlers (dispatch loops arrive with the Sync/Jobs modules).',
        { connection: this.prisma.describeConnection() },
        WorkerService.name,
      );
    } else {
      this.logger.log(
        'Worker started',
        { jobHandlers: registered.map((job) => job.name) },
        WorkerService.name,
      );
    }
  }
}
