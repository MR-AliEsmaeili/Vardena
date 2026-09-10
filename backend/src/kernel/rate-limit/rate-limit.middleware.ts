import type { NextFunction, Request, Response } from 'express';
import { AppException } from '../errors/app-exception.js';

/**
 * Minimal in-memory fixed-window rate limiter (security.md section 5).
 *
 * Deliberately dependency-free: `@nestjs/throttler` has no Nest 12-compatible
 * release, and a fixed window per IP is ~60 lines on the platform (ADR-0015).
 * Stricter per-endpoint limits (login, heavy reports) arrive with the owning
 * modules; they can reuse this middleware with different budgets.
 *
 * Limits: counters live in process memory, so enforcement is exact for a
 * single API replica and approximate per-replica when scaled horizontally.
 * Moving to a shared store would be new infrastructure => ADR first (AR-29).
 */
export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests per window per client IP. */
  max: number;
  /** Requests to exempt (health probes must never be throttled). */
  skip?: (req: Request) => boolean;
  /** Memory guard: max tracked IPs before oldest-first eviction. */
  maxTrackedKeys?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimitMiddleware(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  const maxTrackedKeys = options.maxTrackedKeys ?? 50_000;

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, options.windowMs);
  // Never hold the event loop (or the test runner) open.
  if (typeof sweep.unref === 'function') sweep.unref();

  return function rateLimit(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (options.skip?.(req) === true) {
      next();
      return;
    }
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    let bucket = buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      if (buckets.size >= maxTrackedKeys && !buckets.has(key)) {
        const oldest = buckets.keys().next();
        if (!oldest.done) buckets.delete(oldest.value);
      }
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    res.setHeader('RateLimit-Limit', String(options.max));
    res.setHeader(
      'RateLimit-Remaining',
      String(Math.max(0, options.max - bucket.count)),
    );
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      next(AppException.rateLimited(retryAfter));
      return;
    }
    next();
  };
}
