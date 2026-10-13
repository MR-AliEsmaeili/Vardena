import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { AppConfig } from '../config/app-config.js';

/**
 * OpenAPI setup (AR-26, ADR-0014). Backend DTOs are the contract source of
 * truth; the spec is generated from them and served at `/api/docs`
 * (`/api/docs-json` for codegen). Disabled in production by default.
 *
 * `buildOpenApiDocument` is the single source used by the live `/api/docs`
 * UI and by `npm run openapi:dump` (F-7 generated-client drift check).
 */
export function buildOpenApiDocument(
  app: INestApplication,
  config: AppConfig,
): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Vardena API')
    .setDescription(
      'Vardena ERP — modular monolith API. Contract generated from backend DTOs (ADR-0014).\n\n' +
        'Authentication: server-side opaque session delivered via an httpOnly ' +
        'cookie (`vardena_session`). POST `/api/v1/auth/login` to obtain a ' +
        'session; the cookie is set automatically on the response. ' +
        'POST `/api/v1/auth/logout` to revoke it (ADR-0007).',
    )
    .setVersion(config.appVersion)
    .addCookieAuth(
      config.auth.cookieName,
      {
        type: 'apiKey',
        in: 'cookie',
        scheme: '',
        description:
          'Opaque session cookie (httpOnly, SameSite=Lax, Secure on HTTPS).',
      },
      'cookie',
    );
  return SwaggerModule.createDocument(app, builder.build());
}

export function setupSwagger(app: INestApplication, config: AppConfig): void {
  if (!config.swaggerEnabled) return;
  const document = buildOpenApiDocument(app, config);
  SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true });
}
