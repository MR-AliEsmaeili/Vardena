import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { loadAppConfig } from '../kernel/config/app-config.js';
import { configureApp } from '../kernel/http/configure-app.js';
import { buildOpenApiDocument } from '../kernel/http/swagger.js';

/**
 * Dump the OpenAPI document from the compiled Nest application without
 * listening on a port. Used by `npm run openapi:dump` and the F-7 CI check.
 *
 * Requires a valid `DATABASE_URL` (config validation) but does not query the
 * database: permission/document-type registration is in-memory, and Prisma
 * connects lazily.
 *
 * Usage: `node dist/tools/dump-openapi.js [output.json]`
 */
async function dump(): Promise<void> {
  const config = loadAppConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app, { ...config, swaggerEnabled: false });
  await app.init();
  const document = buildOpenApiDocument(app, config);
  const out = resolve(process.argv[2] ?? 'openapi.json');
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  process.stdout.write(`${out}\n`);
}

try {
  await dump();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'fatal',
      context: 'DumpOpenApi',
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
}
