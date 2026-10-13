import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  getSchemaPath,
} from '@nestjs/swagger';
import { paginatedResponseOf } from '../../../kernel/pagination/paginated-result.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { AccountingPeriodsService } from '../application/accounting-periods.service.js';
import { ACCOUNTING_PERIOD_PERMISSIONS } from '../domain/accounting-permissions.js';
import { AccountingScopeQueryDto } from './dto/accounting-scope.dto.js';
import {
  AccountingPeriodResponseDto,
  CreateAccountingPeriodDto,
  ListAccountingPeriodsQueryDto,
  TransitionAccountingPeriodDto,
} from './dto/accounting-period.dto.js';

const PaginatedAccountingPeriodDto = paginatedResponseOf(
  AccountingPeriodResponseDto,
);

/**
 * Accounting period administration (contract §7, ADR-0026).
 *
 * Transport-only (AR-03). The list requires `organizationId`, so no
 * endpoint ever returns periods across organizations. Opening a period IS
 * creating it (the row is born `open`); there is deliberately no update
 * endpoint (no `Accounting.AccountingPeriod.Edit` code in contract §22),
 * so after opening only the lifecycle moves (`close`, `reopen`, `seal`)
 * apply — each with its own permission and a mandatory reason.
 */
@ApiTags('accounting-periods')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'accounting-periods', version: '1' })
export class AccountingPeriodsController {
  constructor(private readonly periods: AccountingPeriodsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_PERIOD_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the accounting periods of one organization.' })
  @ApiExtraModels(PaginatedAccountingPeriodDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedAccountingPeriodDto) }] },
  })
  async list(@Query() query: ListAccountingPeriodsQueryDto): Promise<{
    items: AccountingPeriodResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.periods.listAccountingPeriods(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_PERIOD_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one accounting period.' })
  @ApiOkResponse({ type: AccountingPeriodResponseDto })
  @ApiNotFoundResponse({ description: 'Accounting period does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<AccountingPeriodResponseDto> {
    return this.periods.getAccountingPeriod(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_PERIOD_PERMISSIONS.OPEN)
  @ApiOperation({
    summary: 'Open (create) an accounting period in a fiscal year.',
  })
  @ApiCreatedResponse({ type: AccountingPeriodResponseDto })
  @ApiConflictResponse({
    description: 'Sequence is already used by another period of the year.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateAccountingPeriodDto,
  ): Promise<AccountingPeriodResponseDto> {
    return this.periods.createAccountingPeriod({
      organizationId: body.organizationId,
      fiscalYearId: body.fiscalYearId,
      sequence: body.sequence,
      title: body.title,
      startDate: body.startDate,
      endDate: body.endDate,
    });
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_PERIOD_PERMISSIONS.CLOSE)
  @ApiOperation({ summary: 'Close an open accounting period.' })
  @ApiOkResponse({ type: AccountingPeriodResponseDto })
  @ApiNotFoundResponse({ description: 'Accounting period does not exist.' })
  @ApiConflictResponse({
    description: 'The accounting period moved while the request was in flight.',
  })
  async close(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: TransitionAccountingPeriodDto,
  ): Promise<AccountingPeriodResponseDto> {
    return this.periods.transitionAccountingPeriod({
      organizationId: scope.organizationId,
      id,
      transition: 'close',
      reason: body.reason,
    });
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_PERIOD_PERMISSIONS.REOPEN)
  @ApiOperation({
    summary:
      'Reopen a closed or sealed accounting period. Refused while the fiscal year is sealed.',
  })
  @ApiOkResponse({ type: AccountingPeriodResponseDto })
  @ApiNotFoundResponse({ description: 'Accounting period does not exist.' })
  @ApiConflictResponse({
    description: 'The accounting period moved while the request was in flight.',
  })
  async reopen(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: TransitionAccountingPeriodDto,
  ): Promise<AccountingPeriodResponseDto> {
    return this.periods.transitionAccountingPeriod({
      organizationId: scope.organizationId,
      id,
      transition: 'reopen',
      reason: body.reason,
    });
  }

  @Post(':id/seal')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_PERIOD_PERMISSIONS.SEAL)
  @ApiOperation({ summary: 'Seal a closed accounting period.' })
  @ApiOkResponse({ type: AccountingPeriodResponseDto })
  @ApiNotFoundResponse({ description: 'Accounting period does not exist.' })
  @ApiConflictResponse({
    description: 'The accounting period moved while the request was in flight.',
  })
  async seal(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: TransitionAccountingPeriodDto,
  ): Promise<AccountingPeriodResponseDto> {
    return this.periods.transitionAccountingPeriod({
      organizationId: scope.organizationId,
      id,
      transition: 'seal',
      reason: body.reason,
    });
  }
}
