import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../kernel/config/app-config.js';
import { LocalDevelopmentLicenseProvider } from './local-development-license.provider.js';

function provider(): LocalDevelopmentLicenseProvider {
  return new LocalDevelopmentLicenseProvider({
    licensing: {
      status: 'ACTIVE',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: null,
      organizationLimit: 10,
      userLimit: 50,
      moduleEntitlements: ['users'],
      featureEntitlements: [],
      signingPublicKeys: [],
      provider: 'local-development',
    },
  } as unknown as AppConfig);
}

describe('LocalDevelopmentLicenseProvider', () => {
  it('does not invent signed device capacity from local development config', async () => {
    await expect(provider().getLicense()).resolves.toMatchObject({
      provider: 'local-development',
      deviceLimit: null,
      deviceLimitSpecified: false,
    });
  });

  it('returns only its synthetic identity and has no persisted-customer mapping role', async () => {
    const local = provider();

    // This provider receives configuration only: no installation/customer
    // repository or Prisma client is consulted or written. Its fixed pair must
    // therefore never be treated as authority for a different persisted row.
    await expect(local.getLicense()).resolves.toMatchObject({
      customerId: '01JLOCALCUSTOMER0000000000',
      customerCode: 'CUST-LOCAL-DEV',
      installationId: '01JLOCALINSTALLATION000000',
      licenseId: '01JLOCALDEVELOPMENT0000000',
      provider: 'local-development',
    });
    await expect(local.installationId()).resolves.toBe(
      '01JLOCALINSTALLATION000000',
    );
  });
});
