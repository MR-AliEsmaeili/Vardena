import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { SystemAdministratorBootstrapService } from './bootstrap/system-administrator-bootstrap.service.js';
import { runEntrypoint } from './kernel/bootstrap.js';
import { loadAppConfig } from './kernel/config/app-config.js';
import { JsonLogger } from './kernel/logging/json-logger.service.js';

/**
 * Post-migration installation command.
 *
 * It loads the same modules as the API so every owning module registers its
 * official permission catalog, then reconciles the bootstrap user and its
 * ordinary RBAC rows. There is deliberately no HTTP endpoint or auth bypass.
 */
async function bootstrapSystemAdministrator(): Promise<void> {
  loadAppConfig();
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  const logger = app.get(JsonLogger);
  app.useLogger(logger);

  try {
    await app.init();
    const result = await app.get(SystemAdministratorBootstrapService).run();
    logger.log(
      'System administrator bootstrap complete',
      {
        installationId: result.installationId,
        userId: result.userId,
        roleId: result.roleId,
        permissionCount: result.permissionCount,
        userCreated: result.userCreated,
        roleCreated: result.roleCreated,
        userRoleCreated: result.userRoleCreated,
        organizationId: result.organizationId,
        organizationCreated: result.organizationCreated,
        membershipCreated: result.membershipCreated,
      },
      'SystemAdministratorBootstrap',
    );
  } finally {
    await app.close();
  }
}

await runEntrypoint('system-bootstrap', bootstrapSystemAdministrator);
