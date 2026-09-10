import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';
import { ValidationProbeModule } from './support/validation-probe.js';

describe('Request validation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp({ extraImports: [ValidationProbeModule] }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a valid body and transforms types', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe-validation')
      .send({ title: 'Valid title', count: 3, nested: { name: 'ok' } })
      .expect(201);
    expect(res.body).toEqual({
      received: { title: 'Valid title', count: 3, nested: { name: 'ok' } },
    });
  });

  it('rejects unknown fields with a ValidationFailed envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe-validation')
      .send({ title: 'Valid title', count: 3, isAdmin: true })
      .expect(400);
    expect(res.body.code).toBe('ValidationFailed');
    expect(res.body.message).toBe('Request validation failed.');
    expect(res.body.details).toContainEqual(
      expect.objectContaining({ field: 'isAdmin' }),
    );
    expect(res.body.correlationId).toBe(res.headers['x-correlation-id']);
  });

  it('rejects wrong types, short strings, and nested violations with dotted paths', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe-validation')
      .send({ title: 'no', count: 'many', nested: { name: 'x' } })
      .expect(400);
    const fields = (res.body.details as Array<{ field: string }>)
      .map((issue) => issue.field)
      .sort();
    // 'many' violates both isInt and min on count — every violation is reported.
    expect(fields).toEqual(['count', 'count', 'nested.name', 'title']);
  });

  it('coerces query params and rejects unknown/invalid ones', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/v1/probe-validation?page=3')
      .expect(200);
    expect(ok.body).toEqual({ page: 3, pageType: 'number' });

    const bad = await request(app.getHttpServer())
      .get('/api/v1/probe-validation?page=abc')
      .expect(400);
    expect(bad.body.code).toBe('ValidationFailed');

    const unknown = await request(app.getHttpServer())
      .get('/api/v1/probe-validation?hacker=1')
      .expect(400);
    expect(unknown.body.code).toBe('ValidationFailed');
  });
});
