import { INestApplication, Type } from '@nestjs/common';
import { Test, TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { APP_CONFIG } from '../../src/kernel/config/app-config.js';
import {
  configureApp,
  registerNotFoundFallback,
} from '../../src/kernel/http/configure-app.js';

export interface TestAppOptions {
  /** Extra modules (test-only probe controllers). */
  extraImports?: Array<Type<unknown>>;
  /** Provider overrides, applied before compile (e.g. mock PrismaService). */
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/**
 * Build a test app through the SAME pipeline as production (`configureApp`).
 * Never assemble ad-hoc test apps: pipeline parity is what makes e2e
 * meaningful (prefix, versioning, validation, errors, correlation, limits).
 */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<{ app: INestApplication; module: TestingModule }> {
  let builder = Test.createTestingModule({
    imports: [AppModule, ...(options.extraImports ?? [])],
  });
  if (options.override !== undefined) builder = options.override(builder);
  const module = await builder.compile();
  const app = module.createNestApplication();
  configureApp(app, app.get(APP_CONFIG));
  try {
    await app.init();
  } catch (error) {
    // The harness owns the app it created: a failed init must not orphan the
    // module (its providers — e.g. the Prisma pg pool — would otherwise never
    // see onModuleDestroy and can hold the test process alive).
    await app.close().catch(() => undefined);
    throw error;
  }
  registerNotFoundFallback(app);
  return { app, module };
}
