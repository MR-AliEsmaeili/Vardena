import { describe, expect, it } from 'vitest';
import type { LicenseEntitlement, LicenseStatus } from './license.js';
import {
  continuationBaselineFor,
  covers,
  effectiveWindow,
  evaluateImportConflicts,
  findScheduledVersion,
  findVersionByOperationId,
  hasRecordedSupersession,
  isResolvableReductionConflict,
  isEligibleAt,
  isSupersededAt,
  lapsedCoverageVersion,
  lapsedLicenseContext,
  overlappingVersions,
  resolveEffectiveVersion,
  reducesCapacityOrEntitlements,
  reductionConflicts,
  sortVersionsNewestFirst,
  supersessionCeaseInstant,
  supersessionRewritesPastGovernance,
  toInstallationLicense,
  windowsOverlap,
  type RetainedLicenseVersion,
} from './license-version.js';

/**
 * Deterministic effective-version resolution (ADR-0046 Decisions 4–5, design
 * §3). The rules are pure functions of the retained rows and an instant, which
 * is what makes a future-dated renewal safe: importing it cannot deactivate
 * what currently governs, and every read agrees about which version that is.
 */

const INSTALLATION = '01K7INSTALLATION0000000000';
/** One fixed evaluation instant; nothing in this suite depends on the clock. */
const NOW = new Date('2026-06-01T00:00:00.000Z');
const LICENSE = '01K7LICENSE0000000000000000';
const CUSTOMER = '01K7CUSTOMER000000000000000';
const CUSTOMER_CODE = 'CUST-ACME-01';

let counter = 0;

function version(
  overrides: Partial<RetainedLicenseVersion> = {},
): RetainedLicenseVersion {
  counter += 1;
  const index = String(counter).padStart(4, '0');
  const customerId = overrides.customerId ?? CUSTOMER;
  const customerCode =
    overrides.customerCode ??
    (customerId === CUSTOMER
      ? CUSTOMER_CODE
      : `CUST-${customerId.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`);
  return {
    versionId: `01K7VERSION${index}0000000000`,
    licenseId: LICENSE,
    customerId,
    customerCode,
    installationId: INSTALLATION,
    operationId: `01K7OPERATION${index}00000000`,
    status: 'ACTIVE' as LicenseStatus,
    provider: 'persistent',
    documentVersion: 2,
    documentHash: `hash-${index}`,
    keyId: 'authority-2026',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null,
    organizationLimit: null,
    userLimit: null,
    deviceLimit: null,
    deviceLimitSpecified: false,
    entitlements: [
      { kind: 'MODULE', code: 'accounting' } as LicenseEntitlement,
    ],
    supersededAt: null,
    governsUntil: null,
    supersededByVersionId: null,
    supersedesVersionId: null,
    importedAt: new Date('2026-01-01T00:00:00.000Z'),
    source: 'file',
    ...overrides,
  };
}

function window(
  from: string,
  until: string | null,
): Partial<RetainedLicenseVersion> {
  return {
    validFrom: new Date(from),
    validUntil: until === null ? null : new Date(until),
  };
}

/**
 * A version retired the way the pre-correction model recorded it: the
 * supersession was recorded at `at` AND governance ended there (the successor
 * had already started). Rows migrated from L-02 keep exactly this shape, which
 * is why it stays the default here.
 */
function superseded(
  at: string,
  by: string,
  overrides: Partial<RetainedLicenseVersion> = {},
): RetainedLicenseVersion {
  return version({
    supersededAt: new Date(at),
    governsUntil: new Date(at),
    supersededByVersionId: by,
    ...overrides,
  });
}

describe('retained license versions', () => {
  it('is inclusive at the start and exclusive at the end', () => {
    const v = version(
      window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );

    expect(covers(v, new Date('2026-12-31T23:59:59.999Z'))).toBe(true);
    expect(covers(v, new Date('2027-01-01T00:00:00.000Z'))).toBe(false);
    expect(covers(v, new Date('2025-12-31T23:59:59.999Z'))).toBe(false);
  });

  it('treats adjacency as no overlap and an open end as overlap', () => {
    const first = version(
      window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );
    const renewal = version(
      window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
    );
    const perpetual = version(window('2026-06-01T00:00:00.000Z', null));

    expect(windowsOverlap(first, renewal)).toBe(false);
    expect(windowsOverlap(first, perpetual)).toBe(true);
    expect(
      overlappingVersions(renewal, [first, perpetual]).map((v) => v.versionId),
    ).toEqual([perpetual.versionId]);
  });

  it('counts a retired version by the window it really governed', () => {
    // OQ-86 Option C (2026-10-12): a version retired in June governed
    // [January, June). A candidate that lands later is not an overlap — its
    // retained tail cannot block a legitimate renewal…
    const retired = superseded(
      '2026-06-01T00:00:00.000Z',
      '01K7LATER0000000000000000',
      window('2026-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
    );
    expect(
      overlappingVersions(
        version(window('2027-01-01T00:00:00.000Z', '2029-01-01T00:00:00.000Z')),
        [retired],
      ),
    ).toEqual([]);

    // …but a candidate that lands INSIDE that window is one: retired history
    // counts, which is exactly what the previous rule did not do.
    expect(
      overlappingVersions(
        version(window('2026-03-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z')),
        [retired],
      ).map((v) => v.versionId),
    ).toEqual([retired.versionId]);
  });

  it('resolves the single covering version as effective', () => {
    const v = version(
      window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );

    expect(
      resolveEffectiveVersion([v], new Date('2026-06-01T00:00:00.000Z')),
    ).toEqual({
      kind: 'effective',
      version: v,
    });
  });

  it('reports an expired version when nothing covers the instant', () => {
    const old = version(
      window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );

    const resolution = resolveEffectiveVersion(
      [old],
      new Date('2027-03-01T00:00:00.000Z'),
    );

    expect(resolution.kind).toBe('inactive');
    if (resolution.kind !== 'inactive') throw new Error('unreachable');
    expect(resolution.reason).toBe('expired');
    expect(resolution.version.versionId).toBe(old.versionId);
  });

  it('reports the latest-ended version when several ended', () => {
    const older = version(
      window('2024-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
    );
    const newer = version(
      window('2025-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    );

    const resolution = resolveEffectiveVersion(
      [older, newer],
      new Date('2026-06-01T00:00:00.000Z'),
    );

    expect(resolution.version?.versionId).toBe(newer.versionId);
    expect(resolution.kind === 'inactive' && resolution.reason).toBe('expired');
  });

  it('reports a not-yet-valid version only when nothing else covers or ended', () => {
    const renewal = version(
      window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
    );

    const resolution = resolveEffectiveVersion(
      [renewal],
      new Date('2026-06-01T00:00:00.000Z'),
    );

    expect(resolution.kind === 'inactive' && resolution.reason).toBe(
      'not-yet-valid',
    );
    expect(resolution.version?.versionId).toBe(renewal.versionId);
  });

  it('keeps a subscription ended while a renewal is scheduled (gap)', () => {
    const ended = version(
      window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );
    const upcoming = version(
      window('2027-06-01T00:00:00.000Z', '2028-06-01T00:00:00.000Z'),
    );

    const at = new Date('2027-03-01T00:00:00.000Z');
    const resolution = resolveEffectiveVersion([ended, upcoming], at);

    expect(resolution.kind === 'inactive' && resolution.reason).toBe('expired');
    expect(resolution.version?.versionId).toBe(ended.versionId);
    expect(findScheduledVersion([ended, upcoming], at)?.versionId).toBe(
      upcoming.versionId,
    );
  });

  it('reports a non-ACTIVE covering version as a status inactivity', () => {
    const suspended = version({
      status: 'SUSPENDED',
      ...window('2026-01-01T00:00:00.000Z', null),
    });

    const resolution = resolveEffectiveVersion(
      [suspended],
      new Date('2026-06-01T00:00:00.000Z'),
    );

    expect(resolution.kind === 'inactive' && resolution.reason).toBe('status');
  });

  it('ignores superseded versions entirely', () => {
    const retired = superseded(
      '2026-02-01T00:00:00.000Z',
      '01K7LATER0000000000000000',
      window('2026-01-01T00:00:00.000Z', null),
    );

    expect(
      resolveEffectiveVersion([retired], new Date('2026-06-01T00:00:00.000Z')),
    ).toEqual({
      kind: 'none',
      version: null,
    });
  });

  it('is UNLICENSED only when nothing is retained', () => {
    expect(resolveEffectiveVersion([], new Date())).toEqual({
      kind: 'none',
      version: null,
    });
  });

  it('resolves overlapping data deterministically and flags it as ambiguous', () => {
    const later = version({
      ...window('2026-03-01T00:00:00.000Z', null),
      importedAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    const earlier = version({
      ...window('2026-01-01T00:00:00.000Z', null),
      importedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const resolution = resolveEffectiveVersion(
      [earlier, later],
      new Date('2026-06-01T00:00:00.000Z'),
    );

    expect(resolution.kind).toBe('ambiguous');
    // Deterministic: the latest start wins, then the latest import, then the id.
    expect(resolution.version?.versionId).toBe(later.versionId);
    if (resolution.kind !== 'ambiguous') throw new Error('unreachable');
    expect(resolution.covering.map((v) => v.versionId).sort()).toEqual(
      [earlier.versionId, later.versionId].sort(),
    );
  });

  it('prefers the later import when two covering versions start together', () => {
    const first = version({
      ...window('2026-01-01T00:00:00.000Z', null),
      importedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const second = version({
      ...window('2026-01-01T00:00:00.000Z', null),
      importedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const resolution = resolveEffectiveVersion(
      [first, second],
      new Date('2026-06-01T00:00:00.000Z'),
    );

    expect(resolution.kind).toBe('ambiguous');
    expect(resolution.version?.versionId).toBe(second.versionId);
  });

  it('finds versions by operation id and sorts newest first', () => {
    const old = version(
      window('2024-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
    );
    const current = version(window('2025-01-01T00:00:00.000Z', null));

    expect(findVersionByOperationId([old, current], current.operationId)).toBe(
      current,
    );
    expect(findVersionByOperationId([old, current], 'missing')).toBeNull();
    expect(
      sortVersionsNewestFirst([old, current]).map((v) => v.versionId),
    ).toEqual([current.versionId, old.versionId]);
  });

  it('projects a retained version onto the evaluated license shape', () => {
    const v = version({
      organizationLimit: 4,
      userLimit: 30,
      ...window('2026-01-01T00:00:00.000Z', null),
    });

    expect(toInstallationLicense(v, 'persistent')).toMatchObject({
      customerId: CUSTOMER,
      installationId: INSTALLATION,
      licenseId: LICENSE,
      status: 'ACTIVE',
      organizationLimit: 4,
      userLimit: 30,
      provider: 'persistent',
    });
  });
});

describe('supersession is recorded once and governs from the successor start', () => {
  it('keeps a version eligible while its supersession is future-dated', () => {
    const predecessor = version({
      ...window('2026-01-01T00:00:00.000Z', null),
      supersededAt: new Date('2026-05-01T00:00:00.000Z'),
      governsUntil: new Date('2027-01-01T00:00:00.000Z'),
      supersededByVersionId: '01K7SUCCESSOR0000000000000',
    });

    expect(hasRecordedSupersession(predecessor)).toBe(true);
    expect(
      isSupersededAt(predecessor, new Date('2026-12-31T00:00:00.000Z')),
    ).toBe(false);
    expect(
      isEligibleAt(predecessor, new Date('2026-12-31T00:00:00.000Z')),
    ).toBe(true);
    // At the successor's own start the hand-over is exact.
    expect(
      isSupersededAt(predecessor, new Date('2027-01-01T00:00:00.000Z')),
    ).toBe(true);
  });

  it('ends the predecessor exactly at the successor validFrom', () => {
    const successor = version(
      window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
    );
    const predecessor = version(window('2026-01-01T00:00:00.000Z', null));

    expect(supersessionCeaseInstant(successor)).toEqual(successor.validFrom);
    expect(
      effectiveWindow({ ...predecessor, governsUntil: successor.validFrom }),
    ).toEqual({
      start: predecessor.validFrom,
      end: successor.validFrom,
    });
  });

  it('governs the old version before, and the successor at, the hand-over', () => {
    const predecessor = version({
      ...window('2026-01-01T00:00:00.000Z', null),
      supersededAt: new Date('2026-05-01T00:00:00.000Z'),
      governsUntil: new Date('2027-01-01T00:00:00.000Z'),
      supersededByVersionId: '01K7SUCCESSOR0000000000000',
    });
    const successor = version(
      window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
    );
    const versions = [predecessor, successor];

    expect(
      resolveEffectiveVersion(versions, new Date('2026-06-01T00:00:00.000Z'))
        .version?.versionId,
    ).toBe(predecessor.versionId);
    expect(
      resolveEffectiveVersion(versions, new Date('2027-01-01T00:00:00.000Z'))
        .version?.versionId,
    ).toBe(successor.versionId);
    expect(
      resolveEffectiveVersion(versions, new Date('2027-06-01T00:00:00.000Z'))
        .version?.versionId,
    ).toBe(successor.versionId);
    // Exactly one version governs every instant: no ambiguity, no gap.
    for (const instant of [
      '2026-01-01T00:00:00.000Z',
      '2026-12-31T23:59:59.999Z',
      '2027-01-01T00:00:00.000Z',
      '2027-12-31T23:59:59.999Z',
    ]) {
      const resolution = resolveEffectiveVersion(versions, new Date(instant));
      expect(resolution.kind).toBe('effective');
      expect(resolution.version?.versionId).toBe(
        instant < '2027-01-01T00:00:00.000Z'
          ? predecessor.versionId
          : successor.versionId,
      );
    }
  });

  it('treats an empty effective window as intersecting nothing', () => {
    // A legacy replacement can retire a version before its own validFrom; its
    // effective window is empty, and an empty window must not block a renewal.
    const zeroed = version({
      ...window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
      supersededAt: new Date('2026-06-01T00:00:00.000Z'),
      governsUntil: new Date('2026-05-01T00:00:00.000Z'),
      supersededByVersionId: '01K7SUCCESSOR0000000000000',
    });
    const candidate = version(
      window('2026-05-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );

    expect(overlappingVersions(candidate, [zeroed])).toEqual([]);
  });
});

describe('import conflict evaluation', () => {
  function evaluate(
    candidate: Partial<RetainedLicenseVersion>,
    overrides: Partial<Parameters<typeof evaluateImportConflicts>[0]> = {},
  ): ReturnType<typeof evaluateImportConflicts> {
    const full = version(candidate);
    return evaluateImportConflicts({
      candidate: full,
      operationId: full.operationId,
      documentHash: full.documentHash,
      supersession: { kind: 'none' },
      versions: [],
      at: NOW,
      ...overrides,
    });
  }

  it('accepts a signed document that overlaps nothing', () => {
    const existing = version(
      window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );
    const result = evaluate(
      window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
      { versions: [existing] },
    );

    expect(result.conflict).toBeNull();
    expect(result.supersedes).toBeNull();
  });

  it('refuses a renewal that re-binds the license to another customer', () => {
    // PDR-11 §2.1: a license is bound to one customer. A renewal naming the same
    // license identifier for a different customer would silently re-attribute
    // every retained version, so it is refused even when it would not overlap.
    const existing = version(
      window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );
    const result = evaluate(
      {
        ...window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
        customerId: '01K7OTHERCUSTOMER0000000000',
      },
      { versions: [existing] },
    );

    expect(result.conflict).toEqual({
      reason: 'license-binding-conflict',
      overlapping: 0,
    });
    expect(result.supersedes).toBeNull();
  });

  it('does not let an explicit supersession re-bind the customer', () => {
    const existing = version(window('2026-01-01T00:00:00.000Z', null));
    const result = evaluate(
      {
        ...window('2027-01-01T00:00:00.000Z', null),
        customerId: '01K7OTHERCUSTOMER0000000000',
      },
      {
        versions: [existing],
        supersession: { kind: 'explicit', operationId: existing.operationId },
      },
    );

    expect(result.conflict?.reason).toBe('license-binding-conflict');
    expect(result.supersedes).toBeNull();
  });

  it('keeps a same-customer renewal of the same license importable', () => {
    const existing = version(
      window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );
    const result = evaluate(
      window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
      { versions: [existing] },
    );

    expect(result.conflict).toBeNull();
  });

  it('hands over to a later-starting version under the precedence rule (OQ-80 Option B)', () => {
    const existing = version(
      window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );
    const result = evaluate(
      window('2026-07-01T00:00:00.000Z', '2027-07-01T00:00:00.000Z'),
      { versions: [existing] },
    );

    // No explicit supersession: the later start governs from its own
    // `validFrom`, and the evaluation names the version it takes over so the
    // transaction can stamp and audit the hand-over.
    expect(result.conflict).toBeNull();
    expect(result.supersedes?.versionId).toBe(existing.versionId);
  });

  it('refuses an overlap that starts no later than the version it would take over', () => {
    const existing = version(window('2026-01-01T00:00:00.000Z', null));
    const result = evaluate(window('2026-01-01T00:00:00.000Z', null), {
      versions: [existing],
    });

    expect(result.conflict).toEqual({
      reason: 'overlapping-range',
      overlapping: 1,
    });
    expect(result.supersedes).toBeNull();
  });

  it('refuses an ambiguous overlap of more than one retained version', () => {
    const first = version(
      window('2026-01-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
    );
    const second = version(
      window('2026-09-01T00:00:00.000Z', '2027-09-01T00:00:00.000Z'),
    );
    const result = evaluate(
      window('2026-06-01T00:00:00.000Z', '2027-06-01T00:00:00.000Z'),
      { versions: [first, second] },
    );

    // Two hand-overs from one document is not a precedence question: it is
    // refused rather than guessed.
    expect(result.conflict).toEqual({
      reason: 'overlapping-range',
      overlapping: 2,
    });
    expect(result.supersedes).toBeNull();
  });

  /**
   * The three ways one import can retire a retained version: the implicit
   * hand-over of OQ-80 Option B (a signed document that starts later), an
   * explicit signed `supersedesOperationId`, and the legacy `VLIC1`
   * replacement. The PDR-11 §8.6 capacity/entitlement guard must be the same
   * for all three — naming the version to retire proves WHICH version the
   * document replaces, and proves nothing about the capacity or entitlement
   * conflict the reduction creates.
   */
  function precedencePaths(
    predecessor: RetainedLicenseVersion,
  ): Array<[string, Partial<Parameters<typeof evaluateImportConflicts>[0]>]> {
    return [
      ['implicit precedence', { supersession: { kind: 'none' } }],
      [
        'explicit supersession',
        {
          supersession: {
            kind: 'explicit',
            operationId: predecessor.operationId,
          },
        },
      ],
      ['legacy VLIC1 replacement', { supersession: { kind: 'implicit' } }],
    ];
  }

  it('checks signed device quota reductions against retained active usage and fails closed', () => {
    const unlimited = version({
      deviceLimit: null,
      deviceLimitSpecified: true,
    });
    const finite = version({
      deviceLimit: 2,
      deviceLimitSpecified: true,
    });
    const removed = version({
      deviceLimit: null,
      deviceLimitSpecified: false,
    });

    expect(reducesCapacityOrEntitlements(unlimited, finite)).toBe(true);
    expect(
      reductionConflicts(unlimited, finite, {
        organizationCount: 0,
        activeUserCount: 0,
        registeredDeviceCount: 3,
      }),
    ).toEqual([{ kind: 'device-capacity', limit: 2, currentUsage: 3 }]);
    expect(
      isResolvableReductionConflict({
        kind: 'device-capacity',
        limit: 2,
        currentUsage: 3,
      }),
    ).toBe(true);
    expect(
      isResolvableReductionConflict({
        kind: 'device-entitlement-removed',
        currentUsage: 1,
      }),
    ).toBe(true);
    expect(
      reductionConflicts(unlimited, finite, {
        organizationCount: 0,
        activeUserCount: 0,
        registeredDeviceCount: null,
      }),
    ).toEqual([{ kind: 'usage-unavailable', scope: 'devices' }]);
    expect(
      reductionConflicts(unlimited, finite, {
        organizationCount: 0,
        activeUserCount: 0,
        registeredDeviceCount: 2,
      }),
    ).toEqual([]);
    expect(
      reductionConflicts(unlimited, removed, {
        organizationCount: 0,
        activeUserCount: 0,
        registeredDeviceCount: 1,
      }),
    ).toEqual([{ kind: 'device-entitlement-removed', currentUsage: 1 }]);
  });

  it.each([
    ['organizationLimit', { organizationLimit: 4 }],
    ['userLimit', { userLimit: 19 }],
    ['an entitlement', { entitlements: [] as LicenseEntitlement[] }],
  ] as const)(
    'refuses a reduction in %s on every path that retires a version (PDR-11 §8.6)',
    (_what, shrink) => {
      const predecessor = version({
        ...window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
        organizationLimit: 5,
        userLimit: 20,
      });
      const candidate = {
        ...window('2026-07-01T00:00:00.000Z', '2027-07-01T00:00:00.000Z'),
        organizationLimit: 5,
        userLimit: 20,
        ...shrink,
      };
      // §8.6 is a conflict with CURRENT USAGE: give the evaluation usage well
      // above the shrunk limits so the refusal is the capacity/entitlement
      // conflict itself, not the fail-closed absence of a count.
      const usage = {
        organizationCount: 9,
        activeUserCount: 99,
        registeredDeviceCount: 0,
      };

      for (const [path, overrides] of precedencePaths(predecessor)) {
        const result = evaluate(candidate, {
          versions: [predecessor],
          usage,
          ...overrides,
        });

        expect(result.conflict, path).toMatchObject({
          reason: 'reduction-requires-resolution',
          overlapping: 1,
        });
        // The refusal EXPLAINS the conflict it preserves: which version would
        // be reduced and the concrete conflict (L-04 explain contract). A
        // removed entitlement is a conflict with the retained grant itself; a
        // shrunk limit is a conflict with the counted usage.
        expect(result.conflict, path).toMatchObject({
          reduction:
            _what === 'an entitlement'
              ? {
                  predecessorVersionId: predecessor.versionId,
                  conflicts: [
                    {
                      kind: 'entitlement-removed',
                      entitlement: { kind: 'MODULE', code: 'accounting' },
                    },
                  ],
                }
              : _what === 'organizationLimit'
                ? {
                    predecessorVersionId: predecessor.versionId,
                    conflicts: [
                      {
                        kind: 'organization-capacity',
                        limit: 4,
                        currentUsage: 9,
                      },
                    ],
                  }
                : {
                    predecessorVersionId: predecessor.versionId,
                    conflicts: [
                      { kind: 'user-capacity', limit: 19, currentUsage: 99 },
                    ],
                  },
        });
        // Nothing is retired: a refused import may not have taken the
        // predecessor over on any path.
        expect(result.supersedes, path).toBeNull();
      }
    },
  );

  it('refuses a mixed change that grows capacity but removes an entitlement (OD-LIC-01)', () => {
    const predecessor = version({
      ...window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
      entitlements: [
        { kind: 'MODULE', code: 'accounting' } as LicenseEntitlement,
        { kind: 'MODULE', code: 'documents' } as LicenseEntitlement,
      ],
    });

    // Every dimension is evaluated on its own: a bigger organization limit and
    // a bigger user limit do not pay for a module the predecessor had, so the
    // whole document is refused and nothing is retired — even though the
    // document explicitly names the version it supersedes. Usage is far below
    // the grown limits, so the ONLY conflict is the removed entitlement: the
    // retained grant is a conflict class of its own (L-04).
    const result = evaluate(
      {
        ...window('2026-07-01T00:00:00.000Z', '2027-07-01T00:00:00.000Z'),
        organizationLimit: 9,
        userLimit: 40,
        entitlements: [
          { kind: 'MODULE', code: 'accounting' } as LicenseEntitlement,
        ],
      },
      {
        versions: [predecessor],
        usage: {
          organizationCount: 1,
          activeUserCount: 1,
          registeredDeviceCount: 0,
        },
        supersession: {
          kind: 'explicit',
          operationId: predecessor.operationId,
        },
      },
    );

    expect(result.conflict).toEqual({
      reason: 'reduction-requires-resolution',
      overlapping: 1,
      reduction: {
        predecessorVersionId: predecessor.versionId,
        conflicts: [
          {
            kind: 'entitlement-removed',
            entitlement: { kind: 'MODULE', code: 'documents' },
          },
        ],
      },
    });
    expect(result.supersedes).toBeNull();
  });

  it('refuses a partial reduction even when another limit grows', () => {
    const predecessor = version({
      ...window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
    });

    // A larger organization limit does not pay for a smaller user limit: the
    // reduction is evaluated per dimension, not on a net total. Usage sits
    // between the two limits (3 < 6 organizations, 25 > 19 users), so the
    // only conflict is the user dimension — with the concrete numbers (L-04).
    const result = evaluate(
      {
        ...window('2026-07-01T00:00:00.000Z', '2027-07-01T00:00:00.000Z'),
        organizationLimit: 6,
        userLimit: 19,
      },
      {
        versions: [predecessor],
        usage: {
          organizationCount: 3,
          activeUserCount: 25,
          registeredDeviceCount: 0,
        },
        supersession: {
          kind: 'explicit',
          operationId: predecessor.operationId,
        },
      },
    );

    expect(result.conflict).toEqual({
      reason: 'reduction-requires-resolution',
      overlapping: 1,
      reduction: {
        predecessorVersionId: predecessor.versionId,
        conflicts: [{ kind: 'user-capacity', limit: 19, currentUsage: 25 }],
      },
    });
    expect(result.supersedes).toBeNull();
  });

  it('checks a shrunk limit against counted usage on every path (L-04)', () => {
    const predecessor = version({
      ...window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
    });
    const shrunk = {
      ...window('2026-07-01T00:00:00.000Z', '2027-07-01T00:00:00.000Z'),
      organizationLimit: 4,
      userLimit: 20,
    };

    for (const [path, overrides] of precedencePaths(predecessor)) {
      // Current usage is WITHIN the new limit: the shrink is not a conflict
      // with current usage, so it applies without any resolution (PDR-11 §8.6
      // — the Must is a check against the resulting state, not a freeze).
      const within = evaluate(shrunk, {
        versions: [predecessor],
        usage: {
          organizationCount: 4,
          activeUserCount: 20,
          registeredDeviceCount: 0,
        },
        ...overrides,
      });
      expect(within.conflict, `within: ${path}`).toBeNull();
      expect(within.supersedes?.versionId, `within: ${path}`).toBe(
        predecessor.versionId,
      );

      // One more organization than the new limit allows: a concrete conflict,
      // explained with the limit and the counted usage.
      const beyond = evaluate(shrunk, {
        versions: [predecessor],
        usage: {
          organizationCount: 5,
          activeUserCount: 20,
          registeredDeviceCount: 0,
        },
        ...overrides,
      });
      expect(beyond.conflict, `beyond: ${path}`).toMatchObject({
        reason: 'reduction-requires-resolution',
        reduction: {
          predecessorVersionId: predecessor.versionId,
          conflicts: [
            { kind: 'organization-capacity', limit: 4, currentUsage: 5 },
          ],
        },
      });
      expect(beyond.supersedes, `beyond: ${path}`).toBeNull();

      // The count is unavailable: fail closed — the shrink is refused as a
      // conflict whose explain payload says WHICH count was unavailable,
      // never as an unnoticed accept. (The shrunk dimension here is the user
      // limit, so the missing active-user count is what fails closed.)
      const unknown = evaluate(
        { ...shrunk, userLimit: 19 },
        {
          versions: [predecessor],
          usage: {
            organizationCount: 4,
            activeUserCount: null,
            registeredDeviceCount: 0,
          },
          ...overrides,
        },
      );
      expect(unknown.conflict, `unknown: ${path}`).toMatchObject({
        reason: 'reduction-requires-resolution',
        reduction: {
          predecessorVersionId: predecessor.versionId,
          conflicts: [{ kind: 'usage-unavailable', scope: 'active-users' }],
        },
      });

      // No count was supplied at all (a caller that cannot reach the usage
      // port): the same fail-closed decision, for every dimension.
      const absent = evaluate(shrunk, {
        versions: [predecessor],
        ...overrides,
      });
      expect(absent.conflict, `absent: ${path}`).toMatchObject({
        reason: 'reduction-requires-resolution',
        reduction: {
          predecessorVersionId: predecessor.versionId,
          conflicts: [{ kind: 'usage-unavailable', scope: 'organizations' }],
        },
      });
    }
  });

  it('still applies a hand-over that keeps or grows the retained grant, on every path', () => {
    const predecessor = version({
      ...window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
    });
    const keeping: Array<[string, Partial<RetainedLicenseVersion>]> = [
      ['identical limits', { organizationLimit: 5, userLimit: 20 }],
      ['a larger organization limit', { organizationLimit: 9, userLimit: 20 }],
      [
        'an additional entitlement',
        {
          organizationLimit: 5,
          userLimit: 20,
          entitlements: [
            { kind: 'MODULE', code: 'accounting' } as LicenseEntitlement,
            { kind: 'MODULE', code: 'documents' } as LicenseEntitlement,
          ],
        },
      ],
    ];

    for (const [grant, limits] of keeping) {
      for (const [path, overrides] of precedencePaths(predecessor)) {
        const result = evaluate(
          {
            ...window('2026-07-01T00:00:00.000Z', '2027-07-01T00:00:00.000Z'),
            ...limits,
          },
          { versions: [predecessor], ...overrides },
        );

        expect(result.conflict, `${path}: ${grant}`).toBeNull();
        expect(result.supersedes?.versionId, `${path}: ${grant}`).toBe(
          predecessor.versionId,
        );
      }
    }
  });

  it('lets an explicit signed supersession change the term, and treats an open end as a reduction where nobody is named (OD-LIC-01)', () => {
    const perpetual = version({
      ...window('2026-01-01T00:00:00.000Z', null),
      organizationLimit: 5,
      userLimit: 20,
    });
    const closing = {
      ...window('2026-07-01T00:00:00.000Z', '2027-07-01T00:00:00.000Z'),
      organizationLimit: 5,
      userLimit: 20,
    };

    // The retirement itself is not named by the document here, so ending an
    // open end is a reduction of the retained grant and fails closed. The
    // explain payload names the open-end conflict — which NO operator
    // resolution may authorize (PDR-12: only an explicit signed supersession
    // may close an open end).
    for (const [path, overrides] of [
      ['implicit precedence', { supersession: { kind: 'none' as const } }],
      [
        'legacy VLIC1 replacement',
        { supersession: { kind: 'implicit' as const } },
      ],
    ] as const) {
      const result = evaluate(closing, {
        versions: [perpetual],
        ...overrides,
      });

      expect(result.conflict, path).toEqual({
        reason: 'reduction-requires-resolution',
        overlapping: 1,
        reduction: {
          predecessorVersionId: perpetual.versionId,
          conflicts: [{ kind: 'open-end-closed' }],
        },
      });
      expect(result.supersedes, path).toBeNull();
    }

    // A signed supersession that names the version it retires may make exactly
    // this change — the Product Owner's final decision of 2026-10-12
    // (OD-LIC-01, PDR-12): the document states, for a NAMED version, until when
    // the license now runs, which is the explicit, auditable instruction §12.9
    // asks for, and it touches no capacity or entitlement. It is accepted with
    // the same grant and with a larger one.
    for (const [grant, limits] of [
      ['unchanged limits', { organizationLimit: 5, userLimit: 20 }],
      ['increased limits', { organizationLimit: 9, userLimit: 40 }],
    ] as const) {
      const signed = evaluate(
        { ...closing, ...limits },
        {
          versions: [perpetual],
          supersession: {
            kind: 'explicit',
            operationId: perpetual.operationId,
          },
        },
      );

      expect(signed.conflict, grant).toBeNull();
      expect(signed.supersedes?.versionId, grant).toBe(perpetual.versionId);
    }

    // The exception is the term only: on the SAME path a capacity reduction is
    // still refused when current usage exceeds the new limit, so naming the
    // version does not buy a smaller grant.
    const reduced = evaluate(
      { ...closing, organizationLimit: 4, userLimit: 20 },
      {
        versions: [perpetual],
        usage: {
          organizationCount: 5,
          activeUserCount: 20,
          registeredDeviceCount: 0,
        },
        supersession: { kind: 'explicit', operationId: perpetual.operationId },
      },
    );
    expect(reduced.conflict).toEqual({
      reason: 'reduction-requires-resolution',
      overlapping: 1,
      reduction: {
        predecessorVersionId: perpetual.versionId,
        conflicts: [
          { kind: 'organization-capacity', limit: 4, currentUsage: 5 },
        ],
      },
    });
    expect(reduced.supersedes).toBeNull();

    // Keeping the open end is not a reduction on any path.
    for (const [path, overrides] of precedencePaths(perpetual)) {
      const result = evaluate(
        {
          ...window('2026-07-01T00:00:00.000Z', null),
          organizationLimit: 5,
          userLimit: 20,
        },
        { versions: [perpetual], ...overrides },
      );

      expect(result.conflict, path).toBeNull();
      expect(result.supersedes?.versionId, path).toBe(perpetual.versionId);
    }
  });

  it('refuses a renewal that leaves a gap, and allows adjacency (OQ-80 G2)', () => {
    const first = version(
      window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );

    // Adjacency is contiguity, not a gap.
    expect(
      evaluate(window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'), {
        versions: [first],
      }).conflict,
    ).toBeNull();

    // One millisecond of lapse is already a gap.
    expect(
      evaluate(window('2027-01-01T00:00:00.001Z', '2028-01-01T00:00:00.000Z'), {
        versions: [first],
      }).conflict,
    ).toEqual({ reason: 'renewal-gap', overlapping: 0 });

    // A perpetual version never leaves coverage, so no renewal can be late —
    // as long as the renewal keeps the grant perpetual too (a time-limited
    // successor would be refused by the §8.6 guard instead, never by the gap
    // rule).
    const perpetual = version(window('2026-01-01T00:00:00.000Z', null));
    expect(
      evaluate(window('2030-01-01T00:00:00.000Z', null), {
        versions: [perpetual],
      }).conflict,
    ).toBeNull();
  });

  it('only treats a candidate carrying a retained license id as a renewal', () => {
    const first = version(
      window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );

    // Same license identifier: the lapse is a gap and is refused.
    expect(
      evaluate(window('2028-01-01T00:00:00.000Z', '2029-01-01T00:00:00.000Z'), {
        versions: [first],
      }).conflict?.reason,
    ).toBe('renewal-gap');

    // Another license identifier: this is not a renewal of the retained one.
    // The candidate starts AFTER the retained coverage has ended, so it is a
    // post-gap recovery candidate — and since the Owner decision of
    // 2026-10-12 (OQ-87 Option B, PDR-13) the ordinary import is NOT a
    // permitted post-gap recovery path: refused with a stable 409 that points
    // at the dedicated, permission-gated recovery operation.
    expect(
      evaluate(
        {
          ...window('2028-01-01T00:00:00.000Z', '2029-01-01T00:00:00.000Z'),
          licenseId: '01K7ANOTHERLICENSE000000000',
        },
        { versions: [first] },
      ).conflict,
    ).toEqual({
      reason: 'post-gap-recovery-requires-dedicated-operation',
      overlapping: 0,
    });

    // While coverage has NOT ended, a new identity is an ordinary import (the
    // overlap rules decide); no recovery intent is involved.
    expect(
      evaluate(
        {
          ...window('2026-07-01T00:00:00.000Z', '2029-01-01T00:00:00.000Z'),
          licenseId: '01K7ANOTHERLICENSE000000000',
        },
        { versions: [first] },
      ).conflict,
    ).toBeNull();
  });

  it('never lets a document change the installation customer without an explicit transfer', () => {
    const existing = version(
      window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );
    const other = {
      ...window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
      // Another customer always means another license: a license identifier is
      // bound to one customer (a renewal that renames it is refused as
      // `license-binding-conflict`, which is a different refusal).
      licenseId: '01K7ANOTHERLICENSE000000000',
      customerId: '01K7OTHERCUSTOMER0000000000',
    };

    // The installation is bound to CUSTOMER; this document names another one
    // and carries no transfer intent: refused, whatever else it would do.
    const mismatch = evaluate(other, {
      versions: [existing],
      installationCustomerId: CUSTOMER,
    });
    expect(mismatch.conflict).toEqual({
      reason: 'installation-customer-mismatch',
      overlapping: 0,
    });
    expect(mismatch.supersedes).toBeNull();

    // With the authorized transfer intent it is allowed …
    const transfer = evaluate(other, {
      versions: [existing],
      installationCustomerId: CUSTOMER,
      customerTransfer: { reason: 'Contract moved to another legal entity.' },
    });
    expect(transfer.conflict).toBeNull();

    // … and a transfer that would change nothing is refused instead of being
    // re-applied.
    expect(
      evaluate(window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'), {
        versions: [existing],
        installationCustomerId: CUSTOMER,
        customerTransfer: { reason: 'Repeating the same transfer.' },
      }).conflict,
    ).toEqual({
      reason: 'transfer-requires-different-customer',
      overlapping: 0,
    });
  });

  it('refuses a document that lands inside the effective window of a retired version (OQ-86 Option C)', () => {
    const retired = version({
      ...window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
      supersededAt: new Date('2026-06-01T00:00:00.000Z'),
      governsUntil: new Date('2026-06-01T00:00:00.000Z'),
      supersededByVersionId: '01K7SUCCESSOR0000000000000',
    });

    // Inside the window it really governed: refused.
    expect(
      evaluate(window('2026-03-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'), {
        versions: [retired],
      }).conflict,
    ).toEqual({ reason: 'overlapping-range', overlapping: 1 });

    // In its retained tail (after the hand-over): no historical governance is
    // touched, so the overlap rules do not refuse it. But the candidate is a
    // NEW identity that starts after the last governance this history can
    // prove ended (the retired version's hand-over instant), so the OQ-87
    // decision (Option B, PDR-13) applies: the ordinary import is not a
    // post-gap recovery path — the dedicated recovery operation is.
    expect(
      evaluate(
        {
          ...window('2026-10-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
          licenseId: '01K7ANOTHERLICENSE000000000',
        },
        { versions: [retired] },
      ).conflict,
    ).toEqual({
      reason: 'post-gap-recovery-requires-dedicated-operation',
      overlapping: 0,
    });

    // The retained tail still protects a SAME-license successor from being an
    // ordinary import too: a renewal that starts after the hand-over has
    // already left a governance gap, which OQ-80 G2 refuses.
    expect(
      evaluate(window('2026-10-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'), {
        versions: [retired],
      }).conflict?.reason,
    ).toBe('renewal-gap');
  });

  it('resolves an explicit signed supersession by operation id', () => {
    const existing = version(window('2026-01-01T00:00:00.000Z', null));
    const result = evaluate(window('2026-06-01T00:00:00.000Z', null), {
      versions: [existing],
      supersession: { kind: 'explicit', operationId: existing.operationId },
    });

    expect(result.conflict).toBeNull();
    expect(result.supersedes?.versionId).toBe(existing.versionId);
  });

  it('refuses an explicit supersession of an unknown or already-retired version', () => {
    const retired = superseded(
      '2026-02-01T00:00:00.000Z',
      '01K7SUCCESSOR0000000000000',
      window('2026-01-01T00:00:00.000Z', null),
    );

    expect(
      evaluate(window('2026-06-01T00:00:00.000Z', null), {
        versions: [retired],
        supersession: {
          kind: 'explicit',
          operationId: '01K7MISSING00000000000000',
        },
      }).conflict?.reason,
    ).toBe('unknown-supersession');
    expect(
      evaluate(window('2026-06-01T00:00:00.000Z', null), {
        versions: [retired],
        supersession: { kind: 'explicit', operationId: retired.operationId },
      }).conflict?.reason,
    ).toBe('unknown-supersession');
  });

  it('refuses an explicit supersession of a version that already stopped governing', () => {
    const ended = version({
      ...window('2026-01-01T00:00:00.000Z', null),
      supersededAt: new Date('2026-05-01T00:00:00.000Z'),
      governsUntil: new Date('2026-05-15T00:00:00.000Z'),
      supersededByVersionId: '01K7SUCCESSOR0000000000000',
    });

    expect(
      evaluate(window('2026-06-01T00:00:00.000Z', null), {
        versions: [ended],
        supersession: { kind: 'explicit', operationId: ended.operationId },
      }).conflict?.reason,
    ).toBe('unknown-supersession');
  });

  it('lets a legacy code replace the single version it overlaps', () => {
    const existing = version(window('2026-01-01T00:00:00.000Z', null));
    const result = evaluate(window('2026-06-01T00:00:00.000Z', null), {
      versions: [existing],
      supersession: { kind: 'implicit' },
    });

    expect(result.conflict).toBeNull();
    expect(result.supersedes?.versionId).toBe(existing.versionId);
  });

  it('gives the legacy VLIC1 transport no way around the guard: it may not end a perpetual grant either', () => {
    const perpetual = version({
      ...window('2026-01-01T00:00:00.000Z', null),
      organizationLimit: 5,
      userLimit: 20,
    });

    // A text code names no version and states no explicit term instruction the
    // way a signed document does, so the open end stays protected here exactly
    // as it is for the implicit hand-over (OD-LIC-01: the exception is the
    // explicit signed path only). Its capacity is unchanged, so the refusal can
    // only be the term — explained as the open-end conflict it is.
    const result = evaluate(
      {
        ...window('2026-07-01T00:00:00.000Z', '2027-07-01T00:00:00.000Z'),
        organizationLimit: 5,
        userLimit: 20,
      },
      { versions: [perpetual], supersession: { kind: 'implicit' } },
    );

    expect(result.conflict).toEqual({
      reason: 'reduction-requires-resolution',
      overlapping: 1,
      reduction: {
        predecessorVersionId: perpetual.versionId,
        conflicts: [{ kind: 'open-end-closed' }],
      },
    });
    expect(result.supersedes).toBeNull();

    // Keeping the open end is accepted, so the refusal above is the term and
    // not the transport.
    const kept = evaluate(
      {
        ...window('2026-07-01T00:00:00.000Z', null),
        organizationLimit: 5,
        userLimit: 20,
      },
      { versions: [perpetual], supersession: { kind: 'implicit' } },
    );
    expect(kept.conflict).toBeNull();
    expect(kept.supersedes?.versionId).toBe(perpetual.versionId);
  });

  it('refuses a legacy code that would have to choose between versions', () => {
    const first = version(window('2026-01-01T00:00:00.000Z', null));
    const second = version(window('2026-02-01T00:00:00.000Z', null));

    expect(
      evaluate(window('2026-06-01T00:00:00.000Z', null), {
        versions: [first, second],
        supersession: { kind: 'implicit' },
      }).conflict,
    ).toEqual({ reason: 'overlapping-range', overlapping: 2 });
  });

  it('refuses a legacy code that would rewrite a recorded supersession', () => {
    // A future-dated renewal already retired this version as of 2027-01-01;
    // the version still governs until then, and a text code may not take the
    // retirement over (it cannot say which successor it joins).
    const futureDated = version({
      ...window('2026-01-01T00:00:00.000Z', null),
      supersededAt: new Date('2026-05-01T00:00:00.000Z'),
      governsUntil: new Date('2027-01-01T00:00:00.000Z'),
      supersededByVersionId: '01K7SUCCESSOR0000000000000',
    });

    expect(
      evaluate(window('2026-06-01T00:00:00.000Z', null), {
        versions: [futureDated],
        supersession: { kind: 'implicit' },
      }).conflict?.reason,
    ).toBe('overlapping-range');
  });

  it('refuses a replayed operation or artifact', () => {
    const existing = version(window('2026-01-01T00:00:00.000Z', null));

    expect(
      evaluate(window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'), {
        versions: [existing],
        operationId: existing.operationId,
      }).conflict?.reason,
    ).toBe('duplicate-operation');
    expect(
      evaluate(window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'), {
        versions: [existing],
        documentHash: existing.documentHash,
      }).conflict?.reason,
    ).toBe('duplicate-operation');
  });

  it('reaches one decision per import: a replayed artifact wins over overlap', () => {
    const existing = version(window('2026-01-01T00:00:00.000Z', null));
    const result = evaluate(window('2026-06-01T00:00:00.000Z', null), {
      versions: [existing],
      operationId: existing.operationId,
      documentHash: existing.documentHash,
    });

    expect(result.conflict?.reason).toBe('duplicate-operation');
  });
});

describe('a supersession may not remove governance from the past', () => {
  it('asks only whether already-exercised governance would disappear', () => {
    const governing = version(window('2026-01-01T00:00:00.000Z', null));
    const ended = version(
      window('2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
    );
    const scheduled = version(
      window('2036-07-01T00:00:00.000Z', '2037-01-01T00:00:00.000Z'),
    );
    const at = (value: string) => new Date(value);

    // A hand-over inside the past truncates what the target really governed…
    expect(
      supersessionRewritesPastGovernance(
        governing,
        version(window('2026-05-01T00:00:00.000Z', null)),
        NOW,
      ),
    ).toBe(true);
    // … including the boundary of the target's own end…
    expect(
      supersessionRewritesPastGovernance(
        ended,
        version(window('2026-02-01T00:00:00.000Z', null)),
        NOW,
      ),
    ).toBe(true);
    // … but a hand-over at the evaluation instant, or later, removes nothing.
    expect(
      supersessionRewritesPastGovernance(
        governing,
        version(window('2026-06-01T00:00:00.000Z', null)),
        NOW,
      ),
    ).toBe(false);
    expect(
      supersessionRewritesPastGovernance(
        governing,
        version(window('2026-07-01T00:00:00.000Z', null)),
        NOW,
      ),
    ).toBe(false);
    // A target that had already ended has nothing left to take away: the
    // documented correction of an expired version stays allowed.
    expect(
      supersessionRewritesPastGovernance(
        ended,
        version(window('2026-04-01T00:00:00.000Z', null)),
        NOW,
      ),
    ).toBe(false);
    // Nothing in the past of a version that has not started yet.
    expect(
      supersessionRewritesPastGovernance(
        scheduled,
        version(window('2020-01-01T00:00:00.000Z', null)),
        NOW,
      ),
    ).toBe(false);
    // The retired version's own tail never counts: it was already shortened.
    expect(
      supersessionRewritesPastGovernance(
        superseded('2026-02-01T00:00:00.000Z', '01K7SUCCESSOR0000000000000', {
          governsUntil: new Date('2026-02-01T00:00:00.000Z'),
        }),
        version(window('2026-03-01T00:00:00.000Z', null)),
        at('2026-06-01T00:00:00.000Z'),
      ),
    ).toBe(false);
  });

  function evaluate(
    candidate: Partial<RetainedLicenseVersion>,
    overrides: Partial<Parameters<typeof evaluateImportConflicts>[0]> = {},
  ): ReturnType<typeof evaluateImportConflicts> {
    const full = version(candidate);
    return evaluateImportConflicts({
      candidate: full,
      operationId: full.operationId,
      documentHash: full.documentHash,
      supersession: { kind: 'none' },
      versions: [],
      at: NOW,
      ...overrides,
    });
  }

  it('refuses an explicit supersession that would rewrite the past', () => {
    const governing = version(window('2026-01-01T00:00:00.000Z', null));
    const refused = evaluate(window('2026-05-01T00:00:00.000Z', null), {
      versions: [governing],
      supersession: { kind: 'explicit', operationId: governing.operationId },
    });

    expect(refused.conflict).toEqual({
      reason: 'backdated-supersession',
      overlapping: 0,
    });
    expect(refused.supersedes).toBeNull();

    // The two neighbours stay allowed: a hand-over at the evaluation instant,
    // and a correction of a target that had already ended.
    const atOnce = evaluate(window('2026-06-01T00:00:00.000Z', null), {
      versions: [governing],
      supersession: { kind: 'explicit', operationId: governing.operationId },
    });
    expect(atOnce.conflict).toBeNull();
    expect(atOnce.supersedes).toBe(governing);

    // A correction of a target that had already ended stays importable as long
    // as it is CONTIGUOUS: it starts where the target ended (OQ-80 G2 forbids
    // the renewal that would leave a gap, and a month later would).
    const ended = version(
      window('2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
    );
    const correction = evaluate(window('2026-03-01T00:00:00.000Z', null), {
      versions: [ended],
      supersession: { kind: 'explicit', operationId: ended.operationId },
    });
    expect(correction.conflict).toBeNull();
    expect(correction.supersedes).toBe(ended);

    // The same correction a month later is the gap G2 refuses.
    const gapped = evaluate(window('2026-04-01T00:00:00.000Z', null), {
      versions: [ended],
      supersession: { kind: 'explicit', operationId: ended.operationId },
    });
    expect(gapped.conflict).toEqual({ reason: 'renewal-gap', overlapping: 0 });
  });

  it('refuses a legacy code whose implicit replacement would rewrite the past', () => {
    const governing = version(window('2026-01-01T00:00:00.000Z', null));
    const refused = evaluate(window('2020-01-01T00:00:00.000Z', null), {
      versions: [governing],
      supersession: { kind: 'implicit' },
    });

    expect(refused.conflict).toEqual({
      reason: 'backdated-supersession',
      overlapping: 0,
    });
    expect(refused.supersedes).toBeNull();
  });
});

describe('retained versions never govern the same instant', () => {
  /**
   * The static invariant the import transaction protects: after every applied
   * import the effective windows `[validFrom, min(validUntil, governsUntil))`
   * of an installation are pairwise disjoint, so at most one version can cover
   * any instant.
   */
  function assertDisjoint(versions: RetainedLicenseVersion[]): void {
    for (let a = 0; a < versions.length; a += 1) {
      for (let b = a + 1; b < versions.length; b += 1) {
        const first = versions[a]!;
        const second = versions[b]!;
        const left = effectiveWindow(first);
        const right = effectiveWindow(second);
        // Governed at the same instant <=> isEligibleAt both and one covers.
        const instants = [left.start, right.start, left.end, right.end].filter(
          (instant): instant is Date => instant !== null,
        );
        for (const instant of instants) {
          const governing = versions.filter(
            (candidate) =>
              isEligibleAt(candidate, instant) && covers(candidate, instant),
          );
          expect(governing.length).toBeLessThanOrEqual(1);
        }
        void first;
        void second;
      }
    }
  }

  it('holds across a sequence of renewals, a future renewal and a replacement', () => {
    const first = version({
      ...window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
      importedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    // A future-dated renewal that explicitly retires the first version: the
    // first version keeps governing until the renewal's start.
    const futureRenewal = version({
      ...window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
      importedAt: new Date('2026-02-01T00:00:00.000Z'),
      supersedesVersionId: first.versionId,
    });
    const retired = {
      ...first,
      governsUntil: futureRenewal.validFrom,
      supersededAt: new Date('2026-02-01T00:00:00.000Z'),
      supersededByVersionId: futureRenewal.versionId,
    };
    // A legacy code activated in the gap that replaces the next renewal.
    const replacement = version({
      ...window('2028-06-01T00:00:00.000Z', null),
      importedAt: new Date('2026-03-01T00:00:00.000Z'),
      supersedesVersionId: futureRenewal.versionId,
    });
    const retirement = {
      ...futureRenewal,
      governsUntil: replacement.validFrom,
      supersededAt: new Date('2026-03-01T00:00:00.000Z'),
      supersededByVersionId: replacement.versionId,
    };

    const versions = [retired, retirement, replacement];
    assertDisjoint(versions);
    for (const instant of [
      '2026-06-01T00:00:00.000Z',
      '2027-06-01T00:00:00.000Z',
      '2028-06-01T00:00:00.000Z',
      '2030-01-01T00:00:00.000Z',
    ]) {
      const resolution = resolveEffectiveVersion(versions, new Date(instant));
      expect(resolution.kind).toBe('effective');
      expect(overlappingVersions(resolution.version!, versions)).toEqual([
        resolution.version,
      ]);
    }
  });
});

/**
 * Overlap-authority correction (2026-10-14): a signed supersession sanctions
 * exactly the ONE version it names. Before the correction a candidate that
 * declared a supersession and ALSO overlapped a different version that still
 * governed was accepted, which left two retained versions governing the same
 * instant — the disjoint-window invariant of ADR-0046 Decision 4 and design
 * §3.3 (OQ-86 Option C covers the retired history) — and made every as-of read
 * of that instant report `ambiguous` (design §3.2 rule 7, the defensive
 * failure mode the decisions were meant to make unreachable).
 *
 * Nothing about an ordinary explicit supersession, the implicit hand-over of
 * OQ-80 Option B, the legacy `VLIC1` rules or the gap/reduction rules changes:
 * the refusal is the rule-4 arm that already existed for retired history,
 * extended to the one still-governing overlap a named retirement does not
 * cover.
 */
describe('an explicit supersession sanctions exactly the version it names', () => {
  const GOVERNING = window(
    '2026-01-01T00:00:00.000Z',
    '2027-01-01T00:00:00.000Z',
  );
  const SCHEDULED = window(
    '2027-01-01T00:00:00.000Z',
    '2028-01-01T00:00:00.000Z',
  );

  /**
   * V1 governs now; V2 is a future-dated renewal already retained at its own
   * window. The candidate starts inside V2's window and ends after it.
   */
  function scenario(): {
    governing: RetainedLicenseVersion;
    scheduled: RetainedLicenseVersion;
    candidate: RetainedLicenseVersion;
  } {
    return {
      governing: version(GOVERNING),
      scheduled: version({
        ...SCHEDULED,
        importedAt: new Date('2026-02-01T00:00:00.000Z'),
      }),
      candidate: version(
        window('2027-06-01T00:00:00.000Z', '2028-06-01T00:00:00.000Z'),
      ),
    };
  }

  function evaluate(
    scenarioParts: ReturnType<typeof scenario>,
    supersedesOperationId: string,
  ): ReturnType<typeof evaluateImportConflicts> {
    const { candidate } = scenarioParts;
    return evaluateImportConflicts({
      candidate,
      operationId: candidate.operationId,
      documentHash: candidate.documentHash,
      supersession: {
        kind: 'explicit',
        operationId: supersedesOperationId,
      },
      versions: [scenarioParts.governing, scenarioParts.scheduled],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
    });
  }

  it('refuses a candidate that overlaps one retained version while naming another', () => {
    const parts = scenario();

    const refused = evaluate(parts, parts.governing.operationId);

    expect(refused.conflict).toEqual({
      reason: 'overlapping-range',
      overlapping: 1,
    });
    expect(refused.supersedes).toBeNull();
  });

  it('still applies the same candidate when it names the version it overlaps', () => {
    const parts = scenario();

    const applied = evaluate(parts, parts.scheduled.operationId);

    expect(applied.conflict).toBeNull();
    expect(applied.supersedes).toBe(parts.scheduled);
  });

  it('measures the continuation baseline when the document names a non-overlapping version', () => {
    // F-01 reproduction (§8.6, corrective 2026-10-16): naming a weak version
    // the candidate does not overlap must not displace the measurement of the
    // grant the installation actually continues.
    const low = version({
      ...window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      entitlements: [],
    });
    const high = version({
      ...window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
      organizationLimit: 50,
      entitlements: [],
    });
    const candidate = version({
      ...window('2028-01-01T00:00:00.000Z', '2029-01-01T00:00:00.000Z'),
      organizationLimit: 6,
      entitlements: [],
    });
    const usage = {
      organizationCount: 40,
      activeUserCount: 0,
      registeredDeviceCount: 0,
    };

    const named = evaluateImportConflicts({
      candidate,
      operationId: candidate.operationId,
      documentHash: candidate.documentHash,
      supersession: { kind: 'explicit', operationId: low.operationId },
      versions: [low, high],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
      usage,
    });

    // Against the NAMED version this is an increase (5 → 6). Against the
    // version the installation is actually on (50) it is a reduction with 40
    // organizations in use, so the import is refused — and the explain payload
    // names the baseline, not the weak target.
    expect(named.conflict).toEqual({
      reason: 'reduction-requires-resolution',
      overlapping: 1,
      reduction: {
        predecessorVersionId: high.versionId,
        conflicts: [
          { kind: 'organization-capacity', limit: 6, currentUsage: 40 },
        ],
      },
    });
    expect(named.supersedes).toBeNull();

    // The same document WITHOUT the supersession has always reached this
    // verdict through rule 6c, so the target choice cannot decide the outcome.
    const unnamed = evaluateImportConflicts({
      candidate,
      operationId: candidate.operationId,
      documentHash: candidate.documentHash,
      supersession: { kind: 'none' },
      versions: [low, high],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
      usage,
    });
    expect(unnamed.conflict).toEqual(named.conflict);

    // The explicit resolution of the real conflict still applies the document,
    // and the BASELINE is the recorded resolution subject.
    const resolved = evaluateImportConflicts({
      candidate,
      operationId: candidate.operationId,
      documentHash: candidate.documentHash,
      supersession: { kind: 'explicit', operationId: low.operationId },
      versions: [low, high],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
      usage,
      reductionResolution: { reason: 'Operator confirmed the renewal.' },
    });
    if (resolved.conflict !== null)
      throw new Error('expected the resolved import to apply');
    expect(resolved.supersedes).toBe(low);
    expect(resolved.resolutionSubject?.versionId).toBe(high.versionId);

    // A candidate that stays within counted usage is not a reduction against
    // either version, so the named supersession still applies normally.
    const withinUsage = version({
      ...window('2028-01-01T00:00:00.000Z', '2029-01-01T00:00:00.000Z'),
      organizationLimit: 45,
      entitlements: [],
    });
    const applied = evaluateImportConflicts({
      candidate: withinUsage,
      operationId: withinUsage.operationId,
      documentHash: withinUsage.documentHash,
      supersession: { kind: 'explicit', operationId: low.operationId },
      versions: [low, high],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
      usage,
    });
    if (applied.conflict !== null)
      throw new Error('expected the named supersession to apply');
    expect(applied.supersedes).toBe(low);
  });

  it('measures only the continuation baseline, never the non-overlapping version it corrects', () => {
    // The document corrects a version it does not overlap; the grant it
    // actually continues is the one that ends where the document starts. A
    // change relative to the corrected version is therefore not a reduction —
    // and a change relative to the REAL grant still is.
    const corrected = version({
      ...window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
      organizationLimit: 5,
      entitlements: [
        { kind: 'MODULE', code: 'accounting' } as LicenseEntitlement,
        { kind: 'MODULE', code: 'inventory' } as LicenseEntitlement,
      ],
    });
    const governing = version({
      ...window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
      organizationLimit: 50,
      entitlements: [
        { kind: 'MODULE', code: 'accounting' } as LicenseEntitlement,
      ],
    });
    const usage = {
      organizationCount: 40,
      activeUserCount: 0,
      registeredDeviceCount: 0,
    };

    // `inventory` was granted only by the corrected version, which never
    // governed this window: dropping it is not a reduction of the real grant.
    const corrects = version({
      ...window('2028-01-01T00:00:00.000Z', '2029-01-01T00:00:00.000Z'),
      organizationLimit: 45,
      entitlements: [
        { kind: 'MODULE', code: 'accounting' } as LicenseEntitlement,
      ],
    });
    const applied = evaluateImportConflicts({
      candidate: corrects,
      operationId: corrects.operationId,
      documentHash: corrects.documentHash,
      supersession: { kind: 'explicit', operationId: corrected.operationId },
      versions: [corrected, governing],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
      usage,
    });
    if (applied.conflict !== null)
      throw new Error(
        `expected the correction to apply, refused: ${applied.conflict.reason}`,
      );
    expect(applied.supersedes).toBe(corrected);
    expect(applied.resolutionSubject).toBeNull();

    // Dropping what the REAL grant carried is refused, and the explain payload
    // names that grant — never the corrected version.
    const drops = version({
      ...window('2028-01-01T00:00:00.000Z', '2029-01-01T00:00:00.000Z'),
      organizationLimit: 45,
      entitlements: [],
    });
    const refused = evaluateImportConflicts({
      candidate: drops,
      operationId: drops.operationId,
      documentHash: drops.documentHash,
      supersession: { kind: 'explicit', operationId: corrected.operationId },
      versions: [corrected, governing],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
      usage,
    });
    expect(refused.conflict).toMatchObject({
      reason: 'reduction-requires-resolution',
      overlapping: 1,
      reduction: {
        predecessorVersionId: governing.versionId,
        conflicts: [
          {
            kind: 'entitlement-removed',
            entitlement: { kind: 'MODULE', code: 'accounting' },
          },
        ],
      },
    });
  });

  it('still applies a supersession of a non-overlapping version when nothing else overlaps', () => {
    // The documented "correction of a scheduled version": naming a version the
    // candidate does not overlap stays allowed while it overlaps NOTHING else.
    const scheduled = version(SCHEDULED);
    const candidate = version(
      window('2026-06-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );

    const applied = evaluateImportConflicts({
      candidate,
      operationId: candidate.operationId,
      documentHash: candidate.documentHash,
      supersession: { kind: 'explicit', operationId: scheduled.operationId },
      versions: [scheduled],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
    });

    expect(applied.conflict).toBeNull();
    expect(applied.supersedes).toBe(scheduled);
  });

  it('keeps the accepted hand-over pairwise disjoint, and shows the refused one was not', () => {
    const parts = scenario();
    // Naming the governing version — the one the candidate does NOT overlap —
    // is refused, so the state below is never produced by an import.
    expect(evaluate(parts, parts.governing.operationId).conflict).toEqual({
      reason: 'overlapping-range',
      overlapping: 1,
    });

    const applied = evaluate(parts, parts.scheduled.operationId);
    expect(applied.conflict).toBeNull();

    // Applied exactly as the import transaction would: the named version is
    // stamped at the successor's own start.
    const stamped = {
      ...parts.scheduled,
      supersededAt: NOW,
      governsUntil: parts.candidate.validFrom,
      supersededByVersionId: parts.candidate.versionId,
    };
    for (const instant of [
      '2026-06-01T00:00:00.000Z',
      '2027-03-01T00:00:00.000Z',
      '2027-09-01T00:00:00.000Z',
    ]) {
      const resolution = resolveEffectiveVersion(
        [parts.governing, stamped, parts.candidate],
        new Date(instant),
      );
      expect(resolution.kind).toBe('effective');
    }

    // The state the pre-correction acceptance produced instead: the candidate
    // applied while the version it overlapped was never retired — two versions
    // covering one instant, which is what the refusal above prevents.
    const ambiguous = resolveEffectiveVersion(
      [parts.governing, parts.scheduled, parts.candidate],
      new Date('2027-09-01T00:00:00.000Z'),
    );
    if (ambiguous.kind !== 'ambiguous') {
      throw new Error(`expected an ambiguous state, got ${ambiguous.kind}`);
    }
    expect(ambiguous.covering).toHaveLength(2);
  });

  it('refuses it when the candidate also overlaps the version it names', () => {
    // OQ-80 §8.1: "A candidate that would overlap more than one still-governing
    // version is refused rather than guessed." Naming one of the two does not
    // sanction the overlap with the other: the import would leave the unnamed
    // version governing the same instants as the candidate.
    const first = version(
      window('2026-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
    );
    const second = version({
      ...window('2027-01-01T00:00:00.000Z', '2029-01-01T00:00:00.000Z'),
      importedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const candidate = version(
      window('2027-06-01T00:00:00.000Z', '2028-06-01T00:00:00.000Z'),
    );

    const refused = evaluateImportConflicts({
      candidate,
      operationId: candidate.operationId,
      documentHash: candidate.documentHash,
      supersession: { kind: 'explicit', operationId: first.operationId },
      versions: [first, second],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
    });

    expect(refused.conflict).toEqual({
      reason: 'overlapping-range',
      overlapping: 1,
    });
    expect(refused.supersedes).toBeNull();
  });

  it('never accepts an import that leaves two versions governing one instant', () => {
    // Bounded reachability check of the disjoint-window invariant (ADR-0046
    // Decision 4). From an empty installation, every candidate window this
    // suite can express is tried with every supersession intent, the states the
    // import transaction would really commit are kept (the guarded stamp
    // refuses a version that already carries a supersession), and every
    // resulting state must have at most ONE eligible covering version at every
    // probe instant. Before the correction the explicit arm accepted a document
    // that named one version while overlapping another, so this enumeration
    // found two covering versions; it is the regression guard for that class,
    // not just for the single reproducer above.
    const WINDOWS = [
      ['2026-01-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'],
      ['2026-04-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
      ['2026-07-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'],
      ['2026-06-01T00:00:00.000Z', null],
    ] as const;
    const INSTANTS = [
      '2026-01-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z',
    ].map((instant) => new Date(instant));

    function intents(
      versions: readonly RetainedLicenseVersion[],
    ): Array<Parameters<typeof evaluateImportConflicts>[0]['supersession']> {
      return [
        { kind: 'none' },
        { kind: 'implicit' },
        ...versions.map((version) => ({
          kind: 'explicit' as const,
          operationId: version.operationId,
        })),
      ];
    }

    /**
     * The transaction's write, mirrored: the successor row is inserted and the
     * one version the evaluation selected (if any) is stamped at the
     * successor's own `validFrom`. A stamp the guarded `updateMany` would
     * refuse (the row already carries a supersession) is not a committed state.
     */
    function commit(
      versions: readonly RetainedLicenseVersion[],
      candidate: RetainedLicenseVersion,
      evaluation: ReturnType<typeof evaluateImportConflicts>,
    ): RetainedLicenseVersion[] | null {
      const supersedes =
        evaluation.conflict === null ? evaluation.supersedes : null;
      if (supersedes !== null && hasRecordedSupersession(supersedes))
        return null;
      const stamped = versions.map((version) =>
        version.versionId === supersedes?.versionId
          ? {
              ...version,
              supersededAt: NOW,
              governsUntil: supersessionCeaseInstant(candidate),
              supersededByVersionId: candidate.versionId,
            }
          : version,
      );
      return [...stamped, candidate];
    }

    let frontier: RetainedLicenseVersion[][] = [[]];
    for (let depth = 0; depth < 3; depth += 1) {
      const next: RetainedLicenseVersion[][] = [];
      for (const versions of frontier) {
        for (const [from, until] of WINDOWS) {
          for (const supersession of intents(versions)) {
            const candidate = version(window(from, until));
            const evaluation = evaluateImportConflicts({
              candidate,
              operationId: candidate.operationId,
              documentHash: candidate.documentHash,
              supersession,
              versions,
              at: NOW,
              installationCustomerId: CUSTOMER,
              installationCustomerCode: CUSTOMER_CODE,
            });
            if (evaluation.conflict !== null) continue;
            const committed = commit(versions, candidate, evaluation);
            if (committed === null) continue;

            for (const instant of INSTANTS) {
              const resolution = resolveEffectiveVersion(committed, instant);
              expect(
                resolution.kind,
                `${instant.toISOString()} with ${committed.length} retained versions`,
              ).not.toBe('ambiguous');
            }
            next.push(committed);
          }
        }
      }
      frontier = next;
    }
    expect(frontier.length).toBeGreaterThan(0);
  });

  it('keeps the legacy VLIC1 path safe: it takes over the version it overlaps', () => {
    // A text code cannot name a version, so there is no way to express the
    // refused instruction: the implicit path takes over the one still-governing
    // version it overlaps (OQ-80 Option B) and never retires a different one.
    const parts = scenario();

    const applied = evaluateImportConflicts({
      candidate: parts.candidate,
      operationId: parts.candidate.operationId,
      documentHash: parts.candidate.documentHash,
      supersession: { kind: 'implicit' },
      versions: [parts.governing, parts.scheduled],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
    });

    expect(applied.conflict).toBeNull();
    expect(applied.supersedes).toBe(parts.scheduled);
  });
});

/**
 * L-05 (PDR-11 §8.6 on the renewal path): a contiguous renewal retires
 * nothing, so rule 6b never had a predecessor to compare it against. The
 * guard now measures such a candidate against the deterministic continuation
 * baseline — the retained version whose effective window ends exactly at the
 * candidate's start — with the same usage check the hand-over paths use.
 */
describe('continuation baseline of a renewal that retires nothing (L-05)', () => {
  const BOUNDARY = '2027-01-01T00:00:00.000Z';
  const AFTER = '2028-01-01T00:00:00.000Z';

  function continuation(
    candidateOverrides: Partial<RetainedLicenseVersion>,
    overrides: Partial<Parameters<typeof evaluateImportConflicts>[0]> = {},
  ): ReturnType<typeof evaluateImportConflicts> {
    const full = version({
      ...window(BOUNDARY, AFTER),
      ...candidateOverrides,
    });
    return evaluateImportConflicts({
      candidate: full,
      operationId: full.operationId,
      documentHash: full.documentHash,
      supersession: { kind: 'none' },
      versions: [],
      at: NOW,
      installationCustomerId: CUSTOMER,
      usage: {
        organizationCount: 9,
        activeUserCount: 24,
        registeredDeviceCount: 0,
      },
      ...overrides,
    });
  }

  function retained(
    overrides: Partial<RetainedLicenseVersion> = {},
  ): RetainedLicenseVersion {
    return version({
      ...window('2026-01-01T00:00:00.000Z', BOUNDARY),
      organizationLimit: 10,
      userLimit: 25,
      ...overrides,
    });
  }

  it('measures a contiguous renewal against the adjacent grant and refuses a reduction below counted usage', () => {
    const baseline = retained();
    const result = continuation(
      { organizationLimit: 2, userLimit: 3, entitlements: [] },
      { versions: [baseline] },
    );

    expect(result.conflict).toEqual({
      reason: 'reduction-requires-resolution',
      overlapping: 1,
      reduction: {
        predecessorVersionId: baseline.versionId,
        conflicts: [
          { kind: 'organization-capacity', limit: 2, currentUsage: 9 },
          { kind: 'user-capacity', limit: 3, currentUsage: 24 },
          {
            kind: 'entitlement-removed',
            entitlement: { kind: 'MODULE', code: 'accounting' },
          },
        ],
      },
    });
    expect(result.supersedes).toBeNull();
  });

  it('guards a renewal with a changed licenseId against the same baseline (F-8 non-bypass)', () => {
    const baseline = retained({
      licenseId: '01K7OLDLICENSE000000000000',
    });
    const result = continuation(
      {
        licenseId: '01K7NEWLICENSE000000000000',
        userLimit: 3,
      },
      { versions: [baseline] },
    );

    // No licenseId match: the installation's bound customer selects the same
    // baseline, so the shrink is caught exactly as for a retained identity.
    expect(result.conflict).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        predecessorVersionId: baseline.versionId,
        conflicts: [{ kind: 'user-capacity', limit: 3, currentUsage: 24 }],
      },
    });
  });

  it('selects the baseline deterministically: licenseId first, then the bound customer, then latest import and id', () => {
    const ownLicense = retained({
      importedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const otherCustomer = retained({
      licenseId: '01K7OTHERLICENSE00000000000',
      customerId: '01K7OTHERCUSTOMER0000000000',
      importedAt: new Date('2026-05-01T00:00:00.000Z'),
    });

    // 1. A version of the candidate's own licenseId wins even when another
    //    adjacent version was imported later.
    expect(
      continuationBaselineFor(
        { validFrom: new Date(BOUNDARY), licenseId: LICENSE },
        [otherCustomer, ownLicense],
        CUSTOMER,
      )?.versionId,
    ).toBe(ownLicense.versionId);

    // 2. Without a licenseId match, the installation's bound customer wins
    //    over a later-imported version of another customer.
    expect(
      continuationBaselineFor(
        { validFrom: new Date(BOUNDARY), licenseId: '01K7NEWLICENSE000000000' },
        [otherCustomer, ownLicense],
        CUSTOMER,
      )?.versionId,
    ).toBe(ownLicense.versionId);

    // 3. Neither matches (an unbound installation): latest import wins.
    expect(
      continuationBaselineFor(
        { validFrom: new Date(BOUNDARY), licenseId: '01K7NEWLICENSE000000000' },
        [ownLicense, otherCustomer],
        null,
      )?.versionId,
    ).toBe(otherCustomer.versionId);

    // 4. Same import instant: the greater version id breaks the tie.
    const olderId = retained({
      importedAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    const newerId = retained({
      importedAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    expect(
      continuationBaselineFor(
        { validFrom: new Date(BOUNDARY), licenseId: '01K7NEWLICENSE000000000' },
        [olderId, newerId],
        null,
      )?.versionId,
    ).toBe(newerId.versionId);
  });

  it('refuses the resolved continuation through the baseline without stamping it', () => {
    const baseline = retained();
    const result = continuation(
      { organizationLimit: 2 },
      {
        versions: [baseline],
        reductionResolution: { reason: 'Operator confirmed the renewal.' },
      },
    );

    if (result.conflict !== null)
      throw new Error('expected the renewal to apply');
    expect(result.supersedes).toBeNull();
    // The resolution subject is the BASELINE — named for the audit, never a
    // retirement (the transaction must not stamp it).
    expect(result.resolutionSubject?.versionId).toBe(baseline.versionId);
  });

  it('keeps a renewal that stays within actual usage free of any resolution', () => {
    const baseline = retained();
    const result = continuation(
      {
        organizationLimit: 9,
        userLimit: 24,
        entitlements: baseline.entitlements,
      },
      { versions: [baseline] },
    );

    if (result.conflict !== null)
      throw new Error('expected the renewal to apply');
    expect(result.supersedes).toBeNull();
    expect(result.resolutionSubject).toBeNull();
  });

  it('refuses a resolution whose renewal does not conflict (nothing to resolve)', () => {
    const baseline = retained();
    // A shrink that stays within the counted usage (9 organizations) is not a
    // conflict, so the supplied resolution meets nothing to authorize.
    const result = continuation(
      { organizationLimit: 9 },
      {
        versions: [baseline],
        reductionResolution: { reason: 'Operator confirmed the renewal.' },
      },
    );

    expect(result.conflict).toEqual({
      reason: 'resolution-not-applicable',
      overlapping: 0,
    });
  });

  it('refuses a resolution on a first license, where no retained version ends at the start', () => {
    const result = continuation(
      { organizationLimit: 2 },
      {
        versions: [],
        reductionResolution: { reason: 'Operator confirmed the renewal.' },
      },
    );

    // Nothing is retained, so there is no continuation measurement — and an
    // unused resolution is never an import.
    expect(result.conflict).toEqual({
      reason: 'resolution-not-applicable',
      overlapping: 0,
    });
  });

  it('fails closed when the baseline usage cannot be counted, even with a resolution', () => {
    const baseline = retained();
    const result = continuation(
      { organizationLimit: 2 },
      { versions: [baseline], usage: null },
    );

    expect(result.conflict).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        predecessorVersionId: baseline.versionId,
        conflicts: [{ kind: 'usage-unavailable', scope: 'organizations' }],
      },
    });
    const withResolution = continuation(
      { organizationLimit: 2 },
      {
        versions: [baseline],
        usage: null,
        reductionResolution: { reason: 'Operator confirmed the renewal.' },
      },
    );
    expect(withResolution.conflict).toMatchObject({
      reason: 'reduction-requires-resolution',
    });
  });

  it('guards the legacy VLIC1 adjacency renewal after its own L-02 rules', () => {
    const baseline = retained();
    const full = version({
      ...window(BOUNDARY, AFTER),
      organizationLimit: 2,
      entitlements: [],
    });
    const result = evaluateImportConflicts({
      candidate: full,
      operationId: full.operationId,
      documentHash: full.documentHash,
      supersession: { kind: 'implicit' },
      versions: [baseline],
      at: NOW,
      installationCustomerId: CUSTOMER,
      usage: {
        organizationCount: 9,
        activeUserCount: 24,
        registeredDeviceCount: 0,
      },
    });

    expect(result.conflict).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        predecessorVersionId: baseline.versionId,
        conflicts: [
          { kind: 'organization-capacity', limit: 2, currentUsage: 9 },
          {
            kind: 'entitlement-removed',
            entitlement: { kind: 'MODULE', code: 'accounting' },
          },
        ],
      },
    });
    expect(result.supersedes).toBeNull();
  });

  it('measures a renewal that follows a superseded chain against the latest effective end', () => {
    // V1 was handed over to V2 mid-window (OQ-80 Option B); V2 then ended by
    // its own validUntil. A renewal adjacent at V2's end must be measured
    // against V2 — the grant the installation was last on.
    const first = retained({
      ...window('2026-01-01T00:00:00.000Z', BOUNDARY),
      governsUntil: new Date('2026-06-01T00:00:00.000Z'),
      supersededAt: new Date('2026-05-01T00:00:00.000Z'),
      supersededByVersionId: '01K7SUCCESSOR0000000000000',
    });
    const second = retained({
      ...window('2026-06-01T00:00:00.000Z', BOUNDARY),
      organizationLimit: 4,
      userLimit: 30,
    });
    const result = continuation(
      { organizationLimit: 2, userLimit: 30 },
      { versions: [first, second] },
    );

    expect(result.conflict).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        predecessorVersionId: second.versionId,
        conflicts: [
          { kind: 'organization-capacity', limit: 2, currentUsage: 9 },
        ],
      },
    });
  });

  it('never selects an open-ended version as the baseline; the term arm has no continuation case', () => {
    const perpetual = retained({ ...window('2026-01-01T00:00:00.000Z', null) });

    // A perpetual grant has no effective end, so it is never adjacent.
    expect(
      continuationBaselineFor(
        { validFrom: new Date(BOUNDARY), licenseId: LICENSE },
        [perpetual],
        CUSTOMER,
      ),
    ).toBeNull();

    // A candidate over the perpetual grant cannot slip into the continuation
    // path at all: it overlaps, so the hand-over guard refuses the closed end
    // exactly as before (PDR-12), and no baseline is consulted. The candidate
    // keeps the limits and entitlements, so the open end is the ONLY conflict.
    const result = continuation(
      {
        ...window(BOUNDARY, AFTER),
        validFrom: new Date('2026-06-01T00:00:00.000Z'),
        organizationLimit: 10,
        userLimit: 25,
        entitlements: perpetual.entitlements,
      },
      { versions: [perpetual] },
    );
    expect(result.conflict).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        conflicts: [{ kind: 'open-end-closed' }],
      },
    });
    expect(result.supersedes).toBeNull();
  });

  it('rejects customer-code-mismatch when customerId or customerCode disagrees with retained or known customers (L-06)', () => {
    const existing = version(
      window('2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'),
    );

    // Same customerId, different customerCode -> customer-code-mismatch.
    const changedCode = version({
      ...window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
      customerId: CUSTOMER,
      customerCode: 'CUST-DIFFERENT-99',
    });
    expect(
      evaluateImportConflicts({
        candidate: changedCode,
        operationId: changedCode.operationId,
        documentHash: changedCode.documentHash,
        supersession: { kind: 'none' },
        versions: [existing],
        at: NOW,
        installationCustomerId: CUSTOMER,
        installationCustomerCode: CUSTOMER_CODE,
      }).conflict,
    ).toEqual({
      reason: 'customer-code-mismatch',
      overlapping: 0,
    });

    // Different customerId claiming existing customerCode -> customer-code-mismatch
    // even if customerTransfer is supplied!
    const hijackedCode = version({
      ...window('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
      licenseId: '01K7OTHERLICENSE00000000000',
      customerId: '01K7OTHERCUSTOMER0000000000',
      customerCode: CUSTOMER_CODE,
    });
    expect(
      evaluateImportConflicts({
        candidate: hijackedCode,
        operationId: hijackedCode.operationId,
        documentHash: hijackedCode.documentHash,
        supersession: { kind: 'none' },
        versions: [existing],
        at: NOW,
        installationCustomerId: CUSTOMER,
        installationCustomerCode: CUSTOMER_CODE,
        customerTransfer: { reason: 'Attempted transfer with hijacked code.' },
      }).conflict,
    ).toEqual({
      reason: 'customer-code-mismatch',
      overlapping: 0,
    });
  });
});

/**
 * Contract tests for the post-gap recovery reduction guard (L-07, accepted
 * OD-LIC-05 Option 1 / ADR-0050). A post-gap start is never adjacent to retained
 * coverage, so the §8.6 comparison is against the latest lapsed coverage
 * version, and any resolution is carried by the dedicated recovery operation.
 */
describe('post-gap recovery and the §8.6 reduction guard (contract)', () => {
  const LAPSED_END = '2026-06-01T00:00:00.000Z';

  function lapsedVersion(): RetainedLicenseVersion {
    return version({
      ...window('2026-01-01T00:00:00.000Z', LAPSED_END),
      organizationLimit: 50,
      entitlements: [
        { kind: 'MODULE', code: 'accounting' } as LicenseEntitlement,
      ],
    });
  }

  function recoveryCandidate(
    overrides: Partial<RetainedLicenseVersion> = {},
  ): RetainedLicenseVersion {
    return version({
      ...window('2026-07-01T00:00:00.000Z', '2027-07-01T00:00:00.000Z'),
      licenseId: '01K7NEWLICENSE00000000000',
      organizationLimit: 2,
      entitlements: [],
      ...overrides,
    });
  }

  const usage = {
    organizationCount: 40,
    activeUserCount: 0,
    registeredDeviceCount: 0,
  };

  it('selects the deterministic latest lapsed coverage version and preserves perpetual-null semantics', () => {
    const earlier = version({
      ...window('2026-01-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'),
      versionId: 'version-earlier-end',
    });
    const laterButOlderImport = version({
      ...window('2026-01-01T00:00:00.000Z', LAPSED_END),
      versionId: 'version-latest-end-older-import',
      importedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const laterImport = version({
      ...window('2026-01-01T00:00:00.000Z', LAPSED_END),
      versionId: 'version-latest-end-newer-import',
      importedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const laterId = version({
      ...window('2026-01-01T00:00:00.000Z', LAPSED_END),
      versionId: 'version-z',
      importedAt: laterImport.importedAt,
    });

    expect(
      lapsedCoverageVersion([earlier, laterButOlderImport, laterImport]),
    ).toBe(laterImport);
    expect(lapsedCoverageVersion([laterImport, laterId])).toBe(laterId);
    expect(lapsedLicenseContext([laterImport, laterId])).toEqual({
      licenseId: laterId.licenseId,
      coverageEnd: laterId.validUntil,
    });
    expect(lapsedCoverageVersion([])).toBeNull();
    expect(
      lapsedCoverageVersion([
        laterImport,
        version(window('2026-01-01T00:00:00.000Z', null)),
      ]),
    ).toBeNull();
    expect(
      lapsedLicenseContext([version(window('2026-01-01T00:00:00.000Z', null))]),
    ).toBeNull();
  });

  it('requires an explicit resolution for a post-gap reduction and names the lapsed grant', () => {
    const lapsed = lapsedVersion();
    const candidate = recoveryCandidate();

    const refused = evaluateImportConflicts({
      candidate,
      operationId: candidate.operationId,
      documentHash: candidate.documentHash,
      supersession: { kind: 'none' },
      versions: [lapsed],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
      usage,
      gapRecovery: { reason: 'Operator confirmed the recovery.' },
    });

    expect(refused.conflict).toEqual({
      reason: 'reduction-requires-resolution',
      overlapping: 1,
      reduction: {
        predecessorVersionId: lapsed.versionId,
        conflicts: [
          { kind: 'organization-capacity', limit: 2, currentUsage: 40 },
          {
            kind: 'entitlement-removed',
            entitlement: { kind: 'MODULE', code: 'accounting' },
          },
        ],
      },
    });
    expect(refused.supersedes).toBeNull();
  });

  it('applies a resolved reduction on recovery, auditing the lapsed grant without superseding it', () => {
    const lapsed = lapsedVersion();
    const candidate = recoveryCandidate();

    const applied = evaluateImportConflicts({
      candidate,
      operationId: candidate.operationId,
      documentHash: candidate.documentHash,
      supersession: { kind: 'none' },
      versions: [lapsed],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
      usage,
      gapRecovery: { reason: 'Operator confirmed the recovery.' },
      reductionResolution: { reason: 'Customer approved the lower grant.' },
    });

    if (applied.conflict !== null) {
      throw new Error(
        `expected authorized recovery, refused: ${applied.conflict.reason}`,
      );
    }
    expect(applied.supersedes).toBeNull();
    expect(applied.resolutionSubject).toBe(lapsed);
  });

  it('refuses an unused resolution on a non-reducing recovery', () => {
    const lapsed = lapsedVersion();
    const candidate = recoveryCandidate({
      organizationLimit: 60,
      entitlements: [
        { kind: 'MODULE', code: 'accounting' } as LicenseEntitlement,
      ],
    });

    const refused = evaluateImportConflicts({
      candidate,
      operationId: candidate.operationId,
      documentHash: candidate.documentHash,
      supersession: { kind: 'none' },
      versions: [lapsed],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
      usage,
      gapRecovery: { reason: 'Operator confirmed the recovery.' },
      reductionResolution: { reason: 'Customer approved a reduction.' },
    });

    expect(refused.conflict).toEqual({
      reason: 'resolution-not-applicable',
      overlapping: 0,
    });
  });

  it('keeps ordinary import and the separate resolution route from carrying a post-gap candidate', () => {
    const lapsed = lapsedVersion();
    const candidate = recoveryCandidate();
    const common = {
      candidate,
      operationId: candidate.operationId,
      documentHash: candidate.documentHash,
      supersession: { kind: 'none' } as const,
      versions: [lapsed],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
      usage,
    };

    expect(evaluateImportConflicts(common).conflict).toMatchObject({
      reason: 'post-gap-recovery-requires-dedicated-operation',
    });
    expect(
      evaluateImportConflicts({
        ...common,
        reductionResolution: { reason: 'Customer approved the reduction.' },
      }).conflict,
    ).toMatchObject({
      reason: 'post-gap-recovery-requires-dedicated-operation',
    });
  });

  it('rejects a post-gap recovery that declares a supersession target as recovery-not-applicable', () => {
    const lapsed = lapsedVersion();
    const candidate = recoveryCandidate();
    const refused = evaluateImportConflicts({
      candidate,
      operationId: candidate.operationId,
      documentHash: candidate.documentHash,
      supersession: { kind: 'explicit', operationId: lapsed.operationId },
      versions: [lapsed],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
      usage,
      gapRecovery: { reason: 'Operator confirmed the recovery.' },
    });

    expect(refused.conflict).toEqual({
      reason: 'recovery-not-applicable',
      overlapping: 0,
    });

    // Even an unknown declared target cannot turn a post-gap recovery into
    // ordinary supersession validation; recovery retires nothing.
    const unknownTarget = evaluateImportConflicts({
      candidate,
      operationId: candidate.operationId,
      documentHash: candidate.documentHash,
      supersession: { kind: 'explicit', operationId: 'unknown-operation-id' },
      versions: [lapsed],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
      usage,
      gapRecovery: { reason: 'Operator confirmed the recovery.' },
    });
    expect(unknownTarget.conflict).toEqual({
      reason: 'recovery-not-applicable',
      overlapping: 0,
    });
  });

  it('fails closed when post-gap usage is unavailable, even with a resolution reason', () => {
    const lapsed = lapsedVersion();
    const candidate = recoveryCandidate();
    const refused = evaluateImportConflicts({
      candidate,
      operationId: candidate.operationId,
      documentHash: candidate.documentHash,
      supersession: { kind: 'none' },
      versions: [lapsed],
      at: NOW,
      installationCustomerId: CUSTOMER,
      installationCustomerCode: CUSTOMER_CODE,
      usage: null,
      gapRecovery: { reason: 'Operator confirmed the recovery.' },
      reductionResolution: { reason: 'Customer approved the lower grant.' },
    });

    expect(refused.conflict).toMatchObject({
      reason: 'reduction-requires-resolution',
      reduction: {
        predecessorVersionId: lapsed.versionId,
        conflicts: [
          { kind: 'usage-unavailable', scope: 'organizations' },
          {
            kind: 'entitlement-removed',
            entitlement: { kind: 'MODULE', code: 'accounting' },
          },
        ],
      },
    });
  });
});
