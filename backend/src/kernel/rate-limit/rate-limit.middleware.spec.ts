import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppException } from '../errors/app-exception.js';
import { createRateLimitMiddleware } from './rate-limit.middleware.js';

function mockReqRes(ip = '10.0.0.1'): {
  req: Request;
  res: Response;
  headers: Map<string, string>;
} {
  const headers = new Map<string, string>();
  const req = { ip } as Request;
  const res = {
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, value);
    }),
  } as unknown as Response;
  return { req, res, headers };
}

function run(
  middleware: ReturnType<typeof createRateLimitMiddleware>,
  req: Request,
  res: Response,
): unknown {
  const next = vi.fn() as unknown as NextFunction;
  middleware(req, res, next);
  const calls = (next as unknown as { mock: { calls: unknown[][] } }).mock
    .calls;
  return calls.length > 0 ? calls[0]?.[0] : undefined;
}

describe('createRateLimitMiddleware', () => {
  it('allows requests within budget and reports remaining quota', () => {
    const middleware = createRateLimitMiddleware({ windowMs: 60_000, max: 2 });
    const { req, res, headers } = mockReqRes();

    expect(run(middleware, req, res)).toBeUndefined();
    expect(headers.get('RateLimit-Limit')).toBe('2');
    expect(headers.get('RateLimit-Remaining')).toBe('1');

    const second = mockReqRes();
    expect(run(middleware, second.req, second.res)).toBeUndefined();
    expect(second.headers.get('RateLimit-Remaining')).toBe('0');
  });

  it('rejects requests over budget with a 429 AppException and Retry-After', () => {
    const middleware = createRateLimitMiddleware({ windowMs: 60_000, max: 1 });
    const first = mockReqRes();
    expect(run(middleware, first.req, first.res)).toBeUndefined();

    const second = mockReqRes();
    const err = run(middleware, second.req, second.res);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('RateLimitExceeded');
    expect((err as AppException).getStatus()).toBe(429);
    expect(second.headers.get('Retry-After')).toBeDefined();
  });

  it('tracks clients independently and honors skip()', () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 60_000,
      max: 1,
      skip: (req) => req.ip === '127.0.0.1',
    });
    const { req, res } = mockReqRes();
    expect(run(middleware, req, res)).toBeUndefined();
    expect(run(middleware, req, res)).toBeInstanceOf(AppException);

    const other = mockReqRes('10.0.0.2');
    expect(run(middleware, other.req, other.res)).toBeUndefined();

    const skipped = mockReqRes('127.0.0.1');
    expect(run(middleware, skipped.req, skipped.res)).toBeUndefined();
    expect(run(middleware, skipped.req, skipped.res)).toBeUndefined();
  });

  it('resets the budget when the window expires', async () => {
    const middleware = createRateLimitMiddleware({ windowMs: 30, max: 1 });
    const { req, res } = mockReqRes();
    expect(run(middleware, req, res)).toBeUndefined();
    expect(run(middleware, req, res)).toBeInstanceOf(AppException);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const after = mockReqRes();
    expect(run(middleware, after.req, after.res)).toBeUndefined();
  });
});
