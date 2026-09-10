import { describe, expect, it, vi } from 'vitest';
import { loadAppConfig } from '../../../kernel/config/app-config.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import type { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import type { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { HealthService } from './health.service.js';

function makeService(prisma: Partial<PrismaService>): {
  service: HealthService;
  logger: JsonLogger;
} {
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as JsonLogger;
  const config = loadAppConfig({
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db',
    APP_VERSION: '9.9.9',
  });
  const service = new HealthService(prisma as PrismaService, config, logger);
  return { service, logger };
}

describe('HealthService', () => {
  it('reports liveness without touching the database', () => {
    const checkHealth = vi.fn();
    const { service } = makeService({ checkHealth });
    const result = service.checkLiveness();
    expect(result.status).toBe('ok');
    expect(result.version).toBe('9.9.9');
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(checkHealth).not.toHaveBeenCalled();
  });

  it('reports readiness when the database is reachable', async () => {
    const { service } = makeService({
      checkHealth: vi.fn().mockResolvedValue(undefined),
    });
    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ok',
      version: '9.9.9',
      checks: { database: 'up' },
    });
  });

  it('maps database failures onto 503 ServiceUnavailable and logs the cause', async () => {
    const { service, logger } = makeService({
      checkHealth: vi
        .fn()
        .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:1')),
    });
    const failure = await service
      .checkReadiness()
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppException);
    expect((failure as AppException).code).toBe('ServiceUnavailable');
    expect((failure as AppException).getStatus()).toBe(503);
    expect(logger.warn).toHaveBeenCalledWith(
      'Readiness check failed: database unreachable',
      expect.objectContaining({
        error: expect.stringContaining('ECONNREFUSED'),
      }),
      'HealthService',
    );
  });
});
