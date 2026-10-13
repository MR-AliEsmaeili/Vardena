import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { TrialBalanceService } from '../application/trial-balance.service.js';
import { TRIAL_BALANCE_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  TrialBalanceQueryDto,
  TrialBalanceResponseDto,
} from './dto/trial-balance.dto.js';

const PaginatedTrialBalanceDto = paginatedResponseOf(TrialBalanceResponseDto);

/** Explicit, read-only Trial Balance report API. */
@ApiTags('accounting-trial-balance')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing Accounting.TrialBalance.View.',
})
@Controller({ path: 'accounting/trial-balance', version: '1' })
export class TrialBalanceController {
  constructor(private readonly trialBalance: TrialBalanceService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(TRIAL_BALANCE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Read the bounded Trial Balance.',
    description:
      'Returns exact Opening, Debit Turnover, Credit Turnover, Period Net and Closing. POSTING rows use their ledger activity; AGGREGATION rows roll up POSTING descendants only. The optional sort is limited to the documented allow-list. No account classification or financial-statement columns are inferred.',
  })
  @ApiExtraModels(PaginatedTrialBalanceDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedTrialBalanceDto) }] },
  })
  @ApiBadRequestResponse({
    description:
      'Invalid paging/date/filter value, unsupported query parameter, or sort field outside the documented allow-list.',
  })
  @ApiNotFoundResponse({
    description:
      'Organization, financial area, fiscal year, period, account, or hierarchy root is not in the request organization scope.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The area/year/period scope is inconsistent, the organization is disabled, or the date range escapes the fiscal year.',
  })
  async list(@Query() query: TrialBalanceQueryDto): Promise<{
    items: TrialBalanceResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const result = await this.trialBalance.list(query);
    return {
      items: result.items as TrialBalanceResponseDto[],
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }
}
