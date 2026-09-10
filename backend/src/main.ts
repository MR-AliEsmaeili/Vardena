import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { runEntrypoint } from './kernel/bootstrap.js';
import { loadAppConfig } from './kernel/config/app-config.js';
import {
  configureApp,
  registerNotFoundFallback,
} from './kernel/http/configure-app.js';
import { JsonLogger } from './kernel/logging/json-logger.service.js';

/** API process entrypoint. Configuration is validated before Nest boots (fail fast). */
async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app, config);
  // Explicit init so the not-found fallback registers after Nest's routes.
  await app.init();
  registerNotFoundFallback(app);
  app.enableShutdownHooks();
  await app.listen(config.port);
  app.get(JsonLogger).log(
    'Vardena API listening',
    {
      port: config.port,
      nodeEnv: config.nodeEnv,
      swagger: config.swaggerEnabled ? '/api/docs' : 'disabled',
    },
    'Bootstrap',
  );
}

await runEntrypoint('api', bootstrap);
