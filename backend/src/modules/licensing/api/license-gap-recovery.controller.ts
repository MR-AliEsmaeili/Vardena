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
import { LicenseImportService } from '../application/license-import.service.js';
import { LicensingService } from '../application/licensing.service.js';
import { LICENSING_PERMISSIONS } from '../domain/licensing-permissions.js';
import { GapRecoveryResultDto, RecoverAfterGapDto } from './dto/license.dto.js';
import { toLicenseStateView } from './license-state.view.js';

/**
 * The dedicated post-gap recovery operation (Owner decision 2026-10-12, OQ-87
 * Option B, PDR-13).
 *
 * When an installation's license coverage has lapsed — every retained version
 * has ended and none is retained any longer — a NEW license identity may cover
 * that lapse ONLY through this route. The ordinary import is NOT a post-gap
 * recovery path: it answers 409
 * `post-gap-recovery-requires-dedicated-operation` with nothing written.
 *
 * The route requires BOTH `Licensing.License.Activate` and the dedicated
 * `Licensing.Installation.RecoverAfterGap` permission, and a validated
 * operator reason; the application service re-checks all of it (AR-21). The
 * recovery and the typed `license.import.recovered` audit event (the new
 * version, the lapsed license, its coverage end, the actor, the source, the
 * instant and the reason) are written in ONE transaction (see
 * `LicensesRepository.importVersion`), so a failed recovery leaves the
 * retained state untouched. A recovery never changes the installation's
 * customer binding: the document must name the customer the installation is
 * bound to (`installation-customer-mismatch` otherwise). A legacy text code
 * cannot carry a recovery (422 `recovery-requires-signed-document`).
 */
@ApiTags('licensing')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'license', version: '1' })
export class LicenseGapRecoveryController {
  constructor(
    private readonly licenseImport: LicenseImportService,
    private readonly licensing: LicensingService,
  ) {}

  @Post('gap-recovery')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(
    LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
    LICENSING_PERMISSIONS.INSTALLATION_RECOVER_AFTER_GAP,
  )
  @ApiOperation({
    summary:
      'Recover this installation after a license coverage lapse with a signed license document.',
    description:
      'Verifies the signed document, then — under the installation lock — applies the new license identity that covers a lapsed coverage window, together with a typed audit event recording the lapsed license, its coverage end, the operation, the actor, the source, the instant and the supplied reason, in one transaction. Only valid when coverage has actually lapsed; every other licensing rule (signature, binding, overlap, term rules) is unchanged.',
  })
  @ApiOkResponse({
    type: GapRecoveryResultDto,
    description:
      'The evaluated state after the recovery, with the lapsed-license facts the transaction committed.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiConflictResponse({
    description:
      'The document is authentic but conflicts with retained state: coverage has not lapsed (import it instead), the license identifier belongs to another customer or installation, a renewal would leave a gap, the version overlaps retained history, or it reduces entitlements without an authorized resolution.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The document is malformed, tampered with, issued for another installation, not active, already ended, a legacy text code (which cannot carry a recovery), or names capabilities this build does not know.',
  })
  async recover(
    @Body() body: RecoverAfterGapDto,
  ): Promise<GapRecoveryResultDto> {
    const result = await this.licenseImport.recoverAfterGap(
      body.document,
      body.reason,
    );
    // The response is a FRESH canonical read plus the transaction's own
    // lapse facts — never the mutation's own opinion about license state.
    const snapshot = await this.licensing.currentState();
    return {
      ...toLicenseStateView(snapshot.license, snapshot.versions),
      changed: result.changed,
      outcome: result.outcome,
      lapsedLicenseId: result.lapsedLicenseId,
      coverageEnd: result.coverageEnd,
    };
  }
}
