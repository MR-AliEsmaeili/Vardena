import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { ClientDeviceLifecycleService } from '../application/client-device-lifecycle.service.js';
import { LICENSING_PERMISSIONS } from '../domain/licensing-permissions.js';
import {
  ClientDeviceDto,
  ClientDeviceHistoryDto,
  ClientDeviceInventoryDto,
  CreateDeviceEnrollmentChallengeDto,
  CreateDeviceReplacementChallengeDto,
  DeviceEnrollmentChallengeDto,
  DeviceReplacementChallengeDto,
  DeviceReplacementCompletionDto,
  DeviceReplacementRequestExportDto,
  DeviceReplacementResultDto,
  ImportDeviceReplacementResponseDto,
  ProveDeviceEnrollmentDto,
  ProveDeviceReplacementDto,
} from './dto/client-device.dto.js';

@ApiTags('licensing')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'license/devices', version: '1' })
export class ClientDevicesController {
  constructor(private readonly lifecycle: ClientDeviceLifecycleService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LICENSING_PERMISSIONS.DEVICE_VIEW)
  @ApiOperation({
    summary:
      'Read the retained client-device inventory and authoritative quota.',
    description:
      'Returns installation-scoped device states, replacement history and the effective signed device limit. Public keys and private keys are not returned.',
  })
  @ApiOkResponse({ type: ClientDeviceInventoryDto })
  async inventory(): Promise<ClientDeviceInventoryDto> {
    return this.lifecycle.inventory();
  }

  @Get(':deviceId/history')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LICENSING_PERMISSIONS.DEVICE_VIEW)
  @ApiOperation({
    summary: 'Read retained audit history for one client device.',
  })
  @ApiOkResponse({ type: ClientDeviceHistoryDto })
  async deviceHistory(
    @Param('deviceId') deviceId: string,
  ): Promise<ClientDeviceHistoryDto> {
    return this.lifecycle.deviceHistory(deviceId);
  }

  @Post('enrollment-challenges')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LICENSING_PERMISSIONS.DEVICE_ACTIVATE)
  @ApiOperation({
    summary: 'Create a one-use challenge for a client device public key.',
    description:
      'The client signs the returned canonicalPayload locally with its Ed25519 private key and submits the detached signature to the activate endpoint. Challenge creation does not activate a device or consume quota.',
  })
  @ApiOkResponse({ type: DeviceEnrollmentChallengeDto })
  @ApiBadRequestResponse({ description: 'Request validation failed.' })
  @ApiConflictResponse({
    description:
      'The signed device limit is full or the key is already registered.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'No active signed device entitlement is available.',
  })
  async createEnrollmentChallenge(
    @Body() body: CreateDeviceEnrollmentChallengeDto,
  ): Promise<DeviceEnrollmentChallengeDto> {
    return this.lifecycle.createEnrollmentChallenge(body.publicKey);
  }

  @Post('enrollment-challenges/:challengeId/activate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LICENSING_PERMISSIONS.DEVICE_ACTIVATE)
  @ApiOperation({
    summary:
      'Verify device proof of possession and activate the registered device.',
    description:
      'Rechecks the effective signed license, current quota, installation/customer binding, challenge expiry and one-use state under the shared installation/device allocation lock.',
  })
  @ApiOkResponse({ type: ClientDeviceDto })
  @ApiConflictResponse({
    description:
      'The challenge or device state conflicts with current licensing state.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The device signature or signed entitlement is invalid.',
  })
  async activateEnrollment(
    @Param('challengeId') challengeId: string,
    @Body() body: ProveDeviceEnrollmentDto,
  ): Promise<ClientDeviceDto> {
    return this.lifecycle.activateEnrollment(challengeId, body.signature);
  }

  @Post(':deviceId/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LICENSING_PERMISSIONS.DEVICE_DEACTIVATE)
  @ApiOperation({
    summary:
      'Explicitly deactivate an active device without deleting its history.',
    description:
      'Deactivation is distinct from replacement. A signed pending replacement must first be explicitly cancelled; the device row is retained.',
  })
  @ApiOkResponse({ type: ClientDeviceDto })
  @ApiConflictResponse({
    description: 'The device is not active or has a pending replacement.',
  })
  async deactivate(
    @Param('deviceId') deviceId: string,
  ): Promise<ClientDeviceDto> {
    return this.lifecycle.deactivate(deviceId);
  }

  @Post(':deviceId/replacement-challenges')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LICENSING_PERMISSIONS.DEVICE_REPLACE)
  @ApiOperation({
    summary: 'Create a signed replacement challenge for a new device key.',
    description:
      'The old device private key is not required. The new device signs the canonical VDRQ1 request challenge; quota remains consumed by the old active device until a trusted signed response completes the exchange.',
  })
  @ApiOkResponse({ type: DeviceReplacementChallengeDto })
  @ApiConflictResponse({
    description:
      'The old device or replacement state conflicts with current licensing state.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'An active signed device entitlement is unavailable.',
  })
  async createReplacementChallenge(
    @Param('deviceId') deviceId: string,
    @Body() body: CreateDeviceReplacementChallengeDto,
  ): Promise<DeviceReplacementChallengeDto> {
    return this.lifecycle.createReplacementChallenge(deviceId, body.publicKey);
  }

  @Post('replacements/:requestId/prove')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LICENSING_PERMISSIONS.DEVICE_REPLACE)
  @ApiOperation({
    summary: 'Verify the new device proof and retain a pending VDRQ1 request.',
    description:
      'Returns the primary JSON file and text transport for the same signed VDRQ1 request. The private key is never included.',
  })
  @ApiOkResponse({ type: DeviceReplacementRequestExportDto })
  @ApiConflictResponse({
    description:
      'The challenge expired or the replacement request is no longer pending.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The new-device signature is invalid.',
  })
  async proveReplacement(
    @Param('requestId') requestId: string,
    @Body() body: ProveDeviceReplacementDto,
  ): Promise<DeviceReplacementRequestExportDto> {
    return this.lifecycle.proveReplacement(requestId, body.signature);
  }

  @Get('replacements/:requestId/export')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LICENSING_PERMISSIONS.DEVICE_REPLACE)
  @ApiOperation({
    summary: 'Export a retained signed pending replacement request.',
  })
  @ApiOkResponse({ type: DeviceReplacementRequestExportDto })
  @ApiConflictResponse({
    description: 'The replacement request is not pending or has expired.',
  })
  async replacementRequestExport(
    @Param('requestId') requestId: string,
  ): Promise<DeviceReplacementRequestExportDto> {
    return this.lifecycle.replacementRequestExport(requestId);
  }

  @Post('replacements/import')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LICENSING_PERMISSIONS.DEVICE_COMPLETE_REPLACEMENT)
  @ApiOperation({
    summary:
      'Verify and import an authority-signed VDRP1 replacement response.',
    description:
      'Accepts the signed JSON file envelope or the identical VDRP1 text artifact. Verification, binding, expiry, replay and atomic one-for-one device exchange are enforced on the server.',
  })
  @ApiOkResponse({ type: DeviceReplacementCompletionDto })
  @ApiBadRequestResponse({ description: 'Request validation failed.' })
  @ApiConflictResponse({
    description:
      'The request is cancelled, expired, stale, or already completed.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The response signature, trusted key, correlation or validity window is invalid.',
  })
  async importReplacementResponse(
    @Body() body: ImportDeviceReplacementResponseDto,
  ): Promise<DeviceReplacementCompletionDto> {
    return this.lifecycle.importReplacementResponse(body.document);
  }

  @Post('replacements/:requestId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LICENSING_PERMISSIONS.DEVICE_CANCEL_REPLACEMENT)
  @ApiOperation({
    summary: 'Durably cancel a challenge or pending replacement request.',
    description:
      'Cancellation is terminal. A matching response imported later cannot revive or complete the cancelled request.',
  })
  @ApiOkResponse({ type: DeviceReplacementResultDto })
  @ApiConflictResponse({
    description: 'The replacement is already terminal or expired.',
  })
  async cancelReplacement(
    @Param('requestId') requestId: string,
  ): Promise<DeviceReplacementResultDto> {
    return this.lifecycle.cancelReplacement(requestId);
  }
}
