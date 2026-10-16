import { describe, expect, it } from 'vitest';
import type { InstallationLicense } from '../domain/license.js';
import type { LicenseProvider } from './license-provider.js';
import { LicensingService } from './licensing.service.js';

const EXPIRY = new Date('2026-10-08T08:30:00.000Z');
const GRACE_END = new Date('2026-10-22T08:30:00.000Z');
const PERMS = [
  'Accounting.Document.View',
  'Accounting.Document.Create',
  'Accounting.Document.Finalize',
  'Sales.Invoice.Export',
  'Inventory.Item.View',
  'Licensing.License.Activate',
];

function service(
  overrides: Partial<InstallationLicense> = {},
  providerOverride?: LicenseProvider,
): LicensingService {
  const provider: LicenseProvider = providerOverride ?? {
    getLicense: async () => ({
      customerId: 'c1',
      customerCode: 'CUST-1',
      installationId: 'i1',
      licenseId: 'l1',
      status: 'ACTIVE',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: EXPIRY,
      organizationLimit: null,
      userLimit: null,
      deviceLimit: null,
      deviceLimitSpecified: false,
      entitlements: [
        { kind: 'MODULE', code: 'accounting' },
        { kind: 'MODULE', code: 'sales' },
      ],
      provider: 'test',
      ...overrides,
    }),
  };
  return new LicensingService(provider);
}

describe('OQ-45 LicensingService Grace/Read-Only filtering', () => {
  it('GRACE keeps normal entitled operation; signed active stays false', async () => {
    const s = service();
    await expect(s.current(EXPIRY)).resolves.toMatchObject({
      active: false,
      accessMode: 'GRACE',
    });
    await expect(
      s.filterLicensedPermissions(PERMS, new Date(GRACE_END.getTime() - 1)),
    ).resolves.toEqual([
      'Accounting.Document.View',
      'Accounting.Document.Create',
      'Accounting.Document.Finalize',
      'Sales.Invoice.Export',
      'Licensing.License.Activate',
    ]);
    await expect(
      s.assertBusinessMutationAllowed(new Date(GRACE_END.getTime() - 1)),
    ).resolves.toBeUndefined();
  });
  it('READ_ONLY at exact deadline keeps entitled View/Export + platform, blocks mutations, grants nothing new', async () => {
    const s = service();
    await expect(
      s.filterLicensedPermissions(PERMS, GRACE_END),
    ).resolves.toEqual([
      'Accounting.Document.View',
      'Sales.Invoice.Export',
      'Licensing.License.Activate',
    ]);
    await expect(
      s.assertBusinessMutationAllowed(GRACE_END),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
    await expect(
      s.isPermissionLicensed('Accounting.Document.View', GRACE_END),
    ).resolves.toBe(true);
    await expect(
      s.isPermissionLicensed('Accounting.Document.Create', GRACE_END),
    ).resolves.toBe(false);
    await expect(
      s.isPermissionLicensed('Inventory.Item.View', GRACE_END),
    ).resolves.toBe(false);
  });
  it('valid renewal (provider now returns active license) restores mutations without stale cache', async () => {
    let current = EXPIRY;
    const renewed = service(
      {},
      {
        getLicense: async () =>
          current >= GRACE_END
            ? {
                customerId: 'c1',
                customerCode: 'CUST-1',
                installationId: 'i1',
                licenseId: 'l2',
                status: 'ACTIVE',
                validFrom: GRACE_END,
                validUntil: null,
                organizationLimit: null,
                userLimit: null,
                deviceLimit: null,
                deviceLimitSpecified: false,
                entitlements: [{ kind: 'MODULE', code: 'accounting' }],
                provider: 'test',
              }
            : null,
      },
    );
    // Before renewal instant the provider above returns null (unlicensed);
    // after it, the renewed license restores create permission.
    current = GRACE_END;
    await expect(
      renewed.filterLicensedPermissions(
        ['Accounting.Document.Create'],
        GRACE_END,
      ),
    ).resolves.toEqual(['Accounting.Document.Create']);
  });
  it('provider failure fails closed for mutations', async () => {
    const failing = service(
      {},
      {
        getLicense: async () => {
          throw new Error('provider unavailable');
        },
      },
    );
    await expect(
      failing.assertBusinessMutationAllowed(GRACE_END),
    ).rejects.toThrow('provider unavailable');
  });
  it('suspended licenses get no Grace and keep previous platform-only filtering', async () => {
    await expect(
      service({ status: 'SUSPENDED' }).filterLicensedPermissions(PERMS, EXPIRY),
    ).resolves.toEqual(['Licensing.License.Activate']);
  });

  it('fails closed for reads too when the provider throws — never an unfiltered set', async () => {
    const failing = service(
      {},
      {
        getLicense: async () => {
          throw new Error('provider unavailable');
        },
      },
    );
    // A read that cannot be evaluated must not silently return the stored
    // codes: the filter is the only thing standing between a stored
    // assignment and an effective permission.
    await expect(
      failing.filterLicensedPermissions(['Accounting.Document.View'], EXPIRY),
    ).rejects.toThrow('provider unavailable');
    await expect(
      failing.isPermissionLicensed('Accounting.Document.View', EXPIRY),
    ).rejects.toThrow('provider unavailable');
  });

  it('restores mutations on valid renewal from READ_ONLY with no cache and no reassignment', async () => {
    let renewed = false;
    const provider: LicenseProvider = {
      getLicense: async () =>
        renewed
          ? {
              customerId: 'c1',
              customerCode: 'CUST-1',
              installationId: 'i1',
              licenseId: 'l1',
              status: 'ACTIVE',
              validFrom: new Date('2026-01-01T00:00:00.000Z'),
              validUntil: null,
              organizationLimit: null,
              userLimit: null,
              deviceLimit: null,
              deviceLimitSpecified: false,
              entitlements: [{ kind: 'MODULE', code: 'accounting' }],
              provider: 'test',
            }
          : {
              customerId: 'c1',
              customerCode: 'CUST-1',
              installationId: 'i1',
              licenseId: 'l1',
              status: 'ACTIVE',
              validFrom: new Date('2026-01-01T00:00:00.000Z'),
              validUntil: EXPIRY,
              organizationLimit: null,
              userLimit: null,
              deviceLimit: null,
              deviceLimitSpecified: false,
              entitlements: [{ kind: 'MODULE', code: 'accounting' }],
              provider: 'test',
            },
    };
    const s = new LicensingService(provider);

    // Same service instance, same evaluation instant: only the provider's
    // answer changes, and the very next call sees it (no license cache).
    await expect(
      s.filterLicensedPermissions(['Accounting.Document.Create'], GRACE_END),
    ).resolves.toEqual([]);
    await expect(s.assertBusinessMutationAllowed(GRACE_END)).rejects.toThrow();

    renewed = true;

    await expect(
      s.filterLicensedPermissions(['Accounting.Document.Create'], GRACE_END),
    ).resolves.toEqual(['Accounting.Document.Create']);
    await expect(
      s.assertBusinessMutationAllowed(GRACE_END),
    ).resolves.toBeUndefined();
  });

  it('does not extend Grace across repeated evaluations or a fresh instance (restart)', async () => {
    const first = service();
    const restarted = service();
    const nearDeadline = new Date(GRACE_END.getTime() - 1);

    const a = await first.current(nearDeadline);
    const b = await first.current(nearDeadline);
    const c = await restarted.current(nearDeadline);

    expect(a.accessMode).toBe('GRACE');
    expect(a.graceEndsAt?.toISOString()).toBe(GRACE_END.toISOString());
    // No sliding window: reading the state again, or evaluating it in a fresh
    // instance after a restart, returns the SAME signed deadline.
    expect(b.graceEndsAt?.toISOString()).toBe(a.graceEndsAt?.toISOString());
    expect(c.graceEndsAt?.toISOString()).toBe(a.graceEndsAt?.toISOString());
    expect(c.accessMode).toBe('GRACE');

    // One millisecond later the boundary is crossed for every instance.
    expect((await first.current(GRACE_END)).accessMode).toBe('READ_ONLY');
    expect((await restarted.current(GRACE_END)).accessMode).toBe('READ_ONLY');
  });

  it('keeps Grace working normally: entitled mutations and reads both stay effective', async () => {
    const s = service();
    const inGrace = new Date(GRACE_END.getTime() - 1);
    // Grace is not Read-Only: only the unentitled module is filtered out, and
    // that is the ordinary entitlement rule, not an expiry rule.
    await expect(s.filterLicensedPermissions(PERMS, inGrace)).resolves.toEqual([
      'Accounting.Document.View',
      'Accounting.Document.Create',
      'Accounting.Document.Finalize',
      'Sales.Invoice.Export',
      'Licensing.License.Activate',
    ]);
    await expect(s.isPermissionLicensed(PERMS[0]!, inGrace)).resolves.toBe(
      true,
    );
    await expect(
      s.assertBusinessMutationAllowed(inGrace),
    ).resolves.toBeUndefined();
  });
});
