import { LicensingService } from '../../src/modules/licensing/application/licensing.service.js';
import type { LicenseProvider } from '../../src/modules/licensing/application/license-provider.js';

/** Explicit all-current-modules development license used by unrelated tests. */
export function licensingTestDouble(
  overrides: Partial<Awaited<ReturnType<LicenseProvider['getLicense']>>> = {},
): LicensingService {
  const provider: LicenseProvider = {
    getLicense: async () => ({
      customerId: 'test-customer',
      customerCode: 'CUST-TEST-01',
      installationId: 'test-installation',
      licenseId: 'test-license',
      status: 'ACTIVE',
      validFrom: new Date('2020-01-01T00:00:00.000Z'),
      validUntil: null,
      organizationLimit: null,
      userLimit: null,
      provider: 'test',
      entitlements: [
        'accounting',
        'documents',
        'inventory',
        'organization',
        'rbac',
        'users',
        'workflow',
      ].map((code) => ({ kind: 'MODULE' as const, code })),
      ...overrides,
    }),
  };
  return new LicensingService(provider);
}
