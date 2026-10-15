import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../kernel/config/app-config.js';
import { ClientDevicesRepository } from '../data/client-devices.repository.js';
import { LICENSING_PERMISSIONS } from '../domain/licensing-permissions.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { InstallationIdentityService } from './installation-identity.service.js';
import { LicensingService } from './licensing.service.js';
import { ClientDeviceLifecycleService } from './client-device-lifecycle.service.js';

describe('ClientDeviceLifecycleService permission rechecks', () => {
  it('rechecks the operation-specific exact permission before touching installation state', async () => {
    const denied = new Error('permission denied');
    const authorization = {
      requireAllPermissions: vi.fn().mockRejectedValue(denied),
    } as unknown as AuthorizationService;
    const identity = {
      current: vi.fn(),
    } as unknown as InstallationIdentityService;
    const licensing = {} as LicensingService;
    const devices = {} as ClientDevicesRepository;
    const config = {
      licensing: { signingPublicKeys: [] },
    } as unknown as AppConfig;
    const service = new ClientDeviceLifecycleService(
      config,
      authorization,
      identity,
      licensing,
      devices,
    );

    const operations: Array<{
      required: string;
      run: () => Promise<unknown>;
    }> = [
      {
        required: LICENSING_PERMISSIONS.DEVICE_VIEW,
        run: () => service.inventory(),
      },
      {
        required: LICENSING_PERMISSIONS.DEVICE_VIEW,
        run: () => service.deviceHistory('device-id'),
      },
      {
        required: LICENSING_PERMISSIONS.DEVICE_ACTIVATE,
        run: () => service.createEnrollmentChallenge('public-key'),
      },
      {
        required: LICENSING_PERMISSIONS.DEVICE_ACTIVATE,
        run: () => service.activateEnrollment('challenge-id', 'signature'),
      },
      {
        required: LICENSING_PERMISSIONS.DEVICE_DEACTIVATE,
        run: () => service.deactivate('device-id'),
      },
      {
        required: LICENSING_PERMISSIONS.DEVICE_REPLACE,
        run: () =>
          service.createReplacementChallenge('device-id', 'public-key'),
      },
      {
        required: LICENSING_PERMISSIONS.DEVICE_REPLACE,
        run: () => service.proveReplacement('request-id', 'signature'),
      },
      {
        required: LICENSING_PERMISSIONS.DEVICE_REPLACE,
        run: () => service.replacementRequestExport('request-id'),
      },
      {
        required: LICENSING_PERMISSIONS.DEVICE_COMPLETE_REPLACEMENT,
        run: () => service.importReplacementResponse('response-document'),
      },
      {
        required: LICENSING_PERMISSIONS.DEVICE_CANCEL_REPLACEMENT,
        run: () => service.cancelReplacement('request-id'),
      },
    ];

    for (const [index, operation] of operations.entries()) {
      await expect(operation.run()).rejects.toBe(denied);
      expect(authorization.requireAllPermissions).toHaveBeenNthCalledWith(
        index + 1,
        [operation.required],
      );
    }
    expect(identity.current).not.toHaveBeenCalled();
  });

  it('uses one atomic repository path for license-bound request export', async () => {
    const calls: string[] = [];
    const authorization = {
      requireAllPermissions: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthorizationService;
    const identity = {
      current: vi.fn().mockResolvedValue({ installationId: 'installation-id' }),
    } as unknown as InstallationIdentityService;
    const devices = {
      expireStaleOperations: vi.fn(async () => {
        calls.push('expire');
      }),
      replacementRequestExport: vi.fn(async () => {
        calls.push('export');
        return {
          request: {
            id: 'request-id',
            requestHash: 'request-hash',
            requestExpiresAt: new Date('2026-10-16T00:00:00.000Z'),
          },
          artifact: 'VDRQ1.payload.signature',
        };
      }),
    } as unknown as ClientDevicesRepository;
    const config = {
      licensing: { signingPublicKeys: [] },
    } as unknown as AppConfig;
    const service = new ClientDeviceLifecycleService(
      config,
      authorization,
      identity,
      {} as LicensingService,
      devices,
    );

    const result = await service.replacementRequestExport('request-id');

    expect(calls).toEqual(['export']);
    expect(devices.expireStaleOperations).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      requestId: 'request-id',
      requestHash: 'request-hash',
      text: 'VDRQ1.payload.signature',
    });
    expect(result.file).toContain('vardena-device-replacement-request');
  });
});
