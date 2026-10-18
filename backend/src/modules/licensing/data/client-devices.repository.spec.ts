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
 * The duplicate replacement-key guard must be part of the LOOKUP, not a
 * comparison against whichever row a non-deterministic query happened to
 * return.
 *
 * With two pending requests in flight, the original code read the first
 * `{ installationId, state IN (CHALLENGE, PENDING) }` row without any
 * `keyFingerprint` filter and compared THAT row's fingerprint with the
 * requested one. When the query returned the other request — the case the fake
 * below models deliberately — the guard passed, and the duplicate was rejected
 * only by the partial unique index
 * `uq_device_replacement_requests_active_key_fingerprint`: a raw Prisma
 * violation that reaches the client as an unmapped 500 instead of the stable
 * `replacement-device-key-used` reason the API documents.
 *
 * The assertion is the contract — the caller must see a `DeviceLifecycleError`,
 * never a database error — and the recorded lookup proves where the decision
 * came from.
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
const NOW = new Date('2026-10-16T00:00:00.000Z');

const oldDeviceKey = deviceKey();
/** Already held by a pending replacement request of ANOTHER device. */
const pendingKey = deviceKey();
/** Held by a second pending request: the row an unfiltered query may return. */
const decoyKey = deviceKey();
/** Held by nothing. */
const freeKey = deviceKey();

const VERSION = {
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
} as unknown as RetainedLicenseVersion;

/** Two pending requests for two different devices. */
const pendingRequests = [
  {
    id: 'request-pending',
    installationId: INSTALLATION,
    oldDeviceId: 'device-other-1',
    keyFingerprint: pendingKey.parsed.fingerprint,
    state: 'PENDING',
  },
  {
    id: 'request-decoy',
    installationId: INSTALLATION,
    oldDeviceId: 'device-other-2',
    keyFingerprint: decoyKey.parsed.fingerprint,
    state: 'PENDING',
  },
];

function harness() {
  const lookups: Array<Record<string, unknown>> = [];

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
        if ('oldDeviceId' in where) return null; // no prior request for this device
        lookups.push({ ...where });
        const fingerprint = where['keyFingerprint'];
        if (fingerprint === undefined) {
          // "Some" pending request, exactly as an unordered query may return
          // it: the inconvenient row, which is what makes this a regression
          // test rather than a restatement of the fix.
          return pendingRequests[1];
        }
        return (
          pendingRequests.find((row) => row.keyFingerprint === fingerprint) ??
          null
        );
      },
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (
          pendingRequests.some(
            (row) => row.keyFingerprint === data['keyFingerprint'],
          )
        ) {
          // What PostgreSQL's partial unique index raises.
          throw new Error(
            'Unique constraint failed on the fields: (`installation_id`,`key_fingerprint`)',
          );
        }
        return data;
      },
      updateMany: async () => ({ count: 0 }),
    },
    deviceEnrollmentChallenge: {
      findFirst: async () => null,
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
    },
    licenseAuditEvent: {
      create: async () => ({}),
    },
  };

  const prisma = {
    inTransaction: async (run: (tx: unknown) => Promise<unknown>) => run({}),
    getClient: async () => client,
  } as unknown as PrismaService;

  const licenses = {
    lockForDeviceAllocation: async () => ({
      installation: { customerId: CUSTOMER, customerCode: CUSTOMER_CODE },
      effectiveVersion: VERSION,
    }),
    recordAuditEvent: async () => {},
  } as unknown as LicensesRepository;

  return {
    repository: new ClientDevicesRepository(prisma, licenses),
    lookups,
  };
}

function input(
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
    const { repository, lookups } = harness();

    await expect(
      repository.createReplacementChallenge(input(pendingKey)),
    ).rejects.toMatchObject({ reason: 'replacement-device-key-used' });

    // …and the decision came from a lookup that actually asked for the key.
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toMatchObject({
      installationId: INSTALLATION,
      keyFingerprint: pendingKey.parsed.fingerprint,
      state: { in: ['CHALLENGE', 'PENDING'] },
    });
  });

  it('does not treat an unrelated pending request as a key conflict', async () => {
    const { repository } = harness();

    // A key no pending request holds: the guard must let this through rather
    // than refuse by coincidence.
    const created = await repository.createReplacementChallenge(input(freeKey));

    expect(created).toMatchObject({
      keyFingerprint: freeKey.parsed.fingerprint,
      state: 'CHALLENGE',
    });
  });
});
