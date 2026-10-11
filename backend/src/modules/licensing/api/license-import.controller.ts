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
import { ImportLicenseDocumentDto } from './dto/license.dto.js';
import {
  toLicenseStateView,
  type LicenseStateView,
} from './license-state.view.js';

/**
 * Signed license document import (L-03, ADR-0046).
 *
 * Transport-only (AR-03): parse the body, delegate to the import pipeline,
 * answer with the freshly evaluated canonical state. The route is
 * authenticated (`AuthGuard`) and authorized by one narrow permission —
 * `Licensing.License.Activate` — which the application service re-checks
 * (AR-21). There is no role-name, username or environment bypass, no
 * client-supplied license fields, and no endpoint anywhere in the product
 * that can *issue* or *sign* a document.
 */
@ApiTags('licensing')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'license', version: '1' })
export class LicenseImportController {
  constructor(
    private readonly licenseImport: LicenseImportService,
    private readonly licensing: LicensingService,
  ) {}

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(LICENSING_PERMISSIONS.LICENSE_ACTIVATE)
  @ApiOperation({
    summary: 'Import a signed license document (file or artifact).',
    description:
      'Verifies the document signature, its binding to THIS installation, its payload and its position in the retained version history, then persists it in one transaction. A future-dated document is retained and becomes effective at its own validFrom. A repeated operation is refused with 409 and changes nothing.',
  })
  @ApiOkResponse({
    description:
      'The evaluated state after the import, with the retained-version history.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiConflictResponse({
    description:
      'The document is authentic but conflicts with retained state: a repeated operation, an overlapping range without an explicit supersession, an unknown supersession target, or a license identifier already bound to another customer or installation.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The document is malformed, tampered with, issued for another installation, not active, already ended, or names capabilities this build does not know.',
  })
  async import(
    @Body() body: ImportLicenseDocumentDto,
  ): Promise<LicenseStateView & { changed: boolean; outcome: string }> {
    const result = await this.licenseImport.importDocument(body.document);
    // The response is a FRESH canonical read, never the mutation's own
    // opinion: a successful import is not itself a license state.
    const snapshot = await this.licensing.currentState();
    return {
      ...toLicenseStateView(snapshot.license, snapshot.versions),
      changed: result.changed,
      outcome: result.outcome,
    };
  }
}
