import { Module } from '@nestjs/common';
import { KernelModule } from './kernel/kernel.module.js';
import { PrismaModule } from './kernel/prisma/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';

/**
 * API root module. Business modules register here as they land
 * (Identity, Users, RBAC, … — see docs/modules.md), each owning its
 * folder under `modules/` and its Prisma schema file (AR-01/02).
 */
@Module({
  imports: [KernelModule, PrismaModule, HealthModule],
})
export class AppModule {}
