import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { createTestApp } from './support/test-app.js';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health/live answers without a database', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      version: expect.any(String),
      uptimeSeconds: expect.any(Number),
    });
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('GET /api/v1/health/ready is 503 ServiceUnavailable when the database is down', async () => {
    // The e2e vitest config points DATABASE_URL at a refused address, so this
    // is deterministic with or without Docker. It asserts the contract
    // (status + code), not the underlying cause.
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(503);
    expect(res.body.code).toBe('ServiceUnavailable');
    expect(res.body.message).toBe(
      'The database is temporarily unreachable. Please try again later.',
    );
    expect(res.body.correlationId).toBe(res.headers['x-correlation-id']);
    expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
  });

  it('GET /api/v1/health/ready is 200 when the database is healthy', async () => {
    const { app: healthy } = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(PrismaService)
          .useValue({ checkHealth: async () => {} }),
    });
    try {
      const res = await request(healthy.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(200);
      expect(res.body).toEqual({
        status: 'ok',
        version: expect.any(String),
        checks: { database: 'up' },
      });
    } finally {
      await healthy.close();
    }
  });

  it('serves the generated OpenAPI contract at /api/docs-json', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths['/api/v1/health/live'].get).toBeDefined();
    expect(res.body.paths['/api/v1/health/ready'].get).toBeDefined();
    await request(app.getHttpServer()).get('/api/docs').expect(200);
  });
});
