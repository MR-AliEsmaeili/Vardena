import { Injectable } from '@nestjs/common';
import {
  OrganizationsService,
  type UpdateOrganizationInput,
} from '../modules/organization/application/organizations.service.js';
import { InventoryBusinessDocumentsService } from '../modules/inventory/application/inventory-business-documents.service.js';

/**
 * Root application composition for the synchronous Organization ↔ Inventory
 * calendar-transition use case (accepted ADR-0043).
 *
 * This is deliberately outside both business modules: it composes their
 * public application contracts without introducing an Organization →
 * Inventory module dependency or exposing a transaction client.
 */
@Injectable()
export class OrganizationCalendarTransitionService {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly inventoryDocuments: InventoryBusinessDocumentsService,
  ) {}

  updateOrganization(
    id: string,
    input: UpdateOrganizationInput,
  ): ReturnType<OrganizationsService['updateOrganization']> {
    return this.organizations.updateOrganization(id, input, (organizationId) =>
      this.inventoryDocuments.findFirstUnrenderableBusinessDate(organizationId),
    );
  }
}
