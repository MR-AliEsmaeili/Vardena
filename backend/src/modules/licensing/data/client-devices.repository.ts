import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { generateId } from '../../../kernel/ids/ulid.js';
import { CUSTOMER_CODE_PATTERN } from '../domain/customer.js';
import {
  PrismaService,
  type DatabaseTransaction,
} from '../../../kernel/prisma/prisma.service.js';
import { evaluateLicense, type LicenseLimit } from '../domain/license.js';
import {
  canonicalizeDeviceReplacementChallenge,
  canonicalizeEnrollmentChallenge,
  DeviceLifecycleError,
  DeviceProtocolError,
  serializeDeviceReplacementRequestArtifact,
  validateDeviceReplacementCorrelation,
  verifyDeviceProof as verifyDeviceProofDomain,
  type DeviceLifecycleErrorReason,
  type DeviceReplacementChallengePayload,
  type DeviceReplacementResponsePayload,
  type EnrollmentChallengePayload,
} from '../domain/client-device.js';
import {
  toInstallationLicense,
  type RetainedLicenseVersion,
} from '../domain/license-version.js';
import {
  LicensesRepository,
  type LicenseAuditEventCommand,
} from './licenses.repository.js';

export type ClientDeviceStatus = 'ACTIVE' | 'DEACTIVATED' | 'REPLACED';
export type EnrollmentChallengeState = 'PENDING' | 'CONSUMED' | 'EXPIRED';
export type DeviceReplacementState =
  'CHALLENGE' | 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export interface ClientDeviceRow {
  id: string;
  installationId: string;
  operationId: string;
  keyFingerprint: string;
  publicKey: string;
  status: ClientDeviceStatus;
  activatedAt: Date;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  replacedAt: Date | null;
  replacedByDeviceId: string | null;
  enrollmentChallengeId: string | null;
  replacementRequestId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface DeviceEnrollmentChallengeRow {
  id: string;
  installationId: string;
  operationId: string;
  deviceId: string;
  keyFingerprint: string;
  publicKey: string;
  customerId: string;
  customerCode: string;
  licenseId: string;
  licenseVersionId: string;
  canonicalPayload: string;
  issuedAt: Date;
  expiresAt: Date;
  state: EnrollmentChallengeState;
  consumedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface ClientDeviceReplacementRequestRow {
  id: string;
  installationId: string;
  challengeId: string;
  operationId: string;
  oldDeviceId: string;
  newDeviceId: string;
  keyFingerprint: string;
  publicKey: string;
  nonce: string;
  canonicalPayload: string;
  requestSignature: string | null;
  requestHash: string | null;
  customerId: string;
  customerCode: string;
  licenseId: string;
  licenseVersionId: string;
  issuedAt: Date;
  challengeExpiresAt: Date;
  requestExpiresAt: Date;
  state: DeviceReplacementState;
  responseOperationId: string | null;
  responseHash: string | null;
  responseKeyId: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  expiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ClientDeviceAuditRow {
  id: string;
  installationId: string;
  eventType: string;
  outcome: 'APPLIED' | 'REJECTED' | 'UNCHANGED';
  operationId: string | null;
  licenseId: string | null;
  versionId: string | null;
  deviceId: string | null;
  replacementRequestId: string | null;
  actorId: string | null;
  source: string;
  documentHash: string | null;
  reason: string | null;
  detail: string | null;
  occurredAt: Date;
}

interface DeviceWhere {
  installationId: string;
  id?: string;
  keyFingerprint?: string;
  status?: ClientDeviceStatus;
}

interface DeviceCreateData {
  id: string;
  installationId: string;
  operationId: string;
  keyFingerprint: string;
  publicKey: string;
  status: ClientDeviceStatus;
  activatedAt: Date;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  replacedAt: Date | null;
  replacedByDeviceId: string | null;
  enrollmentChallengeId: string | null;
  replacementRequestId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

interface DeviceDelegate {
  findMany(args: {
    where: { installationId: string };
    orderBy: { activatedAt: 'desc' };
  }): Promise<ClientDeviceRow[]>;
  findFirst(args: { where: DeviceWhere }): Promise<ClientDeviceRow | null>;
  count(args: {
    where: { installationId: string; status: ClientDeviceStatus };
  }): Promise<number>;
  create(args: { data: DeviceCreateData }): Promise<ClientDeviceRow>;
  updateMany(args: {
    where: DeviceWhere;
    data: Partial<Omit<DeviceCreateData, 'id' | 'installationId'>>;
  }): Promise<{ count: number }>;
}

interface EnrollmentWhere {
  installationId: string;
  id?: string;
  keyFingerprint?: string;
  state?: EnrollmentChallengeState;
}

interface EnrollmentDelegate {
  findFirst(args: {
    where: EnrollmentWhere;
  }): Promise<DeviceEnrollmentChallengeRow | null>;
  findMany(args: {
    where: { installationId: string; state: EnrollmentChallengeState };
  }): Promise<DeviceEnrollmentChallengeRow[]>;
  create(args: {
    data: DeviceEnrollmentChallengeRow;
  }): Promise<DeviceEnrollmentChallengeRow>;
  updateMany(args: {
    where: EnrollmentWhere;
    data: { state: EnrollmentChallengeState; consumedAt?: Date | null };
  }): Promise<{ count: number }>;
}

interface ReplacementWhere {
  installationId: string;
  id?: string;
  keyFingerprint?: string;
  oldDeviceId?: string;
  newDeviceId?: string;
  responseOperationId?: string;
  state?: DeviceReplacementState | { in: DeviceReplacementState[] };
}

interface ReplacementDelegate {
  findFirst(args: {
    where: ReplacementWhere;
  }): Promise<ClientDeviceReplacementRequestRow | null>;
  findMany(args: {
    where: ReplacementWhere;
    orderBy?: { createdAt: 'desc' };
  }): Promise<ClientDeviceReplacementRequestRow[]>;
  create(args: {
    data: ClientDeviceReplacementRequestRow;
  }): Promise<ClientDeviceReplacementRequestRow>;
  updateMany(args: {
    where: ReplacementWhere;
    data: Partial<ClientDeviceReplacementRequestRow>;
  }): Promise<{ count: number }>;
}

interface AuditWhere {
  installationId: string;
  deviceId?: string;
  replacementRequestId?: string;
  OR?: Array<{ deviceId: string } | { replacementRequestId: { in: string[] } }>;
}

interface AuditDelegate {
  create(args: {
    data: Omit<ClientDeviceAuditRow, 'id'> & {
      id: string;
      createdAt: Date;
      updatedAt: Date;
      previousCustomerId: null;
      previousCustomerCode: null;
      newCustomerId: null;
      newCustomerCode: null;
      previousLicenseId: null;
    };
  }): Promise<unknown>;
  findMany(args: {
    where: AuditWhere;
    orderBy: { occurredAt: 'desc' };
    take: number;
  }): Promise<ClientDeviceAuditRow[]>;
}

interface Client {
  clientDevice: DeviceDelegate;
  deviceEnrollmentChallenge: EnrollmentDelegate;
  clientDeviceReplacementRequest: ReplacementDelegate;
  licenseAuditEvent: AuditDelegate;
}

export interface CreateEnrollmentChallengeInput {
  installationId: string;
  challengeId: string;
  operationId: string;
  deviceId: string;
  publicKey: string;
  keyFingerprint: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
  actorId: string | null;
}

export interface CreateReplacementChallengeInput {
  installationId: string;
  requestId: string;
  challengeId: string;
  operationId: string;
  oldDeviceId: string;
  newDeviceId: string;
  publicKey: string;
  keyFingerprint: string;
  nonce: string;
  issuedAt: Date;
  challengeExpiresAt: Date;
  requestExpiresAt: Date;
  actorId: string | null;
}

export interface ClientDeviceInventory {
  devices: ClientDeviceRow[];
  activeDeviceCount: number;
  replacements: ClientDeviceReplacementRequestRow[];
}

/**
 * Persistence boundary for Licensing-owned client-device identities and
 * lifecycle. All allocation writes take the installation row lock followed by
 * the same `devices` advisory lock as signed-license import; data never leaves
 * the Licensing module.
 */
@Injectable()
export class ClientDevicesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly licenses: LicensesRepository,
  ) {}

  /**
   * Persist time-based and signed-license-context terminal transitions before
   * a read or operation relies on pending-state indexes. The update and its
   * audit rows share the installation and device-allocation locks.
   */
  async expireStaleOperations(
    installationId: string,
    now: Date,
    actorId: string | null,
  ): Promise<void> {
    await this.prisma.inTransaction(async (transaction) => {
      const client = await this.prisma.getClient<Client>(transaction);
      const context = await this.lockedLicenseContext(
        transaction,
        installationId,
        now,
      );
      await this.expireStaleOperationsInTransaction(
        client,
        installationId,
        now,
        actorId,
        context,
      );
    });
  }

  /** The L-04 device usage count; called while license import holds its lock. */
  async countActiveDevices(installationId: string): Promise<number> {
    const { clientDevice } = await this.prisma.getClient<Client>();
    return clientDevice.count({
      where: { installationId, status: 'ACTIVE' },
    });
  }

  async inventory(installationId: string): Promise<ClientDeviceInventory> {
    const { clientDevice, clientDeviceReplacementRequest } =
      await this.prisma.getClient<Client>();
    const [devices, replacements] = await Promise.all([
      clientDevice.findMany({
        where: { installationId },
        orderBy: { activatedAt: 'desc' },
      }),
      clientDeviceReplacementRequest.findMany({
        where: { installationId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      devices,
      activeDeviceCount: devices.filter((device) => device.status === 'ACTIVE')
        .length,
      replacements,
    };
  }

  async findEnrollmentChallenge(
    installationId: string,
    challengeId: string,
  ): Promise<DeviceEnrollmentChallengeRow | null> {
    const { deviceEnrollmentChallenge } = await this.prisma.getClient<Client>();
    return deviceEnrollmentChallenge.findFirst({
      where: { installationId, id: challengeId },
    });
  }

  async createEnrollmentChallenge(
    input: CreateEnrollmentChallengeInput,
  ): Promise<DeviceEnrollmentChallengeRow> {
    return this.prisma.inTransaction(async (transaction) => {
      const client = await this.prisma.getClient<Client>(transaction);
      const context = await this.requireActiveSignedLicense(
        transaction,
        input.installationId,
        input.issuedAt,
      );
      await this.expireStaleOperationsInTransaction(
        client,
        input.installationId,
        input.issuedAt,
        input.actorId,
        context,
      );
      this.assertQuota(
        context,
        await this.activeCount(client, input.installationId),
      );

      const existingDevice = await client.clientDevice.findFirst({
        where: {
          installationId: input.installationId,
          keyFingerprint: input.keyFingerprint,
        },
      });
      if (existingDevice !== null) {
        throw lifecycleError(
          'device-key-already-registered',
          'This device key already has a retained device record.',
        );
      }
      const existingChallenge =
        await client.deviceEnrollmentChallenge.findFirst({
          where: {
            installationId: input.installationId,
            keyFingerprint: input.keyFingerprint,
            state: 'PENDING',
          },
        });
      if (existingChallenge !== null) {
        throw lifecycleError(
          'device-operation-conflict',
          'A challenge for this device key is already pending.',
        );
      }
      const existingReplacement =
        await client.clientDeviceReplacementRequest.findFirst({
          where: {
            installationId: input.installationId,
            keyFingerprint: input.keyFingerprint,
            state: { in: ['CHALLENGE', 'PENDING'] },
          },
        });
      if (existingReplacement !== null) {
        throw lifecycleError(
          'device-operation-conflict',
          'This device key is already part of a pending replacement.',
        );
      }

      const payload: EnrollmentChallengePayload = {
        format: 'VDEA1',
        challengeId: input.challengeId,
        operationId: input.operationId,
        deviceId: input.deviceId,
        installationId: input.installationId,
        customerId: context.version.customerId,
        customerCode: context.version.customerCode,
        licenseId: context.version.licenseId,
        licenseVersionId: context.version.versionId,
        purpose: 'DEVICE_ENROLLMENT',
        publicKey: input.publicKey,
        publicKeyFingerprint: input.keyFingerprint,
        nonce: input.nonce,
        issuedAt: input.issuedAt.toISOString(),
        expiresAt: input.expiresAt.toISOString(),
      };
      const canonicalPayload = canonicalizeEnrollmentChallenge(payload);
      const row = await client.deviceEnrollmentChallenge.create({
        data: {
          id: input.challengeId,
          installationId: input.installationId,
          operationId: input.operationId,
          deviceId: input.deviceId,
          keyFingerprint: input.keyFingerprint,
          publicKey: input.publicKey,
          customerId: context.version.customerId,
          customerCode: context.version.customerCode,
          licenseId: context.version.licenseId,
          licenseVersionId: context.version.versionId,
          canonicalPayload,
          issuedAt: input.issuedAt,
          expiresAt: input.expiresAt,
          state: 'PENDING',
          consumedAt: null,
          createdAt: input.issuedAt,
          createdBy: input.actorId,
        },
      });
      await this.createAuditEvent(client, {
        installationId: input.installationId,
        eventType: 'license.device.enrollment-challenge-issued',
        outcome: 'APPLIED',
        operationId: input.operationId,
        licenseId: context.version.licenseId,
        versionId: context.version.versionId,
        deviceId: input.deviceId,
        replacementRequestId: null,
        actorId: input.actorId,
        source: 'api',
        documentHash: null,
        reason: null,
        detail: null,
        occurredAt: input.issuedAt,
      });
      return row;
    });
  }

  async activateEnrollment(input: {
    installationId: string;
    challengeId: string;
    canonicalPayload: string;
    signature: string;
    actorId: string | null;
    now: Date;
  }): Promise<ClientDeviceRow> {
    return this.prisma.inTransaction(async (transaction) => {
      const client = await this.prisma.getClient<Client>(transaction);
      const context = await this.requireActiveSignedLicense(
        transaction,
        input.installationId,
        input.now,
      );
      const challenge = await client.deviceEnrollmentChallenge.findFirst({
        where: { installationId: input.installationId, id: input.challengeId },
      });
      if (challenge === null) {
        throw lifecycleError(
          'enrollment-challenge-not-found',
          'The device enrollment challenge was not found.',
        );
      }
      if (challenge.state === 'CONSUMED') {
        throw lifecycleError(
          'enrollment-challenge-consumed',
          'The device enrollment challenge has already been used.',
        );
      }
      if (challenge.state === 'EXPIRED' || challenge.expiresAt <= input.now) {
        throw lifecycleError(
          'enrollment-challenge-expired',
          'The device enrollment challenge has expired.',
        );
      }
      if (
        challenge.canonicalPayload !== input.canonicalPayload ||
        challenge.licenseVersionId !== context.version.versionId ||
        challenge.customerId !== context.version.customerId ||
        challenge.customerCode !== context.version.customerCode
      ) {
        throw lifecycleError(
          'enrollment-challenge-stale',
          'The enrollment challenge no longer matches the effective signed license.',
        );
      }
      const verified = verifyDeviceSignatureSafely({
        canonicalPayload: challenge.canonicalPayload,
        signature: input.signature,
        publicKey: challenge.publicKey,
      });
      if (!verified) {
        throw new DeviceProtocolError(
          'invalid-signature',
          'The device enrollment proof is invalid.',
        );
      }
      const duplicate = await client.clientDevice.findFirst({
        where: {
          installationId: input.installationId,
          keyFingerprint: challenge.keyFingerprint,
        },
      });
      if (duplicate !== null) {
        throw lifecycleError(
          'device-key-already-registered',
          'This device key already has a retained device record.',
        );
      }
      const replacementCollision =
        await client.clientDeviceReplacementRequest.findFirst({
          where: {
            installationId: input.installationId,
            keyFingerprint: challenge.keyFingerprint,
            state: { in: ['CHALLENGE', 'PENDING'] },
          },
        });
      if (replacementCollision !== null) {
        throw lifecycleError(
          'device-operation-conflict',
          'This device key is already part of a pending replacement.',
        );
      }
      const activeCount = await this.activeCount(client, input.installationId);
      this.assertQuota(context, activeCount);
      const changed = await client.deviceEnrollmentChallenge.updateMany({
        where: {
          installationId: input.installationId,
          id: challenge.id,
          state: 'PENDING',
        },
        data: { state: 'CONSUMED', consumedAt: input.now },
      });
      if (changed.count !== 1) {
        throw lifecycleError(
          'enrollment-challenge-consumed',
          'The device enrollment challenge has already been used.',
        );
      }
      const device = await client.clientDevice.create({
        data: {
          id: challenge.deviceId,
          installationId: input.installationId,
          operationId: challenge.operationId,
          keyFingerprint: challenge.keyFingerprint,
          publicKey: challenge.publicKey,
          status: 'ACTIVE',
          activatedAt: input.now,
          deactivatedAt: null,
          deactivatedBy: null,
          replacedAt: null,
          replacedByDeviceId: null,
          enrollmentChallengeId: challenge.id,
          replacementRequestId: null,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actorId,
          updatedBy: input.actorId,
        },
      });
      await this.createAuditEvent(client, {
        installationId: input.installationId,
        eventType: 'license.device.activated',
        outcome: 'APPLIED',
        operationId: challenge.operationId,
        licenseId: context.version.licenseId,
        versionId: context.version.versionId,
        deviceId: device.id,
        replacementRequestId: null,
        actorId: input.actorId,
        source: 'api',
        documentHash: null,
        reason: null,
        detail: null,
        occurredAt: input.now,
      });
      return device;
    });
  }

  async deactivate(input: {
    installationId: string;
    deviceId: string;
    operationId: string;
    actorId: string | null;
    now: Date;
  }): Promise<ClientDeviceRow> {
    return this.prisma.inTransaction(async (transaction) => {
      const client = await this.prisma.getClient<Client>(transaction);
      const context = await this.lockedLicenseContext(
        transaction,
        input.installationId,
        input.now,
      );
      const device = await client.clientDevice.findFirst({
        where: { installationId: input.installationId, id: input.deviceId },
      });
      if (device === null) {
        throw lifecycleError('device-not-found', 'The device was not found.');
      }
      if (device.status !== 'ACTIVE') {
        throw lifecycleError(
          'device-not-active',
          'Only an active device can be deactivated.',
        );
      }
      await this.expireStaleOperationsInTransaction(
        client,
        input.installationId,
        input.now,
        input.actorId,
        context,
      );
      const pendingReplacement =
        await client.clientDeviceReplacementRequest.findFirst({
          where: {
            installationId: input.installationId,
            oldDeviceId: device.id,
            state: 'PENDING',
          },
        });
      if (pendingReplacement !== null) {
        throw lifecycleError(
          'device-operation-conflict',
          'Cancel the pending replacement before deactivating this device.',
        );
      }
      const updated = await client.clientDevice.updateMany({
        where: {
          installationId: input.installationId,
          id: device.id,
          status: 'ACTIVE',
        },
        data: {
          status: 'DEACTIVATED',
          deactivatedAt: input.now,
          deactivatedBy: input.actorId,
          updatedAt: input.now,
          updatedBy: input.actorId,
        },
      });
      if (updated.count !== 1) {
        throw lifecycleError(
          'device-operation-conflict',
          'The device state changed before deactivation completed.',
        );
      }
      await this.createAuditEvent(client, {
        installationId: input.installationId,
        eventType: 'license.device.deactivated',
        outcome: 'APPLIED',
        operationId: input.operationId,
        licenseId: context.version?.licenseId ?? null,
        versionId: context.version?.versionId ?? null,
        deviceId: device.id,
        replacementRequestId: null,
        actorId: input.actorId,
        source: 'api',
        documentHash: null,
        reason: null,
        detail: null,
        occurredAt: input.now,
      });
      const after = await client.clientDevice.findFirst({
        where: { installationId: input.installationId, id: device.id },
      });
      if (after === null) throw new Error('Deactivated device disappeared.');
      return after;
    });
  }

  async createReplacementChallenge(
    input: CreateReplacementChallengeInput,
  ): Promise<ClientDeviceReplacementRequestRow> {
    return this.prisma.inTransaction(async (transaction) => {
      const client = await this.prisma.getClient<Client>(transaction);
      const context = await this.requireActiveSignedLicense(
        transaction,
        input.installationId,
        input.issuedAt,
      );
      await this.expireStaleOperationsInTransaction(
        client,
        input.installationId,
        input.issuedAt,
        input.actorId,
        context,
      );
      const oldDevice = await client.clientDevice.findFirst({
        where: { installationId: input.installationId, id: input.oldDeviceId },
      });
      if (oldDevice === null) {
        throw lifecycleError('device-not-found', 'The device was not found.');
      }
      if (oldDevice.status !== 'ACTIVE') {
        throw lifecycleError(
          'device-not-active',
          'Only an active device can be replaced.',
        );
      }
      const prior = await client.clientDeviceReplacementRequest.findFirst({
        where: {
          installationId: input.installationId,
          oldDeviceId: input.oldDeviceId,
          state: { in: ['CHALLENGE', 'PENDING'] },
        },
      });
      if (prior !== null) {
        throw lifecycleError(
          'replacement-already-pending',
          'A replacement is already in progress for this device.',
        );
      }
      if (oldDevice.keyFingerprint === input.keyFingerprint) {
        throw lifecycleError(
          'replacement-device-key-used',
          'A replacement must use a new device key.',
        );
      }
      const existingDevice = await client.clientDevice.findFirst({
        where: {
          installationId: input.installationId,
          keyFingerprint: input.keyFingerprint,
        },
      });
      if (existingDevice !== null) {
        throw lifecycleError(
          'replacement-device-key-used',
          'The replacement key is already associated with a retained device.',
        );
      }
      const pendingEnrollment =
        await client.deviceEnrollmentChallenge.findFirst({
          where: {
            installationId: input.installationId,
            keyFingerprint: input.keyFingerprint,
            state: 'PENDING',
          },
        });
      if (pendingEnrollment !== null) {
        throw lifecycleError(
          'replacement-device-key-used',
          'The replacement key is already part of a pending enrollment.',
        );
      }
      // The fingerprint belongs IN the lookup, not in a post-comparison: with
      // two pending requests in flight an unfiltered `findFirst` may return an
      // arbitrary row, let the duplicate through, and leave
      // `uq_device_replacement_requests_active_key_fingerprint` to reject the
      // insert — which reaches the client as an unmapped database error instead
      // of this stable reason.
      const existingRequest =
        await client.clientDeviceReplacementRequest.findFirst({
          where: {
            installationId: input.installationId,
            keyFingerprint: input.keyFingerprint,
            state: { in: ['CHALLENGE', 'PENDING'] },
          },
        });
      if (existingRequest !== null) {
        throw lifecycleError(
          'replacement-device-key-used',
          'The replacement key is already used by another pending request.',
        );
      }
      const payload: DeviceReplacementChallengePayload = {
        format: 'VDRQ1',
        requestId: input.requestId,
        challengeId: input.challengeId,
        operationId: input.operationId,
        installationId: input.installationId,
        customerId: context.version.customerId,
        customerCode: context.version.customerCode,
        licenseId: context.version.licenseId,
        licenseVersionId: context.version.versionId,
        oldDeviceId: input.oldDeviceId,
        newDeviceId: input.newDeviceId,
        publicKey: input.publicKey,
        publicKeyFingerprint: input.keyFingerprint,
        nonce: input.nonce,
        issuedAt: input.issuedAt.toISOString(),
        challengeExpiresAt: input.challengeExpiresAt.toISOString(),
        expiresAt: input.requestExpiresAt.toISOString(),
      };
      const canonicalPayload = canonicalizeDeviceReplacementChallenge(payload);
      const row = await client.clientDeviceReplacementRequest.create({
        data: {
          id: input.requestId,
          installationId: input.installationId,
          challengeId: input.challengeId,
          operationId: input.operationId,
          oldDeviceId: input.oldDeviceId,
          newDeviceId: input.newDeviceId,
          keyFingerprint: input.keyFingerprint,
          publicKey: input.publicKey,
          nonce: input.nonce,
          canonicalPayload,
          requestSignature: null,
          requestHash: null,
          customerId: context.version.customerId,
          customerCode: context.version.customerCode,
          licenseId: context.version.licenseId,
          licenseVersionId: context.version.versionId,
          issuedAt: input.issuedAt,
          challengeExpiresAt: input.challengeExpiresAt,
          requestExpiresAt: input.requestExpiresAt,
          state: 'CHALLENGE',
          responseOperationId: null,
          responseHash: null,
          responseKeyId: null,
          completedAt: null,
          cancelledAt: null,
          expiredAt: null,
          createdAt: input.issuedAt,
          updatedAt: input.issuedAt,
          createdBy: input.actorId,
          updatedBy: input.actorId,
        },
      });
      await this.createAuditEvent(client, {
        installationId: input.installationId,
        eventType: 'license.device.replacement-challenge-issued',
        outcome: 'APPLIED',
        operationId: input.operationId,
        licenseId: context.version.licenseId,
        versionId: context.version.versionId,
        deviceId: oldDevice.id,
        replacementRequestId: input.requestId,
        actorId: input.actorId,
        source: 'api',
        documentHash: null,
        reason: null,
        detail: null,
        occurredAt: input.issuedAt,
      });
      return row;
    });
  }

  async findReplacementRequest(
    installationId: string,
    requestId: string,
  ): Promise<ClientDeviceReplacementRequestRow | null> {
    const { clientDeviceReplacementRequest } =
      await this.prisma.getClient<Client>();
    return clientDeviceReplacementRequest.findFirst({
      where: { installationId, id: requestId },
    });
  }

  async proveReplacement(input: {
    installationId: string;
    requestId: string;
    canonicalPayload: string;
    signature: string;
    actorId: string | null;
    now: Date;
  }): Promise<{
    request: ClientDeviceReplacementRequestRow;
    artifact: string;
  }> {
    const result = await this.prisma.inTransaction(async (transaction) => {
      const client = await this.prisma.getClient<Client>(transaction);
      const context = await this.lockedLicenseContext(
        transaction,
        input.installationId,
        input.now,
      );
      const request = await client.clientDeviceReplacementRequest.findFirst({
        where: { installationId: input.installationId, id: input.requestId },
      });
      if (request === null) {
        throw lifecycleError(
          'replacement-request-not-found',
          'The device replacement request was not found.',
        );
      }
      if (request.state !== 'CHALLENGE') {
        throw lifecycleError(
          request.state === 'CANCELLED'
            ? 'replacement-request-cancelled'
            : 'replacement-request-not-pending',
          'The device replacement challenge is no longer pending.',
        );
      }
      if (
        request.challengeExpiresAt <= input.now ||
        request.requestExpiresAt <= input.now
      ) {
        throw lifecycleError(
          'replacement-request-expired',
          'The device replacement challenge has expired.',
        );
      }
      if (
        context.version === null ||
        !context.active ||
        !context.version.deviceLimitSpecified ||
        context.installation.customerId !== request.customerId ||
        context.version.versionId !== request.licenseVersionId ||
        context.version.customerCode !== request.customerCode
      ) {
        const failure = lifecycleError(
          'replacement-request-expired',
          'The replacement no longer matches the active signed license.',
        );
        await client.clientDeviceReplacementRequest.updateMany({
          where: {
            installationId: input.installationId,
            id: request.id,
            state: 'CHALLENGE',
          },
          data: {
            state: 'EXPIRED',
            expiredAt: input.now,
            updatedAt: input.now,
            updatedBy: input.actorId,
          },
        });
        await this.createAuditEvent(client, {
          installationId: input.installationId,
          eventType: 'license.device.replacement-expired',
          outcome: 'REJECTED',
          operationId: request.operationId,
          licenseId: request.licenseId,
          versionId: request.licenseVersionId,
          deviceId: request.oldDeviceId,
          replacementRequestId: request.id,
          actorId: input.actorId,
          source: 'api',
          documentHash: null,
          reason: 'license-version-changed',
          detail: null,
          occurredAt: input.now,
        });
        return { error: failure } as const;
      }
      if (request.canonicalPayload !== input.canonicalPayload) {
        throw lifecycleError(
          'replacement-request-not-pending',
          'The replacement challenge data does not match the retained request.',
        );
      }
      const validProof = verifyDeviceSignatureSafely({
        canonicalPayload: request.canonicalPayload,
        signature: input.signature,
        publicKey: request.publicKey,
      });
      if (!validProof) {
        throw new DeviceProtocolError(
          'invalid-signature',
          'The device replacement proof is invalid.',
        );
      }
      const oldDevice = await client.clientDevice.findFirst({
        where: {
          installationId: input.installationId,
          id: request.oldDeviceId,
        },
      });
      if (oldDevice === null || oldDevice.status !== 'ACTIVE') {
        const failure = lifecycleError(
          'replacement-request-expired',
          'The old device is no longer active.',
        );
        await client.clientDeviceReplacementRequest.updateMany({
          where: {
            installationId: input.installationId,
            id: request.id,
            state: 'CHALLENGE',
          },
          data: {
            state: 'EXPIRED',
            expiredAt: input.now,
            updatedAt: input.now,
            updatedBy: input.actorId,
          },
        });
        await this.createAuditEvent(client, {
          installationId: input.installationId,
          eventType: 'license.device.replacement-expired',
          outcome: 'REJECTED',
          operationId: request.operationId,
          licenseId: request.licenseId,
          versionId: request.licenseVersionId,
          deviceId: request.oldDeviceId,
          replacementRequestId: request.id,
          actorId: input.actorId,
          source: 'api',
          documentHash: null,
          reason: 'old-device-not-active',
          detail: null,
          occurredAt: input.now,
        });
        return { error: failure } as const;
      }
      const artifact = serializeDeviceReplacementRequestArtifact({
        canonicalPayload: request.canonicalPayload,
        signature: input.signature,
      });
      const requestHash = sha256(artifact);
      const updated = await client.clientDeviceReplacementRequest.updateMany({
        where: {
          installationId: input.installationId,
          id: request.id,
          state: 'CHALLENGE',
        },
        data: {
          state: 'PENDING',
          requestSignature: input.signature,
          requestHash,
          updatedAt: input.now,
          updatedBy: input.actorId,
        },
      });
      if (updated.count !== 1) {
        throw lifecycleError(
          'replacement-request-not-pending',
          'The replacement request is no longer pending.',
        );
      }
      await this.createAuditEvent(client, {
        installationId: input.installationId,
        eventType: 'license.device.replacement-requested',
        outcome: 'APPLIED',
        operationId: request.operationId,
        licenseId: request.licenseId,
        versionId: request.licenseVersionId,
        deviceId: request.oldDeviceId,
        replacementRequestId: request.id,
        actorId: input.actorId,
        source: 'api',
        documentHash: requestHash,
        reason: null,
        detail: null,
        occurredAt: input.now,
      });
      const saved = await client.clientDeviceReplacementRequest.findFirst({
        where: { installationId: input.installationId, id: request.id },
      });
      if (saved === null) throw new Error('Replacement request disappeared.');
      return { value: { request: saved, artifact } } as const;
    });
    if ('error' in result) throw result.error;
    return result.value;
  }

  async replacementRequestExport(input: {
    installationId: string;
    requestId: string;
    actorId: string | null;
    now: Date;
  }): Promise<{
    request: ClientDeviceReplacementRequestRow;
    artifact: string;
  }> {
    const result = await this.prisma.inTransaction(async (transaction) => {
      const client = await this.prisma.getClient<Client>(transaction);
      const context = await this.lockedLicenseContext(
        transaction,
        input.installationId,
        input.now,
      );
      await this.expireStaleOperationsInTransaction(
        client,
        input.installationId,
        input.now,
        input.actorId,
        context,
      );
      const request = await client.clientDeviceReplacementRequest.findFirst({
        where: {
          installationId: input.installationId,
          id: input.requestId,
        },
      });
      if (request === null) {
        return {
          error: lifecycleError(
            'replacement-request-not-found',
            'The device replacement request was not found.',
          ),
        } as const;
      }
      if (request.state !== 'PENDING' || request.requestSignature === null) {
        return {
          error: lifecycleError(
            request.state === 'CANCELLED'
              ? 'replacement-request-cancelled'
              : request.state === 'EXPIRED'
                ? 'replacement-request-expired'
                : 'replacement-request-not-pending',
            'Only a signed pending replacement request can be exported.',
          ),
        } as const;
      }
      if (request.requestExpiresAt <= input.now) {
        return {
          error: lifecycleError(
            'replacement-request-expired',
            'The device replacement request has expired.',
          ),
        } as const;
      }
      const artifact = serializeDeviceReplacementRequestArtifact({
        canonicalPayload: request.canonicalPayload,
        signature: request.requestSignature,
      });
      if (request.requestHash !== sha256(artifact)) {
        return {
          error: lifecycleError(
            'replacement-request-not-pending',
            'The retained replacement request failed its integrity check.',
          ),
        } as const;
      }
      return { value: { request, artifact } } as const;
    });
    if ('error' in result) throw result.error;
    return result.value;
  }

  async completeReplacement(input: {
    installationId: string;
    requestId: string;
    response: DeviceReplacementResponsePayload;
    responseHash: string;
    source: 'file' | 'text';
    actorId: string | null;
    now: Date;
  }): Promise<{
    oldDevice: ClientDeviceRow;
    newDevice: ClientDeviceRow;
    request: ClientDeviceReplacementRequestRow;
  }> {
    const result = await this.prisma.inTransaction(async (transaction) => {
      const client = await this.prisma.getClient<Client>(transaction);
      const context = await this.lockedLicenseContext(
        transaction,
        input.installationId,
        input.now,
      );
      const request = await client.clientDeviceReplacementRequest.findFirst({
        where: { installationId: input.installationId, id: input.requestId },
      });
      if (request === null) {
        throw lifecycleError(
          'replacement-request-not-found',
          'The device replacement request was not found.',
        );
      }
      if (request.state !== 'PENDING') {
        throw lifecycleError(
          request.state === 'CANCELLED'
            ? 'replacement-request-cancelled'
            : request.state === 'EXPIRED'
              ? 'replacement-request-expired'
              : 'replacement-response-replayed',
          'The replacement request is not eligible for completion.',
        );
      }
      if (
        request.requestSignature === null ||
        request.requestHash === null ||
        request.requestExpiresAt <= input.now
      ) {
        throw lifecycleError(
          'replacement-request-expired',
          'The device replacement request has expired or is incomplete.',
        );
      }
      if (
        context.version === null ||
        !context.active ||
        !context.version.deviceLimitSpecified ||
        context.installation.customerId !== request.customerId ||
        context.version.versionId !== request.licenseVersionId ||
        context.version.customerCode !== request.customerCode
      ) {
        const failure = lifecycleError(
          'replacement-request-expired',
          'The replacement no longer matches the active signed license.',
        );
        await client.clientDeviceReplacementRequest.updateMany({
          where: {
            installationId: input.installationId,
            id: request.id,
            state: 'PENDING',
          },
          data: {
            state: 'EXPIRED',
            expiredAt: input.now,
            updatedAt: input.now,
            updatedBy: input.actorId,
          },
        });
        await this.createAuditEvent(client, {
          installationId: input.installationId,
          eventType: 'license.device.replacement-expired',
          outcome: 'REJECTED',
          operationId: request.operationId,
          licenseId: request.licenseId,
          versionId: request.licenseVersionId,
          deviceId: request.oldDeviceId,
          replacementRequestId: request.id,
          actorId: input.actorId,
          source: input.source,
          documentHash: input.responseHash,
          reason: 'license-version-changed',
          detail: null,
          occurredAt: input.now,
        });
        return { error: failure } as const;
      }
      const responseOperation =
        await client.clientDeviceReplacementRequest.findFirst({
          where: {
            installationId: input.installationId,
            responseOperationId: input.response.responseOperationId,
          },
        });
      if (responseOperation !== null) {
        throw lifecycleError(
          'replacement-response-replayed',
          'This replacement response operation has already been applied.',
        );
      }
      const correlationError = validateReplacementCorrelation({
        request,
        response: input.response,
        version: context.version,
        now: input.now,
      });
      if (correlationError !== null) {
        throw correlationError;
      }
      const oldDevice = await client.clientDevice.findFirst({
        where: {
          installationId: input.installationId,
          id: request.oldDeviceId,
        },
      });
      if (oldDevice === null || oldDevice.status !== 'ACTIVE') {
        const failure = lifecycleError(
          'replacement-request-expired',
          'The old device is no longer active.',
        );
        await client.clientDeviceReplacementRequest.updateMany({
          where: {
            installationId: input.installationId,
            id: request.id,
            state: 'PENDING',
          },
          data: {
            state: 'EXPIRED',
            expiredAt: input.now,
            updatedAt: input.now,
            updatedBy: input.actorId,
          },
        });
        await this.createAuditEvent(client, {
          installationId: input.installationId,
          eventType: 'license.device.replacement-expired',
          outcome: 'REJECTED',
          operationId: request.operationId,
          licenseId: request.licenseId,
          versionId: request.licenseVersionId,
          deviceId: request.oldDeviceId,
          replacementRequestId: request.id,
          actorId: input.actorId,
          source: input.source,
          documentHash: input.responseHash,
          reason: 'old-device-not-active',
          detail: null,
          occurredAt: input.now,
        });
        return { error: failure } as const;
      }
      const pendingEnrollment =
        await client.deviceEnrollmentChallenge.findFirst({
          where: {
            installationId: input.installationId,
            keyFingerprint: request.keyFingerprint,
            state: 'PENDING',
          },
        });
      if (pendingEnrollment !== null) {
        throw lifecycleError(
          'replacement-device-key-used',
          'The replacement key is also part of a pending enrollment.',
        );
      }
      const beforeCount = await this.activeCount(client, input.installationId);
      const newDevice = await client.clientDevice.create({
        data: {
          id: request.newDeviceId,
          installationId: input.installationId,
          operationId: request.operationId,
          keyFingerprint: request.keyFingerprint,
          publicKey: request.publicKey,
          status: 'ACTIVE',
          activatedAt: input.now,
          deactivatedAt: null,
          deactivatedBy: null,
          replacedAt: null,
          replacedByDeviceId: null,
          enrollmentChallengeId: null,
          replacementRequestId: request.id,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actorId,
          updatedBy: input.actorId,
        },
      });
      const retired = await client.clientDevice.updateMany({
        where: {
          installationId: input.installationId,
          id: oldDevice.id,
          status: 'ACTIVE',
        },
        data: {
          status: 'REPLACED',
          replacedAt: input.now,
          replacedByDeviceId: newDevice.id,
          updatedAt: input.now,
          updatedBy: input.actorId,
        },
      });
      if (retired.count !== 1) {
        throw lifecycleError(
          'device-operation-conflict',
          'The old device could not be retired.',
        );
      }
      const completed = await client.clientDeviceReplacementRequest.updateMany({
        where: {
          installationId: input.installationId,
          id: request.id,
          state: 'PENDING',
        },
        data: {
          state: 'COMPLETED',
          responseOperationId: input.response.responseOperationId,
          responseHash: input.responseHash,
          responseKeyId: input.response.keyId,
          completedAt: input.now,
          updatedAt: input.now,
          updatedBy: input.actorId,
        },
      });
      if (completed.count !== 1) {
        throw lifecycleError(
          'replacement-response-replayed',
          'The replacement request was already completed.',
        );
      }
      const afterCount = await this.activeCount(client, input.installationId);
      if (beforeCount !== afterCount) {
        throw new Error(
          `Atomic device replacement changed quota usage from ${beforeCount} to ${afterCount}.`,
        );
      }
      await this.createAuditEvent(client, {
        installationId: input.installationId,
        eventType: 'license.device.replaced',
        outcome: 'APPLIED',
        operationId: request.operationId,
        licenseId: request.licenseId,
        versionId: request.licenseVersionId,
        deviceId: oldDevice.id,
        replacementRequestId: request.id,
        actorId: input.actorId,
        source: input.source,
        documentHash: input.responseHash,
        reason: null,
        detail: `replacedByDeviceId=${newDevice.id}`,
        occurredAt: input.now,
      });
      await this.createAuditEvent(client, {
        installationId: input.installationId,
        eventType: 'license.device.replacement-completed',
        outcome: 'APPLIED',
        operationId: input.response.responseOperationId,
        licenseId: request.licenseId,
        versionId: request.licenseVersionId,
        deviceId: newDevice.id,
        replacementRequestId: request.id,
        actorId: input.actorId,
        source: input.source,
        documentHash: input.responseHash,
        reason: null,
        detail: `replacedDeviceId=${oldDevice.id}`,
        occurredAt: input.now,
      });
      const savedRequest =
        await client.clientDeviceReplacementRequest.findFirst({
          where: { installationId: input.installationId, id: request.id },
        });
      const savedOld = await client.clientDevice.findFirst({
        where: { installationId: input.installationId, id: oldDevice.id },
      });
      if (savedRequest === null || savedOld === null) {
        throw new Error('Committed replacement rows could not be reloaded.');
      }
      return {
        value: { oldDevice: savedOld, newDevice, request: savedRequest },
      } as const;
    });
    if ('error' in result) throw result.error;
    return result.value;
  }

  async cancelReplacement(input: {
    installationId: string;
    requestId: string;
    operationId: string;
    actorId: string | null;
    now: Date;
  }): Promise<ClientDeviceReplacementRequestRow> {
    return this.prisma.inTransaction(async (transaction) => {
      const client = await this.prisma.getClient<Client>(transaction);
      const context = await this.lockedLicenseContext(
        transaction,
        input.installationId,
        input.now,
      );
      const request = await client.clientDeviceReplacementRequest.findFirst({
        where: { installationId: input.installationId, id: input.requestId },
      });
      if (request === null) {
        throw lifecycleError(
          'replacement-request-not-found',
          'The device replacement request was not found.',
        );
      }
      if (request.state !== 'CHALLENGE' && request.state !== 'PENDING') {
        throw lifecycleError(
          request.state === 'CANCELLED'
            ? 'replacement-request-cancelled'
            : 'replacement-request-not-pending',
          'Only a pending replacement can be cancelled.',
        );
      }
      await this.expireStaleOperationsInTransaction(
        client,
        input.installationId,
        input.now,
        input.actorId,
        context,
      );
      const stillPending =
        await client.clientDeviceReplacementRequest.findFirst({
          where: { installationId: input.installationId, id: request.id },
        });
      if (
        stillPending?.state !== 'CHALLENGE' &&
        stillPending?.state !== 'PENDING'
      ) {
        throw lifecycleError(
          'replacement-request-expired',
          'The replacement request is no longer cancellable.',
        );
      }
      const updated = await client.clientDeviceReplacementRequest.updateMany({
        where: {
          installationId: input.installationId,
          id: request.id,
          state: stillPending.state,
        },
        data: {
          state: 'CANCELLED',
          cancelledAt: input.now,
          updatedAt: input.now,
          updatedBy: input.actorId,
        },
      });
      if (updated.count !== 1) {
        throw lifecycleError(
          'replacement-request-not-pending',
          'The replacement request could not be cancelled.',
        );
      }
      await this.createAuditEvent(client, {
        installationId: input.installationId,
        eventType: 'license.device.replacement-cancelled',
        outcome: 'APPLIED',
        operationId: input.operationId,
        licenseId: request.licenseId,
        versionId: request.licenseVersionId,
        deviceId: request.oldDeviceId,
        replacementRequestId: request.id,
        actorId: input.actorId,
        source: 'api',
        documentHash: request.requestHash,
        reason: null,
        detail: null,
        occurredAt: input.now,
      });
      const saved = await client.clientDeviceReplacementRequest.findFirst({
        where: { installationId: input.installationId, id: request.id },
      });
      if (saved === null) throw new Error('Cancelled replacement disappeared.');
      return saved;
    });
  }

  async deviceHistory(input: {
    installationId: string;
    deviceId: string;
    limit?: number;
  }): Promise<{
    device: ClientDeviceRow;
    events: ClientDeviceAuditRow[];
  } | null> {
    const client = await this.prisma.getClient<Client>();
    const device = await client.clientDevice.findFirst({
      where: { installationId: input.installationId, id: input.deviceId },
    });
    if (device === null) return null;
    const linkedRequests = await client.clientDeviceReplacementRequest.findMany(
      {
        where: {
          installationId: input.installationId,
          oldDeviceId: device.id,
        },
      },
    );
    const activatedBy = await client.clientDeviceReplacementRequest.findMany({
      where: {
        installationId: input.installationId,
        newDeviceId: device.id,
      },
    });
    const replacementIds = [...linkedRequests, ...activatedBy].map(
      (request) => request.id,
    );
    const where: AuditWhere =
      replacementIds.length === 0
        ? { installationId: input.installationId, deviceId: device.id }
        : {
            installationId: input.installationId,
            OR: [
              { deviceId: device.id },
              { replacementRequestId: { in: replacementIds } },
            ],
          };
    const events = await client.licenseAuditEvent.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: input.limit ?? 100,
    });
    return { device, events };
  }

  async recordRejectedEvent(command: LicenseAuditEventCommand): Promise<void> {
    await this.licenses.recordAuditEvent(command);
  }

  private async requireActiveSignedLicense(
    transaction: DatabaseTransaction,
    installationId: string,
    now: Date,
  ): Promise<ActiveAllocationLicenseContext> {
    const context = await this.lockedLicenseContext(
      transaction,
      installationId,
      now,
    );
    if (context.version === null) {
      throw lifecycleError(
        'license-required',
        'A signed license version is required to register or replace a device.',
      );
    }
    if (
      context.installation.customerId !== context.version.customerId ||
      !CUSTOMER_CODE_PATTERN.test(context.version.customerCode)
    ) {
      throw lifecycleError(
        'license-binding-mismatch',
        'The signed license customer binding does not match this installation.',
      );
    }
    if (!context.active) {
      throw lifecycleError(
        'license-not-active',
        'The effective signed license is not active.',
      );
    }
    if (!context.version.deviceLimitSpecified) {
      throw lifecycleError(
        'device-entitlement-unspecified',
        'The effective signed license does not specify a device entitlement.',
      );
    }
    return { ...context, version: context.version, limitSpecified: true };
  }

  private async lockedLicenseContext(
    transaction: DatabaseTransaction,
    installationId: string,
    now: Date,
  ): Promise<AllocationLicenseContext> {
    const locked = await this.licenses.lockForDeviceAllocation(
      transaction,
      installationId,
      now,
    );
    const version = locked.effectiveVersion;
    const evaluated =
      version === null
        ? null
        : evaluateLicense(
            toInstallationLicense(version, version.provider),
            now,
          );
    return {
      installation: locked.installation,
      version,
      active: evaluated?.active ?? false,
      limit: version?.deviceLimit ?? null,
      limitSpecified: version?.deviceLimitSpecified ?? false,
    };
  }

  private assertQuota(
    context: AllocationLicenseContext,
    activeCount: number,
  ): void {
    if (!context.limitSpecified) {
      throw lifecycleError(
        'device-entitlement-unspecified',
        'The effective signed license does not specify a device entitlement.',
      );
    }
    if (context.limit !== null && activeCount >= context.limit) {
      throw new DeviceLifecycleError(
        'device-limit-reached',
        'The active device count has reached the signed device limit.',
        { activeDeviceCount: activeCount, deviceLimit: context.limit },
      );
    }
  }

  private async activeCount(
    client: Client,
    installationId: string,
  ): Promise<number> {
    return client.clientDevice.count({
      where: { installationId, status: 'ACTIVE' },
    });
  }

  private async expireStaleOperationsInTransaction(
    client: Client,
    installationId: string,
    now: Date,
    actorId: string | null,
    context: AllocationLicenseContext,
  ): Promise<void> {
    const challenges = await client.deviceEnrollmentChallenge.findMany({
      where: { installationId, state: 'PENDING' },
    });
    for (const challenge of challenges) {
      const licenseContextChanged = !licenseBindingIsCurrent(
        context,
        challenge,
      );
      const expiredByTime = challenge.expiresAt <= now;
      if (!licenseContextChanged && !expiredByTime) continue;
      const changed = await client.deviceEnrollmentChallenge.updateMany({
        where: {
          installationId,
          id: challenge.id,
          state: 'PENDING',
        },
        data: { state: 'EXPIRED' },
      });
      if (changed.count !== 1) continue;
      await this.createAuditEvent(client, {
        installationId,
        eventType: 'license.device.enrollment-challenge-expired',
        outcome: 'REJECTED',
        operationId: challenge.operationId,
        licenseId: challenge.licenseId,
        versionId: challenge.licenseVersionId,
        deviceId: challenge.deviceId,
        replacementRequestId: null,
        actorId,
        source: 'api',
        documentHash: null,
        reason: licenseContextChanged
          ? 'license-context-changed'
          : 'challenge-expired',
        detail: null,
        occurredAt: now,
      });
    }

    const requests = await client.clientDeviceReplacementRequest.findMany({
      where: {
        installationId,
        state: { in: ['CHALLENGE', 'PENDING'] },
      },
    });
    for (const request of requests) {
      const licenseContextChanged = !licenseBindingIsCurrent(context, request);
      const expiredByTime =
        request.state === 'CHALLENGE'
          ? request.challengeExpiresAt <= now
          : request.requestExpiresAt <= now;
      if (!licenseContextChanged && !expiredByTime) continue;
      const changed = await client.clientDeviceReplacementRequest.updateMany({
        where: {
          installationId,
          id: request.id,
          state: request.state,
        },
        data: {
          state: 'EXPIRED',
          expiredAt: now,
          updatedAt: now,
          updatedBy: actorId,
        },
      });
      if (changed.count !== 1) continue;
      await this.createAuditEvent(client, {
        installationId,
        eventType: 'license.device.replacement-expired',
        outcome: 'REJECTED',
        operationId: request.operationId,
        licenseId: request.licenseId,
        versionId: request.licenseVersionId,
        deviceId: request.oldDeviceId,
        replacementRequestId: request.id,
        actorId,
        source: 'api',
        documentHash: request.requestHash,
        reason: licenseContextChanged
          ? 'license-context-changed'
          : 'request-expired',
        detail: null,
        occurredAt: now,
      });
    }
  }

  private async createAuditEvent(
    client: Client,
    event: LicenseAuditEventCommand,
  ): Promise<void> {
    await client.licenseAuditEvent.create({
      data: {
        id: generateId(),
        installationId: event.installationId,
        eventType: event.eventType,
        outcome: event.outcome,
        operationId: event.operationId,
        licenseId: event.licenseId,
        versionId: event.versionId,
        deviceId: event.deviceId ?? null,
        replacementRequestId: event.replacementRequestId ?? null,
        actorId: event.actorId,
        source: event.source,
        documentHash: event.documentHash,
        reason: event.reason,
        detail: event.detail,
        previousCustomerId: null,
        previousCustomerCode: null,
        newCustomerId: null,
        newCustomerCode: null,
        previousLicenseId: null,
        occurredAt: event.occurredAt,
        createdAt: event.occurredAt,
        updatedAt: event.occurredAt,
      },
    });
  }
}

interface AllocationLicenseContext {
  installation: { id: string; customerId: string | null };
  version: RetainedLicenseVersion | null;
  active: boolean;
  limit: LicenseLimit;
  limitSpecified: boolean;
}

interface ActiveAllocationLicenseContext extends AllocationLicenseContext {
  version: RetainedLicenseVersion;
  limitSpecified: true;
}

type DeviceLicenseBinding = {
  customerId: string;
  customerCode: string;
  licenseId: string;
  licenseVersionId: string;
};

function licenseBindingIsCurrent(
  context: AllocationLicenseContext,
  binding: DeviceLicenseBinding,
): boolean {
  const version = context.version;
  return (
    context.active &&
    context.limitSpecified &&
    version !== null &&
    context.installation.customerId === binding.customerId &&
    version.customerId === binding.customerId &&
    version.customerCode === binding.customerCode &&
    version.licenseId === binding.licenseId &&
    version.versionId === binding.licenseVersionId
  );
}

function lifecycleError(
  reason: DeviceLifecycleErrorReason,
  message: string,
): DeviceLifecycleError {
  return new DeviceLifecycleError(reason, message);
}

function verifyDeviceSignatureSafely(input: {
  canonicalPayload: string;
  signature: string;
  publicKey: string;
}): boolean {
  try {
    return verifyDeviceProofDomain(input);
  } catch {
    return false;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validateReplacementCorrelation(input: {
  request: ClientDeviceReplacementRequestRow;
  response: DeviceReplacementResponsePayload;
  version: RetainedLicenseVersion;
  now: Date;
}): DeviceProtocolError | null {
  try {
    validateDeviceReplacementCorrelation({
      response: input.response,
      request: {
        requestId: input.request.id,
        challengeId: input.request.challengeId,
        requestOperationId: input.request.operationId,
        requestHash: input.request.requestHash ?? '',
        installationId: input.request.installationId,
        customerId: input.request.customerId,
        customerCode: input.request.customerCode,
        licenseId: input.request.licenseId,
        licenseVersionId: input.request.licenseVersionId,
        oldDeviceId: input.request.oldDeviceId,
        newDeviceId: input.request.newDeviceId,
        publicKeyFingerprint: input.request.keyFingerprint,
        requestIssuedAt: input.request.issuedAt,
        requestExpiresAt: input.request.requestExpiresAt,
        licenseValidFrom: input.version.validFrom,
        licenseValidUntil: input.version.validUntil,
        now: input.now,
      },
    });
    return null;
  } catch (error) {
    if (error instanceof DeviceProtocolError) return error;
    throw error;
  }
}
