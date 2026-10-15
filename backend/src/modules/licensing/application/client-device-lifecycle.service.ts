import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  APP_CONFIG,
  type AppConfig,
} from '../../../kernel/config/app-config.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { InstallationIdentityService } from './installation-identity.service.js';
import { LicensingService } from './licensing.service.js';
import {
  DEVICE_ENROLLMENT_CHALLENGE_TTL_MS,
  DEVICE_REPLACEMENT_REQUEST_TTL_MS,
  DeviceLifecycleError,
  DeviceProtocolError,
  parseDevicePublicKey,
  serializeDeviceReplacementRequestFile,
  verifyDeviceProof,
  verifyDeviceReplacementResponse,
  type VerifiedDeviceReplacementResponse,
} from '../domain/client-device.js';
import { LICENSING_PERMISSIONS } from '../domain/licensing-permissions.js';
import {
  parseTrustedLicenseKeys,
  type TrustedLicenseKey,
} from '../domain/license-document.js';
import {
  ClientDevicesRepository,
  type ClientDeviceAuditRow,
  type ClientDeviceReplacementRequestRow,
  type ClientDeviceRow,
  type CreateEnrollmentChallengeInput,
} from '../data/client-devices.repository.js';
import type {
  ClientDeviceDto,
  ClientDeviceHistoryDto,
  ClientDeviceInventoryDto,
  DeviceAuditEventDto,
  DeviceEnrollmentChallengeDto,
  DeviceReplacementChallengeDto,
  DeviceReplacementCompletionDto,
  DeviceReplacementDto,
  DeviceReplacementRequestExportDto,
  DeviceReplacementResultDto,
} from '../api/dto/client-device.dto.js';

@Injectable()
export class ClientDeviceLifecycleService {
  private readonly trustedKeys: TrustedLicenseKey[];

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly authorization: AuthorizationService,
    private readonly identity: InstallationIdentityService,
    private readonly licensing: LicensingService,
    private readonly devices: ClientDevicesRepository,
  ) {
    this.trustedKeys = parseTrustedLicenseKeys(
      config.licensing.signingPublicKeys,
    );
  }

  async inventory(): Promise<ClientDeviceInventoryDto> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.DEVICE_VIEW,
    ]);
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const installation = await this.identity.current();
    await this.devices.expireStaleOperations(
      installation.installationId,
      now,
      actorId,
    );
    const [state, inventory] = await Promise.all([
      this.licensing.currentState(now),
      this.devices.inventory(installation.installationId),
    ]);
    const hasEffectiveSignedVersion =
      state.versions?.effectiveVersionId !== null &&
      state.versions?.effectiveVersionId !== undefined;
    const deviceLimitSpecified =
      hasEffectiveSignedVersion && state.license.deviceLimitSpecified;
    const deviceLimit = deviceLimitSpecified ? state.license.deviceLimit : null;
    const availableDeviceSlots =
      !deviceLimitSpecified || deviceLimit === null
        ? null
        : Math.max(0, deviceLimit - inventory.activeDeviceCount);
    return {
      installationId: installation.installationId,
      licenseActive: state.license.active,
      deviceLimitSpecified,
      deviceLimit,
      activeDeviceCount: inventory.activeDeviceCount,
      availableDeviceSlots,
      devices: inventory.devices.map(toClientDeviceDto),
      replacements: inventory.replacements.map(toReplacementDto),
    };
  }

  async deviceHistory(deviceId: string): Promise<ClientDeviceHistoryDto> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.DEVICE_VIEW,
    ]);
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const installation = await this.identity.current();
    await this.devices.expireStaleOperations(
      installation.installationId,
      now,
      actorId,
    );
    const history = await this.devices.deviceHistory({
      installationId: installation.installationId,
      deviceId,
      limit: 100,
    });
    if (history === null)
      throw AppException.notFound('Client device', deviceId);
    return {
      device: toClientDeviceDto(history.device),
      events: history.events.map(toAuditEventDto),
    };
  }

  async createEnrollmentChallenge(
    publicKeyValue: string,
  ): Promise<DeviceEnrollmentChallengeDto> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.DEVICE_ACTIVATE,
    ]);
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const installation = await this.identity.current();
    const ids = {
      operationId: generateId(),
      deviceId: generateId(),
      challengeId: generateId(),
    };
    return this.withFailureAudit(
      {
        installationId: installation.installationId,
        eventType: 'license.device.enrollment-rejected',
        operationId: ids.operationId,
        deviceId: ids.deviceId,
        actorId,
        source: 'api',
        occurredAt: now,
      },
      async () => {
        const key = parseDevicePublicKey(publicKeyValue);
        const input: CreateEnrollmentChallengeInput = {
          installationId: installation.installationId,
          ...ids,
          publicKey: key.encoded,
          keyFingerprint: key.fingerprint,
          nonce: randomBytes(32).toString('base64url'),
          issuedAt: now,
          expiresAt: new Date(
            now.getTime() + DEVICE_ENROLLMENT_CHALLENGE_TTL_MS,
          ),
          actorId,
        };
        const challenge = await this.devices.createEnrollmentChallenge(input);
        return {
          challengeId: challenge.id,
          operationId: challenge.operationId,
          deviceId: challenge.deviceId,
          keyFingerprint: challenge.keyFingerprint,
          expiresAt: challenge.expiresAt.toISOString(),
          canonicalPayload: challenge.canonicalPayload,
        };
      },
    );
  }

  async activateEnrollment(
    challengeId: string,
    signature: string,
  ): Promise<ClientDeviceDto> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.DEVICE_ACTIVATE,
    ]);
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const installation = await this.identity.current();
    await this.devices.expireStaleOperations(
      installation.installationId,
      now,
      actorId,
    );
    const challenge = await this.devices.findEnrollmentChallenge(
      installation.installationId,
      challengeId,
    );
    return this.withFailureAudit(
      {
        installationId: installation.installationId,
        eventType: 'license.device.activation-rejected',
        operationId: challenge?.operationId ?? null,
        deviceId: challenge?.deviceId ?? null,
        licenseId: challenge?.licenseId ?? null,
        versionId: challenge?.licenseVersionId ?? null,
        actorId,
        source: 'api',
        occurredAt: now,
      },
      async () => {
        if (challenge === null) {
          throw new DeviceLifecycleError(
            'enrollment-challenge-not-found',
            'The device enrollment challenge was not found.',
          );
        }
        if (
          !verifyDeviceProof({
            canonicalPayload: challenge.canonicalPayload,
            signature,
            publicKey: challenge.publicKey,
          })
        ) {
          throw new DeviceProtocolError(
            'invalid-signature',
            'The device enrollment proof is invalid.',
          );
        }
        const device = await this.devices.activateEnrollment({
          installationId: installation.installationId,
          challengeId,
          canonicalPayload: challenge.canonicalPayload,
          signature,
          actorId,
          now,
        });
        return toClientDeviceDto(device);
      },
    );
  }

  async deactivate(deviceId: string): Promise<ClientDeviceDto> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.DEVICE_DEACTIVATE,
    ]);
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const installation = await this.identity.current();
    const operationId = generateId();
    return this.withFailureAudit(
      {
        installationId: installation.installationId,
        eventType: 'license.device.deactivation-rejected',
        operationId,
        deviceId,
        actorId,
        source: 'api',
        occurredAt: now,
      },
      async () => {
        const device = await this.devices.deactivate({
          installationId: installation.installationId,
          deviceId,
          operationId,
          actorId,
          now,
        });
        return toClientDeviceDto(device);
      },
    );
  }

  async createReplacementChallenge(
    oldDeviceId: string,
    publicKeyValue: string,
  ): Promise<DeviceReplacementChallengeDto> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.DEVICE_REPLACE,
    ]);
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const installation = await this.identity.current();
    const ids = {
      requestId: generateId(),
      challengeId: generateId(),
      operationId: generateId(),
      newDeviceId: generateId(),
    };
    return this.withFailureAudit(
      {
        installationId: installation.installationId,
        eventType: 'license.device.replacement-rejected',
        operationId: ids.operationId,
        deviceId: oldDeviceId,
        replacementRequestId: ids.requestId,
        actorId,
        source: 'api',
        occurredAt: now,
      },
      async () => {
        const key = parseDevicePublicKey(publicKeyValue);
        const challengeExpiresAt = new Date(
          now.getTime() + DEVICE_ENROLLMENT_CHALLENGE_TTL_MS,
        );
        const requestExpiresAt = new Date(
          now.getTime() + DEVICE_REPLACEMENT_REQUEST_TTL_MS,
        );
        const request = await this.devices.createReplacementChallenge({
          installationId: installation.installationId,
          ...ids,
          oldDeviceId,
          publicKey: key.encoded,
          keyFingerprint: key.fingerprint,
          nonce: randomBytes(32).toString('base64url'),
          issuedAt: now,
          challengeExpiresAt,
          requestExpiresAt,
          actorId,
        });
        return {
          requestId: request.id,
          challengeId: request.challengeId,
          operationId: request.operationId,
          oldDeviceId: request.oldDeviceId,
          newDeviceId: request.newDeviceId,
          keyFingerprint: request.keyFingerprint,
          challengeExpiresAt: request.challengeExpiresAt.toISOString(),
          requestExpiresAt: request.requestExpiresAt.toISOString(),
          canonicalPayload: request.canonicalPayload,
        };
      },
    );
  }

  async proveReplacement(
    requestId: string,
    signature: string,
  ): Promise<DeviceReplacementRequestExportDto> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.DEVICE_REPLACE,
    ]);
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const installation = await this.identity.current();
    await this.devices.expireStaleOperations(
      installation.installationId,
      now,
      actorId,
    );
    const request = await this.devices.findReplacementRequest(
      installation.installationId,
      requestId,
    );
    return this.withFailureAudit(
      {
        installationId: installation.installationId,
        eventType: 'license.device.replacement-proof-rejected',
        operationId: request?.operationId ?? null,
        deviceId: request?.oldDeviceId ?? null,
        replacementRequestId: requestId,
        licenseId: request?.licenseId ?? null,
        versionId: request?.licenseVersionId ?? null,
        actorId,
        source: 'api',
        occurredAt: now,
      },
      async () => {
        if (request === null) {
          throw new DeviceLifecycleError(
            'replacement-request-not-found',
            'The device replacement request was not found.',
          );
        }
        if (
          !verifyDeviceProof({
            canonicalPayload: request.canonicalPayload,
            signature,
            publicKey: request.publicKey,
          })
        ) {
          throw new DeviceProtocolError(
            'invalid-signature',
            'The device replacement proof is invalid.',
          );
        }
        const proved = await this.devices.proveReplacement({
          installationId: installation.installationId,
          requestId,
          canonicalPayload: request.canonicalPayload,
          signature,
          actorId,
          now,
        });
        const file = serializeDeviceReplacementRequestFile(proved.artifact);
        return {
          requestId: proved.request.id,
          requestHash: proved.request.requestHash ?? '',
          text: proved.artifact,
          file,
          expiresAt: proved.request.requestExpiresAt.toISOString(),
        };
      },
    );
  }

  async replacementRequestExport(
    requestId: string,
  ): Promise<DeviceReplacementRequestExportDto> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.DEVICE_REPLACE,
    ]);
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const installation = await this.identity.current();
    return this.withFailureAudit(
      {
        installationId: installation.installationId,
        eventType: 'license.device.replacement-export-rejected',
        replacementRequestId: requestId,
        actorId,
        source: 'api',
        occurredAt: now,
      },
      async () => {
        const exported = await this.devices.replacementRequestExport({
          installationId: installation.installationId,
          requestId,
          actorId,
          now,
        });
        return {
          requestId: exported.request.id,
          requestHash: exported.request.requestHash ?? '',
          text: exported.artifact,
          file: serializeDeviceReplacementRequestFile(exported.artifact),
          expiresAt: exported.request.requestExpiresAt.toISOString(),
        };
      },
    );
  }

  async importReplacementResponse(
    rawDocument: string,
  ): Promise<DeviceReplacementCompletionDto> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.DEVICE_COMPLETE_REPLACEMENT,
    ]);
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const installation = await this.identity.current();
    await this.devices.expireStaleOperations(
      installation.installationId,
      now,
      actorId,
    );
    let verified: VerifiedDeviceReplacementResponse;
    try {
      verified = verifyDeviceReplacementResponse(rawDocument, this.trustedKeys);
    } catch (error) {
      return this.withFailureAudit(
        {
          installationId: installation.installationId,
          eventType: 'license.device.replacement-response-rejected',
          actorId,
          source: rawDocument.trim().startsWith('{') ? 'file' : 'text',
          occurredAt: now,
        },
        async () => {
          throw error;
        },
      );
    }
    return this.withFailureAudit(
      {
        installationId: installation.installationId,
        eventType: 'license.device.replacement-response-rejected',
        operationId: verified.payload.responseOperationId,
        deviceId: verified.payload.oldDeviceId,
        replacementRequestId: verified.payload.requestId,
        licenseId: verified.payload.licenseId,
        versionId: verified.payload.licenseVersionId,
        actorId,
        source: verified.transport,
        documentHash: verified.artifactHash,
        occurredAt: now,
      },
      async () => {
        const result = await this.devices.completeReplacement({
          installationId: installation.installationId,
          requestId: verified.payload.requestId,
          response: verified.payload,
          responseHash: verified.artifactHash,
          source: verified.transport,
          actorId,
          now,
        });
        return {
          oldDevice: toClientDeviceDto(result.oldDevice),
          newDevice: toClientDeviceDto(result.newDevice),
          replacement: toReplacementDto(result.request),
        };
      },
    );
  }

  async cancelReplacement(
    requestId: string,
  ): Promise<DeviceReplacementResultDto> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.DEVICE_CANCEL_REPLACEMENT,
    ]);
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const installation = await this.identity.current();
    const operationId = generateId();
    await this.devices.expireStaleOperations(
      installation.installationId,
      now,
      actorId,
    );
    const request = await this.devices.findReplacementRequest(
      installation.installationId,
      requestId,
    );
    return this.withFailureAudit(
      {
        installationId: installation.installationId,
        eventType: 'license.device.replacement-cancel-rejected',
        operationId,
        deviceId: request?.oldDeviceId ?? null,
        replacementRequestId: requestId,
        licenseId: request?.licenseId ?? null,
        versionId: request?.licenseVersionId ?? null,
        actorId,
        source: 'api',
        occurredAt: now,
      },
      async () => ({
        replacement: toReplacementDto(
          await this.devices.cancelReplacement({
            installationId: installation.installationId,
            requestId,
            operationId,
            actorId,
            now,
          }),
        ),
      }),
    );
  }

  private async withFailureAudit<T>(
    context: {
      installationId: string;
      eventType: string;
      operationId?: string | null;
      licenseId?: string | null;
      versionId?: string | null;
      deviceId?: string | null;
      replacementRequestId?: string | null;
      actorId: string | null;
      source: string;
      documentHash?: string | null;
      occurredAt: Date;
    },
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      const reason = rejectionReason(error);
      await this.devices
        .recordRejectedEvent({
          installationId: context.installationId,
          eventType: context.eventType,
          outcome: 'REJECTED',
          operationId: context.operationId ?? null,
          licenseId: context.licenseId ?? null,
          versionId: context.versionId ?? null,
          deviceId: context.deviceId ?? null,
          replacementRequestId: context.replacementRequestId ?? null,
          actorId: context.actorId,
          source: context.source,
          documentHash: context.documentHash ?? null,
          reason,
          detail: null,
          occurredAt: context.occurredAt,
        })
        .catch(() => undefined);
      throw mapDeviceError(error);
    }
  }
}

function toClientDeviceDto(device: ClientDeviceRow): ClientDeviceDto {
  return {
    id: device.id,
    keyFingerprint: device.keyFingerprint,
    status: device.status,
    activatedAt: device.activatedAt.toISOString(),
    deactivatedAt: device.deactivatedAt?.toISOString() ?? null,
    deactivatedBy: device.deactivatedBy,
    replacedAt: device.replacedAt?.toISOString() ?? null,
    replacedByDeviceId: device.replacedByDeviceId,
    replacementRequestId: device.replacementRequestId,
  };
}

function toReplacementDto(
  request: ClientDeviceReplacementRequestRow,
): DeviceReplacementDto {
  return {
    id: request.id,
    oldDeviceId: request.oldDeviceId,
    newDeviceId: request.newDeviceId,
    keyFingerprint: request.keyFingerprint,
    state: request.state,
    requestHash: request.requestHash,
    createdAt: request.createdAt.toISOString(),
    challengeExpiresAt: request.challengeExpiresAt.toISOString(),
    requestExpiresAt: request.requestExpiresAt.toISOString(),
    completedAt: request.completedAt?.toISOString() ?? null,
    cancelledAt: request.cancelledAt?.toISOString() ?? null,
    expiredAt: request.expiredAt?.toISOString() ?? null,
  };
}

function toAuditEventDto(event: ClientDeviceAuditRow): DeviceAuditEventDto {
  return {
    id: event.id,
    eventType: event.eventType,
    outcome: event.outcome,
    operationId: event.operationId,
    deviceId: event.deviceId,
    replacementRequestId: event.replacementRequestId,
    source: event.source,
    documentHash: event.documentHash,
    reason: event.reason,
    detail: event.detail,
    occurredAt: event.occurredAt.toISOString(),
  };
}

function rejectionReason(error: unknown): string {
  if (error instanceof DeviceLifecycleError) return error.reason;
  if (error instanceof DeviceProtocolError) return error.reason;
  return 'operation-failed';
}

function mapDeviceError(error: unknown): Error {
  if (error instanceof AppException) return error;
  if (error instanceof DeviceProtocolError) {
    return AppException.businessRule(error.message, { reason: error.reason });
  }
  if (error instanceof DeviceLifecycleError) {
    if (
      error.reason === 'device-not-found' ||
      error.reason === 'enrollment-challenge-not-found' ||
      error.reason === 'replacement-request-not-found'
    ) {
      return AppException.notFound(
        error.reason === 'device-not-found'
          ? 'Client device'
          : error.reason === 'enrollment-challenge-not-found'
            ? 'Device enrollment challenge'
            : 'Device replacement request',
      );
    }
    if (
      error.reason === 'device-limit-reached' ||
      error.reason === 'device-key-already-registered' ||
      error.reason === 'device-not-active' ||
      error.reason === 'device-operation-conflict' ||
      error.reason === 'enrollment-challenge-expired' ||
      error.reason === 'enrollment-challenge-consumed' ||
      error.reason === 'enrollment-challenge-stale' ||
      error.reason === 'replacement-request-not-pending' ||
      error.reason === 'replacement-request-expired' ||
      error.reason === 'replacement-already-pending' ||
      error.reason === 'replacement-device-key-used' ||
      error.reason === 'replacement-response-replayed' ||
      error.reason === 'replacement-request-cancelled'
    ) {
      return AppException.conflict(error.message, {
        reason: error.reason,
        ...error.details,
      });
    }
    return AppException.businessRule(error.message, {
      reason: error.reason,
      ...error.details,
    });
  }
  return error instanceof Error ? error : new Error('Device lifecycle failed.');
}
