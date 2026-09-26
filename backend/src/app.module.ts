import { Module } from '@nestjs/common';
import { IdentityModule } from './modules/identity/identity.module.js';
import { RbacModule } from './modules/rbac/rbac.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { KernelModule } from './kernel/kernel.module.js';
import { PrismaModule } from './kernel/prisma/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { WorkflowModule } from './modules/workflow/workflow.module.js';
import { AccountingModule } from './modules/accounting/accounting.module.js';
import { SystemAdministratorBootstrapService } from './bootstrap/system-administrator-bootstrap.service.js';

/**
 * API root module. Business modules register here (docs/architecture.md §6),
 * each owning its folder under `modules/` and its Prisma schema file (AR-01/02).
 */
@Module({
  imports: [
    KernelModule,
    PrismaModule,
    HealthModule,
    UsersModule,
    IdentityModule,
    RbacModule,
    OrganizationModule,
    InventoryModule,
    DocumentsModule,
    WorkflowModule,
    AccountingModule,
  ],
  // Installation orchestration only. The API has no bootstrap endpoint and
  // never invokes this provider from a request; the explicit post-migration
  // command resolves it from the same application graph.
  providers: [SystemAdministratorBootstrapService],
})
export class AppModule {}
