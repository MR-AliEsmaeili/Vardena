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
import { LicenseActivationService } from '../application/license-activation.service.js';
import { LicensingService } from '../application/licensing.service.js';
import { LICENSING_PERMISSIONS } from '../domain/licensing-permissions.js';
import {
  ActivateLicenseDto,
  LicenseImportResultDto,
} from './dto/license.dto.js';
import { toLicenseStateView } from './license-state.view.js';

/**
 * Installation license activation (L-02).
 *
 * Transport-only (AR-03). The route is authenticated (`AuthGuard`) and
 * authorized by one narrow permission — `Licensing.License.Activate` — which
 * the application service re-checks (AR-21). There is deliberately no public
 * activation endpoint, no role-name or username check, and no generic admin
 * bypass: holding the permission is the only way in.
 *
 * L-03: this route is the compatibility alias for the legacy text code. It
 * shares the ONE import pipeline (and therefore verification, binding,
 * validation and the audit trail) with `POST /license/import`; its documented
 * `VLIC1` lifecycle semantics are unchanged (design §5).
 */
@ApiTags('licensing')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'license', version: '1' })
export class LicenseActivationController {
  constructor(
    private readonly activation: LicenseActivationService,
    private readonly licensing: LicensingService,
  ) {}

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LICENSING_PERMISSIONS.LICENSE_ACTIVATE)
  @ApiOperation({
    summary: 'Activate or replace the installation license from a signed code.',
    description:
      'Verifies the code signature, its binding to THIS installation and its lifecycle, persists it, and returns the evaluated state. Re-submitting the current code is an idempotent success.',
  })
  @ApiOkResponse({
    type: LicenseImportResultDto,
    description:
      'The evaluated state after activation, with the same mutation receipt as import.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiUnprocessableEntityResponse({
    description:
      'The license code is malformed, tampered with, issued for another installation, expired, or suspended.',
  })
  async activate(
    @Body() body: ActivateLicenseDto,
  ): Promise<LicenseImportResultDto> {
    const result = await this.activation.activate(body.code);
    const snapshot = await this.licensing.currentState();
    return {
      ...toLicenseStateView(snapshot.license, snapshot.versions),
      changed: result.changed,
      outcome: result.outcome,
    };
  }
}
