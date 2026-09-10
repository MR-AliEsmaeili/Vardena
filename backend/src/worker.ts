import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { runEntrypoint } from './kernel/bootstrap.js';
import { loadAppConfig } from './kernel/config/app-config.js';
import { JsonLogger } from './kernel/logging/json-logger.service.js';
import { WorkerModule } from './worker.module.js';

/**
 * Worker process entrypoint (ADR-0010: same codebase, separate process).
 *
 * At foundation stage the worker verifies database connectivity at startup
 * (fail fast — a worker without the database is useless) and then idles:
 *
 * - NO outbox dispatch (arrives with the Sync module).
 * - NO integration calls (arrive with Integration adapters).
 * - NO PDF/Excel/report jobs (arrive with Print/Excel/Reporting + Jobs).
 *
 * How future jobs register: a provider in the owning module injects
 * `JobsRegistry` and calls `register(name, handler)`; dispatch loops resolve
 * handlers by job name and invoke them with a per-job correlation id. See
 * `kernel/jobs/jobs.registry.ts`.
 *
 * Lifetime: the keep-alive timer below holds the event loop until SIGTERM /
 * SIGINT. It is an explicit placeholder — the first real scheduler or poll
 * loop (Jobs/Sync) will own the worker lifetime and remove it (ADR-0015).
 */
async function bootstrap(): Promise<void> {
  // Throws on invalid env — fail fast before booting (DI loads it again).
  loadAppConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  const logger = app.get(JsonLogger);
  app.useLogger(logger);
  // Runs WorkerService.onApplicationBootstrap (DB gate + handler listing).
  await app.init();

  const keepAlive = setInterval(() => {}, 2_147_483_647);
  await new Promise<void>((resolve) => {
    process.once('SIGTERM', () => resolve());
    process.once('SIGINT', () => resolve());
  });
  clearInterval(keepAlive);
  await app.close();
  logger.log('Worker stopped', {}, 'Bootstrap');
}

await runEntrypoint('worker', bootstrap);
