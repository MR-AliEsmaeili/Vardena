import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
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
import { LicenseRevocationService } from '../application/license-revocation.service.js';
import { LICENSING_PERMISSIONS } from '../domain/licensing-permissions.js';
import {
  ImportLicenseRevocationDto,
  LicenseRevocationImportResultDto,
} from './dto/license.dto.js';

/**
 * Signed revocation import (OD-LIC-17;
 * `docs/licensing/revocation-artifact-protocol.md`).
 *
 * Transport-only (AR-03): parse the body, hand the artifact to the service and
 * answer with the stored revocation. The route is authenticated and authorized
 * by `Licensing.License.Revoke`, which the application service re-checks
 * (AR-21). There is no endpoint here that can *create* a revocation — the
 * Owner signs it offline; this installation can only consume it.
 */
@ApiTags('licensing')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'license/revocations', version: '1' })
export class LicenseRevocationController {
  constructor(private readonly revocations: LicenseRevocationService) {}

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LICENSING_PERMISSIONS.LICENSE_REVOKE)
  @ApiOperation({
    summary: 'Import a signed license revocation artifact.',
    description:
      'Verifies the VREV1 signature, canonical form, installation/customer/license binding and staleness, then marks exactly that license revoked and writes the typed audit event in one transaction. A byte-identical duplicate returns the historical first result and changes nothing.',
  })
  @ApiOkResponse({
    type: LicenseRevocationImportResultDto,
    description: 'The stored revocation (the historical one on a replay).',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiConflictResponse({
    description:
      'The artifact is authentic but refused by retained state: the same revocation identity with different bytes, or the license already revoked.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The artifact is malformed, has an unsupported version, an unknown or mismatching key, a bad signature, a non-canonical payload, another installation or customer, an unknown target, a future date or a stale date.',
  })
  async import(
    @Body() body: ImportLicenseRevocationDto,
  ): Promise<LicenseRevocationImportResultDto> {
    return await this.revocations.importRevocation(body.document);
  }
}
