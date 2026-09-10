import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  APP_CONFIG,
  type AppConfig,
} from '../../../kernel/config/app-config.js';
import { createRateLimitMiddleware } from '../../../kernel/rate-limit/rate-limit.middleware.js';

/**
 * Stricter rate limit for POST /auth/login (security.md §5).
 *
 * Applied to the AuthController via MiddlewareConsumer. Other auth
 * endpoints (logout, me) intentionally do NOT get the stricter budget —
 * logout is idempotent and cheap, /me is fast and is called frequently by
 * the SPA to refresh state.
 */
@Injectable()
export class LoginRateLimitMiddleware implements NestMiddleware {
  private readonly middleware: ReturnType<typeof createRateLimitMiddleware>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.middleware = createRateLimitMiddleware({
      windowMs: config.auth.loginRateLimit.windowMs,
      max: config.auth.loginRateLimit.max,
    });
  }

  use(req: Request, res: Response, next: NextFunction): void {
    // Only throttle POST /auth/login. Logout (POST /auth/logout) and
    // GET /auth/me are exempt; the global rate limit still covers them.
    const isLogin =
      req.method === 'POST' && stripPrefix(req.path)?.endsWith('/auth/login');
    if (!isLogin) {
      next();
      return;
    }
    this.middleware(req, res, next);
  }
}

function stripPrefix(path: string): string {
  // Strip the global prefix + version if present so matching works in
  // both local dev and behind reverse proxies where path rewrites might
  // differ. Middleware sees the post-prefix path in Nest, but we keep
  // this generous to be safe.
  const match = path.match(/^(?:\/api)?(?:\/v\d+)?(\/.*)$/);
  return match?.[1] ?? path;
}
