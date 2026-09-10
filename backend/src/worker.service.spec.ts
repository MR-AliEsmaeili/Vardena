import { describe, expect, it, vi } from 'vitest';
import { JobsRegistry } from './kernel/jobs/jobs.registry.js';
import type { JsonLogger } from './kernel/logging/json-logger.service.js';
import type { PrismaService } from './kernel/prisma/prisma.service.js';
import { WorkerService } from './worker.service.js';

function makeService(prisma: Partial<PrismaService>): {
  service: WorkerService;
  logger: JsonLogger;
} {
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as JsonLogger;
  const service = new WorkerService(
    new JobsRegistry(),
    prisma as PrismaService,
    logger,
  );
  return { service, logger };
}

describe('WorkerService', () => {
  it('starts and reports zero registered handlers', async () => {
    const { service, logger } = makeService({
      checkHealth: vi.fn().mockResolvedValue(undefined),
      describeConnection: () => 'postgresql://db:5432/vardena',
    });
    await service.onApplicationBootstrap();
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('no registered job handlers'),
      expect.objectContaining({ connection: 'postgresql://db:5432/vardena' }),
      'WorkerService',
    );
  });

  it('fails fast with a clear message when the database is unreachable', async () => {
    const { service, logger } = makeService({
      checkHealth: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      describeConnection: () => 'postgresql://db:5432/vardena',
    });
    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /Worker startup aborted.*postgresql:\/\/db:5432/,
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Worker startup aborted: database is unreachable',
      expect.objectContaining({ error: 'ECONNREFUSED' }),
      'WorkerService',
    );
  });
});
