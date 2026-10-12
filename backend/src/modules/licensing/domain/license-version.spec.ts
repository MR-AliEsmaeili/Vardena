import { describe, expect, it } from 'vitest';
import type { LicenseEntitlement, LicenseStatus } from './license.js';
import {
  covers,
  effectiveWindow,
  evaluateImportConflicts,
  findScheduledVersion,
  findVersionByOperationId,
  hasRecordedSupersession,
  isEligibleAt,
  isSupersededAt,
  overlappingVersions,
  resolveEffectiveVersion,
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

let counter = 0;

function version(
  overrides: Partial<RetainedLicenseVersion> = {},
): RetainedLicenseVersion {
  counter += 1;
  const index = String(counter).padStart(4, '0');
  return {
    versionId: `01K7VERSION${index}0000000000`,
    licenseId: LICENSE,
    customerId: CUSTOMER,
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

      for (const [path, overrides] of precedencePaths(predecessor)) {
        const result = evaluate(candidate, {
          versions: [predecessor],
          ...overrides,
        });

        expect(result.conflict, path).toEqual({
          reason: 'reduction-requires-resolution',
          overlapping: 1,
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
    // document explicitly names the version it supersedes.
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
        supersession: {
          kind: 'explicit',
          operationId: predecessor.operationId,
        },
      },
    );

    expect(result.conflict).toEqual({
      reason: 'reduction-requires-resolution',
      overlapping: 1,
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
    // reduction is evaluated per dimension, not on a net total.
    const result = evaluate(
      {
        ...window('2026-07-01T00:00:00.000Z', '2027-07-01T00:00:00.000Z'),
        organizationLimit: 6,
        userLimit: 19,
      },
      {
        versions: [predecessor],
        supersession: {
          kind: 'explicit',
          operationId: predecessor.operationId,
        },
      },
    );

    expect(result.conflict).toEqual({
      reason: 'reduction-requires-resolution',
      overlapping: 1,
    });
    expect(result.supersedes).toBeNull();
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
    // open end is a reduction of the retained grant and fails closed.
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
    // still refused, so naming the version does not buy a smaller grant.
    const reduced = evaluate(
      { ...closing, organizationLimit: 4, userLimit: 20 },
      {
        versions: [perpetual],
        supersession: { kind: 'explicit', operationId: perpetual.operationId },
      },
    );
    expect(reduced.conflict).toEqual({
      reason: 'reduction-requires-resolution',
      overlapping: 1,
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
    // Whether a new identity may cover a lapse is an Owner question that is
    // still open (OQ-87) — no rule here refuses it, and none grants it.
    expect(
      evaluate(
        {
          ...window('2028-01-01T00:00:00.000Z', '2029-01-01T00:00:00.000Z'),
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
    ).toEqual({ reason: 'transfer-not-applicable', overlapping: 0 });
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
    // touched, so it is an ordinary import.
    expect(
      evaluate(
        {
          ...window('2026-10-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
          licenseId: '01K7ANOTHERLICENSE000000000',
        },
        { versions: [retired] },
      ).conflict,
    ).toBeNull();
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
    // only be the term.
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
