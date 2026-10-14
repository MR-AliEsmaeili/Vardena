import { describe, expect, it } from 'vitest';
import { AppException } from '../../../kernel/errors/app-exception.js';
import type { InstallationLicense } from '../domain/license.js';
import { evaluateLicense } from '../domain/license.js';
import type { LicenseProvider } from './license-provider.js';
import { LicensingService } from './licensing.service.js';

const NOW = new Date('2026-10-01T12:00:00.000Z');

function license(
  overrides: Partial<InstallationLicense> = {},
): InstallationLicense {
  return {
    customerId: 'customer-a',
    customerCode: 'CUST-A',
    installationId: 'installation-a',
    licenseId: 'license-a',
    status: 'ACTIVE',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null,
    organizationLimit: null,
    userLimit: null,
    entitlements: [
      { kind: 'MODULE', code: 'organization' },
      { kind: 'MODULE', code: 'accounting' },
      { kind: 'MODULE', code: 'documents' },
      { kind: 'MODULE', code: 'users' },
      { kind: 'FEATURE', code: 'report_builder' },
    ],
    provider: 'test-provider',
    ...overrides,
  };
}

function service(value: InstallationLicense): LicensingService {
  const provider: LicenseProvider = { getLicense: async () => value };
  return new LicensingService(provider);
}

describe('LicensingService', () => {
  it('evaluates active, suspended, explicit expired, not-yet-valid, and end-exclusive boundaries', () => {
    expect(evaluateLicense(license(), NOW).active).toBe(true);
    expect(
      evaluateLicense(license({ status: 'SUSPENDED' }), NOW),
    ).toMatchObject({ active: false, inactiveReason: 'status' });
    expect(evaluateLicense(license({ status: 'EXPIRED' }), NOW).active).toBe(
      false,
    );
    expect(
      evaluateLicense(
        license({ validFrom: new Date('2026-10-02T00:00:00Z') }),
        NOW,
      ).inactiveReason,
    ).toBe('not-yet-valid');
    expect(
      evaluateLicense(license({ validUntil: NOW }), NOW).inactiveReason,
    ).toBe('expired');
  });

  it('uses null as explicit perpetual/unlimited semantics', async () => {
    const current = await service(license()).current(NOW);
    expect(current.validUntil).toBeNull();
    expect(current.organizationLimit).toBeNull();
    expect(current.userLimit).toBeNull();
    await expect(
      service(license()).assertCanCreateOrganization(1_000_000),
    ).resolves.toBeUndefined();
  });

  it('distinguishes module and feature entitlements', async () => {
    const licensing = service(license());
    await expect(
      licensing.isEntitled('MODULE', 'accounting', NOW),
    ).resolves.toBe(true);
    await expect(
      licensing.isEntitled('MODULE', 'inventory', NOW),
    ).resolves.toBe(false);
    await expect(
      licensing.isEntitled('FEATURE', 'report_builder', NOW),
    ).resolves.toBe(true);
    await expect(
      licensing.isEntitled('MODULE', 'report_builder', NOW),
    ).resolves.toBe(false);
  });

  it('derives assignable permission codes from active module entitlements', async () => {
    const licensing = service(license());
    await expect(
      licensing.filterLicensedPermissions(
        [
          'Accounting.Account.View',
          'Document.DocumentType.Configure',
          'Inventory.Item.View',
          'Organization.Organization.Create',
        ],
        NOW,
      ),
    ).resolves.toEqual([
      'Accounting.Account.View',
      'Document.DocumentType.Configure',
      'Organization.Organization.Create',
    ]);
    await expect(
      licensing.requirePermissionLicensed('Inventory.Item.View'),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('makes every stored permission ineffective while license is inactive', async () => {
    await expect(
      service(license({ status: 'SUSPENDED' })).filterLicensedPermissions(
        ['Accounting.Account.View'],
        NOW,
      ),
    ).resolves.toEqual([]);
  });

  it('enforces finite organization and unique active-user limits', async () => {
    const licensing = service(license({ organizationLimit: 2, userLimit: 3 }));
    await expect(
      licensing.assertCanCreateOrganization(1),
    ).resolves.toBeUndefined();
    await expect(
      licensing.assertCanCreateOrganization(2),
    ).rejects.toBeInstanceOf(AppException);
    await expect(licensing.assertCanActivateUser(2)).resolves.toBeUndefined();
    await expect(licensing.assertCanActivateUser(3)).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it('does not infer license state from any user identity', async () => {
    const provider: LicenseProvider = {
      getLicense: async () => license({ installationId: 'installation-b' }),
    };
    const licensing = new LicensingService(provider);
    expect((await licensing.current(NOW)).installationId).toBe(
      'installation-b',
    );
  });
});
