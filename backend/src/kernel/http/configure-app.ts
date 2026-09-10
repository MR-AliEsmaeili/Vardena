import { INestApplication, VersioningType } from '@nestjs/common';
import type { Express } from 'express';
import type { AppConfig } from '../config/app-config.js';
import { correlationMiddleware } from '../correlation/correlation.middleware.js';
import { GlobalExceptionFilter } from '../errors/global-exception.filter.js';
import { JsonLogger } from '../logging/json-logger.service.js';
import { createRateLimitMiddleware } from '../rate-limit/rate-limit.middleware.js';
import { createAccessLogger } from './access-log.middleware.js';
import { createNotFoundFallback } from './not-found.middleware.js';
import { securityHeadersMiddleware } from './security-headers.middleware.js';
import { setupSwagger } from './swagger.js';
import { createValidationPipe } from './validation.js';

/**
 * The single definition of the API's HTTP pipeline, shared by `main.ts`
 * (production) and e2e tests (`test/support/test-app.ts`). Never build a
 * test app without it — pipeline parity between prod and tests is the point.
 *
 * Order: correlation (first, so everything downstream has an id) ->
 * security headers -> access log -> rate limit -> CORS -> prefix/versioning
 * -> validation pipe -> exception filter -> routes -> not-found fallback.
 */
export function configureApp(app: INestApplication, config: AppConfig): void {
  const logger = app.get(JsonLogger);
  // Replays logs buffered during bootstrap through the JSON logger.
  app.useLogger(logger);

  if (config.trustProxy) {
    const server = app.getHttpAdapter().getInstance() as Express;
    server.set('trust proxy', 1);
  }

  app.use(correlationMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(createAccessLogger(logger));
  app.use(
    createRateLimitMiddleware({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      // Orchestrator probes must never be throttled.
      skip: (req) => req.path.startsWith('/api/v1/health'),
    }),
  );

  // Empty allowlist = no CORS headers at all (same-origin only, fail closed).
  if (config.corsOrigins.length > 0) {
    app.enableCors({ origin: config.corsOrigins, credentials: true });
  }

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter(logger));
  setupSwagger(app, config);
}

/**
 * Registers the terminal not-found fallback. MUST run after `app.init()`
 * (Nest mounts its routes during init) — anything earlier would swallow
 * every request, anything missing would leak Express's HTML 404s.
 * Called by `main.ts` and `test/support/test-app.ts`.
 */
export function registerNotFoundFallback(app: INestApplication): void {
  const server = app.getHttpAdapter().getInstance() as Express;
  server.use(
    createNotFoundFallback(new GlobalExceptionFilter(app.get(JsonLogger))),
  );
}
