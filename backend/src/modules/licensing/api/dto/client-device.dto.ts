import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type {
  ClientDeviceAuditRow,
  ClientDeviceRow,
  ClientDeviceReplacementRequestRow,
} from '../../data/client-devices.repository.js';

const BASE64URL_MESSAGE = 'A base64url-encoded value is required.';

export class CreateDeviceEnrollmentChallengeDto {
  @ApiProperty({
    description:
      'The client device Ed25519 public key, exported as base64url SubjectPublicKeyInfo DER. Never submit a private key.',
    example: 'MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    maxLength: 256,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: BASE64URL_MESSAGE })
  publicKey!: string;
}

export class ProveDeviceEnrollmentDto {
  @ApiProperty({
    description:
      'Detached Ed25519 signature over the exact canonicalPayload returned by the enrollment-challenge endpoint.',
    maxLength: 256,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: BASE64URL_MESSAGE })
  signature!: string;
}

export class CreateDeviceReplacementChallengeDto {
  @ApiProperty({
    description:
      'A new Ed25519 public key created on the replacement device. Its private key remains on that device.',
    example: 'MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    maxLength: 256,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: BASE64URL_MESSAGE })
  publicKey!: string;
}

export class ProveDeviceReplacementDto {
  @ApiProperty({
    description:
      'Detached Ed25519 signature over the exact canonicalPayload returned by the replacement-challenge endpoint.',
    maxLength: 256,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: BASE64URL_MESSAGE })
  signature!: string;
}

export class ImportDeviceReplacementResponseDto {
  @ApiProperty({
    description:
      'A signed VDRP1 replacement-response text artifact or the vardena-device-replacement-response JSON file envelope. Both transports use the same strict signature verification.',
    maxLength: 65536,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(65536)
  document!: string;
}

export interface ClientDeviceView {
  id: string;
  keyFingerprint: string;
  status: ClientDeviceRow['status'];
  activatedAt: string;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  replacedAt: string | null;
  replacedByDeviceId: string | null;
  replacementRequestId: string | null;
}

export class ClientDeviceDto implements ClientDeviceView {
  @ApiProperty({ description: 'Server-generated retained device id.' })
  id!: string;

  @ApiProperty({
    description:
      'SHA-256 fingerprint of the Ed25519 public key; not the key itself.',
  })
  keyFingerprint!: string;

  @ApiProperty({ enum: ['ACTIVE', 'DEACTIVATED', 'REPLACED'] })
  status!: ClientDeviceRow['status'];

  @ApiProperty({ format: 'date-time' })
  activatedAt!: string;

  @ApiProperty({ nullable: true, format: 'date-time' })
  deactivatedAt!: string | null;

  @ApiProperty({ nullable: true })
  deactivatedBy!: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  replacedAt!: string | null;

  @ApiProperty({ nullable: true })
  replacedByDeviceId!: string | null;

  @ApiProperty({ nullable: true })
  replacementRequestId!: string | null;
}

export interface DeviceReplacementView {
  id: string;
  oldDeviceId: string;
  newDeviceId: string;
  keyFingerprint: string;
  state: ClientDeviceReplacementRequestRow['state'];
  requestHash: string | null;
  createdAt: string;
  challengeExpiresAt: string;
  requestExpiresAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
}

export class DeviceReplacementDto implements DeviceReplacementView {
  @ApiProperty({ description: 'Server-generated replacement request id.' })
  id!: string;

  @ApiProperty()
  oldDeviceId!: string;

  @ApiProperty()
  newDeviceId!: string;

  @ApiProperty({
    description: 'Fingerprint of the replacement device public key.',
  })
  keyFingerprint!: string;

  @ApiProperty({
    enum: ['CHALLENGE', 'PENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED'],
  })
  state!: ClientDeviceReplacementRequestRow['state'];

  @ApiProperty({ nullable: true })
  requestHash!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  challengeExpiresAt!: string;

  @ApiProperty({ format: 'date-time' })
  requestExpiresAt!: string;

  @ApiProperty({ nullable: true, format: 'date-time' })
  completedAt!: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  cancelledAt!: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  expiredAt!: string | null;
}

export class ClientDeviceInventoryDto {
  @ApiProperty()
  installationId!: string;

  @ApiProperty()
  licenseActive!: boolean;

  @ApiProperty({
    description:
      'False when the effective signed LicenseVersion did not specify deviceLimit; this is distinct from signed unlimited.',
  })
  deviceLimitSpecified!: boolean;

  @ApiProperty({
    nullable: true,
    description: 'Null means unlimited only when deviceLimitSpecified is true.',
  })
  deviceLimit!: number | null;

  @ApiProperty()
  activeDeviceCount!: number;

  @ApiProperty({
    nullable: true,
    description: 'Null for unlimited or unspecified capacity.',
  })
  availableDeviceSlots!: number | null;

  @ApiProperty({ type: [ClientDeviceDto] })
  devices!: ClientDeviceDto[];

  @ApiProperty({ type: [DeviceReplacementDto] })
  replacements!: DeviceReplacementDto[];
}

export class DeviceEnrollmentChallengeDto {
  @ApiProperty()
  challengeId!: string;

  @ApiProperty()
  operationId!: string;

  @ApiProperty()
  deviceId!: string;

  @ApiProperty({
    description: 'SHA-256 fingerprint of the submitted public key.',
  })
  keyFingerprint!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({
    description:
      'Exact fixed-order UTF-8 JSON bytes to sign with the device private key. This contains public data only.',
  })
  canonicalPayload!: string;
}

export class DeviceReplacementChallengeDto {
  @ApiProperty()
  requestId!: string;

  @ApiProperty()
  challengeId!: string;

  @ApiProperty()
  operationId!: string;

  @ApiProperty()
  oldDeviceId!: string;

  @ApiProperty()
  newDeviceId!: string;

  @ApiProperty()
  keyFingerprint!: string;

  @ApiProperty({ format: 'date-time' })
  challengeExpiresAt!: string;

  @ApiProperty({ format: 'date-time' })
  requestExpiresAt!: string;

  @ApiProperty({
    description:
      'Exact fixed-order VDRQ1 challenge bytes to sign with the new device private key.',
  })
  canonicalPayload!: string;
}

export class DeviceReplacementRequestExportDto {
  @ApiProperty()
  requestId!: string;

  @ApiProperty()
  requestHash!: string;

  @ApiProperty({ description: 'VDRQ1 text artifact; contains no private key.' })
  text!: string;

  @ApiProperty({
    description:
      'Primary JSON file envelope containing the same signed VDRQ1 artifact as text.',
  })
  file!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class DeviceReplacementCompletionDto {
  @ApiProperty({ type: ClientDeviceDto })
  oldDevice!: ClientDeviceDto;

  @ApiProperty({ type: ClientDeviceDto })
  newDevice!: ClientDeviceDto;

  @ApiProperty({ type: DeviceReplacementDto })
  replacement!: DeviceReplacementDto;
}

export class DeviceAuditEventDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty({ enum: ['APPLIED', 'REJECTED', 'UNCHANGED'] })
  outcome!: ClientDeviceAuditRow['outcome'];

  @ApiProperty({ nullable: true })
  operationId!: string | null;

  @ApiProperty({ nullable: true })
  deviceId!: string | null;

  @ApiProperty({ nullable: true })
  replacementRequestId!: string | null;

  @ApiProperty({ nullable: true })
  source!: string | null;

  @ApiProperty({ nullable: true })
  documentHash!: string | null;

  @ApiProperty({ nullable: true })
  reason!: string | null;

  @ApiProperty({ nullable: true })
  detail!: string | null;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;
}

export class ClientDeviceHistoryDto {
  @ApiProperty({ type: ClientDeviceDto })
  device!: ClientDeviceDto;

  @ApiProperty({ type: [DeviceAuditEventDto] })
  events!: DeviceAuditEventDto[];
}

export class DeviceReplacementResultDto {
  @ApiProperty({ type: DeviceReplacementDto })
  replacement!: DeviceReplacementDto;
}
