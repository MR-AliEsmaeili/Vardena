import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { createTestApp } from './support/test-app.js';

describe('Rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp({
      override: (builder) =>
        builder.overrideProvider(APP_CONFIG).useValue({
          ...loadAppConfig(),
          rateLimit: { windowMs: 60_000, max: 2 },
        }),
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows requests within budget with quota headers, then 429s with the error envelope', async () => {
    const server = app.getHttpServer();
    // Non-health routes count toward the limit (health probes are exempt).
    const first = await request(server).get('/api/v1/nope').expect(404);
    expect(first.headers['ratelimit-limit']).toBe('2');
    expect(first.headers['ratelimit-remaining']).toBe('1');

    await request(server).get('/api/v1/nope').expect(404);

    const limited = await request(server).get('/api/v1/nope').expect(429);
    expect(limited.body.code).toBe('RateLimitExceeded');
    expect(limited.body.details).toEqual({
      retryAfterSeconds: expect.any(Number),
    });
    expect(limited.body.correlationId).toBe(
      limited.headers['x-correlation-id'],
    );
    expect(limited.headers['retry-after']).toBeDefined();

    // Health probes stay exempt even after the budget is exhausted.
    await request(server).get('/api/v1/health/live').expect(200);
  });
});
