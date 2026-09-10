import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Global provider of the shared `PrismaService` (one client + pool per
 * process). Global for the same reason as config: every module's `data/`
 * layer needs it, and there must be exactly one. Inject it ONLY from
 * module `data/` layers and technical services (health, worker) — never
 * from controllers or domain code (AR-03/05/07).
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
