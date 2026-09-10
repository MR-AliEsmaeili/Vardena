import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';

describe('Error responses (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('renders unknown routes as EntityNotFound with security headers', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nope')
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
    expect(res.body.message).toBe('Route was not found.');
    expect(res.body.correlationId).toBe(res.headers['x-correlation-id']);
    expect(JSON.stringify(res.body)).not.toContain('stack');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('maps malformed JSON onto BadRequest without internals', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/health/live')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(res.body.code).toBe('BadRequest');
    expect(res.body.correlationId).toBeDefined();
  });
});
