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
import {
  ReductionResolutionResultDto,
  ResolveReductionDto,
} from './dto/license.dto.js';
import { toLicenseStateView } from './license-state.view.js';

/**
 * The explicit reduction-resolution operation (PDR-11 §8.6, L-04).
 *
 * A version whose capacity or entitlement reduction conflicts with current
 * usage or the retained grant is refused by the ordinary import with 409
 * `reduction-requires-resolution` and the concrete conflicts (limits, current
 * usage, removed entitlements) in the response details — nothing is written.
 * This route is the ONLY way such a version may be applied: it carries the
 * operator's explicit, reasoned resolution, requires BOTH
 * `Licensing.License.Activate` and the dedicated
 * `Licensing.License.ResolveReduction` permission, and the application service
 * re-checks all of it (AR-21). No document field, retry or supersession name
 * can act as this authorization, and the resolution is never implicit.
 *
 * The import and the typed `license.import.reduction-resolved` audit event
 * (the conflicts the resolution actually authorized, recomputed under the
 * locks) are written in ONE transaction, so a failed resolution leaves the
 * retained state untouched. Closing an open end (a perpetual version handed
 * over to a time-limited one) is deliberately NOT resolvable here — only an
 * explicit signed supersession naming the version may do that (PDR-12).
 */
@ApiTags('licensing')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'license', version: '1' })
export class LicenseReductionResolutionController {
  constructor(
    private readonly licenseImport: LicenseImportService,
    private readonly licensing: LicensingService,
  ) {}

  @Post('reduction-resolution')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(
    LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
    LICENSING_PERMISSIONS.LICENSE_RESOLVE_REDUCTION,
  )
  @ApiOperation({
    summary:
      'Apply a signed license version whose reduction conflicts, with an explicit resolution.',
    description:
      'Verifies the signed document, then — under the installation and allocation locks — applies the version together with an audited resolution of the capacity or entitlement reductions that conflict with current usage or the retained grant, recording the conflicts the resolution authorized, the actor, the source, the instant and the supplied reason in one transaction. Only valid when the document actually conflicts; the ordinary import answers 409 reduction-requires-resolution with the concrete conflicts, and this operation exists to resolve exactly those.',
  })
  @ApiOkResponse({
    type: ReductionResolutionResultDto,
    description:
      'The evaluated state after the resolution, with the conflicts the resolution authorized.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiConflictResponse({
    description:
      'The document is authentic but conflicts with retained state: it does not conflict with usage (import it instead), the license identifier belongs to another customer or installation, the version overlaps retained history, or an open end is being closed (never operator-resolvable; issue an explicit signed supersession).',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The document is malformed, tampered with, issued for another installation, not active, already ended, backdated, or names capabilities this build does not know.',
  })
  async resolve(
    @Body() body: ResolveReductionDto,
  ): Promise<ReductionResolutionResultDto> {
    const result = await this.licenseImport.resolveReduction(
      body.document,
      body.reason,
    );
    // The response is a FRESH canonical read plus the transaction's own
    // resolution facts — never the mutation's own opinion about license state.
    const snapshot = await this.licensing.currentState();
    return {
      ...toLicenseStateView(snapshot.license, snapshot.versions),
      changed: result.changed,
      outcome: result.outcome,
      resolvedPredecessorVersionId: result.resolvedPredecessorVersionId,
      resolvedConflicts: result.resolvedConflicts,
    };
  }
}
