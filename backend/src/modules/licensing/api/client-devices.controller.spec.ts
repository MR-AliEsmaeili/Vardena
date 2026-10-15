import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { REQUIRE_PERMISSION_METADATA } from '../../rbac/application/require-permission.decorator.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { LICENSING_PERMISSIONS } from '../domain/licensing-permissions.js';
import { ClientDevicesController } from './client-devices.controller.js';

const ROUTE_PERMISSIONS = [
  ['inventory', LICENSING_PERMISSIONS.DEVICE_VIEW],
  ['deviceHistory', LICENSING_PERMISSIONS.DEVICE_VIEW],
  ['createEnrollmentChallenge', LICENSING_PERMISSIONS.DEVICE_ACTIVATE],
  ['activateEnrollment', LICENSING_PERMISSIONS.DEVICE_ACTIVATE],
  ['deactivate', LICENSING_PERMISSIONS.DEVICE_DEACTIVATE],
  ['createReplacementChallenge', LICENSING_PERMISSIONS.DEVICE_REPLACE],
  ['proveReplacement', LICENSING_PERMISSIONS.DEVICE_REPLACE],
  ['replacementRequestExport', LICENSING_PERMISSIONS.DEVICE_REPLACE],
  [
    'importReplacementResponse',
    LICENSING_PERMISSIONS.DEVICE_COMPLETE_REPLACEMENT,
  ],
  ['cancelReplacement', LICENSING_PERMISSIONS.DEVICE_CANCEL_REPLACEMENT],
] as const;

describe('ClientDevicesController route authorization', () => {
  it.each(ROUTE_PERMISSIONS)(
    '%s declares only its exact backend permission and both auth guards',
    (method, permission) => {
      const handler = ClientDevicesController.prototype[method];
      expect(Reflect.getMetadata(REQUIRE_PERMISSION_METADATA, handler)).toEqual(
        [permission],
      );
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        AuthGuard,
        AuthorizationGuard,
      ]);
    },
  );
});
