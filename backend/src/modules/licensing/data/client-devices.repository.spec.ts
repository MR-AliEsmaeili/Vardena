import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { parseDevicePublicKey } from '../domain/client-device.js';
import type { RetainedLicenseVersion } from '../domain/license-version.js';
import {
  ClientDevicesRepository,
  type CreateReplacementChallengeInput,
} from './client-devices.repository.js';
import type { LicensesRepository } from './licenses.repository.js';

/**
 * The persistence-level device tests that need no database.
 *
 * Two subjects share one fake Prisma client:
 *
 * 1. the duplicate replacement-key guard must be part of the LOOKUP, not a
 *    comparison against whichever row a non-deterministic query returned;
 * 2. a license that is merely INACTIVE (natural expiry inside Grace,
 *    Read-Only, blocked status) must never destroy a retained enrollment
 *    challenge or replacement request — only the operation's own clock and a
 *    real signed-license context change do that, each with its own audit
 *    reason (OQ-45's "restore without manual reconstruction", PDR-15 §2.13).
 */
function deviceKey() {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64url');
  return { parsed: parseDevicePublicKey(publicKey) };
}

const INSTALLATION = 'installation-1';
const CUSTOMER = 'customer-1';
const CUSTOMER_CODE = 'CUST-1';
const OLD_DEVICE = 'device-old';
const REQUEST_ID = 'request-pending';
const CHALLENGE_ID = 'challenge-pending';
const NOW = new Date('2026-10-16T00:00:00.000Z');
/** Signed expiry already in the past: the license is inactive, still governing. */
const EXPIRED_AT = new Date('2026-10-01T00:00:00.000Z');

const oldDeviceKey = deviceKey();
const pendingKey = deviceKey();
const decoyKey = deviceKey();
const freeKey = deviceKey();

function licenseVersion(
  overrides: Partial<RetainedLicenseVersion> = {},
): RetainedLicenseVersion {
  return {
    versionId: 'version-1',
    licenseId: 'license-1',
    installationId: INSTALLATION,
    customerId: CUSTOMER,
    customerCode: CUSTOMER_CODE,
    status: 'ACTIVE',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null,
    organizationLimit: null,
    userLimit: null,
    deviceLimit: 5,
    deviceLimitSpecified: true,
    entitlements: [],
    provider: 'test',
    ...overrides,
  } as unknown as RetainedLicenseVersion;
}

/** A pending replacement request bound to the version it was created under. */
function replacementRow(
  version: RetainedLicenseVersion,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: REQUEST_ID,
    installationId: INSTALLATION,
    oldDeviceId: OLD_DEVICE,
    newDeviceId: 'device-new',
    keyFingerprint: pendingKey.parsed.fingerprint,
    customerId: version.customerId,
    customerCode: version.customerCode,
    licenseId: version.licenseId,
    licenseVersionId: version.versionId,
    state: 'PENDING',
    requestSignature: 'signature',
    requestHash: 'hash',
    requestExpiresAt: new Date(NOW.getTime() + 24 * 60 * 60_000),
    challengeExpiresAt: new Date(NOW.getTime() + 15 * 60_000),
    responseOperationId: null,
    operationId: 'operation-1',
    ...overrides,
  };
}

function challengeRow(
  version: RetainedLicenseVersion,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: CHALLENGE_ID,
    installationId: INSTALLATION,
    deviceId: 'device-enrolling',
    keyFingerprint: freeKey.parsed.fingerprint,
    customerId: version.customerId,
    customerCode: version.customerCode,
    licenseId: version.licenseId,
    licenseVersionId: version.versionId,
    operationId: 'operation-2',
    state: 'PENDING',
    expiresAt: new Date(NOW.getTime() + 15 * 60_000),
    ...overrides,
  };
}

interface HarnessOptions {
  /** The effective signed version the license lock answers with. */
  version?: RetainedLicenseVersion | null;
  requests?: ReturnType<typeof replacementRow>[];
  challenges?: ReturnType<typeof challengeRow>[];
  /** Row the single-request lookups (`prove`, `import`, ...) must return. */
  requestRow?: ReturnType<typeof replacementRow> | null;
  /**
   * Model the pre-fix duplicate-key lookup: an unfiltered `findFirst` answers
   * with "some" pending request instead of the one asked for.
   */
  decoyPendingRequest?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const version =
    options.version === undefined ? licenseVersion() : options.version;
  const requests = options.requests ?? [];
  const challenges = options.challenges ?? [];
  const requestRow = options.requestRow ?? null;

  const lookups: Array<Record<string, unknown>> = [];
  const stagedTransitions: Array<Record<string, unknown>> = [];
  const auditEvents: Array<Record<string, unknown>> = [];

  const decoy = {
    id: 'request-decoy',
    installationId: INSTALLATION,
    oldDeviceId: 'device-other',
    keyFingerprint: decoyKey.parsed.fingerprint,
    state: 'PENDING',
  };

  const client = {
    clientDevice: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        where['id'] === OLD_DEVICE
          ? {
              id: OLD_DEVICE,
              installationId: INSTALLATION,
              status: 'ACTIVE',
              keyFingerprint: oldDeviceKey.parsed.fingerprint,
            }
          : null,
      findMany: async () => [],
      create: async () => {
        throw new Error('unexpected device insert');
      },
      updateMany: async () => ({ count: 0 }),
    },
    clientDeviceReplacementRequest: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where['id'] !== undefined) {
          return requestRow !== null && where['id'] === requestRow.id
            ? requestRow
            : null;
        }
        if ('oldDeviceId' in where) return null; // no prior request for this device
        lookups.push({ ...where });
        const fingerprint = where['keyFingerprint'];
        if (fingerprint === undefined) {
          // The pre-fix lookup: "some" pending request, not necessarily ours.
          return options.decoyPendingRequest === true ? decoy : null;
        }
        return (
          requests.find((row) => row.keyFingerprint === fingerprint) ??
          (fingerprint === decoy.keyFingerprint ? decoy : null)
        );
      },
      findMany: async () => requests,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (
          requests.some(
            (row) => row.keyFingerprint === data['keyFingerprint'],
          ) ||
          data['keyFingerprint'] === decoy.keyFingerprint
        ) {
          // What PostgreSQL's partial unique index raises.
          throw new Error(
            'Unique constraint failed on the fields: (`installation_id`,`key_fingerprint`)',
          );
        }
        return data;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        stagedTransitions.push({ table: 'replacement', where, data });
        return { count: 1 };
      },
    },
    deviceEnrollmentChallenge: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        where['id'] === CHALLENGE_ID ? (challenges[0] ?? null) : null,
      findMany: async () => challenges,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        stagedTransitions.push({ table: 'challenge', where, data });
        return { count: 1 };
      },
    },
    licenseAuditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditEvents.push(data);
        return data;
      },
    },
  };

  const prisma = {
    inTransaction: async (run: (tx: unknown) => Promise<unknown>) => run({}),
    getClient: async () => client,
  } as unknown as PrismaService;

  const licenses = {
    lockForDeviceAllocation: async () => ({
      installation: { customerId: CUSTOMER, customerCode: CUSTOMER_CODE },
      effectiveVersion: version,
    }),
    recordAuditEvent: async () => {},
  } as unknown as LicensesRepository;

  return {
    repository: new ClientDevicesRepository(prisma, licenses),
    version,
    lookups,
    stagedTransitions,
    events: auditEvents,
  };
}

function replacementChallengeInput(
  key: ReturnType<typeof deviceKey>,
): CreateReplacementChallengeInput {
  return {
    installationId: INSTALLATION,
    requestId: 'request-new',
    challengeId: 'challenge-new',
    operationId: 'operation-new',
    oldDeviceId: OLD_DEVICE,
    newDeviceId: 'device-new',
    publicKey: key.parsed.encoded,
    keyFingerprint: key.parsed.fingerprint,
    nonce: 'n'.repeat(32),
    issuedAt: NOW,
    challengeExpiresAt: new Date(NOW.getTime() + 15 * 60_000),
    requestExpiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60_000),
    actorId: null,
  };
}

describe('ClientDevicesRepository replacement-key lookup', () => {
  it('refuses a duplicate pending key with the stable reason, not a database error', async () => {
    const { repository, lookups } = harness({
      requests: [replacementRow(licenseVersion())],
      decoyPendingRequest: true,
    });

    await expect(
      repository.createReplacementChallenge(
        replacementChallengeInput(decoyKey),
      ),
    ).rejects.toMatchObject({ reason: 'replacement-device-key-used' });

    // …and the decision came from a lookup that actually asked for the key.
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toMatchObject({
      installationId: INSTALLATION,
      keyFingerprint: decoyKey.parsed.fingerprint,
      state: { in: ['CHALLENGE', 'PENDING'] },
    });
  });

  it('does not treat an unrelated pending request as a key conflict', async () => {
    const { repository } = harness({
      requests: [replacementRow(licenseVersion())],
      decoyPendingRequest: true,
    });

    // A key no pending request holds: the guard must let this through rather
    // than refuse by coincidence.
    const created = await repository.createReplacementChallenge(
      replacementChallengeInput(freeKey),
    );

    expect(created).toMatchObject({
      keyFingerprint: freeKey.parsed.fingerprint,
      state: 'CHALLENGE',
    });
  });
});

/**
 * A license that has crossed its signed expiry instant still GOVERNS the
 * installation. It stops permitting device-lifecycle changes, and that refusal
 * must not destroy retained state: the sweep may only expire an operation on
 * its own clock or on a real signed-license context change.
 */
describe('ClientDevicesRepository license context vs license activity', () => {
  it('keeps pending operations when the license is merely inactive (natural expiry)', async () => {
    const version = licenseVersion({ validUntil: EXPIRED_AT });
    const { repository, stagedTransitions, events } = harness({
      version,
      requests: [replacementRow(version)],
      challenges: [challengeRow(version)],
    });

    await repository.expireStaleOperations(INSTALLATION, NOW, null);

    // Nothing expires: the operation clocks are still in the future and the
    // version/binding is unchanged.
    expect(stagedTransitions).toEqual([]);
    expect(events).toEqual([]);
  });

  it('keeps pending operations in a blocked (suspended) license', async () => {
    const version = licenseVersion({ status: 'SUSPENDED' });
    const { repository, stagedTransitions, events } = harness({
      version,
      requests: [replacementRow(version)],
      challenges: [challengeRow(version)],
    });

    await repository.expireStaleOperations(INSTALLATION, NOW, null);

    expect(stagedTransitions).toEqual([]);
    expect(events).toEqual([]);
  });

  it('expires pending operations on a real license context change, with its own reason', async () => {
    const version = licenseVersion({ versionId: 'version-2' });
    const { repository, stagedTransitions, events } = harness({
      version,
      // Rows bound to version-1, while version-2 now governs.
      requests: [replacementRow(version, { licenseVersionId: 'version-1' })],
      challenges: [challengeRow(version, { licenseVersionId: 'version-1' })],
    });

    await repository.expireStaleOperations(INSTALLATION, NOW, null);

    expect(stagedTransitions).toHaveLength(2);
    for (const transition of stagedTransitions) {
      expect(transition['data']).toMatchObject({ state: 'EXPIRED' });
    }
    expect(events.map((event) => event['reason'])).toEqual([
      'license-context-changed',
      'license-context-changed',
    ]);
  });

  it('expires pending operations on their own clock, with the time reason', async () => {
    const version = licenseVersion();
    const { repository, events } = harness({
      version,
      requests: [
        replacementRow(version, {
          requestExpiresAt: new Date(NOW.getTime() - 1_000),
        }),
      ],
      challenges: [
        challengeRow(version, { expiresAt: new Date(NOW.getTime() - 1_000) }),
      ],
    });

    await repository.expireStaleOperations(INSTALLATION, NOW, null);

    expect(events.map((event) => event['reason']).sort()).toEqual([
      'challenge-expired',
      'request-expired',
    ]);
  });

  it('refuses to complete a retained replacement while the license is inactive, without destroying it', async () => {
    const version = licenseVersion({ validUntil: EXPIRED_AT });
    const row = replacementRow(version);
    const { repository, stagedTransitions, events } = harness({
      version,
      requests: [row],
      requestRow: row,
    });

    await expect(
      repository.completeReplacement({
        installationId: INSTALLATION,
        requestId: REQUEST_ID,
        response: {} as never,
        responseHash: 'hash',
        source: 'file',
        actorId: null,
        now: NOW,
      }),
    ).rejects.toMatchObject({ reason: 'license-not-active' });

    // The accepted, still-valid response is NOT thrown away: after a renewal
    // the same request can be completed without re-issuing it.
    expect(stagedTransitions).toEqual([]);
    expect(events).toEqual([]);
  });

  it('refuses to prove a retained replacement while the license is inactive, without destroying it', async () => {
    const version = licenseVersion({ validUntil: EXPIRED_AT });
    const row = replacementRow(version, { state: 'CHALLENGE' });
    const { repository, stagedTransitions, events } = harness({
      version,
      requests: [row],
      requestRow: row,
    });

    await expect(
      repository.proveReplacement({
        installationId: INSTALLATION,
        requestId: REQUEST_ID,
        canonicalPayload: 'canonical',
        signature: 'signature',
        actorId: null,
        now: NOW,
      }),
    ).rejects.toMatchObject({ reason: 'license-not-active' });

    expect(stagedTransitions).toEqual([]);
    expect(events).toEqual([]);
  });

  it('still expires a retained replacement when the effective version changed', async () => {
    const version = licenseVersion({ versionId: 'version-2' });
    const row = replacementRow(version, { licenseVersionId: 'version-1' });
    const { repository, stagedTransitions, events } = harness({
      version,
      requests: [row],
      requestRow: row,
    });

    await expect(
      repository.completeReplacement({
        installationId: INSTALLATION,
        requestId: REQUEST_ID,
        response: {} as never,
        responseHash: 'hash',
        source: 'file',
        actorId: null,
        now: NOW,
      }),
    ).rejects.toMatchObject({ reason: 'replacement-request-expired' });

    expect(stagedTransitions).toHaveLength(1);
    expect(stagedTransitions[0]?.['data']).toMatchObject({ state: 'EXPIRED' });
    expect(events.map((event) => event['reason'])).toEqual([
      'license-context-changed',
    ]);
  });
});
