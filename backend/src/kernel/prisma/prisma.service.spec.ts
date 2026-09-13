import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { loadAppConfig } from '../config/app-config.js';
import type { JsonLogger } from '../logging/json-logger.service.js';
import { PrismaService, safeDatabaseLabel } from './prisma.service.js';

// Hermeticity: unit tests must pass identically before AND after
// `prisma generate`. The real generated client overwrites
// src/generated/prisma/client.ts (see that file's docstring), flipping the
// "codegen absent" path — so this spec pins the generated module to the
// absent-codegen shape (constructor throws the actionable error, exactly
// like the committed stub) instead of importing whatever is on disk.
// The client-present path is covered by
// prisma.service.client-present.spec.ts (mocked) and the live-DB e2e suites.
vi.mock('../../generated/prisma/client.js', () => {
  const ERROR_MSG =
    'Prisma Client has not been generated. Run "npm run prisma:generate" from backend/ and retry.';
  return {
    PrismaClient: class {
      constructor(_options: { adapter: unknown }) {
        throw new Error(ERROR_MSG);
      }
    },
  };
});

const DB_URL =
  'postgresql://vardena:s3cret@db.internal:5432/vardena?schema=public';

function makeService(): { service: PrismaService; logger: JsonLogger } {
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as JsonLogger;
  const config = loadAppConfig({
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db',
  });
  return { service: new PrismaService(config, logger), logger };
}

describe('safeDatabaseLabel', () => {
  it('strips credentials and query strings', () => {
    expect(safeDatabaseLabel(DB_URL)).toBe(
      'postgresql://db.internal:5432/vardena',
    );
    expect(safeDatabaseLabel('postgresql://u:p@h/db')).toBe(
      'postgresql://h/db',
    );
  });

  it('falls back cleanly for unparseable input', () => {
    expect(safeDatabaseLabel('not a url')).toBe('unparseable DATABASE_URL');
  });
});

describe('PrismaService', () => {
  it('constructs without touching the network and describes the connection safely', async () => {
    const { service } = makeService();
    expect(service.describeConnection()).toBe('postgresql://127.0.0.1:1/db');
    await service.onModuleDestroy();
  });

  it('logs pool idle-client errors instead of crashing', async () => {
    const { service, logger } = makeService();
    const pool = (service as unknown as { pool: Pool }).pool;
    pool.emit('error', new Error('idle boom'));
    expect(logger.error).toHaveBeenCalledWith(
      'Postgres pool idle-client error',
      expect.objectContaining({ error: 'idle boom' }),
      'PrismaService',
    );
    await service.onModuleDestroy();
  });

  it('fails clearly when the generated client is absent (codegen not run)', async () => {
    const { service } = makeService();
    await expect(service.getClient()).rejects.toThrow(
      /has not been generated.*prisma:generate/,
    );
    await expect(service.checkHealth()).rejects.toThrow(
      /has not been generated/,
    );
    await service.onModuleDestroy();
  });
});
