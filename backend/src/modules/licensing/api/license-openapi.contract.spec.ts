import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { describe, expect, it } from 'vitest';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { LicenseActivationService } from '../application/license-activation.service.js';
import { LicenseImportService } from '../application/license-import.service.js';
import { LicensingService } from '../application/licensing.service.js';
import { ClientDeviceLifecycleService } from '../application/client-device-lifecycle.service.js';
import { ClientDevicesController } from './client-devices.controller.js';
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
        ClientDevicesController,
      ],
      providers: [
        { provide: LicensingService, useValue: {} },
        { provide: LicenseActivationService, useValue: {} },
        { provide: LicenseImportService, useValue: {} },
        { provide: ClientDeviceLifecycleService, useValue: {} },
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
        'accessMode',
        'graceEndsAt',
        'installationId',
        'customerId',
        'customerCode',
        'licenseId',
        'validFrom',
        'validUntil',
        'organizationLimit',
        'userLimit',
        'deviceLimit',
        'deviceLimitSpecified',
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

      const inventory =
        document.paths['/license/devices']?.get?.responses?.['200'];
      const challenge =
        document.paths['/license/devices/enrollment-challenges']?.post
          ?.responses?.['200'];
      const activation =
        document.paths[
          '/license/devices/enrollment-challenges/{challengeId}/activate'
        ]?.post?.responses?.['200'];
      const replacementImport =
        document.paths['/license/devices/replacements/import']?.post
          ?.responses?.['200'];
      expect(jsonSchema(inventory)).toEqual({
        $ref: '#/components/schemas/ClientDeviceInventoryDto',
      });
      expect(jsonSchema(challenge)).toEqual({
        $ref: '#/components/schemas/DeviceEnrollmentChallengeDto',
      });
      expect(jsonSchema(activation)).toEqual({
        $ref: '#/components/schemas/ClientDeviceDto',
      });
      expect(jsonSchema(replacementImport)).toEqual({
        $ref: '#/components/schemas/DeviceReplacementCompletionDto',
      });
      const deviceSchema = document.components?.schemas?.['ClientDeviceDto'];
      expect(deviceSchema).toBeDefined();
      if (
        !deviceSchema ||
        !('properties' in deviceSchema) ||
        !deviceSchema.properties
      ) {
        throw new Error('ClientDeviceDto missing properties');
      }
      expect(deviceSchema.properties.publicKey).toBeUndefined();
      expect(deviceSchema.properties.privateKey).toBeUndefined();
      const inventorySchema =
        document.components?.schemas?.['ClientDeviceInventoryDto'];
      expect(inventorySchema).toBeDefined();
      if (
        !inventorySchema ||
        !('properties' in inventorySchema) ||
        !inventorySchema.properties
      ) {
        throw new Error('ClientDeviceInventoryDto missing properties');
      }
      expect(inventorySchema.properties.deviceLimitSpecified).toMatchObject({
        type: 'boolean',
      });
      expect(inventorySchema.properties.deviceLimit).toMatchObject({
        nullable: true,
      });
      expect(inventorySchema.properties.availableDeviceSlots).toMatchObject({
        nullable: true,
      });
      expect(inventorySchema.properties.devices).toMatchObject({
        type: 'array',
        items: { $ref: '#/components/schemas/ClientDeviceDto' },
      });
      const deviceRouteResponses = [
        ['/license/devices', 'get', 'ClientDeviceInventoryDto'],
        [
          '/license/devices/{deviceId}/history',
          'get',
          'ClientDeviceHistoryDto',
        ],
        [
          '/license/devices/enrollment-challenges',
          'post',
          'DeviceEnrollmentChallengeDto',
        ],
        [
          '/license/devices/enrollment-challenges/{challengeId}/activate',
          'post',
          'ClientDeviceDto',
        ],
        ['/license/devices/{deviceId}/deactivate', 'post', 'ClientDeviceDto'],
        [
          '/license/devices/{deviceId}/replacement-challenges',
          'post',
          'DeviceReplacementChallengeDto',
        ],
        [
          '/license/devices/replacements/{requestId}/prove',
          'post',
          'DeviceReplacementRequestExportDto',
        ],
        [
          '/license/devices/replacements/{requestId}/export',
          'get',
          'DeviceReplacementRequestExportDto',
        ],
        [
          '/license/devices/replacements/import',
          'post',
          'DeviceReplacementCompletionDto',
        ],
        [
          '/license/devices/replacements/{requestId}/cancel',
          'post',
          'DeviceReplacementResultDto',
        ],
      ] as const;
      for (const [route, method, schema] of deviceRouteResponses) {
        expect(
          jsonSchema(document.paths[route]?.[method]?.responses?.['200']),
        ).toEqual({ $ref: `#/components/schemas/${schema}` });
      }

      const historySchema =
        document.components?.schemas?.['ClientDeviceHistoryDto'];
      expect(historySchema).toBeDefined();
      if (
        !historySchema ||
        !('properties' in historySchema) ||
        !historySchema.properties
      ) {
        throw new Error('ClientDeviceHistoryDto missing properties');
      }
      expect(historySchema.properties.device).toMatchObject({
        $ref: '#/components/schemas/ClientDeviceDto',
      });
      expect(historySchema.properties.events).toMatchObject({
        type: 'array',
        items: { $ref: '#/components/schemas/DeviceAuditEventDto' },
      });
      const challengeSchema =
        document.components?.schemas?.['DeviceReplacementChallengeDto'];
      expect(challengeSchema).toBeDefined();
      if (
        !challengeSchema ||
        !('properties' in challengeSchema) ||
        !challengeSchema.properties
      ) {
        throw new Error('DeviceReplacementChallengeDto missing properties');
      }
      expect(challengeSchema.properties.canonicalPayload).toBeDefined();
      const exportSchema =
        document.components?.schemas?.['DeviceReplacementRequestExportDto'];
      expect(exportSchema).toBeDefined();
      if (
        !exportSchema ||
        !('properties' in exportSchema) ||
        !exportSchema.properties
      ) {
        throw new Error('DeviceReplacementRequestExportDto missing properties');
      }
      expect(exportSchema.properties.text).toBeDefined();
      expect(exportSchema.properties.file).toBeDefined();
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
