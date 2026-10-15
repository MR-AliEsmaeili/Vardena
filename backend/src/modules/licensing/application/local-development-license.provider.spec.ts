import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../kernel/config/app-config.js';
import { LocalDevelopmentLicenseProvider } from './local-development-license.provider.js';

describe('LocalDevelopmentLicenseProvider device entitlement', () => {
  it('does not invent signed device capacity from local development config', async () => {
    const provider = new LocalDevelopmentLicenseProvider({
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

    await expect(provider.getLicense()).resolves.toMatchObject({
      provider: 'local-development',
      deviceLimit: null,
      deviceLimitSpecified: false,
    });
  });
});
