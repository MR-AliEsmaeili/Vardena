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
  LicenseCustomerTransferResultDto,
  TransferLicenseCustomerDto,
} from './dto/license.dto.js';
import { toLicenseStateView } from './license-state.view.js';

/**
 * Explicit installation customer transfer (Owner decision 2026-10-12, Q4).
 *
 * An installation's commercial customer may change ONLY here: a normal import
 * never moves it (a document naming another customer is refused as
 * `installation-customer-mismatch`), and this route requires BOTH
 * `Licensing.License.Activate` and the dedicated
 * `Licensing.Installation.TransferCustomer`. The application service re-checks
 * both (AR-21), so no other caller can reach the operation.
 *
 * Transport-only (AR-03): the body carries the signed document and the
 * operator's reason; everything licensing-relevant still comes from the
 * verified payload. The transfer and the typed
 * `license.installation.customer-transferred` audit event are written in ONE
 * transaction (see `LicensesRepository.importVersion`), so a failed transfer
 * leaves the previous customer binding and the retained license state
 * untouched.
 */
@ApiTags('licensing')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'license', version: '1' })
export class LicenseCustomerTransferController {
  constructor(
    private readonly licenseImport: LicenseImportService,
    private readonly licensing: LicensingService,
  ) {}

  @Post('customer-transfer')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(
    LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
    LICENSING_PERMISSIONS.INSTALLATION_TRANSFER_CUSTOMER,
  )
  @ApiOperation({
    summary: 'Transfer this installation to the customer of a signed license.',
    description:
      'Verifies the signed document, then — under the installation lock — rebinds the installation to the document’s customer and retains the version in one transaction, together with a typed audit event recording the previous customer, the new customer, the operation, the actor, the source, the instant and the supplied reason. A transfer that would change nothing is refused (409) instead of silently re-applying.',
  })
  @ApiOkResponse({
    type: LicenseCustomerTransferResultDto,
    description:
      'The evaluated state after the transfer, with the retained-version history and the binding facts the transaction committed.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiConflictResponse({
    description:
      'The document is authentic but conflicts with retained state: the installation is already bound to that customer, the license identifier belongs to another customer or installation, a renewal would leave a gap, the version overlaps retained history, or it reduces entitlements the release cannot resolve yet.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The document is malformed, tampered with, issued for another installation, not active, already ended, a legacy text code (which cannot express a transfer), or names capabilities this build does not know.',
  })
  async transfer(
    @Body() body: TransferLicenseCustomerDto,
  ): Promise<LicenseCustomerTransferResultDto> {
    const result = await this.licenseImport.transferCustomer(
      body.document,
      body.reason,
    );
    // The response is a FRESH canonical read plus the transaction's own binding
    // facts — never the mutation's own opinion about license state.
    const snapshot = await this.licensing.currentState();
    return {
      ...toLicenseStateView(snapshot.license, snapshot.versions),
      changed: result.changed,
      outcome: result.outcome,
      previousCustomerId: result.previousCustomerId,
      bindingChanged: result.bindingChanged,
    };
  }
}
