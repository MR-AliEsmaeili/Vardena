import { describe, expect, it } from 'vitest';
import type { LicenseEntitlement, LicenseStatus } from './license.js';
import {
  covers,
  findScheduledVersion,
  findVersionByOperationId,
  overlappingVersions,
  resolveEffectiveVersion,
  sortVersionsNewestFirst,
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

function superseded(
  at: string,
  by: string,
  overrides: Partial<RetainedLicenseVersion> = {},
): RetainedLicenseVersion {
  return version({
    supersededAt: new Date(at),
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

  it('never counts a superseded version as an overlap', () => {
    const retired = superseded(
      '2026-06-01T00:00:00.000Z',
      '01K7LATER0000000000000000',
      window('2026-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'),
    );
    const candidate = version(
      window('2027-01-01T00:00:00.000Z', '2029-01-01T00:00:00.000Z'),
    );

    expect(overlappingVersions(candidate, [retired])).toEqual([]);
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
