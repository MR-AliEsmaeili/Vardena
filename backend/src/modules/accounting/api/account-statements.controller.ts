import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { AccountStatementsService } from '../application/account-statements.service.js';
import { ACCOUNT_STATEMENT_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  AccountStatementQueryDto,
  AccountStatementResponseDto,
} from './dto/account-statement.dto.js';

/**
 * Account Statement (Task 17B Account Statement slice; Owner decisions D1–D7).
 *
 * The single, bounded, read-only statement endpoint: `GET
 * /api/v1/accounting/account-statements` for ONE postable account, ONE fiscal
 * year and an optional accounting period. Transport-only (AR-03): every rule
 * (authorization, organization scope, scope-key resolution, pagination) is
 * decided by `AccountStatementsService` and the guarded repository.
 *
 * The route carries exactly ONE method — a `GET`. There is no POST/PUT/PATCH/
 * DELETE anywhere in this controller and no write permission: the statement
 * is computed per request from the immutable ledger and never persisted
 * (AC-D-31/AC-I-19). Authorization is enforced twice (ADR-0016): route-level
 * `AuthGuard` + `AuthorizationGuard` +
 * `@RequirePermission('Accounting.AccountStatement.View')` (decision D6 — an
 * independent code, not a reuse of `Accounting.LedgerMovement.View`), and
 * again at the service entry. Organization scope is a request scope KEY
 * asserted against the deployment pin — never trusted from a client header
 * (AC-I-01).
 */
@ApiTags('accounting-account-statements')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description:
    'Authenticated but missing `Accounting.AccountStatement.View` (or the request escapes the authorization context).',
})
@Controller({ path: 'accounting/account-statements', version: '1' })
export class AccountStatementsController {
  constructor(private readonly statements: AccountStatementsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNT_STATEMENT_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'Read the account statement of one account within one fiscal year.',
    description:
      'Opening, movement rows (document date, posting timestamp, voucher/line identity, description, debit, credit, net, running balance, source document id) and closing for one postable account within one fiscal year (optional period) — exact decimal strings, debit-positive convention, intra-year sequence-based opening, totals computed over the whole window. Read-only: no write endpoint exists on this surface.',
  })
  @ApiOkResponse({ type: AccountStatementResponseDto })
  @ApiNotFoundResponse({
    description:
      'Organization, account, fiscal year, accounting period or financial area does not exist in this deployment’s scope (foreign or unknown ids are indistinguishable — 404, never 403).',
  })
  @ApiBadRequestResponse({
    description:
      'Invalid paging value, malformed id, undeclared query parameter (whitelist validation), or an explicit sort (the statement order is fixed).',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Disabled organization, non-postable account, a period outside the requested fiscal year, or a financial area that is not the year’s area.',
  })
  async getAccountStatement(
    @Query() query: AccountStatementQueryDto,
  ): Promise<AccountStatementResponseDto> {
    return this.statements.getAccountStatement(query);
  }
}
