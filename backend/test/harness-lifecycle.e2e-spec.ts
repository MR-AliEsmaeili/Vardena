import {
  Injectable,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { createTestApp } from './support/test-app.js';

/**
 * Regression suite for the E2E hang root cause
 * (docs/testing/e2e-hang-root-cause.md).
 *
 * The historical "tests finished but `npm run test:e2e` never exits"
 * signature was an orphaned Prisma `pg` Pool: a teardown path that skipped
 * `app.close()` left the pool's sockets open inside the test worker. These
 * tests pin the two lifecycle guarantees that prevent it:
 *
 * 1. `app.close()` really ends the shared pg pool owned by `PrismaService`
 *    (`onModuleDestroy` → `$disconnect()` + `pool.end()`), and
 * 2. when `app.init()` fails, `createTestApp()` still tears the module down,
 *    so already-instantiated providers (the pool!) are destroyed instead of
 *    being orphaned by the thrown error.
 *
 * They run on the default hermetic configuration (intentionally unreachable
 * DATABASE_URL, see vitest.config.e2e.ts) and therefore behave identically
 * with and without a live database or generated Prisma client.
 */

/** Test-only structural view of PrismaService's private pg pool. */
interface PoolView {
  pool: { ended: boolean };
}

function poolOf(prisma: PrismaService): PoolView['pool'] {
  return (prisma as unknown as PoolView).pool;
}

describe('E2E harness lifecycle (hang regression)', () => {
  it('app.close() ends the pg pool owned by PrismaService', async () => {
    const { app, module } = await createTestApp();
    const prisma = module.get(PrismaService);
    try {
      // Exercise the readiness path once so the database path is really
      // used before teardown (deterministic 503: unreachable DATABASE_URL
      // or the not-generated client stub — both are the designed answer).
      await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503);
      expect(poolOf(prisma).ended).toBe(false);
    } finally {
      await app.close();
    }
    expect(poolOf(prisma).ended).toBe(true);
  });

  it('a failed app.init() still destroys instantiated providers (no orphaned pool)', async () => {
    const destroyed: string[] = [];
    let observedPrisma: PrismaService | undefined;

    @Injectable()
    class LifecycleWitness implements OnModuleDestroy {
      constructor(prisma: PrismaService) {
        observedPrisma = prisma;
      }
      onModuleDestroy(): void {
        destroyed.push('witness');
      }
    }
    @Module({ providers: [LifecycleWitness] })
    class WitnessModule {}

    @Injectable()
    class InitBomb implements OnModuleInit {
      onModuleInit(): void {
        throw new Error('deliberate init failure (harness regression probe)');
      }
    }
    @Module({ providers: [InitBomb] })
    class InitBombModule {}

    await expect(
      createTestApp({ extraImports: [WitnessModule, InitBombModule] }),
    ).rejects.toThrow('deliberate init failure');

    // The harness closed the app it could not init: destroy hooks ran …
    expect(destroyed).toContain('witness');
    // … and the root-cause resource — the shared pg pool — was released.
    expect(observedPrisma).toBeDefined();
    expect(poolOf(observedPrisma as PrismaService).ended).toBe(true);
  });

  it('leaves no TCP handles behind after close', async () => {
    const { app } = await createTestApp();
    try {
      await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    } finally {
      await app.close();
    }
    // Closed sockets are reaped asynchronously; poll briefly instead of
    // asserting on a single racy snapshot.
    const deadline = Date.now() + 2_000;
    let tcpHandles: string[];
    do {
      await new Promise((resolve) => setTimeout(resolve, 25));
      tcpHandles = process
        .getActiveResourcesInfo()
        .filter((name) => name.startsWith('TCP'));
    } while (tcpHandles.length > 0 && Date.now() < deadline);
    expect(tcpHandles).toEqual([]);
  });
});
