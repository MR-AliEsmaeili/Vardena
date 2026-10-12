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
const LICENSE = '01K7LICENSE0000000000000000';

/** `issueLicenseFile` for the suite's installation, customer and license. */
function signedDocument(
  options: Partial<Parameters<typeof issueLicenseFile>[0]> = {},
  key: Parameters<typeof issueLicenseFile>[1] = AUTHORITY.privateKey,
): ReturnType<typeof issueLicenseFile> {
  return issueLicenseFile(
    {
      installationId: INSTALLATION,
      customerId: CUSTOMER,
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
  return issueLicenseDocument(
    {
      installationId: INSTALLATION,
      customerId: CUSTOMER,
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
  return issueLicenseCode(
    {
      installationId: INSTALLATION,
      customerId: CUSTOMER,
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
  options: { withIdentity?: boolean; allowed?: boolean; keys?: string[] } = {},
): Harness {
  const stores = createLicensingStores(
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
    loggerStub(),
  );
  return { stores, service, licensing, provider };
}

async function rejectionOf(
  run: Promise<unknown>,
): Promise<{ status: number; message: string; code: string }> {
  try {
    await run;
    throw new Error('expected the import to be rejected');
  } catch (error) {
    if (error instanceof AppException) {
      return {
        status: error.getStatus(),
        message: error.message,
        code: error.code,
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
  return issueLicenseFile(
    {
      installationId: INSTALLATION,
      customerId: CUSTOMER,
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

    const result = await harness.service.transferCustomer(
      transferDocument(),
      'Contract 2026-114 moved this server to Acme Industrial.',
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
      newCustomerId: OTHER_CUSTOMER,
      licenseId: OTHER_LICENSE,
      operationId: harness.stores.versions[1]?.operationId,
      versionId: harness.stores.versions[1]?.versionId,
      actorId: null,
      source: 'file',
      reason: null,
      occurredAt: expect.any(Date),
    });
    expect(transfer?.detail).toMatch(/Contract 2026-114/);
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
    expect(harness.stores.self()?.customerId).toBe(CUSTOMER);
    expect(harness.stores.versions).toHaveLength(versionsBefore);
    expect(harness.stores.auditEvents.at(-1)).toMatchObject({
      outcome: 'REJECTED',
      reason: 'transfer-not-applicable',
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
