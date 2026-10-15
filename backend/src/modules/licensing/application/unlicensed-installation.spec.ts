import { describe, expect, it } from 'vitest';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { LicensingService } from './licensing.service.js';
import type { LicenseProvider } from './license-provider.js';

/**
 * The state of an installation that has never activated a license (L-02).
 *
 * This is the state of every fresh installation, including a development one:
 * nothing about `NODE_ENV` can make it active, and the only capability that
 * survives it is the platform permission that installs a license.
 */
describe('unlicensed installation', () => {
  const provider = (
    installationId: string | null = '01K7INSTALLATIONAAAAAAAAAA',
  ): LicenseProvider => ({
    name: 'persistent',
    getLicense: async () => null,
    installationId: async () => installationId,
  });

  it('evaluates as UNLICENSED and inactive, keeping the installation identity', async () => {
    const licensing = new LicensingService(provider());

    await expect(licensing.current()).resolves.toEqual({
      licensed: false,
      customerId: null,
      customerCode: null,
      installationId: '01K7INSTALLATIONAAAAAAAAAA',
      licenseId: null,
      status: 'UNLICENSED',
      validFrom: null,
      validUntil: null,
      organizationLimit: null,
      userLimit: null,
      deviceLimit: null,
      deviceLimitSpecified: false,
      entitlements: [],
      provider: 'persistent',
      active: false,
      inactiveReason: 'unlicensed',
    });
  });

  it('entitles nothing and blocks every licensed capability', async () => {
    const licensing = new LicensingService(provider());

    await expect(licensing.isEntitled('MODULE', 'organization')).resolves.toBe(
      false,
    );
    await expect(licensing.organizationAllocation()).rejects.toBeInstanceOf(
      AppException,
    );
    await expect(licensing.requireModule('users')).rejects.toThrow(
      /not available under the active installation license/,
    );
    await expect(licensing.isUnlicensed()).resolves.toBe(true);
  });

  it('allows exactly ONE active user so bootstrap can reach activation', async () => {
    const licensing = new LicensingService(provider());

    await expect(licensing.activeUserAllocation()).resolves.toEqual({
      installationId: '01K7INSTALLATIONAAAAAAAAAA',
      limit: 1,
    });
    await expect(licensing.assertCanActivateUser(0)).resolves.toBeUndefined();
    await expect(licensing.assertCanActivateUser(1)).rejects.toThrow(
      /active-user limit has been reached/,
    );
  });

  it('gives an expired license no bootstrap allowance', async () => {
    const licensing = new LicensingService({
      name: 'persistent',
      getLicense: async () => ({
        customerId: 'customer',
        customerCode: 'CUST-01',
        installationId: 'installation',
        licenseId: 'license',
        status: 'ACTIVE',
        validFrom: new Date('2020-01-01T00:00:00.000Z'),
        validUntil: new Date('2021-01-01T00:00:00.000Z'),
        organizationLimit: null,
        userLimit: null,
        deviceLimit: null,
        deviceLimitSpecified: false,
        provider: 'persistent',
        entitlements: [{ kind: 'MODULE', code: 'users' }],
      }),
    });

    await expect(licensing.current()).resolves.toMatchObject({
      active: false,
      inactiveReason: 'expired',
    });
    await expect(licensing.activeUserAllocation()).rejects.toThrow(
      /active installation license is required/,
    );
  });

  it('keeps ONLY the licensing platform permission effective', async () => {
    const licensing = new LicensingService(provider());

    await expect(
      licensing.filterLicensedPermissions([
        'Organization.Organization.Create',
        'Users.User.Create',
        'Licensing.License.Activate',
      ]),
    ).resolves.toEqual(['Licensing.License.Activate']);
    await expect(
      licensing.isPermissionLicensed('Licensing.License.Activate'),
    ).resolves.toBe(true);
    await expect(
      licensing.isPermissionLicensed('Rbac.Role.Create'),
    ).resolves.toBe(false);
  });

  it('reports no installation when the identity cannot be read', async () => {
    const licensing = new LicensingService(provider(null));
    await expect(licensing.current()).resolves.toMatchObject({
      installationId: null,
      status: 'UNLICENSED',
    });
  });

  it('still filters unlicensed modules out while a license is active', async () => {
    const licensing = new LicensingService({
      name: 'persistent',
      getLicense: async () => ({
        customerId: 'customer',
        customerCode: 'CUST-01',
        installationId: 'installation',
        licenseId: 'license',
        status: 'ACTIVE',
        validFrom: new Date('2020-01-01T00:00:00.000Z'),
        validUntil: null,
        organizationLimit: null,
        userLimit: null,
        deviceLimit: null,
        deviceLimitSpecified: false,
        provider: 'persistent',
        entitlements: [{ kind: 'MODULE', code: 'users' }],
      }),
    });

    await expect(
      licensing.filterLicensedPermissions([
        'Users.User.Create',
        'Organization.Organization.Create',
        'Licensing.License.Activate',
      ]),
    ).resolves.toEqual(['Users.User.Create', 'Licensing.License.Activate']);
  });
});
