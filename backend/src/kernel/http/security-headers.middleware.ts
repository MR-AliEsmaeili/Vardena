import type { NextFunction, Request, Response } from 'express';

/**
 * Static security headers that are safe before the SPA exists.
 *
 * CSP and HSTS are deliberately deferred: CSP must match the SPA's asset
 * origins (no frontend yet) and HSTS depends on the deployment TLS posture
 * (OQ-06). Both are re-evaluated in the first frontend session, including
 * whether to adopt `helmet` (documented in backend/README.md).
 */
export function securityHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}
