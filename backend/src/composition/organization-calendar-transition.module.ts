import { Module } from '@nestjs/common';
import { IdentityModule } from '../modules/identity/identity.module.js';
import { RbacModule } from '../modules/rbac/rbac.module.js';
import { OrganizationModule } from '../modules/organization/organization.module.js';
import { InventoryModule } from '../modules/inventory/inventory.module.js';
import { OrganizationCalendarTransitionController } from './organization-calendar-transition.controller.js';
import { OrganizationCalendarTransitionService } from './organization-calendar-transition.service.js';

/**
 * Root-only use-case composition: business modules do not import this module.
 * The contracts it composes are owned/exported by Organization and Inventory.
 */
@Module({
  imports: [OrganizationModule, InventoryModule, IdentityModule, RbacModule],
  controllers: [OrganizationCalendarTransitionController],
  providers: [OrganizationCalendarTransitionService],
})
export class OrganizationCalendarTransitionModule {}
