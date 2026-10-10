import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { OrganizationModule } from '../modules/organization/organization.module.js';
import { OrganizationsController } from '../modules/organization/api/organizations.controller.js';
import { ORGANIZATION_PERMISSIONS } from '../modules/organization/domain/organization-permissions.js';
import { OrganizationCalendarTransitionModule } from './organization-calendar-transition.module.js';
import { OrganizationCalendarTransitionController } from './organization-calendar-transition.controller.js';
import { OrganizationCalendarTransitionService } from './organization-calendar-transition.service.js';
import { InventoryModule } from '../modules/inventory/inventory.module.js';
import { AuthGuard } from '../modules/identity/application/auth.guard.js';
import { AuthorizationGuard } from '../modules/rbac/application/authorization.guard.js';
import { REQUIRE_PERMISSION_METADATA } from '../modules/rbac/application/require-permission.decorator.js';
import { DEPLOYMENT_SCOPE_PATH_PARAM } from '../modules/organization/application/deployment-scope.decorator.js';
import type { OrganizationsService } from '../modules/organization/application/organizations.service.js';
import type { InventoryBusinessDocumentsService } from '../modules/inventory/application/inventory-business-documents.service.js';
import { toBusinessDate } from '../kernel/datetime/business-date.js';

function moduleImports(moduleType: Function): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) as unknown[];
}

function unwrapModuleReference(reference: unknown): unknown {
  if (
    typeof reference === 'object' &&
    reference !== null &&
    'forwardRef' in reference &&
    typeof reference.forwardRef === 'function'
  ) {
    return (reference.forwardRef as () => unknown)();
  }
  return reference;
}

describe('Organization calendar-transition composition (accepted ADR-0043)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('supplies Organization with Inventory’s public history reader, without sharing a transaction client', async () => {
    const businessDate = toBusinessDate('0600-01-01');
    if (businessDate === null) throw new Error('Invalid BusinessDate fixture.');
    const readHistory = vi.fn(async () => businessDate);
    const updateOrganization = vi.fn(
      async (
        _id: string,
        _input: { calendarSystem?: string },
        historyReader: (organizationId: string) => Promise<typeof businessDate>,
      ) => ({ id: 'org-1', calendarSystem: await historyReader('org-1') }),
    );
    const organizations = {
      updateOrganization,
    } as unknown as OrganizationsService;
    const inventoryDocuments = {
      findFirstUnrenderableBusinessDate: readHistory,
    } as unknown as InventoryBusinessDocumentsService;
    const composition = new OrganizationCalendarTransitionService(
      organizations,
      inventoryDocuments,
    );

    await composition.updateOrganization('org-1', { calendarSystem: 'JALALI' });

    expect(updateOrganization).toHaveBeenCalledTimes(1);
    expect(updateOrganization).toHaveBeenCalledWith(
      'org-1',
      { calendarSystem: 'JALALI' },
      expect.any(Function),
    );
    await expect(
      updateOrganization.mock.calls[0]?.[2]?.('org-1'),
    ).resolves.toBe(businessDate);
    expect(readHistory).toHaveBeenCalledWith('org-1');
  });

  it('preserves PATCH /api/v1/organizations/:id, its DTO, guards, permission and root scope metadata', () => {
    const controller = OrganizationCalendarTransitionController;
    const handler = controller.prototype.update;
    const controllerSource = readFileSync(
      new URL(
        './organization-calendar-transition.controller.ts',
        import.meta.url,
      ),
      'utf8',
    );

    expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe(
      'organizations',
    );
    expect(Reflect.getMetadata(VERSION_METADATA, controller)).toBe('1');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.PATCH,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      AuthGuard,
      AuthorizationGuard,
    ]);
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_METADATA, handler)).toEqual([
      ORGANIZATION_PERMISSIONS.EDIT,
    ]);
    expect(Reflect.getMetadata(DEPLOYMENT_SCOPE_PATH_PARAM, handler)).toBe(
      'id',
    );
    expect(controllerSource).toContain('UpdateOrganizationDto');
    expect(controllerSource).toContain('OrganizationResponseDto');
    expect(OrganizationsController.prototype).not.toHaveProperty('update');
  });

  it('keeps Organization and Inventory independent of the root composition module', () => {
    const organizationImports = moduleImports(OrganizationModule).map(
      unwrapModuleReference,
    );
    const inventoryImports = moduleImports(InventoryModule).map(
      unwrapModuleReference,
    );
    const compositionImports = moduleImports(
      OrganizationCalendarTransitionModule,
    ).map(unwrapModuleReference);
    const applicationImports = moduleImports(AppModule).map(
      unwrapModuleReference,
    );

    expect(organizationImports).not.toContain(InventoryModule);
    expect(organizationImports).not.toContain(
      OrganizationCalendarTransitionModule,
    );
    expect(inventoryImports).toContain(OrganizationModule);
    expect(inventoryImports).not.toContain(
      OrganizationCalendarTransitionModule,
    );
    expect(compositionImports).toContain(OrganizationModule);
    expect(compositionImports).toContain(InventoryModule);
    expect(
      Reflect.getMetadata(
        MODULE_METADATA.CONTROLLERS,
        OrganizationCalendarTransitionModule,
      ),
    ).toContain(OrganizationCalendarTransitionController);
    expect(applicationImports).toContain(OrganizationCalendarTransitionModule);
  });

  it('keeps cross-module SQL out of the two owning repositories', () => {
    const organizationRepository = readFileSync(
      new URL(
        '../modules/organization/data/organizations.repository.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const inventoryRepository = readFileSync(
      new URL(
        '../modules/inventory/data/inventory-business-documents.repository.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const compositionService = readFileSync(
      new URL('./organization-calendar-transition.service.ts', import.meta.url),
      'utf8',
    );

    expect(organizationRepository).not.toContain(
      '"inventory"."inventory_business_documents"',
    );
    expect(organizationRepository).not.toMatch(/\binventoryBusinessDocument\b/);
    expect(inventoryRepository).not.toContain('"organization"."organizations"');
    expect(inventoryRepository).not.toMatch(/\borganization\s*:/);
    expect(compositionService).not.toMatch(
      /Repository|PrismaService|\.\$transaction/,
    );
  });
});
