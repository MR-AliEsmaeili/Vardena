import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../kernel/config/app-config.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import {
  generateAuthorityKeyPair,
  issueLicenseCode,
  issueLicenseDocument,
  issueLicenseFile,
} from '../../../tools/development-license-authority.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import {
  createLicensingStores,
  type LicensingStores,
} from '../../../../test/support/licensing-repositories.js';
import {
  effectiveWindow,
  resolveEffectiveVersion,
} from '../domain/license-version.js';
import { LICENSING_PERMISSIONS } from '../domain/licensing-permissions.js';
import { InstallationIdentityService } from './installation-identity.service.js';
import { ImportConflictError } from '../data/licenses.repository.js';
import type { LicenseUsagePort } from './license-usage.js';
import { LicenseImportService } from './license-import.service.js';
import { LicensingService } from './licensing.service.js';
import { PersistentLicenseProvider } from './persistent-license.provider.js';

/**
 * The import pipeline (ADR-0046, design §4–§6).
 *
 * The harness wires the REAL services over the in-memory stores: the identity
 * service, the persistent provider (i.e. the same effective-version
 * resolution the read path uses) and the licensing service. What is stubbed
 * is only the authorization service, so 403 can be simulated without a
 * database, and the logger.
 *
 * Properties under test: nothing is written unless every stage passes;
 * a future-dated document is retained without deactivating the version that
 * governs; overlap needs an explicit signed supersession; replay is refused;
 * and the audit trail records applied, rejected and unchanged outcomes.
 *
 * TIME is controlled, never slept through: the import instant is pinned with
 * `vi.setSystemTime` (only `Date` is faked, so nothing else is affected) and
 * every read is asked for an explicit instant, which is what makes the
 * before/at/after assertions around a hand-over exact.
 */

const INSTALLATION = '01K7INSTALLATION0000000000';
const ATTACKER_INSTALLATION = '01K7OTHERINSTALLATION0000';
const AUTHORITY = generateAuthorityKeyPair();
const STRANGER = generateAuthorityKeyPair();
/**
 * One installation belongs to one commercial customer, and a renewal keeps the
 * license identity (Owner decisions 2026-10-12: Q4 and Q3). Documents in this
 * suite therefore share these two identifiers unless a test overrides them to
 * exercise the refusal paths on purpose.
 */
const CUSTOMER = '01K7CUSTOMER000000000000000';
const CUSTOMER_CODE = 'CUST-ACME-01';
const LICENSE = '01K7LICENSE0000000000000000';

function defaultCustomerCode(customerId: string): string {
  return customerId === CUSTOMER
    ? CUSTOMER_CODE
    : `CUST-${customerId.replace(/[^A-Za-z0-9]/g, '').slice(-12)}`;
}

/** `issueLicenseFile` for the suite's installation, customer and license. */
function signedDocument(
  options: Partial<Parameters<typeof issueLicenseFile>[0]> = {},
  key: Parameters<typeof issueLicenseFile>[1] = AUTHORITY.privateKey,
): ReturnType<typeof issueLicenseFile> {
  const customerId =
    options.customer?.customerId ?? options.customerId ?? CUSTOMER;
  return issueLicenseFile(
    {
      installationId: INSTALLATION,
      customerId,
      customerCode:
        options.customer?.customerCode ??
        options.customerCode ??
        defaultCustomerCode(customerId),
      licenseId: LICENSE,
      ...options,
    },
    key,
  );
}

/** `issueLicenseDocument` with the same commercial identity. */
function signedArtifact(
  options: Partial<Parameters<typeof issueLicenseDocument>[0]> = {},
  key: Parameters<typeof issueLicenseDocument>[1] = AUTHORITY.privateKey,
): ReturnType<typeof issueLicenseDocument> {
  const customerId =
    options.customer?.customerId ?? options.customerId ?? CUSTOMER;
  return issueLicenseDocument(
    {
      installationId: INSTALLATION,
      customerId,
      customerCode:
        options.customer?.customerCode ??
        options.customerCode ??
        defaultCustomerCode(customerId),
      licenseId: LICENSE,
      ...options,
    },
    key,
  );
}

/** `issueLicenseCode` (legacy `VLIC1`) with the same commercial identity. */
function signedCode(
  options: Partial<Parameters<typeof issueLicenseCode>[0]> = {},
  key: Parameters<typeof issueLicenseCode>[1] = AUTHORITY.privateKey,
): ReturnType<typeof issueLicenseCode> {
  const customerId =
    options.customer?.customerId ?? options.customerId ?? CUSTOMER;
  return issueLicenseCode(
    {
      installationId: INSTALLATION,
      customerId,
      customerCode:
        options.customer?.customerCode ??
        options.customerCode ??
        defaultCustomerCode(customerId),
      licenseId: LICENSE,
      ...options,
    },
    key,
  );
}

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as JsonLogger;
}

/** §8.6 usage stub: counted organizations/users, controllable per test. */
function usageStub(
  counts: {
    organizations?: number;
    activeUsers?: number;
    registeredDevices?: number;
  } = {},
): LicenseUsagePort {
  return {
    snapshot: async () => ({
      organizationCount: counts.organizations ?? 0,
      activeUserCount: counts.activeUsers ?? 0,
      registeredDeviceCount: counts.registeredDevices ?? 0,
    }),
  };
}

function authorizationStub(allowed = true): AuthorizationService {
  return {
    requireAllPermissions: async (): Promise<void> => {
      if (!allowed) throw AppException.forbidden();
    },
  } as unknown as AuthorizationService;
}

function configStub(keys: string[]): AppConfig {
  return {
    licensing: { provider: 'persistent', signingPublicKeys: keys },
  } as unknown as AppConfig;
}

interface Harness {
  stores: LicensingStores;
  service: LicenseImportService;
  licensing: LicensingService;
  provider: PersistentLicenseProvider;
}

function buildHarness(
  options: {
    stores?: LicensingStores;
    withIdentity?: boolean;
    allowed?: boolean;
    keys?: string[];
    /** §8.6 usage counts the pre-check and the transaction see (L-04). */
    usage?: {
      organizations?: number;
      activeUsers?: number;
      registeredDevices?: number;
    };
  } = {},
): Harness {
  const stores =
    options.stores ??
    createLicensingStores(
      options.withIdentity === false
        ? {}
        : {
            installation: {
              installationId: INSTALLATION,
              name: 'Vardena',
              customerId: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
          },
    );
  const identity = new InstallationIdentityService(
    stores.installations,
    loggerStub(),
  );
  const provider = new PersistentLicenseProvider(
    identity,
    stores.licenses,
    loggerStub(),
  );
  const licensing = new LicensingService(provider);
  const service = new LicenseImportService(
    configStub(options.keys ?? [AUTHORITY.publicKey]),
    authorizationStub(options.allowed ?? true),
    identity,
    stores.licenses,
    licensing,
    usageStub(options.usage),
    loggerStub(),
  );
  return { stores, service, licensing, provider };
}

async function rejectionOf(run: Promise<unknown>): Promise<{
  status: number;
  message: string;
  code: string;
  details: Record<string, unknown>;
}> {
  try {
    await run;
    throw new Error('expected the import to be rejected');
  } catch (error) {
    if (error instanceof AppException) {
      return {
        status: error.getStatus(),
        message: error.message,
        code: error.code,
        details: error.details as Record<string, unknown>,
      };
    }
    throw error;
  }
}

function issuedFile(
  overrides: Partial<Parameters<typeof issueLicenseFile>[0]> = {},
  key = AUTHORITY.privateKey,
  file: { keyId?: string } = {},
): string {
  const customerId =
    overrides.customer?.customerId ?? overrides.customerId ?? CUSTOMER;
  return issueLicenseFile(
    {
      installationId: INSTALLATION,
      customerId,
      customerCode:
        overrides.customer?.customerCode ??
        overrides.customerCode ??
        defaultCustomerCode(customerId),
      licenseId: LICENSE,
      customerName: 'Acme Holding',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    },
    key,
    file,
  ).file;
}

describe('license import pipeline', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness();
  });

  it('imports a signed file, retains the version and records the audit event', async () => {
    const file = issuedFile({ organizationLimit: 3, userLimit: 10 });

    const result = await harness.service.importDocument(file);

    expect(result).toMatchObject({
      changed: true,
      outcome: 'APPLIED',
      license: {
        status: 'ACTIVE',
        active: true,
        organizationLimit: 3,
        userLimit: 10,
        installationId: INSTALLATION,
      },
    });
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]).toMatchObject({
      source: 'file',
      documentVersion: 2,
      keyId: expect.stringMatching(/^sha256-/),
      supersededAt: null,
    });
    expect(
      harness.stores.customers.get(harness.stores.versions[0]!.customerId),
    ).toBe('Acme Holding');
    expect(harness.stores.auditEvents.map((event) => event.eventType)).toEqual([
      'license.import.applied',
    ]);
    expect(harness.stores.auditEvents[0]).toMatchObject({
      outcome: 'APPLIED',
      source: 'file',
      reason: null,
    });
  });

  it('imports the same artifact as text, with identical trust', async () => {
    const { document } = signedArtifact(
      {
        installationId: INSTALLATION,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
      AUTHORITY.privateKey,
    );

    await harness.service.importDocument(document);

    expect(harness.stores.versions[0]?.source).toBe('text');
    expect(harness.stores.versions[0]?.documentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('retains a future-dated renewal without deactivating the current version', async () => {
    await harness.service.importDocument(
      issuedFile({
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
      }),
    );
    const renewal = issuedFile({
      validFrom: new Date('2027-01-01T00:00:00.000Z'),
      validUntil: new Date('2028-01-01T00:00:00.000Z'),
    });

    const result = await harness.service.importDocument(renewal);

    // Two retained versions; the first one still governs today (2026), and the
    // renewal is reported as scheduled — no premature invalidation.
    expect(result).toMatchObject({
      outcome: 'APPLIED',
      license: { active: true },
    });
    expect(harness.stores.versions).toHaveLength(2);
    await expect(harness.provider.versionHistory()).resolves.toMatchObject({
      scheduled: { validFrom: '2027-01-01T00:00:00.000Z' },
    });
    const history = await harness.provider.versionHistory();
    expect(history.scheduled?.versionId).toBe(
      harness.stores.versions[1]?.versionId,
    );
  });

  it('rejects an overlap that has no explicit supersession and writes nothing', async () => {
    await harness.service.importDocument(issuedFile());

    const rejection = await rejectionOf(
      harness.service.importDocument(issuedFile()),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/overlaps a retained version/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      outcome: 'REJECTED',
      reason: 'overlapping-range',
      eventType: 'license.import.rejected',
    });
  });

  it('refuses a renewal that re-binds the license to another customer as a 409, and keeps the customer', async () => {
    const LICENSE = '01K7LICENSEREBIND0000000';
    await harness.service.importDocument(
      issuedFile({
        licenseId: LICENSE,
        customerId: '01K7CUSTOMERA000000000000',
        validUntil: new Date('2026-12-31T00:00:00.000Z'),
      }),
    );

    const rejection = await rejectionOf(
      harness.service.importDocument(
        issuedFile({
          licenseId: LICENSE,
          customerId: '01K7CUSTOMERB000000000000',
          validFrom: new Date('2027-01-01T00:00:00.000Z'),
          validUntil: new Date('2028-01-01T00:00:00.000Z'),
        }),
      ),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/already bound to a different customer/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]?.customerId).toBe(
      '01K7CUSTOMERA000000000000',
    );
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      outcome: 'REJECTED',
      reason: 'license-binding-conflict',
      eventType: 'license.import.rejected',
    });
  });

  describe('lost races inside the import transaction', () => {
    /** A Prisma-shaped unique violation: only `code` and `meta.target` matter. */
    function uniqueViolation(target: string): Error {
      return Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target },
      });
    }

    it('reports a claimed license identifier as license-binding-conflict (409), not as a replay', async () => {
      vi.spyOn(harness.stores.licenses, 'importVersion').mockRejectedValueOnce(
        new ImportConflictError({
          reason: 'license-binding-conflict',
          overlapping: 0,
        }),
      );

      const rejection = await rejectionOf(
        harness.service.importDocument(issuedFile()),
      );

      expect(rejection.status).toBe(409);
      expect(rejection.message).toMatch(
        /already bound to a different customer/,
      );
      expect(harness.stores.auditEvents.at(-1)).toMatchObject({
        outcome: 'REJECTED',
        reason: 'license-binding-conflict',
      });
    });

    it('reports a unique violation on the version identity as duplicate-operation (409)', async () => {
      vi.spyOn(harness.stores.licenses, 'importVersion').mockRejectedValueOnce(
        uniqueViolation('uq_license_versions_installation_operation'),
      );

      const rejection = await rejectionOf(
        harness.service.importDocument(issuedFile()),
      );

      expect(rejection.status).toBe(409);
      expect(harness.stores.auditEvents.at(-1)).toMatchObject({
        reason: 'duplicate-operation',
      });
    });

    it('never reports an unrelated unique violation as a duplicate: it surfaces as an unexpected error', async () => {
      const unrelated = uniqueViolation('licensing_customers_pkey');
      vi.spyOn(harness.stores.licenses, 'importVersion').mockRejectedValueOnce(
        unrelated,
      );

      await expect(harness.service.importDocument(issuedFile())).rejects.toBe(
        unrelated,
      );
      expect(harness.stores.versions).toHaveLength(0);
      expect(
        harness.stores.auditEvents.some(
          (event) => event.reason === 'duplicate-operation',
        ),
      ).toBe(false);
    });
  });

  it('refuses a renewal that would leave a gap (OQ-80 G2) and writes nothing', async () => {
    await harness.service.importDocument(
      issuedFile({
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2026-12-01T00:00:00.000Z'),
      }),
    );

    // The renewal carries the retained license identity and starts after the
    // coverage it renews has ended: that is exactly the gap OQ-80 G2 refuses.
    const rejection = await rejectionOf(
      harness.service.importDocument(
        issuedFile({
          validFrom: new Date('2027-06-01T00:00:00.000Z'),
          validUntil: new Date('2028-06-01T00:00:00.000Z'),
        }),
      ),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/gap in coverage/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      outcome: 'REJECTED',
      reason: 'renewal-gap',
      eventType: 'license.import.rejected',
    });

    // Nothing was extended: inside the lapse the installation still reads as
    // expired, and the refused document's window is not covered by anything.
    await expect(
      harness.licensing.current(new Date('2026-06-01T00:00:00.000Z')),
    ).resolves.toMatchObject({ licensed: true, active: true });
    await expect(
      harness.licensing.current(new Date('2027-03-01T00:00:00.000Z')),
    ).resolves.toMatchObject({
      licensed: true,
      active: false,
      inactiveReason: 'expired',
    });
    await expect(
      harness.licensing.current(new Date('2027-08-01T00:00:00.000Z')),
    ).resolves.toMatchObject({
      licensed: true,
      active: false,
      inactiveReason: 'expired',
    });
  });

  it('accepts an adjacent renewal and a perpetual renewal (G2 boundary)', async () => {
    // Adjacency — the renewal starts exactly where the previous window ends —
    // is contiguous, not a gap, and needs no supersession.
    await harness.service.importDocument(
      issuedFile({
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
      }),
    );
    await expect(
      harness.service.importDocument(
        issuedFile({
          validFrom: new Date('2027-01-01T00:00:00.000Z'),
          validUntil: new Date('2028-01-01T00:00:00.000Z'),
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });
    expect(harness.stores.versions).toHaveLength(2);

    // A renewal that starts before the coverage end is not a gap either (it
    // overlaps, and the later start governs under Option B).
    await expect(
      harness.service.importDocument(
        issuedFile({
          validFrom: new Date('2027-06-01T00:00:00.000Z'),
          validUntil: new Date('2029-01-01T00:00:00.000Z'),
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });
    expect(harness.stores.versions).toHaveLength(3);

    // Perpetual coverage never ends, so a renewal can never be late for it.
    await harness.service.importDocument(
      issuedFile({
        licenseId: '01K7PERPETUALLICENSE00000000',
        validFrom: new Date('2028-01-01T00:00:00.000Z'),
        validUntil: null,
      }),
    );
    expect(harness.stores.versions.at(-1)?.validUntil).toBeNull();
  });

  it('rejects a duplicate operation and keeps the retained version untouched', async () => {
    const file = issuedFile();
    await harness.service.importDocument(file);

    const rejection = await rejectionOf(harness.service.importDocument(file));

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/already been imported/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      reason: 'duplicate-operation',
      operationId: harness.stores.versions[0]?.operationId,
    });
  });

  it('rejects an unknown supersession target with a conflict', async () => {
    await harness.service.importDocument(issuedFile());

    const rejection = await rejectionOf(
      harness.service.importDocument(
        issuedFile({ supersedesOperationId: '01K7MISSINGOPERATION0000000' }),
      ),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/not a retained, eligible version/);
    expect(harness.stores.versions).toHaveLength(1);
  });

  it('rejects a document issued for another installation', async () => {
    const rejection = await rejectionOf(
      harness.service.importDocument(
        issuedFile({ installationId: ATTACKER_INSTALLATION }),
      ),
    );

    expect(rejection.status).toBe(422);
    expect(rejection.message).toMatch(/different Vardena installation/);
    expect(harness.stores.versions).toHaveLength(0);
  });

  it('creates no installation identity when none exists yet', async () => {
    const fresh = buildHarness({ withIdentity: false });

    const rejection = await rejectionOf(
      fresh.service.importDocument(issuedFile()),
    );

    expect(rejection.status).toBe(422);
    expect(rejection.message).toMatch(/has no identity yet/);
    expect(fresh.stores.self()).toBeNull();
    expect(fresh.stores.versions).toHaveLength(0);
  });

  it('rejects a document signed by an untrusted authority', async () => {
    const rejection = await rejectionOf(
      harness.service.importDocument(issuedFile({}, STRANGER.privateKey)),
    );

    expect(rejection.status).toBe(422);
    expect(rejection.message).toMatch(/signature is not valid/);
    // Unverified rejections record no identity and no hash.
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      reason: 'signature',
      operationId: null,
      documentHash: null,
    });
    expect(harness.stores.versions).toHaveLength(0);
  });

  it('rejects a document naming an untrusted key id with its own reason', async () => {
    const rejection = await rejectionOf(
      harness.service.importDocument(
        issuedFile({}, AUTHORITY.privateKey, { keyId: 'retired-2025' }),
      ),
    );

    expect(rejection.status).toBe(422);
    expect(rejection.message).toMatch(/unknown key/);
  });

  it('rejects malformed input before any state is touched', async () => {
    for (const input of [
      '',
      'not a license',
      'VLIC2.only',
      '{"format":"vardena-license"}',
    ]) {
      const rejection = await rejectionOf(
        harness.service.importDocument(input),
      );
      expect(rejection.status).toBe(422);
    }
    expect(harness.stores.versions).toHaveLength(0);
    expect(
      harness.stores.auditEvents.every((event) => event.outcome === 'REJECTED'),
    ).toBe(true);
  });

  it('rejects an already-ended document', async () => {
    const rejection = await rejectionOf(
      harness.service.importDocument(
        issuedFile({
          validFrom: new Date('2020-01-01T00:00:00.000Z'),
          validUntil: new Date('2021-01-01T00:00:00.000Z'),
        }),
      ),
    );

    expect(rejection.status).toBe(422);
    expect(rejection.message).toMatch(/already ended/);
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      reason: 'expired-document',
    });
  });

  it('rejects a document that is not active', async () => {
    const rejection = await rejectionOf(
      harness.service.importDocument(issuedFile({ status: 'SUSPENDED' })),
    );

    expect(rejection.status).toBe(422);
    expect(rejection.message).toMatch(/suspended or expired/);
  });

  it('keeps an invalid import from touching a valid license', async () => {
    await harness.service.importDocument(issuedFile({ organizationLimit: 5 }));

    await rejectionOf(harness.service.importDocument('garbage'));
    await rejectionOf(
      harness.service.importDocument(issuedFile({}, STRANGER.privateKey)),
    );
    await rejectionOf(
      harness.service.importDocument(
        issuedFile({ installationId: ATTACKER_INSTALLATION }),
      ),
    );

    await expect(harness.licensing.current()).resolves.toMatchObject({
      active: true,
      organizationLimit: 5,
    });
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]?.supersededAt).toBeNull();
  });

  it('refuses everything without the activation permission', async () => {
    const denied = buildHarness({ allowed: false });

    const rejection = await rejectionOf(
      denied.service.importDocument(issuedFile()),
    );

    expect(rejection.status).toBe(403);
    expect(rejection.code).toBe('PermissionDenied');
    expect(denied.stores.versions).toHaveLength(0);
    expect(denied.stores.auditEvents).toHaveLength(0);
  });

  it('accepts a legacy code and keeps it idempotent', async () => {
    const first = signedCode(
      { installationId: INSTALLATION, organizationLimit: 2 },
      AUTHORITY.privateKey,
    ).code;
    const applied = await harness.service.importDocument(first);

    expect(applied).toMatchObject({ changed: true, outcome: 'APPLIED' });
    expect(harness.stores.versions[0]).toMatchObject({
      source: 'legacy-code',
      documentVersion: 1,
      keyId: null,
      operationId: expect.stringMatching(/^legacy-code:[0-9a-f]{64}$/),
    });

    const again = await harness.service.importDocument(first);
    expect(again).toMatchObject({ changed: false, outcome: 'UNCHANGED' });
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      eventType: 'license.import.unchanged',
      outcome: 'UNCHANGED',
    });
  });

  it('refuses a legacy replacement while the version it overlaps still governs', async () => {
    const first = signedCode(
      { installationId: INSTALLATION, organizationLimit: 2 },
      AUTHORITY.privateKey,
    ).code;
    await harness.service.importDocument(first);

    const replacement = signedCode(
      { installationId: INSTALLATION, organizationLimit: 7 },
      AUTHORITY.privateKey,
    ).code;
    const rejection = await rejectionOf(
      harness.service.importDocument(replacement),
    );

    // A code issued with a start in the past cannot take over from the version
    // that governs now without rewriting what governed then (design §3.3,
    // OQ-86); the fake-clock suite pins the boundaries of that rule.
    expect(rejection.status).toBe(422);
    expect(rejection.message).toMatch(/already in the past/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]).toMatchObject({
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });
  });

  it('keeps the documented legacy rejections (not-yet-valid, expired, suspended)', async () => {
    const future = signedCode(
      {
        installationId: INSTALLATION,
        validFrom: new Date(Date.now() + 86_400_000),
      },
      AUTHORITY.privateKey,
    ).code;
    const expired = signedCode(
      {
        installationId: INSTALLATION,
        validFrom: new Date('2020-01-01T00:00:00.000Z'),
        validUntil: new Date('2021-01-01T00:00:00.000Z'),
      },
      AUTHORITY.privateKey,
    ).code;
    const suspended = signedCode(
      { installationId: INSTALLATION, status: 'SUSPENDED' },
      AUTHORITY.privateKey,
    ).code;

    expect(
      (await rejectionOf(harness.service.importDocument(future))).message,
    ).toMatch(/not valid yet/);
    expect(
      (await rejectionOf(harness.service.importDocument(expired))).message,
    ).toMatch(/expired/);
    expect(
      (await rejectionOf(harness.service.importDocument(suspended))).message,
    ).toMatch(/suspended or revoked/);
    expect(harness.stores.versions).toHaveLength(0);
  });

  it('does not re-verify an already-retained version when the trust list changes', async () => {
    await harness.service.importDocument(issuedFile());
    const rotated = buildHarness({ keys: [STRANGER.publicKey] });
    // A different configuration over the same retained versions: the license
    // is read from storage and stays effective (rotation cannot invalidate a
    // perpetual license that was already imported).
    const stores = harness.stores;
    const identity = new InstallationIdentityService(
      stores.installations,
      loggerStub(),
    );
    const provider = new PersistentLicenseProvider(
      identity,
      stores.licenses,
      loggerStub(),
    );
    const licensing = new LicensingService(provider);
    expect(rotated).toBeDefined();

    await expect(licensing.current()).resolves.toMatchObject({
      active: true,
      status: 'ACTIVE',
    });
    expect(stores.versions).toHaveLength(1);
  });
});

/**
 * Defect 1 of the corrective review (PDR-11 §3.2, CF-1): importing a
 * future-dated successor must not invalidate the license that governs NOW.
 *
 * Deterministic timeline, pinned clock, no sleeps:
 *   import instant  T0 = 2026-06-01T00:00:00Z
 *   predecessor         [2026-01-01, ∞)     — governs from 2026-01-01 forever
 *   successor           [2027-01-01, 2028-01-01), supersedes the predecessor
 */
describe('future-dated supersession', () => {
  let harness: Harness;
  const T0 = new Date('2026-06-01T00:00:00.000Z');
  const BEFORE_HANDOVER = new Date('2026-12-31T23:59:59.999Z');
  const HANDOVER = new Date('2027-01-01T00:00:00.000Z');
  const AFTER_HANDOVER = new Date('2027-06-01T00:00:00.000Z');
  const AFTER_SUCCESSOR = new Date('2028-06-01T00:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    harness = buildHarness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function importPredecessor(): Promise<{
    operationId: string;
    versionId: string;
  }> {
    const predecessor = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        organizationLimit: 3,
      },
      AUTHORITY.privateKey,
    );
    await harness.service.importDocument(predecessor.file);
    return {
      operationId: predecessor.payload.operationId,
      versionId: harness.stores.versions[0]!.versionId,
    };
  }

  it('keeps the current license governing while the successor is still future-dated', async () => {
    const predecessor = await importPredecessor();
    const successor = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: HANDOVER,
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
        organizationLimit: 9,
        supersedesOperationId: predecessor.operationId,
      },
      AUTHORITY.privateKey,
    );

    const result = await harness.service.importDocument(successor.file);

    // The import reports the state it left behind: still the predecessor.
    expect(result).toMatchObject({
      outcome: 'APPLIED',
      license: { active: true, organizationLimit: 3 },
    });
    // Both versions are retained; the successor is scheduled.
    expect(harness.stores.versions).toHaveLength(2);
    expect(harness.stores.versions[0]).toMatchObject({
      versionId: predecessor.versionId,
      // Recorded at the import instant …
      supersededAt: T0,
      // … but it stops governing only when the successor starts.
      governsUntil: HANDOVER,
      supersededByVersionId: harness.stores.versions[1]?.versionId,
    });
    await expect(harness.provider.versionHistory(T0)).resolves.toMatchObject({
      effectiveVersionId: predecessor.versionId,
      scheduled: { validFrom: HANDOVER.toISOString() },
    });

    // Before the hand-over the predecessor still governs, at every instant…
    for (const instant of [T0, BEFORE_HANDOVER]) {
      await expect(harness.licensing.current(instant)).resolves.toMatchObject({
        active: true,
        organizationLimit: 3,
        licenseId: harness.stores.versions[0]?.licenseId,
      });
    }
    // …at the exact hand-over instant the successor takes over (half-open),
    for (const instant of [HANDOVER, AFTER_HANDOVER]) {
      await expect(harness.licensing.current(instant)).resolves.toMatchObject({
        active: true,
        organizationLimit: 9,
      });
    }
    // …and the retired predecessor never comes back after the successor ends.
    await expect(
      harness.licensing.current(AFTER_SUCCESSOR),
    ).resolves.toMatchObject({
      licensed: true,
      active: false,
      inactiveReason: 'expired',
    });
  });

  it('takes over implicitly when the later start governs (OQ-80 Option B)', async () => {
    // The predecessor is time-limited and the candidate grants at least what it
    // grants, so the hand-over is available under the precedence rule.
    const predecessor = signedDocument(
      {
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
        organizationLimit: 3,
      },
      AUTHORITY.privateKey,
    );
    await harness.service.importDocument(predecessor.file);

    const successor = signedDocument(
      {
        validFrom: HANDOVER,
        validUntil: new Date('2029-01-01T00:00:00.000Z'),
        organizationLimit: 3,
      },
      AUTHORITY.privateKey,
    );
    const result = await harness.service.importDocument(successor.file);

    expect(result).toMatchObject({
      outcome: 'APPLIED',
      license: { active: true, organizationLimit: 3 },
    });
    expect(harness.stores.versions).toHaveLength(2);
    // The hand-over is stamped and linked exactly like an explicit one …
    expect(harness.stores.versions[0]).toMatchObject({
      supersededAt: T0,
      governsUntil: HANDOVER,
      supersededByVersionId: harness.stores.versions[1]?.versionId,
    });
    // … and the audit trail says it was the precedence rule, not a signed
    // instruction, that retired the predecessor.
    const supersededEvent = harness.stores.auditEvents.find(
      (event) => event.eventType === 'license.version.superseded',
    );
    expect(supersededEvent).toMatchObject({
      reason: 'implicit-precedence',
      outcome: 'APPLIED',
    });
    // The predecessor still governs right up to the hand-over instant.
    await expect(
      harness.licensing.current(BEFORE_HANDOVER),
    ).resolves.toMatchObject({ active: true, organizationLimit: 3 });
    await expect(harness.licensing.current(HANDOVER)).resolves.toMatchObject({
      active: true,
      organizationLimit: 3,
    });
  });

  it('refuses an overlap that starts no later than the version it overlaps', async () => {
    const predecessor = signedDocument(
      {
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
      },
      AUTHORITY.privateKey,
    );
    await harness.service.importDocument(predecessor.file);

    // Same start: nothing can decide which version governs the overlap, so the
    // ambiguity is refused rather than guessed (and nothing is written).
    const ambiguous = signedDocument(
      {
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
      },
      AUTHORITY.privateKey,
    );
    const rejection = await rejectionOf(
      harness.service.importDocument(ambiguous.file),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/overlaps a retained version/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]?.supersededAt).toBeNull();
    await expect(
      harness.licensing.current(BEFORE_HANDOVER),
    ).resolves.toMatchObject({ active: true });
  });

  it('refuses an implicit hand-over that would reduce the retained grant (PDR-11 §8.6)', async () => {
    harness = buildHarness({ usage: { organizations: 5, activeUsers: 10 } });
    const predecessor = signedDocument(
      {
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
        organizationLimit: 3,
        userLimit: 10,
        moduleEntitlements: ['accounting', 'documents'],
      },
      AUTHORITY.privateKey,
    );
    await harness.service.importDocument(predecessor.file);

    // Each of these starts later and would otherwise take over implicitly, but
    // every one of them takes something away: a smaller capacity, a removed
    // module, and closing an open end. §8.6 requires check/explain/preserve and
    // an explicit resolution before a reduction is applied, and that flow is
    // not implemented yet — so the precedence rule refuses instead.
    const shrinking = [
      signedDocument(
        {
          validFrom: HANDOVER,
          validUntil: new Date('2029-01-01T00:00:00.000Z'),
          organizationLimit: 2,
          userLimit: 10,
          moduleEntitlements: ['accounting', 'documents'],
        },
        AUTHORITY.privateKey,
      ).file,
      signedDocument(
        {
          validFrom: HANDOVER,
          validUntil: new Date('2029-01-01T00:00:00.000Z'),
          organizationLimit: 3,
          userLimit: 10,
          moduleEntitlements: ['accounting'],
        },
        AUTHORITY.privateKey,
      ).file,
    ];

    for (const document of shrinking) {
      const rejection = await rejectionOf(
        harness.service.importDocument(document),
      );
      expect(rejection.status).toBe(409);
      expect(rejection.message).toMatch(/reduces the modules or capacity/);
      expect(harness.stores.auditEvents.at(-1)).toMatchObject({
        outcome: 'REJECTED',
        reason: 'reduction-requires-resolution',
      });
    }

    // Nothing was written and nothing was retired by the refusals.
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]?.supersededAt).toBeNull();
    await expect(harness.licensing.current(T0)).resolves.toMatchObject({
      active: true,
      organizationLimit: 3,
    });
  });

  it('refuses to close a perpetual grant implicitly (PDR-11 §8.6)', async () => {
    // A perpetual license is the strongest grant there is: handing it over to a
    // time-limited successor takes the open end away, so the precedence rule
    // refuses it instead of applying the reduction silently.
    const perpetual = signedDocument(
      {
        licenseId: '01K7PERPETUALGRANT000000000',
        validFrom: new Date('2025-01-01T00:00:00.000Z'),
        validUntil: null,
        organizationLimit: 3,
      },
      AUTHORITY.privateKey,
    );
    await harness.service.importDocument(perpetual.file);

    const closing = signedDocument(
      {
        licenseId: '01K7PERPETUALGRANT000000000',
        validFrom: HANDOVER,
        validUntil: new Date('2029-01-01T00:00:00.000Z'),
        organizationLimit: 3,
      },
      AUTHORITY.privateKey,
    );
    const rejection = await rejectionOf(
      harness.service.importDocument(closing.file),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/reduces the modules or capacity/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]?.supersededAt).toBeNull();
    await expect(harness.licensing.current(T0)).resolves.toMatchObject({
      active: true,
      organizationLimit: 3,
    });
  });

  it.each([
    ['organizationLimit', { organizationLimit: 2 }],
    ['userLimit', { userLimit: 9 }],
    ['a module entitlement', { moduleEntitlements: ['accounting'] }],
  ] as const)(
    'refuses an explicit supersession that reduces %s (PDR-11 §8.6)',
    async (_what, shrink) => {
      // Usage above both limits so every shrunk dimension really conflicts
      // with current usage (the capacity arm of the L-04 check).
      harness = buildHarness({ usage: { organizations: 9, activeUsers: 40 } });
      const predecessor = signedDocument(
        {
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2028-01-01T00:00:00.000Z'),
          organizationLimit: 3,
          userLimit: 10,
          moduleEntitlements: ['accounting', 'documents'],
        },
        AUTHORITY.privateKey,
      );
      await harness.service.importDocument(predecessor.file);
      const stateBefore = await harness.licensing.current(T0);
      const historyBefore = await harness.provider.versionHistory(T0);
      const auditBefore = harness.stores.auditEvents.length;

      const reducing = signedDocument(
        {
          validFrom: HANDOVER,
          validUntil: new Date('2029-01-01T00:00:00.000Z'),
          organizationLimit: 3,
          userLimit: 10,
          moduleEntitlements: ['accounting', 'documents'],
          // The document names the version it retires. That is a statement
          // about WHICH version it replaces, not a resolution of the capacity
          // conflict it creates, so it may not switch §8.6 off.
          supersedesOperationId: predecessor.payload.operationId,
          ...shrink,
        },
        AUTHORITY.privateKey,
      );
      const rejection = await rejectionOf(
        harness.service.importDocument(reducing.file),
      );

      expect(rejection.status).toBe(409);
      expect(rejection.code).toBe('Conflict');
      expect(rejection.message).toMatch(/reduces the modules or capacity/);

      // Nothing was written and nothing was retired: the retained version, the
      // effective grant and the retained history are exactly what they were,
      // and the refused operation id is not retained.
      expect(harness.stores.versions).toHaveLength(1);
      expect(harness.stores.versions[0]).toMatchObject({
        operationId: predecessor.payload.operationId,
        organizationLimit: 3,
        userLimit: 10,
        supersededAt: null,
        governsUntil: null,
        supersededByVersionId: null,
      });
      expect(
        harness.stores.versions.some(
          (version) => version.operationId === reducing.payload.operationId,
        ),
      ).toBe(false);
      await expect(harness.licensing.current(T0)).resolves.toEqual(stateBefore);
      await expect(harness.provider.versionHistory(T0)).resolves.toEqual(
        historyBefore,
      );

      // The refusal is audited, and it is the only thing the attempt wrote.
      const auditAfter = harness.stores.auditEvents.slice(auditBefore);
      expect(auditAfter).toHaveLength(1);
      expect(auditAfter[0]).toMatchObject({
        eventType: 'license.import.rejected',
        outcome: 'REJECTED',
        reason: 'reduction-requires-resolution',
        operationId: reducing.payload.operationId,
      });
    },
  );

  it('refuses a legacy replacement that reduces the retained grant (PDR-11 §8.6)', async () => {
    harness = buildHarness({ usage: { organizations: 5, activeUsers: 10 } });
    // The legacy transport is the third path that retires a version: its
    // documented L-02 lifecycle (replace the version governing now) is
    // preserved, and the §8.6 guard applies to it exactly as it does to the
    // signed paths. A code carries no explicit start of its own, so the
    // replacement that reaches the guard is the hand-over at the import
    // instant.
    const predecessor = signedCode(
      {
        installationId: INSTALLATION,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        organizationLimit: 3,
        userLimit: 10,
        moduleEntitlements: ['accounting', 'documents'],
      },
      AUTHORITY.privateKey,
    ).code;
    await harness.service.importDocument(predecessor);

    const replacing = signedCode(
      {
        installationId: INSTALLATION,
        validFrom: T0,
        organizationLimit: 2,
        userLimit: 10,
        moduleEntitlements: ['accounting', 'documents'],
      },
      AUTHORITY.privateKey,
    ).code;
    const rejection = await rejectionOf(
      harness.service.importDocument(replacing),
    );

    expect(rejection.status).toBe(409);
    // The legacy wording of the same refusal ("would reduce").
    expect(rejection.message).toMatch(/reduce the modules or capacity/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]).toMatchObject({
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      eventType: 'license.import.rejected',
      outcome: 'REJECTED',
      reason: 'reduction-requires-resolution',
    });
    await expect(harness.licensing.current(T0)).resolves.toMatchObject({
      active: true,
      organizationLimit: 3,
      userLimit: 10,
    });

    // The term arm is not bypassable through the text transport either: the
    // code carries no explicit term instruction the way a signed document does,
    // so ending the perpetual grant is refused even with every capacity and
    // entitlement kept.
    const timeLimited = signedCode(
      {
        installationId: INSTALLATION,
        validFrom: T0,
        validUntil: new Date('2029-01-01T00:00:00.000Z'),
        organizationLimit: 3,
        userLimit: 10,
        moduleEntitlements: ['accounting', 'documents'],
      },
      AUTHORITY.privateKey,
    ).code;
    const termRejection = await rejectionOf(
      harness.service.importDocument(timeLimited),
    );
    expect(termRejection.status).toBe(409);
    expect(termRejection.message).toMatch(/reduce the modules or capacity/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]).toMatchObject({
      validUntil: null,
      supersededAt: null,
      governsUntil: null,
    });
  });

  it('applies an explicit signed supersession that converts a perpetual grant into a time-limited one (OD-LIC-01)', async () => {
    // The Product Owner's final decision of 2026-10-12 (PDR-12): an explicit,
    // valid, signed supersession may replace a perpetual grant with a
    // time-limited one — and only that. The capacity and the entitlements must
    // not shrink, which this document honours. Usage sits at the successor's
    // own limits, so a later document that shrinks below them conflicts with
    // current usage (the capacity arm of the L-04 check).
    harness = buildHarness({ usage: { organizations: 9, activeUsers: 40 } });
    const perpetual = signedDocument(
      {
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: null,
        organizationLimit: 3,
        userLimit: 10,
        moduleEntitlements: ['accounting', 'documents'],
      },
      AUTHORITY.privateKey,
    );
    await harness.service.importDocument(perpetual.file);

    const timeLimited = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: HANDOVER,
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
        organizationLimit: 9,
        userLimit: 40,
        moduleEntitlements: ['accounting', 'documents'],
        supersedesOperationId: perpetual.payload.operationId,
      },
      AUTHORITY.privateKey,
    );
    const applied = await harness.service.importDocument(timeLimited.file);

    // Applied: the predecessor governs up to the hand-over, the successor from
    // it — the open end really became a dated end.
    expect(applied).toMatchObject({ changed: true, outcome: 'APPLIED' });
    expect(harness.stores.versions).toHaveLength(2);
    expect(harness.stores.versions[0]).toMatchObject({
      operationId: perpetual.payload.operationId,
      validUntil: null,
      supersededAt: T0,
      governsUntil: HANDOVER,
      supersededByVersionId: harness.stores.versions[1]?.versionId,
    });
    await expect(harness.licensing.current(T0)).resolves.toMatchObject({
      active: true,
      organizationLimit: 3,
      userLimit: 10,
    });
    await expect(harness.licensing.current(HANDOVER)).resolves.toMatchObject({
      active: true,
      organizationLimit: 9,
      userLimit: 40,
    });
    // Past the successor's end the license is over — the term change was real,
    // not a silent no-op.
    await expect(
      harness.licensing.current(new Date('2028-06-01T00:00:00.000Z')),
    ).resolves.toMatchObject({ active: false, inactiveReason: 'expired' });

    // The refusal side OF THE SAME CHANGE: a time-limited successor that also
    // takes capacity away is refused while current usage exceeds the new
    // limit, so the term exception above is not a general authorization to
    // reduce the grant.
    const reducing = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: HANDOVER,
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
        organizationLimit: 2,
        userLimit: 40,
        moduleEntitlements: ['accounting', 'documents'],
        supersedesOperationId: timeLimited.payload.operationId,
      },
      AUTHORITY.privateKey,
    );
    const rejection = await rejectionOf(
      harness.service.importDocument(reducing.file),
    );
    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/reduces the modules or capacity/);
    expect(harness.stores.versions).toHaveLength(2);
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      eventType: 'license.import.rejected',
      outcome: 'REJECTED',
      reason: 'reduction-requires-resolution',
    });
    await expect(harness.licensing.current(HANDOVER)).resolves.toMatchObject({
      active: true,
      organizationLimit: 9,
      userLimit: 40,
    });
  });

  it('never reaches the term exception without a valid signature (OD-LIC-01)', async () => {
    const perpetual = signedDocument(
      {
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: null,
        organizationLimit: 3,
      },
      AUTHORITY.privateKey,
    );
    await harness.service.importDocument(perpetual.file);
    const supersedesOperationId = perpetual.payload.operationId;

    // Nobody else can author the change: the same payload signed by a stranger
    // key fails the signature gate (422) before any conflict or supersession
    // logic runs, so nothing is retired.
    const forged = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: HANDOVER,
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
        organizationLimit: 3,
        supersedesOperationId,
      },
      STRANGER.privateKey,
    );
    const forgedRejection = await rejectionOf(
      harness.service.importDocument(forged.file),
    );
    expect(forgedRejection.status).toBe(422);
    expect(forgedRejection.message).toMatch(/signature is not valid/);

    // A document whose signed bytes were altered after signing is refused the
    // same way (the signature covers the payload verbatim).
    const genuine = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: HANDOVER,
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
        organizationLimit: 3,
        supersedesOperationId,
      },
      AUTHORITY.privateKey,
    );
    const marker = Buffer.from('"organizationLimit":3', 'utf8').toString(
      'base64url',
    );
    expect(genuine.document).toContain(marker);
    const tampered = genuine.document.replace(
      marker,
      Buffer.from('"organizationLimit":9', 'utf8').toString('base64url'),
    );
    const tamperedRejection = await rejectionOf(
      harness.service.importDocument(
        JSON.stringify({
          format: 'vardena-license',
          fileVersion: 1,
          document: tampered,
        }),
      ),
    );
    expect(tamperedRejection.status).toBe(422);
    expect(tamperedRejection.message).toMatch(/signature is not valid/);

    // A document with no signature at all never becomes a document.
    const withoutSignature = genuine.document.split('.').slice(0, 2).join('.');
    const missingRejection = await rejectionOf(
      harness.service.importDocument(
        JSON.stringify({
          format: 'vardena-license',
          fileVersion: 1,
          document: withoutSignature,
        }),
      ),
    );
    expect(missingRejection.status).toBe(422);

    // Nothing was written by any of the three attempts: the perpetual version
    // still governs and no supersession is recorded.
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]).toMatchObject({
      validUntil: null,
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });
    expect(
      harness.stores.auditEvents.some(
        (event) => event.eventType === 'license.version.superseded',
      ),
    ).toBe(false);
    await expect(harness.licensing.current(T0)).resolves.toMatchObject({
      active: true,
      organizationLimit: 3,
    });
  });

  it('still applies an explicit supersession that keeps the retained grant', async () => {
    // The guard is a reduction check, not a ban on explicit supersession: a
    // successor that keeps or grows what it takes over is applied exactly as
    // before, with the documented hand-over and audit trail.
    const predecessor = await importPredecessor();
    const successor = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: HANDOVER,
        validUntil: new Date('2029-01-01T00:00:00.000Z'),
        organizationLimit: 9,
        supersedesOperationId: predecessor.operationId,
      },
      AUTHORITY.privateKey,
    );

    const result = await harness.service.importDocument(successor.file);

    expect(result).toMatchObject({ changed: true, outcome: 'APPLIED' });
    expect(harness.stores.versions).toHaveLength(2);
    expect(harness.stores.versions[0]).toMatchObject({
      versionId: predecessor.versionId,
      supersededAt: T0,
      governsUntil: HANDOVER,
      supersededByVersionId: harness.stores.versions[1]?.versionId,
    });
    await expect(harness.licensing.current(T0)).resolves.toMatchObject({
      active: true,
      organizationLimit: 3,
    });
    await expect(harness.licensing.current(HANDOVER)).resolves.toMatchObject({
      active: true,
      organizationLimit: 9,
    });
    // The explicit hand-over keeps the documented classifier: the supersession
    // was signed, not implicit precedence.
    const supersededEvent = harness.stores.auditEvents.find(
      (event) => event.eventType === 'license.version.superseded',
    );
    expect(supersededEvent).toMatchObject({
      reason: null,
      operationId: predecessor.operationId,
      versionId: predecessor.versionId,
    });
  });

  it('refuses a second successor for a version a supersession already retired', async () => {
    const predecessor = await importPredecessor();
    const first = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: HANDOVER,
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
        organizationLimit: 9,
        supersedesOperationId: predecessor.operationId,
      },
      AUTHORITY.privateKey,
    );
    await harness.service.importDocument(first.file);

    const second = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: new Date('2027-06-01T00:00:00.000Z'),
        validUntil: new Date('2028-06-01T00:00:00.000Z'),
        organizationLimit: 11,
        supersedesOperationId: predecessor.operationId,
      },
      AUTHORITY.privateKey,
    );
    const rejection = await rejectionOf(
      harness.service.importDocument(second.file),
    );

    // One version is retired once: the loser of a competing supersession gets
    // the documented conflict, and the winner's hand-over is untouched.
    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/not a retained, eligible version/);
    expect(harness.stores.versions).toHaveLength(2);
    expect(harness.stores.versions[0]).toMatchObject({
      supersededByVersionId: harness.stores.versions[1]?.versionId,
      governsUntil: HANDOVER,
    });
    await expect(harness.licensing.current(T0)).resolves.toMatchObject({
      organizationLimit: 3,
    });
    await expect(harness.licensing.current(HANDOVER)).resolves.toMatchObject({
      organizationLimit: 9,
    });
  });

  it('leaves the current license untouched when the successor import fails', async () => {
    const predecessor = await importPredecessor();
    const forged = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: HANDOVER,
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
        supersedesOperationId: predecessor.operationId,
      },
      STRANGER.privateKey,
    );
    const overlapping = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: HANDOVER,
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
        supersedesOperationId: '01K7MISSINGOPERATION0000000',
      },
      AUTHORITY.privateKey,
    );

    expect(
      (await rejectionOf(harness.service.importDocument(forged.file))).status,
    ).toBe(422);
    expect(
      (await rejectionOf(harness.service.importDocument(overlapping.file)))
        .status,
    ).toBe(409);

    // No version, no supersession stamp, no changed governance.
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]).toMatchObject({
      versionId: predecessor.versionId,
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });
    await expect(harness.licensing.current(T0)).resolves.toMatchObject({
      active: true,
      organizationLimit: 3,
    });
    await expect(harness.provider.versionHistory(T0)).resolves.toMatchObject({
      effectiveVersionId: predecessor.versionId,
      scheduled: null,
    });
  });

  it('retains the invariant that no two versions govern the same instant', async () => {
    const predecessor = await importPredecessor();
    const successor = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: HANDOVER,
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
        supersedesOperationId: predecessor.operationId,
      },
      AUTHORITY.privateKey,
    );
    await harness.service.importDocument(successor.file);
    const replacement = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: new Date('2028-01-01T00:00:00.000Z'),
        validUntil: new Date('2029-01-01T00:00:00.000Z'),
        supersedesOperationId: successor.payload.operationId,
      },
      AUTHORITY.privateKey,
    );
    await harness.service.importDocument(replacement.file);

    const versions = harness.stores.versions;
    expect(versions).toHaveLength(3);

    // Every day of the three licensed years is covered by EXACTLY one version
    // (the windows are `[2026-01-01, 2029-01-01)` in total): no gap, no
    // ambiguity, and one hand-over per successor.
    const day = 86_400_000;
    const start = new Date('2026-01-01T00:00:00.000Z').getTime();
    const end = new Date('2029-01-01T00:00:00.000Z').getTime();
    const handOvers: string[] = [];
    for (let at = start; at < end; at += day) {
      const resolution = resolveEffectiveVersion(versions, new Date(at));
      expect(resolution.kind).toBe('effective');
      const versionId = resolution.version!.versionId;
      if (handOvers.at(-1) !== versionId) handOvers.push(versionId);
    }
    expect((end - start) / day).toBe(1096);
    expect(handOvers).toEqual([
      versions[0]!.versionId,
      versions[1]!.versionId,
      versions[2]!.versionId,
    ]);
  });

  it('applies a supersession whose hand-over is the import instant itself', async () => {
    const predecessor = await importPredecessor();

    const immediate = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: T0,
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
        organizationLimit: 9,
        supersedesOperationId: predecessor.operationId,
      },
      AUTHORITY.privateKey,
    );
    const result = await harness.service.importDocument(immediate.file);

    // A hand-over AT the import instant takes nothing away from an instant
    // that has already passed: it is the boundary the temporal rule allows.
    expect(result).toMatchObject({
      outcome: 'APPLIED',
      license: { active: true, organizationLimit: 9 },
    });
    expect(harness.stores.versions).toHaveLength(2);
    // Recorded at T0 and effective from T0. Both facts are the same instant
    // here, and the predecessor governs up to T0 — not one instant less.
    expect(harness.stores.versions[0]).toMatchObject({
      supersededAt: T0,
      governsUntil: T0,
      supersededByVersionId: harness.stores.versions[1]?.versionId,
    });
    // One millisecond before T0 the predecessor still governs; at T0 the
    // successor does (half-open hand-over).
    await expect(
      harness.licensing.current(new Date(T0.getTime() - 1)),
    ).resolves.toMatchObject({ active: true, organizationLimit: 3 });
    await expect(harness.licensing.current(T0)).resolves.toMatchObject({
      active: true,
      organizationLimit: 9,
    });
    expect(harness.stores.auditEvents.map((event) => event.eventType)).toEqual([
      'license.import.applied',
      'license.version.superseded',
      'license.import.applied',
    ]);
  });

  it('refuses a successor that would hand over before the import instant', async () => {
    const predecessor = await importPredecessor();
    const stateBefore = await harness.licensing.current(T0);
    const historyBefore = await harness.provider.versionHistory(T0);
    const auditBefore = harness.stores.auditEvents.length;

    const backdated = signedDocument(
      {
        installationId: INSTALLATION,
        validFrom: new Date(T0.getTime() - 1),
        validUntil: new Date('2028-01-01T00:00:00.000Z'),
        organizationLimit: 9,
        supersedesOperationId: predecessor.operationId,
      },
      AUTHORITY.privateKey,
    );
    const rejection = await rejectionOf(
      harness.service.importDocument(backdated.file),
    );

    // Fail closed on the ambiguity (OQ-86): the predecessor really governed the
    // instant one millisecond before the import, so the stamp is refused
    // instead of rewriting which version governed then.
    expect(rejection.status).toBe(422);
    expect(rejection.code).toBe('BusinessRuleViolation');
    expect(rejection.message).toMatch(/already in the past/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]).toMatchObject({
      versionId: predecessor.versionId,
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });

    // Nothing was written: the predecessor keeps governing, no hand-over is
    // scheduled, and only the rejection reaches the audit trail.
    await expect(harness.licensing.current(T0)).resolves.toEqual(stateBefore);
    await expect(harness.provider.versionHistory(T0)).resolves.toEqual(
      historyBefore,
    );
    const auditAfter = harness.stores.auditEvents.slice(auditBefore);
    expect(auditAfter.map((event) => event.eventType)).toEqual([
      'license.import.rejected',
    ]);
    expect(auditAfter[0]).toMatchObject({
      outcome: 'REJECTED',
      reason: 'backdated-supersession',
    });
    // The refused operation id is not retained either: the Owner can re-issue
    // the same document with a start that has not yet passed.
    expect(
      harness.stores.versions.some(
        (version) => version.operationId === backdated.payload.operationId,
      ),
    ).toBe(false);
    await expect(
      harness.service.importDocument(
        signedDocument(
          {
            installationId: INSTALLATION,
            operationId: backdated.payload.operationId,
            validFrom: HANDOVER,
            validUntil: new Date('2028-01-01T00:00:00.000Z'),
            organizationLimit: 9,
            supersedesOperationId: predecessor.operationId,
          },
          AUTHORITY.privateKey,
        ).file,
      ),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });
  });

  it('still accepts a contiguous correction of a version that had already ended', async () => {
    // The temporal rule protects instants that are already past; it is not a
    // ban on every start in the past. A version that ended by its own
    // `validUntil` has nothing left to take away — and a correction that starts
    // exactly where it ended leaves no gap either, so it stays importable and
    // no effective window moves.
    const ended = signedDocument(
      {
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2026-03-01T00:00:00.000Z'),
        organizationLimit: 3,
      },
      AUTHORITY.privateKey,
    );
    // It has to be landed while it is still valid (an ended document is refused
    // at import), so the clock starts before its own end.
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'));
    await harness.service.importDocument(ended.file);
    vi.setSystemTime(T0);

    const windowsBefore = harness.stores.versions.map((version) => ({
      versionId: version.versionId,
      window: effectiveWindow(version),
    }));

    const correction = signedDocument(
      {
        validFrom: new Date('2026-03-01T00:00:00.000Z'),
        organizationLimit: 5,
        supersedesOperationId: ended.payload.operationId,
      },
      AUTHORITY.privateKey,
    );
    const result = await harness.service.importDocument(correction.file);

    expect(result).toMatchObject({
      outcome: 'APPLIED',
      license: { active: true, organizationLimit: 5 },
    });
    expect(harness.stores.versions).toHaveLength(2);
    // The stamp records the supersession without shortening anything: the
    // retired version's effective window is byte-for-byte what it was.
    expect(
      harness.stores.versions.slice(0, 1).map((version) => ({
        versionId: version.versionId,
        window: effectiveWindow(version),
      })),
    ).toEqual(windowsBefore);
    // The answer for the predecessor's own window is unchanged, and the
    // correction governs from its declared (past) start onwards.
    await expect(
      harness.licensing.current(new Date('2026-02-01T00:00:00.000Z')),
    ).resolves.toMatchObject({ active: true, organizationLimit: 3 });
    await expect(
      harness.licensing.current(new Date('2026-03-15T00:00:00.000Z')),
    ).resolves.toMatchObject({ active: true, organizationLimit: 5 });
  });

  it('refuses a correction that would leave a gap instead of the coverage it corrects (OQ-80 G2)', async () => {
    const ended = signedDocument(
      {
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2026-03-01T00:00:00.000Z'),
        organizationLimit: 3,
      },
      AUTHORITY.privateKey,
    );
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'));
    await harness.service.importDocument(ended.file);
    vi.setSystemTime(T0);

    // Starting a month after the version it corrects ended is exactly the gap
    // OQ-80 G2 refuses — whether it is requested explicitly or implicitly, and
    // whether or not the target already ended.
    const gapped = signedDocument(
      {
        validFrom: new Date('2026-04-01T00:00:00.000Z'),
        organizationLimit: 5,
        supersedesOperationId: ended.payload.operationId,
      },
      AUTHORITY.privateKey,
    );
    const rejection = await rejectionOf(
      harness.service.importDocument(gapped.file),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/gap in coverage/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]).toMatchObject({
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });
  });

  it('refuses a backdated legacy code that would replace the governing version', async () => {
    const first = signedCode(
      // The L-02 default window: valid since 2020, open-ended.
      { installationId: INSTALLATION, organizationLimit: 2 },
      AUTHORITY.privateKey,
    ).code;
    await harness.service.importDocument(first);

    const replacement = signedCode(
      { installationId: INSTALLATION, organizationLimit: 7 },
      AUTHORITY.privateKey,
    ).code;
    const rejection = await rejectionOf(
      harness.service.importDocument(replacement),
    );

    // A legacy code carries no explicit start of its own here, and retiring the
    // governing version in 2020 would erase what it really governed: refuse
    // rather than guess which instant it should take over (OQ-80, OQ-86).
    expect(rejection.status).toBe(422);
    expect(rejection.message).toMatch(/already in the past/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]).toMatchObject({
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });
    await expect(harness.licensing.current(T0)).resolves.toMatchObject({
      active: true,
      organizationLimit: 2,
    });
  });

  it('accepts a legacy renewal that starts where the version it follows ends', async () => {
    // The legacy transport cannot express a start in the future (`not-yet-valid`
    // still governs it) and must not rewrite the past, so the surviving L-02
    // renewal is adjacency: the code starts exactly where the previous version
    // ends. Nothing is superseded — the predecessor keeps the window it had.
    const first = signedCode(
      {
        installationId: INSTALLATION,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2026-03-01T00:00:00.000Z'),
        organizationLimit: 2,
      },
      AUTHORITY.privateKey,
    ).code;
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'));
    await harness.service.importDocument(first);
    vi.setSystemTime(T0);

    const renewal = signedCode(
      {
        installationId: INSTALLATION,
        validFrom: new Date('2026-03-01T00:00:00.000Z'),
        organizationLimit: 7,
      },
      AUTHORITY.privateKey,
    ).code;
    const applied = await harness.service.importDocument(renewal);

    expect(applied).toMatchObject({
      changed: true,
      license: { active: true, organizationLimit: 7 },
    });
    expect(harness.stores.versions).toHaveLength(2);
    // Adjacency is not an overlap: no supersession is recorded at all.
    expect(harness.stores.versions[0]).toMatchObject({
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });
    await expect(
      harness.licensing.current(new Date('2026-02-01T00:00:00.000Z')),
    ).resolves.toMatchObject({ active: true, organizationLimit: 2 });
    await expect(harness.licensing.current(T0)).resolves.toMatchObject({
      active: true,
      organizationLimit: 7,
    });

    // The applied code is the governing version, so re-applying it is the
    // documented no-op …
    await expect(
      harness.service.importDocument(renewal),
    ).resolves.toMatchObject({ changed: false, outcome: 'UNCHANGED' });
    // … and the code it followed is refused by its own end date, exactly as
    // L-02 documented (the expiry gate precedes the replay gate).
    const rejection = await rejectionOf(harness.service.importDocument(first));
    expect(rejection.status).toBe(422);
    expect(rejection.message).toMatch(/expired/);
  });

  it('refuses a document that lands inside a window a retired version governed (OQ-86 Option C)', async () => {
    const retired = signedDocument(
      {
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
        organizationLimit: 3,
      },
      AUTHORITY.privateKey,
    );
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'));
    await harness.service.importDocument(retired.file);
    vi.setSystemTime(T0);

    // A later-starting successor retires the first version from its own start…
    const successor = signedDocument(
      {
        validFrom: new Date('2026-06-01T00:00:00.000Z'),
        validUntil: new Date('2027-06-01T00:00:00.000Z'),
        organizationLimit: 3,
      },
      AUTHORITY.privateKey,
    );
    await harness.service.importDocument(successor.file);
    expect(harness.stores.versions[0]).toMatchObject({
      governsUntil: new Date('2026-06-01T00:00:00.000Z'),
    });

    // …so the retired version really governed [2026-01-01, 2026-06-01). A
    // backdated document that lands inside that interval would rewrite which
    // version governed those instants: it is refused, and nothing is written.
    const backfill = signedDocument(
      {
        licenseId: '01K7BACKFILL000000000000000',
        validFrom: new Date('2026-03-01T00:00:00.000Z'),
        // Still in force at the import instant: a window that had already
        // ended never reaches the conflict rules (it is refused as expired).
        validUntil: new Date('2026-12-01T00:00:00.000Z'),
      },
      AUTHORITY.privateKey,
    );
    const rejection = await rejectionOf(
      harness.service.importDocument(backfill.file),
    );
    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/overlaps a retained version/);
    expect(harness.stores.versions).toHaveLength(2);
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      outcome: 'REJECTED',
      reason: 'overlapping-range',
    });

    // The retained TAIL of the retired version (after its effective end) is not
    // historical governance: a document that starts after everything retained
    // has ended — adjacency here — is still importable.
    const after = signedDocument(
      {
        licenseId: '01K7BACKFILL000000000000000',
        validFrom: new Date('2027-06-01T00:00:00.000Z'),
        validUntil: new Date('2028-06-01T00:00:00.000Z'),
      },
      AUTHORITY.privateKey,
    );
    await expect(
      harness.service.importDocument(after.file),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });
    expect(harness.stores.versions).toHaveLength(3);
  });

  it('refuses to re-apply a legacy code whose supersession has already taken effect', async () => {
    const code = signedCode(
      {
        installationId: INSTALLATION,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2030-01-01T00:00:00.000Z'),
        organizationLimit: 2,
      },
      AUTHORITY.privateKey,
    ).code;
    await harness.service.importDocument(code);

    // A retained, retired legacy row as a migration can leave it behind: the
    // wire format cannot name a `legacy-code:` operation id in a signed
    // document (`supersedesOperationId` is a ULID), so a supersession of a
    // legacy version is recorded either by an earlier legacy replacement (the
    // L-02 model) or by the backfill. Both instants are set, as the pair
    // constraint requires, and the successor row is not part of this fixture.
    const retained = harness.stores.versions[0]!;
    retained.supersededAt = new Date('2026-02-01T00:00:00.000Z');
    retained.governsUntil = new Date('2026-05-01T00:00:00.000Z');
    retained.supersededByVersionId = null;

    // The code's own window still covers T0, so the expiry gate lets it reach
    // the replay gate — which refuses it: it is retained, but it no longer
    // governs (the idempotent no-op is only honest for the governing version).
    const rejection = await rejectionOf(harness.service.importDocument(code));
    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/no longer the version that governs/);
    expect(harness.stores.versions).toHaveLength(1);
  });
});

describe('explicit installation customer transfer (Q4)', () => {
  let harness: Harness;
  const OTHER_CUSTOMER = '01K7CUSTOMERB000000000000000';
  const OTHER_LICENSE = '01K7LICENSEB0000000000000000';
  /** Pinned import instant: the transfer document starts exactly here. */
  const T0 = new Date('2026-06-01T00:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    harness = buildHarness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function importInitial(): Promise<void> {
    await harness.service.importDocument(issuedFile({ organizationLimit: 3 }));
  }

  /**
   * The document the new customer's license arrives in: a different customer
   * AND a different license identifier (a license belongs to one customer), and
   * a window that starts at the transfer instant — so it takes over from the
   * version that governs up to here without rewriting any past instant.
   */
  function transferDocument(
    overrides: Partial<Parameters<typeof issueLicenseFile>[0]> = {},
  ): string {
    return signedDocument({
      customerId: OTHER_CUSTOMER,
      licenseId: OTHER_LICENSE,
      organizationLimit: 3,
      validFrom: T0,
      ...overrides,
    }).file;
  }

  it('rebinds the installation and records the typed transfer event in one transaction', async () => {
    await importInitial();
    expect(harness.stores.self()?.customerId).toBe(CUSTOMER);

    const transferReason = 'R'.repeat(500);
    const result = await harness.service.transferCustomer(
      transferDocument(),
      transferReason,
    );

    expect(result).toMatchObject({
      outcome: 'APPLIED',
      changed: true,
      bindingChanged: true,
      previousCustomerId: CUSTOMER,
      license: { active: true, customerId: OTHER_CUSTOMER },
    });
    // The binding moved exactly once and the new license is retained.
    expect(harness.stores.self()?.customerId).toBe(OTHER_CUSTOMER);
    expect(harness.stores.versions).toHaveLength(2);
    // The transfer is its own typed event, carrying the old and the new
    // customer, the installation, the operation, the actor, the source, the
    // instant, the outcome and the operator's reason.
    const transfer = harness.stores.auditEvents.find(
      (event) =>
        event.eventType === 'license.installation.customer-transferred',
    );
    expect(transfer).toMatchObject({
      installationId: INSTALLATION,
      outcome: 'APPLIED',
      previousCustomerId: CUSTOMER,
      previousCustomerCode: CUSTOMER_CODE,
      newCustomerId: OTHER_CUSTOMER,
      newCustomerCode: defaultCustomerCode(OTHER_CUSTOMER),
      // L-06 (PDR-14 §3.5.4): the license that governed immediately before the
      // transfer is recorded machine-readably, and the NEW license identity is
      // the event's own `licenseId`.
      previousLicenseId: LICENSE,
      licenseId: OTHER_LICENSE,
      operationId: harness.stores.versions[1]?.operationId,
      versionId: harness.stores.versions[1]?.versionId,
      actorId: null,
      source: 'file',
      reason: null,
      occurredAt: expect.any(Date),
    });
    expect(transfer?.detail).toBe(
      `transfer from license ${LICENSE} to ${OTHER_CUSTOMER} license ${OTHER_LICENSE}: ${transferReason}`,
    );
  });

  it('accepts the exact three-character transfer-reason minimum', async () => {
    await importInitial();

    await harness.service.transferCustomer(transferDocument(), 'abc');

    const transfer = harness.stores.auditEvents.find(
      (event) =>
        event.eventType === 'license.installation.customer-transferred',
    );
    expect(transfer?.detail).toBe(
      `transfer from license ${LICENSE} to ${OTHER_CUSTOMER} license ${OTHER_LICENSE}: abc`,
    );
  });

  it('rejects invalid or overlong transfer reasons before writing', async () => {
    await importInitial();
    const versionCount = harness.stores.versions.length;

    for (const reason of ['', '  ', 'ab', '😀😀', 'R'.repeat(501)]) {
      const rejection = await rejectionOf(
        harness.service.transferCustomer(transferDocument(), reason),
      );
      expect(rejection.status, `reason length: ${reason.length}`).toBe(400);
    }

    expect(harness.stores.self()?.customerId).toBe(CUSTOMER);
    expect(harness.stores.versions).toHaveLength(versionCount);
    expect(
      harness.stores.auditEvents.some(
        (event) =>
          event.eventType === 'license.installation.customer-transferred',
      ),
    ).toBe(false);
  });

  it('uses the same Unicode character count as the request DTO', async () => {
    await importInitial();
    const transferReason = '😀'.repeat(251);

    await harness.service.transferCustomer(transferDocument(), transferReason);

    const transfer = harness.stores.auditEvents.find(
      (event) =>
        event.eventType === 'license.installation.customer-transferred',
    );
    expect(transfer?.detail).toBe(
      `transfer from license ${LICENSE} to ${OTHER_CUSTOMER} license ${OTHER_LICENSE}: ${transferReason}`,
    );
  });

  it('never transfers on an ordinary import, and nothing is written', async () => {
    await importInitial();
    const before = harness.stores.self()?.customerId;
    const versionsBefore = harness.stores.versions.length;

    const rejection = await rejectionOf(
      harness.service.importDocument(transferDocument()),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(
      /different customer than this installation/,
    );
    // The binding is unchanged, no version was retained, and no transfer event
    // was written: a differing `customerId` is never an implicit transfer.
    expect(harness.stores.self()?.customerId).toBe(before);
    expect(harness.stores.versions).toHaveLength(versionsBefore);
    expect(
      harness.stores.auditEvents.some(
        (event) =>
          event.eventType === 'license.installation.customer-transferred',
      ),
    ).toBe(false);
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      outcome: 'REJECTED',
      reason: 'installation-customer-mismatch',
    });
  });

  it('refuses a transfer that names the customer the installation already has', async () => {
    await importInitial();
    const versionsBefore = harness.stores.versions.length;

    // A repeated or racing transfer would otherwise re-apply the same move;
    // instead there is nothing to transfer and the request is refused.
    const rejection = await rejectionOf(
      harness.service.transferCustomer(
        signedDocument({ customerId: CUSTOMER, licenseId: OTHER_LICENSE }).file,
        'Re-running the same transfer.',
      ),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/nothing to transfer/);
    // PDR-14 §3.5.4 names the exact reason; nothing at all is written.
    expect(rejection.details).toEqual({
      reason: 'transfer-requires-different-customer',
    });
    expect(harness.stores.self()?.customerId).toBe(CUSTOMER);
    expect(harness.stores.versions).toHaveLength(versionsBefore);
    expect(harness.stores.customerRecords.has(OTHER_CUSTOMER)).toBe(false);
    expect(harness.stores.customerCodes.has(OTHER_CUSTOMER)).toBe(false);
    // No successful transfer event: only the REJECTED row exists.
    expect(
      harness.stores.auditEvents.some(
        (event) =>
          event.eventType === 'license.installation.customer-transferred' &&
          event.outcome === 'APPLIED',
      ),
    ).toBe(false);
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      outcome: 'REJECTED',
      reason: 'transfer-requires-different-customer',
    });
  });

  it('cannot be driven by a legacy text code', async () => {
    await importInitial();
    const { code } = signedCode({
      customerId: OTHER_CUSTOMER,
      licenseId: OTHER_LICENSE,
    });

    const rejection = await rejectionOf(
      harness.service.transferCustomer(code, 'Legacy attempt.'),
    );

    expect(rejection.status).toBe(422);
    expect(rejection.message).toMatch(/requires a signed license document/);
    expect(harness.stores.self()?.customerId).toBe(CUSTOMER);
    expect(harness.stores.versions).toHaveLength(1);
  });

  it('requires the dedicated permission (AR-21)', async () => {
    harness = buildHarness();
    await importInitial();
    const forbidden = new LicenseImportService(
      configStub([AUTHORITY.publicKey]),
      {
        requireAllPermissions: async (codes: string[]): Promise<void> => {
          if (
            codes.includes(LICENSING_PERMISSIONS.INSTALLATION_TRANSFER_CUSTOMER)
          ) {
            throw AppException.forbidden();
          }
        },
      } as unknown as AuthorizationService,
      new InstallationIdentityService(
        harness.stores.installations,
        loggerStub(),
      ),
      harness.stores.licenses,
      harness.licensing,
      usageStub(),
      loggerStub(),
    );

    const rejection = await rejectionOf(
      forbidden.transferCustomer(transferDocument(), 'No authority.'),
    );

    expect(rejection.status).toBe(403);
    expect(harness.stores.self()?.customerId).toBe(CUSTOMER);
    expect(harness.stores.versions).toHaveLength(1);
  });
});

describe('dedicated post-gap recovery (OQ-87 Option B, PDR-13)', () => {
  let harness: Harness;
  const T0 = new Date('2026-06-01T00:00:00.000Z');
  /** The lapsed license's window ends here. */
  const LAPSE_END = new Date('2027-01-01T00:00:00.000Z');
  /** The recovery instant: after the lapse, with nothing governing. */
  const AFTER_LAPSE = new Date('2027-06-01T00:00:00.000Z');
  /** A NEW license identity: the recovery document carries its own. */
  const RECOVERY_LICENSE = '01K7RECOVERYLICENSE00000000';
  const RECOVERY_REASON =
    'Renewal order 2026-1182 arrived after the previous contract had expired.';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    harness = buildHarness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A time-limited license whose window has ended by the recovery instant:
   * imported while active, then the clock moves past its end so the
   * installation has lapsed coverage.
   */
  async function importLapsed(
    overrides: Partial<Parameters<typeof issueLicenseFile>[0]> = {},
  ): Promise<void> {
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    await harness.service.importDocument(
      issuedFile({
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: LAPSE_END,
        organizationLimit: 3,
        userLimit: 10,
        ...overrides,
      }),
    );
    vi.setSystemTime(AFTER_LAPSE);
  }

  /** A new-identity document that starts strictly after the lapse. */
  function recoveryDocument(
    overrides: Partial<Parameters<typeof issueLicenseFile>[0]> = {},
  ): string {
    return signedDocument({
      licenseId: RECOVERY_LICENSE,
      validFrom: AFTER_LAPSE,
      validUntil: new Date('2029-01-01T00:00:00.000Z'),
      organizationLimit: 3,
      userLimit: 10,
      ...overrides,
    }).file;
  }

  it('refuses the ordinary import of a post-gap document, and nothing is written', async () => {
    await importLapsed();

    const rejection = await rejectionOf(
      harness.service.importDocument(recoveryDocument()),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/dedicated recovery operation/);
    // The lapsed state is untouched: no version, no applied event.
    expect(harness.stores.versions).toHaveLength(1);
    expect(
      harness.stores.auditEvents.some((event) =>
        event.eventType.startsWith('license.import.recovered'),
      ),
    ).toBe(false);
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      eventType: 'license.import.rejected',
      outcome: 'REJECTED',
      reason: 'post-gap-recovery-requires-dedicated-operation',
    });
  });

  it('recovers through the dedicated operation and records the typed event', async () => {
    await importLapsed();

    const result = await harness.service.recoverAfterGap(
      recoveryDocument(),
      RECOVERY_REASON,
    );

    expect(result).toMatchObject({
      outcome: 'APPLIED',
      changed: true,
      lapsedLicenseId: LICENSE,
      coverageEnd: LAPSE_END.toISOString(),
    });
    expect(harness.stores.versions).toHaveLength(2);
    // The recovery is its own typed event, naming the lapsed license as a
    // machine-readable fact AND in the bounded detail, with the reason.
    const recovered = harness.stores.auditEvents.find(
      (event) => event.eventType === 'license.import.recovered',
    );
    expect(recovered).toMatchObject({
      installationId: INSTALLATION,
      outcome: 'APPLIED',
      previousLicenseId: LICENSE,
      licenseId: RECOVERY_LICENSE,
      versionId: harness.stores.versions[1]?.versionId,
      source: 'file',
      occurredAt: AFTER_LAPSE,
    });
    expect(recovered?.detail).toMatch(/post-gap recovery after license/);
    expect(recovered?.detail).toMatch(/Renewal order 2026-1182/);
    // A recovery never touches the customer binding: it is still the one the
    // lapsed license established (the recovery document names the same
    // customer, and a different one is refused below).
    expect(harness.stores.self()?.customerId).toBe(CUSTOMER);
  });

  it('refuses a recovery reduction against the latest lapsed grant with an operation-aware message', async () => {
    harness = buildHarness({ usage: { organizations: 40 } });
    await importLapsed({
      organizationLimit: 50,
      moduleEntitlements: ['accounting'],
    });

    const rejection = await rejectionOf(
      harness.service.recoverAfterGap(
        recoveryDocument({
          organizationLimit: 2,
          moduleEntitlements: [],
        }),
        RECOVERY_REASON,
      ),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.details).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        predecessorVersionId: harness.stores.versions[0]?.versionId,
        conflicts: [
          { kind: 'organization-capacity', limit: 2, currentUsage: 40 },
          {
            kind: 'entitlement-removed',
            entitlement: { kind: 'MODULE', code: 'accounting' },
          },
        ],
      },
    });
    expect(rejection.message).toMatch(/dedicated gap-recovery operation/);
    expect(rejection.message).toMatch(/reductionResolutionReason/);
    expect(rejection.message).not.toMatch(
      /use the dedicated resolution operation/,
    );
    expect(harness.stores.versions).toHaveLength(1);
    expect(
      harness.stores.auditEvents.some(
        (event) =>
          event.eventType === 'license.import.recovered' ||
          event.eventType === 'license.import.reduction-resolved',
      ),
    ).toBe(false);
  });

  it('keeps the transaction-race reduction message operation-aware for recovery', async () => {
    harness = buildHarness({ usage: { organizations: 40 } });
    await importLapsed({
      organizationLimit: 50,
      moduleEntitlements: ['accounting'],
    });
    const lapsedVersion = harness.stores.versions[0];
    if (lapsedVersion === undefined) throw new Error('missing lapsed version');

    // The read-side pass sees a non-reducing increase; the locked transaction
    // then reports the reduction conflict, as it would after a concurrent
    // change to the authoritative retained state/usage.
    vi.spyOn(harness.stores.licenses, 'importVersion').mockRejectedValue(
      new ImportConflictError({
        reason: 'reduction-requires-resolution',
        overlapping: 1,
        reduction: {
          predecessorVersionId: lapsedVersion.versionId,
          conflicts: [
            { kind: 'organization-capacity', limit: 2, currentUsage: 40 },
          ],
        },
      }),
    );

    const rejection = await rejectionOf(
      harness.service.recoverAfterGap(
        recoveryDocument({
          organizationLimit: 60,
          moduleEntitlements: ['accounting'],
        }),
        RECOVERY_REASON,
      ),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(
      /retry the same dedicated gap-recovery operation/i,
    );
    expect(rejection.message).toMatch(
      /do not use the separate reduction-resolution route/,
    );
    expect(rejection.message).not.toMatch(/use the dedicated resolution route/);
    expect(harness.stores.versions).toHaveLength(1);
  });

  it('applies a combined recovery and reduction resolution with two typed events and no supersession stamp', async () => {
    harness = buildHarness({ usage: { organizations: 40 } });
    await importLapsed({
      organizationLimit: 50,
      moduleEntitlements: ['accounting'],
    });
    const lapsedVersion = harness.stores.versions[0];
    if (lapsedVersion === undefined) throw new Error('missing lapsed version');

    const result = await harness.service.recoverAfterGap(
      recoveryDocument({
        organizationLimit: 2,
        moduleEntitlements: [],
      }),
      RECOVERY_REASON,
      'Customer approved the lower grant after reviewing current usage.',
    );

    expect(result).toMatchObject({
      outcome: 'APPLIED',
      changed: true,
      lapsedLicenseId: LICENSE,
      coverageEnd: LAPSE_END.toISOString(),
      resolvedPredecessorVersionId: lapsedVersion.versionId,
      resolvedConflicts: [
        { kind: 'organization-capacity', limit: 2, currentUsage: 40 },
        {
          kind: 'entitlement-removed',
          entitlement: { kind: 'MODULE', code: 'accounting' },
        },
      ],
    });
    expect(harness.stores.versions).toHaveLength(2);
    expect(lapsedVersion.supersededAt).toBeNull();
    expect(lapsedVersion.governsUntil).toBeNull();

    const recovered = harness.stores.auditEvents.find(
      (event) => event.eventType === 'license.import.recovered',
    );
    const resolved = harness.stores.auditEvents.find(
      (event) => event.eventType === 'license.import.reduction-resolved',
    );
    expect(recovered).toMatchObject({
      outcome: 'APPLIED',
      operationId: harness.stores.versions[1]?.operationId,
      licenseId: RECOVERY_LICENSE,
      versionId: harness.stores.versions[1]?.versionId,
      previousLicenseId: LICENSE,
    });
    expect(recovered?.detail).toContain(RECOVERY_REASON);
    expect(resolved).toMatchObject({
      outcome: 'APPLIED',
      operationId: recovered?.operationId,
      licenseId: RECOVERY_LICENSE,
      versionId: recovered?.versionId,
    });
    expect(resolved?.detail).toContain(lapsedVersion.versionId);
    expect(resolved?.detail).toContain('organization-capacity');
    expect(resolved?.detail).toContain('entitlement-removed');
    expect(resolved?.detail).toContain(
      'conflicts=[{"kind":"organization-capacity","limit":2,"currentUsage":40},{"kind":"entitlement-removed","entitlement":{"kind":"MODULE","code":"accounting"}}]',
    );
    expect(resolved?.detail).toContain(
      'Customer approved the lower grant after reviewing current usage.',
    );
  });

  it('validates the optional reduction-resolution reason before persisting a recovery', async () => {
    harness = buildHarness({ usage: { organizations: 40 } });
    await importLapsed({ organizationLimit: 50 });

    const rejection = await rejectionOf(
      harness.service.recoverAfterGap(
        recoveryDocument({ organizationLimit: 2 }),
        RECOVERY_REASON,
        'ab',
      ),
    );

    expect(rejection.status).toBe(400);
    expect(harness.stores.versions).toHaveLength(1);
    expect(
      harness.stores.auditEvents.some(
        (event) => event.eventType === 'license.import.recovered',
      ),
    ).toBe(false);
  });

  it('requires a validated reason (400), and writes nothing', async () => {
    await importLapsed();

    for (const reason of ['', '  ', 'ab', 'R'.repeat(501)]) {
      const rejection = await rejectionOf(
        harness.service.recoverAfterGap(recoveryDocument(), reason),
      );
      expect(rejection.status, `reason: "${reason}"`).toBe(400);
    }
    expect(harness.stores.versions).toHaveLength(1);
    expect(
      harness.stores.auditEvents.some(
        (event) => event.eventType === 'license.import.recovered',
      ),
    ).toBe(false);
  });

  it('requires the dedicated permission server-side (AR-21)', async () => {
    await importLapsed();
    const forbidden = new LicenseImportService(
      configStub([AUTHORITY.publicKey]),
      {
        requireAllPermissions: async (codes: string[]): Promise<void> => {
          if (
            codes.includes(LICENSING_PERMISSIONS.INSTALLATION_RECOVER_AFTER_GAP)
          ) {
            throw AppException.forbidden();
          }
        },
      } as unknown as AuthorizationService,
      new InstallationIdentityService(
        harness.stores.installations,
        loggerStub(),
      ),
      harness.stores.licenses,
      harness.licensing,
      usageStub(),
      loggerStub(),
    );

    const rejection = await rejectionOf(
      forbidden.recoverAfterGap(recoveryDocument(), RECOVERY_REASON),
    );

    expect(rejection.status).toBe(403);
    expect(harness.stores.versions).toHaveLength(1);
  });

  it('refuses a recovery whose coverage has not lapsed (nothing to recover)', async () => {
    // A document for the RETAINED license id is a renewal (G2), never a
    // recovery: while that license has not lapsed there is nothing to
    // recover, and the recovery intent must not be spent on a renewal.
    await harness.service.importDocument(
      issuedFile({
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: LAPSE_END,
        organizationLimit: 3,
        userLimit: 10,
      }),
    );

    const rejection = await rejectionOf(
      harness.service.recoverAfterGap(
        recoveryDocument({
          licenseId: LICENSE,
          validFrom: LAPSE_END,
        }),
        RECOVERY_REASON,
      ),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/nothing to recover|has not lapsed/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(
      harness.stores.auditEvents.some(
        (event) => event.eventType === 'license.import.recovered',
      ),
    ).toBe(false);
  });

  it('refuses a legacy text code as a recovery (422)', async () => {
    await importLapsed();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const legacy = signedCode({
      installationId: INSTALLATION,
      licenseId: RECOVERY_LICENSE,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      organizationLimit: 3,
    }).code;
    vi.setSystemTime(AFTER_LAPSE);

    const rejection = await rejectionOf(
      harness.service.recoverAfterGap(legacy, RECOVERY_REASON),
    );

    expect(rejection.status).toBe(422);
    expect(rejection.message).toMatch(/requires a signed license document/);
    expect(harness.stores.versions).toHaveLength(1);
  });

  it('never re-binds the customer: a wrong-customer recovery document is refused', async () => {
    await importLapsed();
    const OTHER_CUSTOMER = '01K7CUSTOMERB000000000000000';

    const rejection = await rejectionOf(
      harness.service.recoverAfterGap(
        recoveryDocument({ customerId: OTHER_CUSTOMER }),
        RECOVERY_REASON,
      ),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(/different customer/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(
      harness.stores.auditEvents.some(
        (event) => event.eventType === 'license.import.recovered',
      ),
    ).toBe(false);
  });

  it('retrying the same recovery document is a stable duplicate (409)', async () => {
    await importLapsed();
    const document = recoveryDocument();
    await harness.service.recoverAfterGap(document, RECOVERY_REASON);

    const rejection = await rejectionOf(
      harness.service.recoverAfterGap(document, RECOVERY_REASON),
    );

    expect(rejection.status).toBe(409);
    expect(harness.stores.versions).toHaveLength(2);
    expect(
      harness.stores.auditEvents.filter(
        (event) => event.eventType === 'license.import.recovered',
      ),
    ).toHaveLength(1);
  });
});

describe('explicit reduction resolution (PDR-11 §8.6, L-04)', () => {
  let harness: Harness;
  const T0 = new Date('2026-06-01T00:00:00.000Z');
  const HANDOVER = new Date('2027-01-01T00:00:00.000Z');
  const RESOLUTION_REASON =
    'Customer confirmed the reduction; unused seats were revoked first.';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    // Current usage above the successor's shrunk limits: the reduction
    // conflicts with current usage, which is what the resolution authorizes.
    harness = buildHarness({ usage: { organizations: 5, activeUsers: 12 } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function importPredecessor(): Promise<string> {
    const predecessor = signedDocument({
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2028-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
      moduleEntitlements: ['accounting', 'documents'],
    });
    await harness.service.importDocument(predecessor.file);
    return predecessor.payload.operationId;
  }

  /** A signed successor that shrinks the organization limit, naming its target. */
  function reducingDocument(
    supersedesOperationId: string,
    overrides: Partial<Parameters<typeof issueLicenseFile>[0]> = {},
  ): string {
    return signedDocument({
      validFrom: HANDOVER,
      validUntil: new Date('2029-01-01T00:00:00.000Z'),
      organizationLimit: 3,
      userLimit: 20,
      moduleEntitlements: ['accounting', 'documents'],
      supersedesOperationId,
      ...overrides,
    }).file;
  }

  it('refuses a usage-conflicting reduction and explains the conflicts', async () => {
    const predecessorOperationId = await importPredecessor();

    const rejection = await rejectionOf(
      harness.service.importDocument(reducingDocument(predecessorOperationId)),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.details).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        conflicts: [
          { kind: 'organization-capacity', limit: 3, currentUsage: 5 },
        ],
      },
    });
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]?.supersededAt).toBeNull();
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      outcome: 'REJECTED',
      reason: 'reduction-requires-resolution',
    });
  });

  it('applies the reduction through the dedicated resolution and records the typed event', async () => {
    const predecessorOperationId = await importPredecessor();
    const document = reducingDocument(predecessorOperationId);

    const result = await harness.service.resolveReduction(
      document,
      RESOLUTION_REASON,
    );

    expect(result).toMatchObject({
      outcome: 'APPLIED',
      changed: true,
      resolvedConflicts: [
        { kind: 'organization-capacity', limit: 3, currentUsage: 5 },
      ],
    });
    expect(result.resolvedPredecessorVersionId).toBe(
      harness.stores.versions[0]?.versionId,
    );
    expect(harness.stores.versions).toHaveLength(2);
    // The predecessor stops GOVERNING at the successor's start; the superseded
    // stamp records the import instant (same as every supersession).
    expect(harness.stores.versions[0]?.supersededAt).toEqual(T0);
    expect(harness.stores.versions[0]?.governsUntil).toEqual(HANDOVER);
    // The resolution is its own typed event: the conflicts it authorized and
    // the operator's reason, written in the same transaction as the version.
    const resolved = harness.stores.auditEvents.find(
      (event) => event.eventType === 'license.import.reduction-resolved',
    );
    expect(resolved).toMatchObject({
      installationId: INSTALLATION,
      outcome: 'APPLIED',
      licenseId: LICENSE,
      versionId: harness.stores.versions[1]?.versionId,
      source: 'file',
      occurredAt: T0,
    });
    expect(resolved?.detail).toMatch(
      /resolved reduction of version .+ \[organization-capacity\]/,
    );
    expect(resolved?.detail).toMatch(/Customer confirmed the reduction/);
  });

  it('requires a validated reason (400), and writes nothing', async () => {
    const predecessorOperationId = await importPredecessor();

    for (const reason of ['', '  ', 'ab', 'R'.repeat(501)]) {
      const rejection = await rejectionOf(
        harness.service.resolveReduction(
          reducingDocument(predecessorOperationId),
          reason,
        ),
      );
      expect(rejection.status, `reason: "${reason}"`).toBe(400);
    }
    expect(harness.stores.versions).toHaveLength(1);
    expect(
      harness.stores.auditEvents.some(
        (event) => event.eventType === 'license.import.reduction-resolved',
      ),
    ).toBe(false);
  });

  it('requires the dedicated permission server-side (AR-21)', async () => {
    const predecessorOperationId = await importPredecessor();
    const forbidden = new LicenseImportService(
      configStub([AUTHORITY.publicKey]),
      {
        requireAllPermissions: async (codes: string[]): Promise<void> => {
          if (codes.includes(LICENSING_PERMISSIONS.LICENSE_RESOLVE_REDUCTION)) {
            throw AppException.forbidden();
          }
        },
      } as unknown as AuthorizationService,
      new InstallationIdentityService(
        harness.stores.installations,
        loggerStub(),
      ),
      harness.stores.licenses,
      harness.licensing,
      usageStub({ organizations: 5, activeUsers: 12 }),
      loggerStub(),
    );

    const rejection = await rejectionOf(
      forbidden.resolveReduction(
        reducingDocument(predecessorOperationId),
        RESOLUTION_REASON,
      ),
    );

    expect(rejection.status).toBe(403);
    expect(harness.stores.versions).toHaveLength(1);
  });

  it('refuses a resolution whose document does not conflict', async () => {
    const predecessorOperationId = await importPredecessor();

    const rejection = await rejectionOf(
      harness.service.resolveReduction(
        reducingDocument(predecessorOperationId, { organizationLimit: 5 }),
        RESOLUTION_REASON,
      ),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(
      /no capacity or entitlement reduction to resolve/,
    );
    expect(harness.stores.versions).toHaveLength(1);
  });

  it('refuses a legacy text code as a resolution (422)', async () => {
    const predecessorOperationId = await importPredecessor();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const legacy = signedCode({
      installationId: INSTALLATION,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      organizationLimit: 3,
      userLimit: 20,
      moduleEntitlements: ['accounting', 'documents'],
    }).code;
    vi.setSystemTime(T0);
    void predecessorOperationId;

    const rejection = await rejectionOf(
      harness.service.resolveReduction(legacy, RESOLUTION_REASON),
    );

    expect(rejection.status).toBe(422);
    expect(rejection.message).toMatch(/requires a signed license document/);
    expect(harness.stores.versions).toHaveLength(1);
    expect(
      harness.stores.auditEvents.some(
        (event) => event.eventType === 'license.import.reduction-resolved',
      ),
    ).toBe(false);
  });

  it('refuses a resolution of a document that already governs', async () => {
    const predecessorOperationId = await importPredecessor();
    const document = reducingDocument(predecessorOperationId);
    await harness.service.resolveReduction(document, RESOLUTION_REASON);
    const appliedEvents = harness.stores.auditEvents.filter(
      (event) => event.eventType === 'license.import.reduction-resolved',
    );
    expect(appliedEvents).toHaveLength(1);

    // Retrying the same document is never a second resolution.
    const rejection = await rejectionOf(
      harness.service.resolveReduction(document, RESOLUTION_REASON),
    );

    expect(rejection.status).toBe(409);
    expect(harness.stores.versions).toHaveLength(2);
    expect(
      harness.stores.auditEvents.filter(
        (event) => event.eventType === 'license.import.reduction-resolved',
      ),
    ).toHaveLength(1);
  });

  it('never resolves a closed open end (PDR-12)', async () => {
    // A perpetual grant handed over by an UNSIGNED successor (no named
    // predecessor): the open-end arm is not operator-resolvable — only an
    // explicit signed supersession may close an open end, so even the
    // dedicated resolution operation refuses.
    const perpetual = signedDocument({
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: null,
      organizationLimit: 5,
      userLimit: 20,
      moduleEntitlements: ['accounting', 'documents'],
    });
    await harness.service.importDocument(perpetual.file);

    const closing = signedDocument({
      validFrom: HANDOVER,
      validUntil: new Date('2029-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
      moduleEntitlements: ['accounting', 'documents'],
    }).file;

    const rejection = await rejectionOf(
      harness.service.resolveReduction(closing, RESOLUTION_REASON),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.details).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        conflicts: [{ kind: 'open-end-closed' }],
      },
    });
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]?.supersededAt).toBeNull();
  });

  it('a within-usage reduction applies through the ordinary import (no resolution needed)', async () => {
    // Usage (2 organizations) is within the new limit: the shrink is not a
    // conflict with current usage, so the ordinary import applies it — §8.6
    // requires a check against the resulting state, not a freeze on shrinks.
    harness = buildHarness({ usage: { organizations: 2, activeUsers: 5 } });
    const predecessorOperationId = await importPredecessor();

    const result = await harness.service.importDocument(
      reducingDocument(predecessorOperationId),
    );

    expect(result).toMatchObject({ outcome: 'APPLIED', changed: true });
    expect(harness.stores.versions).toHaveLength(2);
    expect(
      harness.stores.auditEvents.some((event) =>
        event.eventType.startsWith('license.import.reduction'),
      ),
    ).toBe(false);
  });

  it('resolves an over-quota device reduction through the existing audited flow', async () => {
    harness = buildHarness({
      usage: { organizations: 5, activeUsers: 12, registeredDevices: 3 },
    });
    const predecessor = signedDocument({
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2028-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
      deviceLimit: null,
      moduleEntitlements: ['accounting', 'documents'],
    });
    await harness.service.importDocument(predecessor.file);
    const candidate = signedDocument({
      validFrom: HANDOVER,
      validUntil: new Date('2029-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
      deviceLimit: 2,
      moduleEntitlements: ['accounting', 'documents'],
      supersedesOperationId: predecessor.payload.operationId,
    });

    const refusal = await rejectionOf(
      harness.service.importDocument(candidate.file),
    );
    const deviceConflict = {
      kind: 'device-capacity',
      limit: 2,
      currentUsage: 3,
    };
    expect(refusal.status).toBe(409);
    expect(refusal.details).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: { conflicts: [deviceConflict] },
    });
    expect(harness.stores.versions).toHaveLength(1);

    const result = await harness.service.resolveReduction(
      candidate.file,
      RESOLUTION_REASON,
    );
    expect(result).toMatchObject({
      outcome: 'APPLIED',
      resolvedConflicts: [deviceConflict],
    });
    expect(harness.stores.versions).toHaveLength(2);
    expect(
      (await harness.licensing.currentState(HANDOVER)).license,
    ).toMatchObject({
      deviceLimit: 2,
      deviceLimitSpecified: true,
    });
    expect(
      harness.stores.auditEvents.some(
        (event) => event.eventType === 'license.import.reduction-resolved',
      ),
    ).toBe(true);
  });

  it('the in-transaction usage read decides, not the read-side pre-check', async () => {
    // Usage grows between the informative pre-check (2 organizations: no
    // conflict) and the import transaction (9: conflict). The decision must
    // follow the count the transaction read after its allocation locks —
    // the read-side pass may never wave a document through.
    let organizations = 2;
    const usagePort: LicenseUsagePort = {
      snapshot: async () => ({
        organizationCount: organizations,
        activeUserCount: 5,
        registeredDeviceCount: 0,
      }),
    };
    const service = new LicenseImportService(
      configStub([AUTHORITY.publicKey]),
      authorizationStub(),
      new InstallationIdentityService(
        harness.stores.installations,
        loggerStub(),
      ),
      harness.stores.licenses,
      harness.licensing,
      usagePort,
      loggerStub(),
    );
    const predecessorOperationId = await importPredecessor();
    organizations = 9;

    const rejection = await rejectionOf(
      service.importDocument(reducingDocument(predecessorOperationId)),
    );
    expect(rejection.status).toBe(409);
    expect(rejection.details).toMatchObject({
      reduction: {
        conflicts: [
          { kind: 'organization-capacity', limit: 3, currentUsage: 9 },
        ],
      },
    });
    expect(harness.stores.versions).toHaveLength(1);

    // With an explicit resolution the same document applies — the resolution
    // authorized exactly the conflicts the transaction recomputed.
    const result = await service.resolveReduction(
      reducingDocument(predecessorOperationId),
      RESOLUTION_REASON,
    );
    expect(result).toMatchObject({
      outcome: 'APPLIED',
      resolvedConflicts: [
        { kind: 'organization-capacity', limit: 3, currentUsage: 9 },
      ],
    });
    expect(harness.stores.versions).toHaveLength(2);
  });
});

/**
 * L-05 (PDR-11 §8.6 on the renewal path): a contiguous renewal retires
 * nothing, so before this guard it was applied with no §8.6 check at all —
 * for a retained and for a changed `licenseId` alike. The mandated regression
 * coverage of the acceptance audit (§4.4.1), end to end through the service:
 * refusal with the stable 409 contract and nothing written, the authorized
 * resolution that applies without stamping the baseline, and the legacy
 * `VLIC1` adjacency renewal guarded after its own L-02 rules.
 */
describe('renewal-path reduction control (PDR-11 §8.6, L-05)', () => {
  let harness: Harness;
  const T0 = new Date('2026-06-01T00:00:00.000Z');
  const BOUNDARY = new Date('2027-01-01T00:00:00.000Z');
  const RESOLUTION_REASON =
    'Customer confirmed the renewal; headcount was reduced with it.';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    harness = buildHarness({ usage: { organizations: 9, activeUsers: 24 } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function importPredecessor(
    overrides: Partial<Parameters<typeof issueLicenseFile>[0]> = {},
  ): Promise<string> {
    const predecessor = signedDocument({
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: BOUNDARY,
      organizationLimit: 10,
      userLimit: 25,
      moduleEntitlements: ['organization', 'users'],
      ...overrides,
    });
    await harness.service.importDocument(predecessor.file);
    return predecessor.payload.operationId;
  }

  /** An adjacent signed renewal that retires nothing (no supersedes). */
  function renewal(
    overrides: Partial<Parameters<typeof issueLicenseFile>[0]> = {},
  ): string {
    return signedDocument({
      validFrom: BOUNDARY,
      validUntil: new Date('2028-01-01T00:00:00.000Z'),
      organizationLimit: 10,
      userLimit: 25,
      moduleEntitlements: ['organization', 'users'],
      ...overrides,
    }).file;
  }

  it('refuses a contiguous renewal that reduces organization capacity below counted usage (same licenseId)', async () => {
    await importPredecessor();

    const refused = signedDocument({
      validFrom: BOUNDARY,
      organizationLimit: 2,
    });
    const rejection = await rejectionOf(
      harness.service.importDocument(refused.file),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.details).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        predecessorVersionId: harness.stores.versions[0]?.versionId,
        conflicts: [
          { kind: 'organization-capacity', limit: 2, currentUsage: 9 },
        ],
      },
    });
    // Nothing was written: no version, no stamp, no applied event for the
    // refused operation, and the refused operation id is not retained (the
    // replay guard never saw it).
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.versions[0]).toMatchObject({
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      outcome: 'REJECTED',
      reason: 'reduction-requires-resolution',
    });
    expect(
      harness.stores.auditEvents.some(
        (event) =>
          event.outcome === 'APPLIED' &&
          event.operationId === refused.payload.operationId,
      ),
    ).toBe(false);
    expect(
      harness.stores.versions.find(
        (version) => version.operationId === refused.payload.operationId,
      ),
    ).toBeUndefined();
  });

  it('refuses a contiguous renewal with a changed licenseId that reduces user capacity below counted usage', async () => {
    await importPredecessor({
      licenseId: '01K7OLDLICENSE000000000000',
    });

    const rejection = await rejectionOf(
      harness.service.importDocument(
        renewal({
          licenseId: '01K7NEWLICENSE000000000000',
          userLimit: 3,
        }),
      ),
    );

    // The F-8 non-bypass evidence: a new identity must not weaken the check —
    // the baseline is still the grant the installation was on.
    expect(rejection.status).toBe(409);
    expect(rejection.details).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        predecessorVersionId: harness.stores.versions[0]?.versionId,
        conflicts: [{ kind: 'user-capacity', limit: 3, currentUsage: 24 }],
      },
    });
    expect(harness.stores.versions).toHaveLength(1);
  });

  it('refuses a contiguous renewal that removes a granted entitlement', async () => {
    await importPredecessor();

    const rejection = await rejectionOf(
      harness.service.importDocument(
        renewal({ moduleEntitlements: ['organization'] }),
      ),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.details).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        conflicts: [
          {
            kind: 'entitlement-removed',
            entitlement: { kind: 'MODULE', code: 'users' },
          },
        ],
      },
    });
    expect(harness.stores.versions).toHaveLength(1);
  });

  it('applies a renewal that stays within actual usage without any resolution', async () => {
    await importPredecessor();

    const result = await harness.service.importDocument(
      renewal({ organizationLimit: 9, userLimit: 24 }),
    );

    expect(result).toMatchObject({ outcome: 'APPLIED', changed: true });
    expect(harness.stores.versions).toHaveLength(2);
    // The renewal retires nothing and consumed no resolution: the baseline
    // keeps its window unstamped and no resolution event exists.
    expect(harness.stores.versions[0]).toMatchObject({
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });
    expect(harness.stores.versions[1]?.supersedesVersionId).toBeNull();
    expect(
      harness.stores.auditEvents.some((event) =>
        event.eventType.startsWith('license.import.reduction'),
      ),
    ).toBe(false);
  });

  it('applies a conflicting renewal through the dedicated resolution, auditing the baseline without stamping it', async () => {
    await importPredecessor();
    const document = renewal({ organizationLimit: 2 });

    const result = await harness.service.resolveReduction(
      document,
      RESOLUTION_REASON,
    );

    expect(result).toMatchObject({
      outcome: 'APPLIED',
      changed: true,
      resolvedConflicts: [
        { kind: 'organization-capacity', limit: 2, currentUsage: 9 },
      ],
    });
    // The receipt names the BASELINE — the version whose grant was measured —
    // which is retained history, not a retirement.
    expect(result.resolvedPredecessorVersionId).toBe(
      harness.stores.versions[0]?.versionId,
    );
    expect(harness.stores.versions).toHaveLength(2);
    expect(harness.stores.versions[0]).toMatchObject({
      supersededAt: null,
      governsUntil: null,
      supersededByVersionId: null,
    });
    expect(harness.stores.versions[1]?.supersedesVersionId).toBeNull();
    const resolved = harness.stores.auditEvents.find(
      (event) => event.eventType === 'license.import.reduction-resolved',
    );
    expect(resolved).toMatchObject({
      installationId: INSTALLATION,
      outcome: 'APPLIED',
      licenseId: LICENSE,
      versionId: harness.stores.versions[1]?.versionId,
      source: 'file',
      occurredAt: T0,
    });
    expect(resolved?.detail).toContain(
      `resolved reduction of version ${harness.stores.versions[0]?.versionId} [organization-capacity]`,
    );
    expect(resolved?.detail).toMatch(/Customer confirmed the renewal/);
  });

  it('refuses a resolution whose renewal does not conflict (nothing to resolve)', async () => {
    await importPredecessor();

    const rejection = await rejectionOf(
      harness.service.resolveReduction(
        renewal({ organizationLimit: 9 }),
        RESOLUTION_REASON,
      ),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.message).toMatch(
      /no capacity or entitlement reduction to resolve/,
    );
    expect(harness.stores.versions).toHaveLength(1);
    expect(
      harness.stores.auditEvents.some(
        (event) => event.eventType === 'license.import.reduction-resolved',
      ),
    ).toBe(false);
  });

  it('guards the legacy VLIC1 adjacency renewal after its L-02 rules, and the legacy transport still cannot resolve', async () => {
    // The legacy transport can only express a start that is already current
    // (`not-yet-valid` still governs it), so the adjacency lives at the
    // predecessor's own end: import the predecessor while it is active, then
    // the downgrade code that starts exactly where it ended.
    const first = signedCode({
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2026-03-01T00:00:00.000Z'),
      organizationLimit: 10,
      userLimit: 25,
    }).code;
    vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'));
    await harness.service.importDocument(first);
    vi.setSystemTime(T0);

    // The legacy adjacency renewal: starts exactly where the retained window
    // ends, retires nothing, and would cut the organization limit below the
    // counted usage.
    const downgrade = signedCode({
      validFrom: new Date('2026-03-01T00:00:00.000Z'),
      organizationLimit: 2,
      userLimit: 25,
    }).code;
    const rejection = await rejectionOf(
      harness.service.importDocument(downgrade),
    );

    expect(rejection.status).toBe(409);
    expect(rejection.details).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        predecessorVersionId: harness.stores.versions[0]?.versionId,
        conflicts: [
          { kind: 'organization-capacity', limit: 2, currentUsage: 9 },
        ],
      },
    });
    expect(harness.stores.versions).toHaveLength(1);

    // The legacy transport cannot carry the resolution (422, document-level):
    // a conflicting adjacency renewal must be re-issued as a signed document
    // through the resolution operation.
    const legacyResolution = await rejectionOf(
      harness.service.resolveReduction(downgrade, RESOLUTION_REASON),
    );
    expect(legacyResolution.status).toBe(422);
    expect(legacyResolution.details).toMatchObject({
      reason: 'resolution-requires-signed-document',
    });
    expect(harness.stores.versions).toHaveLength(1);
    expect(
      harness.stores.auditEvents.some(
        (event) => event.eventType === 'license.import.reduction-resolved',
      ),
    ).toBe(false);
  });

  it('keeps non-reducing renewals, explicit supersession, hand-over and post-gap behaviour unchanged', async () => {
    // A renewal with identical (and then larger) grants still applies.
    await importPredecessor();
    await expect(
      harness.service.importDocument(renewal()),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });
    await expect(
      harness.service.importDocument(
        renewal({
          validFrom: new Date('2028-01-01T00:00:00.000Z'),
          validUntil: new Date('2029-01-01T00:00:00.000Z'),
          organizationLimit: 12,
        }),
      ),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });
    expect(harness.stores.versions).toHaveLength(3);

    // An explicit supersession with a usage-aware reduction still explains
    // and refuses on its own path (unchanged L-04 behaviour), on a fresh
    // installation whose retained history leaves room for the overlap.
    harness = buildHarness({ usage: { organizations: 9, activeUsers: 24 } });
    const predecessorOperationId = await importPredecessor({
      licenseId: '01K7OTHERLICENSE0000000000',
    });
    const refusal = await rejectionOf(
      harness.service.importDocument(
        signedDocument({
          licenseId: '01K7OTHERLICENSE0000000000',
          validFrom: new Date('2026-06-01T00:00:00.000Z'),
          validUntil: new Date('2028-01-01T00:00:00.000Z'),
          organizationLimit: 2,
          supersedesOperationId: predecessorOperationId,
        }).file,
      ),
    );
    expect(refusal.details).toMatchObject({
      reason: 'reduction-requires-resolution',
    });
    expect(harness.stores.versions).toHaveLength(1);
  });
});

describe('stable customerCode across the license lifecycle (L-06, PDR-14)', () => {
  const NOW = new Date('2026-06-01T12:00:00.000Z');
  const OTHER_CUSTOMER = '01K7OTHERCUSTOMER000000000';
  const OTHER_CUSTOMER_CODE = 'CUST-GLOBEX-02';
  const NEW_LICENSE = '01K7RENEWEDLICENSE00000000';
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    harness = buildHarness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requires a valid, unique customerCode when creating a customer and preserves customerId/customerCode when renaming displayName', async () => {
    const created = await harness.stores.licenses.createCustomer({
      customerId: CUSTOMER,
      customerCode: CUSTOMER_CODE,
      displayName: 'Acme Holding',
      now: NOW,
    });
    expect(created).toMatchObject({
      customerId: CUSTOMER,
      customerCode: CUSTOMER_CODE,
      displayName: 'Acme Holding',
    });

    // Duplicate customerId or duplicate customerCode is rejected.
    await expect(
      harness.stores.licenses.createCustomer({
        customerId: CUSTOMER,
        customerCode: 'CUST-ANOTHER-99',
        displayName: 'Duplicate ID',
      }),
    ).rejects.toThrow(/already exists/);
    await expect(
      harness.stores.licenses.createCustomer({
        customerId: OTHER_CUSTOMER,
        customerCode: CUSTOMER_CODE,
        displayName: 'Duplicate Code',
      }),
    ).rejects.toThrow(/already exists/);

    // Invalid or customerId-equal customerCode is rejected.
    await expect(
      harness.stores.licenses.createCustomer({
        customerId: OTHER_CUSTOMER,
        customerCode: OTHER_CUSTOMER,
        displayName: 'Bad Code',
      }),
    ).rejects.toThrow(/must not equal customerId/);

    // Renaming displayName keeps customerId and customerCode unchanged.
    const renamed = await harness.stores.licenses.updateCustomerDisplayName({
      customerId: CUSTOMER,
      displayName: 'Acme Industrial Group',
      now: new Date('2026-06-02T00:00:00.000Z'),
    });
    expect(renamed.customerId).toBe(CUSTOMER);
    expect(renamed.customerCode).toBe(CUSTOMER_CODE);
    expect(renamed.displayName).toBe('Acme Industrial Group');
  });

  it('issues and imports a license for a renamed customer and preserves customerId and customerCode across a new-licenseId renewal without overwriting stored displayName', async () => {
    await harness.stores.licenses.createCustomer({
      customerId: CUSTOMER,
      customerCode: CUSTOMER_CODE,
      displayName: 'Acme Holding',
      now: NOW,
    });
    const renamed = await harness.stores.licenses.updateCustomerDisplayName({
      customerId: CUSTOMER,
      displayName: 'Acme Industrial Group',
      now: NOW,
    });

    // Issue for the renamed customer record; embeds the unchanged customerCode.
    const initial = signedDocument({
      customer: renamed,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(initial.payload.customerId).toBe(CUSTOMER);
    expect(initial.payload.customerCode).toBe(CUSTOMER_CODE);
    expect(initial.payload.customerName).toBe('Acme Industrial Group');

    const imported = await harness.service.importDocument(initial.file);
    expect(imported.outcome).toBe('APPLIED');
    expect(imported.license).toMatchObject({
      customerId: CUSTOMER,
      customerCode: CUSTOMER_CODE,
      licenseId: LICENSE,
    });

    // Importing a renewal with a new licenseId AND a different customerName in
    // the signed payload preserves customerId + customerCode AND does NOT
    // overwrite the stored customer displayName!
    const renewalWithDifferentDisplay = signedDocument({
      licenseId: NEW_LICENSE,
      customerId: CUSTOMER,
      customerCode: CUSTOMER_CODE,
      customerName: 'Unverified Label Change In Artifact',
      validFrom: new Date('2027-01-01T00:00:00.000Z'),
      validUntil: new Date('2028-01-01T00:00:00.000Z'),
    });
    const renewed = await harness.service.importDocument(
      renewalWithDifferentDisplay.file,
    );
    expect(renewed.outcome).toBe('APPLIED');
    expect(harness.stores.versions).toHaveLength(2);
    expect(harness.stores.versions[1]).toMatchObject({
      licenseId: NEW_LICENSE,
      customerId: CUSTOMER,
      customerCode: CUSTOMER_CODE,
    });
    // Stored displayName remains 'Acme Industrial Group', never overwritten by import.
    expect(harness.stores.customers.get(CUSTOMER)).toBe(
      'Acme Industrial Group',
    );
    expect(
      (await harness.stores.licenses.findCustomerById(CUSTOMER))?.displayName,
    ).toBe('Acme Industrial Group');
  });

  it('rejects missing, blank, malformed, or tampered customerCode in a signed artifact on import', async () => {
    const valid = signedArtifact({
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2027-01-01T00:00:00.000Z'),
    }).document;
    const [prefix, body, signature] = valid.split('.');
    const decoded = JSON.parse(
      Buffer.from(body!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    decoded['customerCode'] = 'CUST-TAMPERED-99';
    const tampered = [
      prefix,
      Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url'),
      signature,
    ].join('.');

    const tamperedRejection = await rejectionOf(
      harness.service.importDocument(tampered),
    );
    expect(tamperedRejection.status).toBe(422);
    expect(tamperedRejection.details).toEqual({ reason: 'signature' });
    expect(harness.stores.versions).toHaveLength(0);
  });

  it('rejects a validly signed license whose customerCode mismatches the target customer (409 customer-code-mismatch) without mutating state', async () => {
    await harness.service.importDocument(
      signedDocument({
        customerId: CUSTOMER,
        customerCode: CUSTOMER_CODE,
        customerName: 'Acme Holding',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
      }).file,
    );

    // 1. Same customerId, different customerCode -> 409 customer-code-mismatch.
    const wrongCodeForCustomer = signedDocument({
      customerId: CUSTOMER,
      customerCode: 'CUST-WRONG-99',
      validFrom: new Date('2027-01-01T00:00:00.000Z'),
      validUntil: new Date('2028-01-01T00:00:00.000Z'),
    });
    const mismatchById = await rejectionOf(
      harness.service.importDocument(wrongCodeForCustomer.file),
    );
    expect(mismatchById.status).toBe(409);
    expect(mismatchById.details).toEqual({ reason: 'customer-code-mismatch' });

    // 2. Different customerId claiming the bound customer's customerCode ->
    //    409 customer-code-mismatch on both ordinary import and transfer!
    const hijackedCodeDoc = signedDocument({
      licenseId: NEW_LICENSE,
      customerId: OTHER_CUSTOMER,
      customerCode: CUSTOMER_CODE,
      validFrom: new Date('2027-01-01T00:00:00.000Z'),
      validUntil: new Date('2028-01-01T00:00:00.000Z'),
    });
    const mismatchOnImport = await rejectionOf(
      harness.service.importDocument(hijackedCodeDoc.file),
    );
    expect(mismatchOnImport.status).toBe(409);
    expect(mismatchOnImport.details).toEqual({
      reason: 'customer-code-mismatch',
    });

    const mismatchOnTransfer = await rejectionOf(
      harness.service.transferCustomer(
        hijackedCodeDoc.file,
        'Attempted transfer reusing existing customerCode.',
      ),
    );
    expect(mismatchOnTransfer.status).toBe(409);
    expect(mismatchOnTransfer.details).toEqual({
      reason: 'customer-code-mismatch',
    });

    // Installation binding and customer records remain untouched.
    expect(harness.stores.versions).toHaveLength(1);
    expect(harness.stores.self()?.customerId).toBe(CUSTOMER);
    expect(harness.stores.customerCodes.get(CUSTOMER)).toBe(CUSTOMER_CODE);
    expect(harness.stores.customerRecords.has(OTHER_CUSTOMER)).toBe(false);
  });

  it('rejects a different customer and customerCode on ordinary import (409 installation-customer-mismatch), enforces 403 when unauthorized, and records previousCustomerCode/newCustomerCode on authorized transfer', async () => {
    await harness.service.importDocument(
      signedDocument({
        customerId: CUSTOMER,
        customerCode: CUSTOMER_CODE,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
      }).file,
    );

    const transferDoc = signedDocument({
      licenseId: NEW_LICENSE,
      customerId: OTHER_CUSTOMER,
      customerCode: OTHER_CUSTOMER_CODE,
      customerName: 'Globex Corp',
      validFrom: new Date('2027-01-01T00:00:00.000Z'),
      validUntil: new Date('2028-01-01T00:00:00.000Z'),
    });

    // Ordinary import of another customer + customerCode fails with 409 installation-customer-mismatch.
    const ordinaryRefusal = await rejectionOf(
      harness.service.importDocument(transferDoc.file),
    );
    expect(ordinaryRefusal.status).toBe(409);
    expect(ordinaryRefusal.details).toEqual({
      reason: 'installation-customer-mismatch',
    });
    expect(harness.stores.self()?.customerId).toBe(CUSTOMER);
    expect(harness.stores.customerRecords.has(OTHER_CUSTOMER)).toBe(false);

    // Unauthorized transfer attempt fails with 403.
    const unauthorizedHarness = buildHarness({
      stores: harness.stores,
      allowed: false,
    });
    const forbidden = await rejectionOf(
      unauthorizedHarness.service.transferCustomer(
        transferDoc.file,
        'Unauthorized transfer attempt.',
      ),
    );
    expect(forbidden.status).toBe(403);
    expect(harness.stores.self()?.customerId).toBe(CUSTOMER);

    // Authorized transfer moves both customerId and customerCode and writes typed audit fields.
    const transferred = await harness.service.transferCustomer(
      transferDoc.file,
      'Contract novation 2026-10-14 to Globex Corp.',
    );
    expect(transferred).toMatchObject({
      changed: true,
      outcome: 'APPLIED',
      previousCustomerId: CUSTOMER,
      previousCustomerCode: CUSTOMER_CODE,
      // The license governing at the transfer instant (PDR-14 §3.5.4), and the
      // operator reason exactly as the typed audit event recorded it.
      previousLicenseId: LICENSE,
      bindingChanged: true,
      reason: 'Contract novation 2026-10-14 to Globex Corp.',
    });
    expect(harness.stores.self()?.customerId).toBe(OTHER_CUSTOMER);
    expect(harness.stores.customerCodes.get(OTHER_CUSTOMER)).toBe(
      OTHER_CUSTOMER_CODE,
    );
    const transferEvent = harness.stores.auditEvents.find(
      (event) =>
        event.eventType === 'license.installation.customer-transferred',
    );
    expect(transferEvent).toMatchObject({
      outcome: 'APPLIED',
      previousCustomerId: CUSTOMER,
      previousCustomerCode: CUSTOMER_CODE,
      newCustomerId: OTHER_CUSTOMER,
      newCustomerCode: OTHER_CUSTOMER_CODE,
      detail: `transfer from license ${LICENSE} to ${OTHER_CUSTOMER} license ${NEW_LICENSE}: Contract novation 2026-10-14 to Globex Corp.`,
    });
  });
});
