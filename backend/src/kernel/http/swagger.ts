import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AppConfig } from '../config/app-config.js';

/**
 * OpenAPI setup (AR-26, ADR-0014). Backend DTOs are the contract source of
 * truth; the spec is generated from them and served at `/api/docs`
 * (`/api/docs-json` for codegen). Disabled in production by default; the
 * auth security scheme arrives with the Identity module.
 */
export function setupSwagger(app: INestApplication, config: AppConfig): void {
  if (!config.swaggerEnabled) return;
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Vardena API')
      .setDescription(
        'Vardena ERP — modular monolith API. Contract generated from backend DTOs (ADR-0014).',
      )
      .setVersion(config.appVersion)
      .build(),
  );
  SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true });
}
