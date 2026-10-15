import {
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
} from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import {
  ClientDevicesRepository,
  type ClientDeviceRow,
  type CreateEnrollmentChallengeInput,
  type CreateReplacementChallengeInput,
} from '../src/modules/licensing/data/client-devices.repository.js';
import {
  canonicalizeDeviceReplacementResponse,
  DeviceLifecycleError,
  parseDevicePublicKey,
  verifyDeviceReplacementResponse,
  type DeviceReplacementResponsePayload,
} from '../src/modules/licensing/domain/client-device.js';
import {
  parsePrivateKey,
  parsePublicKey,
} from '../src/modules/licensing/domain/license-code.js';
import { toTrustedKeys } from '../src/modules/licensing/domain/license-document.js';
import { generateAuthorityKeyPair } from '../src/tools/development-license-authority.js';
import { createTestApp } from './support/test-app.js';

const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];
const NOW = new Date();
const CUSTOMER_CODE = `CUST-OQ83-${generateId().slice(-8)}`;
const AUTHORITY_KEY_ID = 'oq83-ci-authority';

interface LiveIds {
  installationId: string;
  customerId: string;
  licenseId: string;
  versionId: string;
  customerCode: string;
}

interface RawClient {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T[]>;
}

function deviceKeyPair() {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64url');
  return {
    publicKey,
    privateKey: pair.privateKey,
    parsed: parseDevicePublicKey(publicKey),
  };
}

function signText(
  text: string,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
): string {
  return cryptoSign(null, Buffer.from(text, 'utf8'), privateKey).toString(
    'base64url',
  );
}

/** PostgreSQL proof of device quota locking and atomic retained lifecycle. */
describe.skipIf(DATABASE_URL === undefined)(
  'Client-device lifecycle persistence (live PostgreSQL, OQ-83)',
  () => {
    const authority = generateAuthorityKeyPair();
    const ids: LiveIds = {
      installationId: generateId(),
      customerId: generateId(),
      licenseId: generateId(),
      versionId: generateId(),
      customerCode: CUSTOMER_CODE,
    };
    let app: INestApplication;
    let prisma: PrismaService;

    async function db(): Promise<RawClient> {
      return prisma.getClient<RawClient>();
    }

    async function seedSignedLicense(): Promise<void> {
      const client = await db();
      const documentHash = createHash('sha256')
        .update(`oq83-live-device-license:${ids.installationId}`)
        .digest('hex');
      const at = new Date(NOW.getTime() - 60_000);
      await client.$executeRawUnsafe(
        `INSERT INTO "licensing"."customers"
          ("id", "customer_code", "display_name", "created_at", "updated_at")
         VALUES ($1, $2, $3, $4, $4)`,
        ids.customerId,
        ids.customerCode,
        'OQ-83 live test customer',
        at,
      );
      await client.$executeRawUnsafe(
        `INSERT INTO "licensing"."installations"
          ("id", "customer_id", "name", "is_self", "created_at", "updated_at")
         VALUES ($1, $2, $3, FALSE, $4, $4)`,
        ids.installationId,
        ids.customerId,
        'OQ-83 live test installation',
        at,
      );
      await client.$executeRawUnsafe(
        `INSERT INTO "licensing"."licenses"
          ("id", "installation_id", "customer_id", "created_at", "updated_at")
         VALUES ($1, $2, $3, $4, $4)`,
        ids.licenseId,
        ids.installationId,
        ids.customerId,
        at,
      );
      await client.$executeRawUnsafe(
        `INSERT INTO "licensing"."license_versions"
          ("id", "license_id", "installation_id", "operation_id", "status",
           "provider", "document_version", "document_hash", "key_id", "source",
           "valid_from", "valid_until", "organization_limit", "user_limit",
           "device_limit", "device_limit_specified", "imported_at",
           "supersedes_version_id", "superseded_at", "governs_until",
           "superseded_by_version_id", "created_at", "updated_at")
         VALUES ($1, $2, $3, $4, 'ACTIVE', 'persistent', 2, $5, NULL, 'file',
                 $6, NULL, NULL, NULL, 1, TRUE, $7, NULL, NULL, NULL, NULL, $7, $7)`,
        ids.versionId,
        ids.licenseId,
        ids.installationId,
        generateId(),
        documentHash,
        at,
        at,
      );
    }

    async function enrollmentInput(
      key: ReturnType<typeof deviceKeyPair>,
    ): Promise<CreateEnrollmentChallengeInput> {
      return {
        installationId: ids.installationId,
        challengeId: generateId(),
        operationId: generateId(),
        deviceId: generateId(),
        publicKey: key.parsed.encoded,
        keyFingerprint: key.parsed.fingerprint,
        nonce: Buffer.from(generateId()).toString('base64url').padEnd(32, 'x'),
        issuedAt: NOW,
        expiresAt: new Date(NOW.getTime() + 15 * 60_000),
        actorId: null,
      };
    }

    async function replacementInput(
      oldDeviceId: string,
      key: ReturnType<typeof deviceKeyPair>,
    ): Promise<CreateReplacementChallengeInput> {
      return {
        installationId: ids.installationId,
        requestId: generateId(),
        challengeId: generateId(),
        operationId: generateId(),
        oldDeviceId,
        newDeviceId: generateId(),
        publicKey: key.parsed.encoded,
        keyFingerprint: key.parsed.fingerprint,
        nonce: Buffer.from(generateId()).toString('base64url').padEnd(32, 'x'),
        issuedAt: NOW,
        challengeExpiresAt: new Date(NOW.getTime() + 15 * 60_000),
        requestExpiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60_000),
        actorId: null,
      };
    }

    async function activate(
      input: CreateEnrollmentChallengeInput,
      key: ReturnType<typeof deviceKeyPair>,
    ): Promise<ClientDeviceRow> {
      const challenge = await app
        .get(ClientDevicesRepository)
        .createEnrollmentChallenge(input);
      const signature = signText(challenge.canonicalPayload, key.privateKey);
      return app.get(ClientDevicesRepository).activateEnrollment({
        installationId: ids.installationId,
        challengeId: challenge.id,
        canonicalPayload: challenge.canonicalPayload,
        signature,
        actorId: null,
        now: NOW,
      });
    }

    async function responseFor(params: {
      request: Awaited<
        ReturnType<ClientDevicesRepository['proveReplacement']>
      >['request'];
      oldDeviceId: string;
      newDeviceKey: ReturnType<typeof deviceKeyPair>;
    }): Promise<{
      response: DeviceReplacementResponsePayload;
      responseHash: string;
      source: 'text' | 'file';
    }> {
      const payload: DeviceReplacementResponsePayload = {
        format: 'VDRP1',
        responseOperationId: generateId(),
        keyId: AUTHORITY_KEY_ID,
        requestId: params.request.id,
        challengeId: params.request.challengeId,
        requestOperationId: params.request.operationId,
        requestHash: params.request.requestHash!,
        installationId: ids.installationId,
        customerId: ids.customerId,
        customerCode: ids.customerCode,
        licenseId: ids.licenseId,
        licenseVersionId: ids.versionId,
        oldDeviceId: params.oldDeviceId,
        newDeviceId: params.request.newDeviceId,
        publicKeyFingerprint: params.newDeviceKey.parsed.fingerprint,
        decision: 'APPROVE',
        issuedAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + 24 * 60 * 60_000).toISOString(),
      };
      const canonical = canonicalizeDeviceReplacementResponse(payload);
      const artifact = [
        'VDRP1',
        Buffer.from(canonical, 'utf8').toString('base64url'),
        signText(canonical, parsePrivateKey(authority.privateKey)),
      ].join('.');
      const verified = verifyDeviceReplacementResponse(
        artifact,
        toTrustedKeys([
          { id: AUTHORITY_KEY_ID, key: parsePublicKey(authority.publicKey) },
        ]),
      );
      return {
        response: verified.payload,
        responseHash: verified.artifactHash,
        source: verified.transport,
      };
    }

    beforeAll(async () => {
      const base = loadAppConfig();
      const built = await createTestApp({
        override: (builder) =>
          builder.overrideProvider(APP_CONFIG).useValue({
            ...base,
            databaseUrl: DATABASE_URL,
            licensing: {
              ...base.licensing,
              provider: 'persistent',
              signingPublicKeys: [authority.publicKey],
            },
          }),
      });
      app = built.app;
      prisma = app.get(PrismaService);
      await seedSignedLicense();
    }, 60_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        const client = await db();
        const replacementDevices = await client.$queryRawUnsafe<{
          id: string;
          key_fingerprint: string;
        }>(
          `SELECT "id", "key_fingerprint" FROM "licensing"."client_devices"
            WHERE "installation_id" = $1 AND "replacement_request_id" IS NOT NULL`,
          ids.installationId,
        );
        for (const device of replacementDevices) {
          const challengeId = generateId();
          const cleanupAt = new Date(NOW.getTime() - 1_000);
          await client.$executeRawUnsafe(
            `INSERT INTO "licensing"."device_enrollment_challenges"
              ("id", "installation_id", "operation_id", "device_id",
               "key_fingerprint", "public_key", "customer_id", "customer_code",
               "license_id", "license_version_id", "canonical_payload",
               "issued_at", "expires_at", "state", "consumed_at", "created_at")
             VALUES ($1, $2, $3, $4, $5, 'cleanup-only', $6, $7, $8, $9,
                     'cleanup-only', $10, $11, 'EXPIRED', NULL, $10)`,
            challengeId,
            ids.installationId,
            generateId(),
            device.id,
            device.key_fingerprint,
            ids.customerId,
            ids.customerCode,
            ids.licenseId,
            ids.versionId,
            cleanupAt,
            new Date(cleanupAt.getTime() + 1_000),
          );
          await client.$executeRawUnsafe(
            `UPDATE "licensing"."client_devices"
                SET "enrollment_challenge_id" = $1, "replacement_request_id" = NULL
              WHERE "installation_id" = $2 AND "id" = $3`,
            challengeId,
            ids.installationId,
            device.id,
          );
        }
        await client.$executeRawUnsafe(
          `UPDATE "licensing"."client_devices"
              SET "status" = 'DEACTIVATED', "deactivated_at" = COALESCE("deactivated_at", $1),
                  "replaced_at" = NULL, "replaced_by_device_id" = NULL
            WHERE "installation_id" = $2 AND "status" = 'REPLACED'`,
          NOW,
          ids.installationId,
        );
        await client.$executeRawUnsafe(
          'DELETE FROM "licensing"."client_device_replacement_requests" WHERE "installation_id" = $1',
          ids.installationId,
        );
        await client.$executeRawUnsafe(
          'DELETE FROM "licensing"."client_devices" WHERE "installation_id" = $1',
          ids.installationId,
        );
        await client.$executeRawUnsafe(
          'DELETE FROM "licensing"."device_enrollment_challenges" WHERE "installation_id" = $1',
          ids.installationId,
        );
        await client.$executeRawUnsafe(
          'DELETE FROM "licensing"."license_audit_events" WHERE "installation_id" = $1',
          ids.installationId,
        );
        await client.$executeRawUnsafe(
          'DELETE FROM "licensing"."license_version_entitlements" WHERE "version_id" = $1',
          ids.versionId,
        );
        await client.$executeRawUnsafe(
          'DELETE FROM "licensing"."license_versions" WHERE "installation_id" = $1',
          ids.installationId,
        );
        await client.$executeRawUnsafe(
          'DELETE FROM "licensing"."licenses" WHERE "installation_id" = $1',
          ids.installationId,
        );
        await client.$executeRawUnsafe(
          'DELETE FROM "licensing"."installations" WHERE "id" = $1',
          ids.installationId,
        );
        await client.$executeRawUnsafe(
          'DELETE FROM "licensing"."customers" WHERE "id" = $1',
          ids.customerId,
        );
      } finally {
        await app.close();
      }
    }, 60_000);

    it('serializes enrollment, enforces signed quota, completes replacement atomically, and retains history', async () => {
      const devices = app.get(ClientDevicesRepository);
      const firstKey = deviceKeyPair();
      const secondKey = deviceKeyPair();
      const [firstInput, secondInput] = await Promise.all([
        enrollmentInput(firstKey),
        enrollmentInput(secondKey),
      ]);
      await Promise.all([
        devices.createEnrollmentChallenge(firstInput),
        devices.createEnrollmentChallenge(secondInput),
      ]);

      // Two one-use challenges race for one signed slot. The shared PostgreSQL
      // installation/device lock lets exactly one proof consume quota.
      const attempts = await Promise.allSettled([
        activate(firstInput, firstKey),
        activate(secondInput, secondKey),
      ]);
      const activated = attempts.filter(
        (result): result is PromiseFulfilledResult<ClientDeviceRow> =>
          result.status === 'fulfilled',
      );
      const rejected = attempts.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      expect(activated).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(DeviceLifecycleError);
      expect(rejected[0]?.reason).toMatchObject({
        reason: 'device-limit-reached',
      });
      const oldDevice = activated[0]!.value;
      expect(await devices.countActiveDevices(ids.installationId)).toBe(1);
      const stillPendingKey =
        oldDevice.keyFingerprint === firstKey.parsed.fingerprint
          ? secondKey
          : firstKey;
      await expect(
        devices.createReplacementChallenge(
          await replacementInput(oldDevice.id, stillPendingKey),
        ),
      ).rejects.toMatchObject({ reason: 'replacement-device-key-used' });
      await expect(
        devices.createEnrollmentChallenge(
          await enrollmentInput(deviceKeyPair()),
        ),
      ).rejects.toMatchObject({ reason: 'device-limit-reached' });

      // A replacement challenge does not consume another slot. Once proved,
      // the request is durable; cancellation is terminal and cannot be revived
      // by importing a valid response for that request.
      const cancelledKey = deviceKeyPair();
      const cancelledInput = await replacementInput(oldDevice.id, cancelledKey);
      const cancelledChallenge =
        await devices.createReplacementChallenge(cancelledInput);
      const cancelledSignature = signText(
        cancelledChallenge.canonicalPayload,
        cancelledKey.privateKey,
      );
      const cancelledProof = await devices.proveReplacement({
        installationId: ids.installationId,
        requestId: cancelledChallenge.id,
        canonicalPayload: cancelledChallenge.canonicalPayload,
        signature: cancelledSignature,
        actorId: null,
        now: NOW,
      });
      await expect(
        devices.deactivate({
          installationId: ids.installationId,
          deviceId: oldDevice.id,
          operationId: generateId(),
          actorId: null,
          now: NOW,
        }),
      ).rejects.toMatchObject({ reason: 'device-operation-conflict' });
      const cancelledResponse = await responseFor({
        request: cancelledProof.request,
        oldDeviceId: oldDevice.id,
        newDeviceKey: cancelledKey,
      });
      await devices.cancelReplacement({
        installationId: ids.installationId,
        requestId: cancelledChallenge.id,
        operationId: generateId(),
        actorId: null,
        now: NOW,
      });
      await expect(
        devices.completeReplacement({
          installationId: ids.installationId,
          requestId: cancelledChallenge.id,
          ...cancelledResponse,
          actorId: null,
          now: NOW,
        }),
      ).rejects.toMatchObject({ reason: 'replacement-request-cancelled' });
      expect(await devices.countActiveDevices(ids.installationId)).toBe(1);

      const replacementKey = deviceKeyPair();
      const replacementInputValue = await replacementInput(
        oldDevice.id,
        replacementKey,
      );
      const challenge = await devices.createReplacementChallenge(
        replacementInputValue,
      );
      const proofSignature = signText(
        challenge.canonicalPayload,
        replacementKey.privateKey,
      );
      const proved = await devices.proveReplacement({
        installationId: ids.installationId,
        requestId: challenge.id,
        canonicalPayload: challenge.canonicalPayload,
        signature: proofSignature,
        actorId: null,
        now: NOW,
      });
      const verifiedResponse = await responseFor({
        request: proved.request,
        oldDeviceId: oldDevice.id,
        newDeviceKey: replacementKey,
      });
      const result = await devices.completeReplacement({
        installationId: ids.installationId,
        requestId: challenge.id,
        ...verifiedResponse,
        actorId: null,
        now: NOW,
      });

      expect(result.oldDevice.status).toBe('REPLACED');
      expect(result.newDevice.status).toBe('ACTIVE');
      expect(result.request.state).toBe('COMPLETED');
      expect(await devices.countActiveDevices(ids.installationId)).toBe(1);
      await expect(
        devices.completeReplacement({
          installationId: ids.installationId,
          requestId: challenge.id,
          ...verifiedResponse,
          actorId: null,
          now: NOW,
        }),
      ).rejects.toMatchObject({ reason: 'replacement-response-replayed' });

      await devices.deactivate({
        installationId: ids.installationId,
        deviceId: result.newDevice.id,
        operationId: generateId(),
        actorId: null,
        now: NOW,
      });
      expect(await devices.countActiveDevices(ids.installationId)).toBe(0);
      const history = await devices.deviceHistory({
        installationId: ids.installationId,
        deviceId: oldDevice.id,
      });
      expect(history?.device.status).toBe('REPLACED');
      expect(history?.events.map(({ eventType }) => eventType)).toEqual(
        expect.arrayContaining([
          'license.device.activated',
          'license.device.replacement-requested',
          'license.device.replacement-cancelled',
          'license.device.replaced',
          'license.device.replacement-completed',
        ]),
      );
      const inventory = await devices.inventory(ids.installationId);
      expect(inventory.devices).toHaveLength(2);
      expect(inventory.devices.map(({ status }) => status).sort()).toEqual([
        'DEACTIVATED',
        'REPLACED',
      ]);
      expect(inventory.replacements.map(({ state }) => state).sort()).toEqual([
        'CANCELLED',
        'COMPLETED',
      ]);

      // Pending replacement and enrollment keys share the installation lock
      // and cannot be claimed through the other lifecycle table.
      const additionalKey = deviceKeyPair();
      const additionalDevice = await activate(
        await enrollmentInput(additionalKey),
        additionalKey,
      );
      const crossTableKey = deviceKeyPair();
      const crossTableReplacement = await devices.createReplacementChallenge(
        await replacementInput(additionalDevice.id, crossTableKey),
      );
      await devices.deactivate({
        installationId: ids.installationId,
        deviceId: additionalDevice.id,
        operationId: generateId(),
        actorId: null,
        now: NOW,
      });
      await expect(
        devices.createEnrollmentChallenge(await enrollmentInput(crossTableKey)),
      ).rejects.toMatchObject({ reason: 'device-operation-conflict' });
      expect(crossTableReplacement.state).toBe('CHALLENGE');
      expect(await devices.countActiveDevices(ids.installationId)).toBe(0);
    }, 60_000);

    it('expires pending replacement exports when their bound signed license version changes', async () => {
      const devices = app.get(ClientDevicesRepository);
      const oldDeviceKey = deviceKeyPair();
      const oldDevice = await activate(
        await enrollmentInput(oldDeviceKey),
        oldDeviceKey,
      );
      const replacementKey = deviceKeyPair();
      const challenge = await devices.createReplacementChallenge(
        await replacementInput(oldDevice.id, replacementKey),
      );
      const proof = await devices.proveReplacement({
        installationId: ids.installationId,
        requestId: challenge.id,
        canonicalPayload: challenge.canonicalPayload,
        signature: signText(
          challenge.canonicalPayload,
          replacementKey.privateKey,
        ),
        actorId: null,
        now: NOW,
      });
      expect(proof.request.state).toBe('PENDING');

      const cutover = new Date(NOW.getTime() + 1_000);
      const nextVersionId = generateId();
      const client = await db();
      const nextHash = createHash('sha256')
        .update(`oq83-live-license-version:${nextVersionId}`)
        .digest('hex');
      await client.$executeRawUnsafe(
        `INSERT INTO "licensing"."license_versions"
          ("id", "license_id", "installation_id", "operation_id", "status",
           "provider", "document_version", "document_hash", "key_id", "source",
           "valid_from", "valid_until", "organization_limit", "user_limit",
           "device_limit", "device_limit_specified", "imported_at",
           "supersedes_version_id", "superseded_at", "governs_until",
           "superseded_by_version_id", "created_at", "updated_at")
         VALUES ($1, $2, $3, $4, 'ACTIVE', 'persistent', 2, $5, NULL, 'file',
                 $6, NULL, NULL, NULL, 2, TRUE, $6, $7, NULL, NULL, NULL, $6, $6)`,
        nextVersionId,
        ids.licenseId,
        ids.installationId,
        generateId(),
        nextHash,
        cutover,
        ids.versionId,
      );
      await client.$executeRawUnsafe(
        `UPDATE "licensing"."license_versions"
            SET "superseded_at" = $1, "governs_until" = $1,
                "superseded_by_version_id" = $2, "updated_at" = $1
          WHERE "installation_id" = $3 AND "id" = $4`,
        cutover,
        nextVersionId,
        ids.installationId,
        ids.versionId,
      );

      await devices.expireStaleOperations(ids.installationId, cutover, null);
      const inventory = await devices.inventory(ids.installationId);
      expect(
        inventory.replacements.find(({ id }) => id === challenge.id)?.state,
      ).toBe('EXPIRED');
      await expect(
        devices.replacementRequestExport({
          installationId: ids.installationId,
          requestId: challenge.id,
          actorId: null,
          now: cutover,
        }),
      ).rejects.toMatchObject({ reason: 'replacement-request-expired' });
      const history = await devices.deviceHistory({
        installationId: ids.installationId,
        deviceId: oldDevice.id,
      });
      expect(history?.device.status).toBe('ACTIVE');
      expect(history?.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: 'license.device.replacement-expired',
            reason: 'license-context-changed',
          }),
        ]),
      );
      expect(await devices.countActiveDevices(ids.installationId)).toBe(1);
    }, 60_000);
  },
);
