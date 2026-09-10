import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('Correlation id (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('echoes a valid client-supplied ULID', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-correlation-id', '01arz3ndektsv4rrffq69g5fav')
      .expect(200);
    expect(res.headers['x-correlation-id']).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  it('echoes a valid client-supplied UUID', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-correlation-id', '550E8400-E29B-41D4-A716-446655440000')
      .expect(200);
    expect(res.headers['x-correlation-id']).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('replaces invalid ids and generates one when missing', async () => {
    const invalid = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-correlation-id', '!!!not-a-correlation-id!!!')
      .expect(200);
    expect(invalid.headers['x-correlation-id']).toMatch(ULID_PATTERN);

    const missing = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200);
    expect(missing.headers['x-correlation-id']).toMatch(ULID_PATTERN);
  });

  it('propagates the id into error responses', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .set('x-correlation-id', '01ARZ3NDEKTSV4RRFFQ69G5FAV')
      .expect(404);
    expect(res.body.correlationId).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(res.headers['x-correlation-id']).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });
});
