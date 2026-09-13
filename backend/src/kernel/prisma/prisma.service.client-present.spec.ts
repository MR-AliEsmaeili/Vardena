import { PrismaPg } from '@prisma/adapter-pg';
import { describe, expect, it, vi } from 'vitest';
import { loadAppConfig } from '../config/app-config.js';
import type { JsonLogger } from '../logging/json-logger.service.js';
import { PrismaService } from './prisma.service.js';

// Companion to prisma.service.spec.ts: pins the generated module to a
// working client so the client-present path is covered hermetically
// (independent of whether `prisma generate` has run on disk).
const queries: Array<{ text: string; values: unknown[] }> = [];

vi.mock('../../generated/prisma/client.js', () => {
  class FakePrismaClient {
    static lastOptions: unknown;
    disconnected = false;
    constructor(options: { adapter: unknown }) {
      FakePrismaClient.lastOptions = options;
    }
    async $queryRaw(
      query: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<unknown> {
      queries.push({ text: query.join('?'), values });
      return [{ '?column?': 1 }];
    }
    async $disconnect(): Promise<void> {
      this.disconnected = true;
    }
  }
  return { PrismaClient: FakePrismaClient, default: FakePrismaClient };
});

function makeService(): PrismaService {
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as JsonLogger;
  const config = loadAppConfig({
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db',
  });
  return new PrismaService(config, logger);
}

describe('PrismaService (generated client present)', () => {
  it('builds the client once over the shared pg adapter', async () => {
    const service = makeService();
    const first = await service.getClient<{ disconnected: boolean }>();
    const second = await service.getClient<{ disconnected: boolean }>();
    expect(second).toBe(first);
    expect(first.disconnected).toBe(false);
    await service.onModuleDestroy();
    expect(first.disconnected).toBe(true);
  });

  it('passes the PrismaPg adapter to the generated client', async () => {
    const service = makeService();
    await service.getClient();
    const { PrismaClient } =
      (await import('../../generated/prisma/client.js')) as unknown as {
        PrismaClient: { lastOptions: { adapter: unknown } };
      };
    expect(PrismaClient.lastOptions.adapter).toBeInstanceOf(PrismaPg);
    await service.onModuleDestroy();
  });

  it('probes connectivity through $queryRaw', async () => {
    queries.length = 0;
    const service = makeService();
    await service.checkHealth();
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain('SELECT 1');
    await service.onModuleDestroy();
  });
});
