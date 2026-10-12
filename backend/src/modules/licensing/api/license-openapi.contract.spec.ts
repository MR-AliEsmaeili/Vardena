import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { describe, expect, it } from 'vitest';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { LicenseActivationService } from '../application/license-activation.service.js';
import { LicenseImportService } from '../application/license-import.service.js';
import { LicensingService } from '../application/licensing.service.js';
import { LicenseActivationController } from './license-activation.controller.js';
import { LicenseImportController } from './license-import.controller.js';
import { LicenseStateController } from './license-state.controller.js';

/**
 * F-6: success-response schemas for current/activate must exist on the
 * generated OpenAPI document (not merely as decorator presence).
 */
describe('Licensing OpenAPI success-response contracts', () => {
  it('documents LicenseStateDto and LicenseImportResultDto on the live paths', async () => {
    const module = await Test.createTestingModule({
      controllers: [
        LicenseStateController,
        LicenseActivationController,
        LicenseImportController,
      ],
      providers: [
        { provide: LicensingService, useValue: {} },
        { provide: LicenseActivationService, useValue: {} },
        { provide: LicenseImportService, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AuthorizationGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const app = module.createNestApplication();
    await app.init();
    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('licensing-contract')
          .setVersion('test')
          .build(),
      );

      const current =
        document.paths['/license/current']?.get?.responses?.['200'];
      const activate =
        document.paths['/license/activate']?.post?.responses?.['200'];
      const imported =
        document.paths['/license/import']?.post?.responses?.['200'];

      expect(jsonSchema(current)).toEqual({
        $ref: '#/components/schemas/LicenseStateDto',
      });
      expect(jsonSchema(activate)).toEqual({
        $ref: '#/components/schemas/LicenseImportResultDto',
      });
      expect(jsonSchema(imported)).toEqual({
        $ref: '#/components/schemas/LicenseImportResultDto',
      });

      const state = document.components?.schemas?.['LicenseStateDto'];
      const result = document.components?.schemas?.['LicenseImportResultDto'];
      expect(state).toBeDefined();
      expect(result).toBeDefined();
      if (!state || !('properties' in state) || !state.properties) {
        throw new Error('LicenseStateDto missing properties');
      }
      if (!result || !('properties' in result) || !result.properties) {
        throw new Error('LicenseImportResultDto missing properties');
      }

      const stateFields = [
        'licensed',
        'status',
        'active',
        'inactiveReason',
        'installationId',
        'customerId',
        'licenseId',
        'validFrom',
        'validUntil',
        'organizationLimit',
        'userLimit',
        'entitlements',
        'provider',
        'effectiveVersionId',
        'scheduledVersion',
        'versions',
      ];
      expect(Object.keys(state.properties).sort()).toEqual(
        [...stateFields].sort(),
      );
      expect(state.properties.changed).toBeUndefined();
      expect(state.properties.outcome).toBeUndefined();
      expect(state.properties.validFrom).toMatchObject({
        format: 'date-time',
        nullable: true,
      });
      expect(state.properties.organizationLimit).toMatchObject({
        type: 'number',
        nullable: true,
      });
      expect(state.properties.versions).toMatchObject({
        type: 'array',
        items: { $ref: '#/components/schemas/LicenseVersionSummaryDto' },
      });

      expect(result.properties.changed).toBeDefined();
      expect(result.properties.outcome).toMatchObject({
        enum: ['APPLIED', 'UNCHANGED'],
      });
      for (const field of stateFields) {
        expect(result.properties[field]).toBeDefined();
      }
    } finally {
      await app.close();
    }
  });
});

function jsonSchema(response: unknown): unknown {
  const r = response as {
    content?: { 'application/json'?: { schema?: unknown } };
  };
  return r?.content?.['application/json']?.schema;
}
