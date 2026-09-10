import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database integration suite. Skipped unless VARDENA_TEST_DATABASE_URL
 * is set (CI with Postgres, or local Docker). Requires a generated client
 * (`npm run prisma:generate`) and a migrated database (`prisma migrate dev`).
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Database (live integration)',
  () => {
    it('connects through PrismaService and reports readiness', async () => {
      let app: INestApplication | undefined;
      try {
        const built = await createTestApp({
          override: (builder) =>
            builder
              .overrideProvider(APP_CONFIG)
              .useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL }),
        });
        app = built.app;
        const prisma = built.module.get(PrismaService);
        await prisma.checkHealth();
        expect(prisma.describeConnection()).toMatch(/^postgresql:\/\//);

        const res = await request(app.getHttpServer())
          .get('/api/v1/health/ready')
          .expect(200);
        expect(res.body.checks).toEqual({ database: 'up' });
      } finally {
        await app?.close();
      }
    });
  },
);
