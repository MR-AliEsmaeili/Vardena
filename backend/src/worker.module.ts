import { Module } from '@nestjs/common';
import { JobsRegistry } from './kernel/jobs/jobs.registry.js';
import { KernelModule } from './kernel/kernel.module.js';
import { PrismaModule } from './kernel/prisma/prisma.module.js';
import { WorkerService } from './worker.service.js';

/**
 * Worker root module: same codebase as the API, separate process and
 * entrypoint (`worker.ts`). Shares kernel + Prisma; owns no HTTP.
 * Dispatch loops and schedules register here as their modules land.
 */
@Module({
  imports: [KernelModule, PrismaModule],
  providers: [JobsRegistry, WorkerService],
})
export class WorkerModule {}
