import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { paginatedResponseOf } from '../../../kernel/pagination/paginated-result.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { AccountsService } from '../application/accounts.service.js';
import { ACCOUNT_PERMISSIONS } from '../domain/accounting-permissions.js';
import type { AccountType } from '../domain/account.js';
import { AccountingScopeQueryDto } from './dto/accounting-scope.dto.js';
import {
  AccountResponseDto,
  CreateAccountDto,
  ListAccountsQueryDto,
  UnlinkDetailGroupDto,
  UpdateAccountDto,
} from './dto/account.dto.js';

const PaginatedAccountDto = paginatedResponseOf(AccountResponseDto);

/**
 * Chart of accounts administration (§8/§14, Task 10.3).
 *
 * Transport-only (AR-03). Hierarchy problems (foreign/disabled/postable
 * parent, cycles, level and code mismatches) are refused by the application
 * service with 422 — never by client behaviour — and cross-organization ids
 * answer 404 (AC-I-01/10/16).
 *
 * There is deliberately NO DELETE endpoint and no `Accounting.Account.Delete`
 * permission: accounts are never deleted and their codes are never reused
 * (§8.6, OQ-36); `disable` is the whole lifecycle.
 *
 * This is the ADMINISTRATION surface. The chart-tree READ projection for tree
 * consumers is a separate Accounting-owned read surface (ODR-2, Task 19):
 * `GET /api/v1/accounting/chart-tree` — read-only, code-ascending, no
 * figures. It is not a Reporting module and not a second Account master
 * (ADR-0009).
 */
@ApiTags('accounts')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'accounts', version: '1' })
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNT_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'List the accounts of one organization.',
    description:
      'The organization scope is asserted before any row is read, on every request and independently of the optional filters (ODR-3 + the deployment pin of ADR-0025).',
  })
  @ApiExtraModels(PaginatedAccountDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedAccountDto) }] },
  })
  @ApiNotFoundResponse({
    description:
      'The organization is outside the caller’s scope — unknown, outside the deployment pin, or one the principal holds no membership of. Indistinguishable from a non-existent organization (no 403, no empty page).',
  })
  async list(@Query() query: ListAccountsQueryDto): Promise<{
    items: AccountResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.accounts.listAccounts(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNT_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one account.' })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiNotFoundResponse({ description: 'Account does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<AccountResponseDto> {
    return this.accounts.getAccount(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNT_PERMISSIONS.CREATE)
  @ApiOperation({
    summary:
      'Create an account in the chart (level and pinned coding structure are derived).',
  })
  @ApiCreatedResponse({ type: AccountResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or the code shape is invalid.',
  })
  @ApiConflictResponse({
    description:
      'An account with that code already exists in this organization.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The placement violates a chart invariant (parent, level, code prefix, cycle, postable parent, depth).',
  })
  async create(@Body() body: CreateAccountDto): Promise<AccountResponseDto> {
    return this.accounts.createAccount({
      organizationId: body.organizationId,
      code: body.code,
      title: body.title,
      parentId: body.parentId,
      accountNature: body.accountNature,
      accountType: body.accountType as AccountType | undefined,
      detailGroupId: body.detailGroupId,
      isPostable: body.isPostable,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNT_PERMISSIONS.EDIT)
  @ApiOperation({
    summary:
      'Edit an account (title, nature, accountType, detailGroupId; postability, parent, and accountType only while unreferenced). The code is immutable.',
  })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiNotFoundResponse({ description: 'Account does not exist.' })
  @ApiBadRequestResponse({
    description: 'Validation failed or the code shape is invalid.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The change violates a chart invariant, or the account is already referenced by documents.',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: UpdateAccountDto,
  ): Promise<AccountResponseDto> {
    return this.accounts.updateAccount(scope.organizationId, id, {
      title: body.title,
      accountNature: body.accountNature,
      accountType: body.accountType as AccountType | undefined,
      detailGroupId: body.detailGroupId,
      isPostable: body.isPostable,
      parentId: body.parentId,
    });
  }

  @Post(':id/unlink-detail-group')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNT_PERMISSIONS.UNLINK_DETAIL_GROUP)
  @ApiOperation({
    summary:
      'Controlled destructive unlinking of Account <-> Detail relationship (OD-29-03). Atomically clears historical detail allocations and preserves monetary turnover.',
  })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiNotFoundResponse({ description: 'Account does not exist.' })
  @ApiBadRequestResponse({
    description:
      'Confirmation missing or account is not linked to a detail group.',
  })
  async unlinkDetailGroup(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: UnlinkDetailGroupDto,
  ): Promise<AccountResponseDto> {
    return this.accounts.unlinkDetailGroup(
      scope.organizationId,
      id,
      body.confirmUnlink,
    );
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNT_PERMISSIONS.ENABLE)
  @ApiOperation({ summary: 'Enable a disabled account.' })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiNotFoundResponse({ description: 'Account does not exist.' })
  async enable(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<AccountResponseDto> {
    return this.accounts.enableAccount(scope.organizationId, id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNT_PERMISSIONS.DISABLE)
  @ApiOperation({
    summary:
      'Disable an account (blocks new children and, later, new posting lines; history stays readable). Accounts are never deleted.',
  })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiNotFoundResponse({ description: 'Account does not exist.' })
  async disable(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<AccountResponseDto> {
    return this.accounts.disableAccount(scope.organizationId, id);
  }
}
